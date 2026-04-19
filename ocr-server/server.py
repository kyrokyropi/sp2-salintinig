"""
PaddleOCR + edge-tts + EasyNMT FastAPI backend

Setup:
  python3 -m venv venv
  venv/bin/pip install -r requirements.txt

Run:
  PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \\
    venv/bin/uvicorn server:app --host 0.0.0.0 --port 8000

Expose publicly with ngrok so Expo Go can reach it:
  ngrok http 8000
Then paste the ngrok https URL into components/ocr-service.ts as PADDLEOCR_URL.
"""

import asyncio
import base64
import io
import os
import tempfile
import traceback
from threading import Lock

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image
from pydantic import BaseModel

# edge-tts voice map — Microsoft neural voices, no API key needed
_TTS_VOICES: dict[str, str] = {
    "en": "en-US-AriaNeural",
    "tl": "fil-PH-BlessicaNeural",
}

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


# ── OCR model ────────────────────────────────────────────────────────────────
# Lazy-load OCR so the web service can bind a port quickly on Render.
_ocr_model = None
_ocr_lock = Lock()


def _get_ocr_model():
    global _ocr_model
    if _ocr_model is None:
        with _ocr_lock:
            if _ocr_model is None:
                from paddleocr import PaddleOCR

                print("Loading PaddleOCR model...")
                _ocr_model = PaddleOCR(
                    use_angle_cls=False,
                    lang="en",
                    show_log=False,
                    # Use mobile/slim models — much smaller memory footprint.
                    det_model_dir=None,
                    # Limit the det model's internal resize.  Default 960
                    # causes huge feature-map allocations on text-dense images.
                    det_limit_side_len=480,
                    det_limit_type="max",
                    # Small rec batch to avoid memory spikes when many text
                    # regions are detected on a dense page.
                    rec_batch_num=2,
                    # Disable GPU to avoid VRAM issues; CPU is fine for OCR.
                    use_gpu=False,
                    # Enable mkldnn for faster CPU inference without extra RAM.
                    enable_mkldnn=True,
                    # Thread count — keep low to limit parallel memory use.
                    cpu_threads=2,
                )
                print("PaddleOCR model loaded.")
    return _ocr_model

# ── CTranslate2 + int8-quantized opus-mt ─────────────────────────────────────
# Lazy-loaded per direction. Each int8 model is ~75 MB on disk / ~150 MB RAM.
# Models auto-unload after NMT_IDLE_SECONDS of inactivity to free RAM.
_enable_nmt = os.getenv("ENABLE_NMT", "1") == "1"
_NMT_IDLE_SECONDS = int(os.getenv("NMT_IDLE_SECONDS", "120"))

# Pre-converted, pre-quantized CTranslate2 checkpoints (Android-targeted int8).
# Each repo is ~75 MB on disk and loads with compute_type="int8" — smallest option
# on the Hub that actually ships a valid model.bin.
_CT2_REPOS: dict[str, str] = {
    "tl->en": "manancode/opus-mt-tl-en-ctranslate2-android",
    "en->tl": "manancode/opus-mt-en-tl-ctranslate2-android",
}
# Helsinki-NLP originals — used only for loading the tokenizer (small files).
_HF_TOKENIZER_REPOS: dict[str, str] = {
    "tl->en": "Helsinki-NLP/opus-mt-tl-en",
    "en->tl": "Helsinki-NLP/opus-mt-en-tl",
}

# Each entry: {"translator": ctranslate2.Translator, "tokenizer": AutoTokenizer, "last_used": float}
_nmt_cache: dict[str, dict] = {}
_nmt_lock = Lock()
_nmt_last_gc = 0.0


def _convert_and_load_ct2(direction: str):
    """Download pre-converted CTranslate2 opus-mt and load at int8 compute."""
    import time
    import ctranslate2
    from transformers import AutoTokenizer
    from huggingface_hub import snapshot_download

    ct2_repo = _CT2_REPOS[direction]
    tok_repo = _HF_TOKENIZER_REPOS[direction]

    print(f"[nmt] Downloading pre-converted CT2 model: {ct2_repo}...")
    ct2_dir = snapshot_download(repo_id=ct2_repo)

    print(f"[nmt] Loading {direction} translator (int8 compute)...")
    translator = ctranslate2.Translator(
        ct2_dir, device="cpu", compute_type="int8", inter_threads=1, intra_threads=2
    )
    tokenizer = AutoTokenizer.from_pretrained(tok_repo)
    return {"translator": translator, "tokenizer": tokenizer, "last_used": time.time()}


def _unload_idle_nmt():
    """Drop translators that haven't been used in NMT_IDLE_SECONDS."""
    import time
    import gc
    global _nmt_last_gc
    now = time.time()
    if now - _nmt_last_gc < 10:
        return
    _nmt_last_gc = now
    stale = [k for k, v in _nmt_cache.items() if now - v["last_used"] > _NMT_IDLE_SECONDS]
    for k in stale:
        print(f"[nmt] Unloading idle translator: {k}")
        entry = _nmt_cache.pop(k)
        # CT2 translator releases memory when the Python object is collected.
        del entry
    if stale:
        gc.collect()


_nmt_failures: dict[str, tuple[float, str]] = {}  # direction -> (timestamp, error msg)
_NMT_FAIL_COOLDOWN = 60  # retry load this often after a failure


def _get_ct2(direction: str):
    import time
    if not _enable_nmt:
        raise RuntimeError("Translation disabled on this deployment")
    if direction not in _CT2_REPOS:
        raise ValueError(f"Unsupported direction: {direction}")
    _unload_idle_nmt()
    # Fast-fail if a recent load attempt failed, to avoid a retry storm.
    if direction in _nmt_failures:
        ts, err = _nmt_failures[direction]
        if time.time() - ts < _NMT_FAIL_COOLDOWN:
            raise RuntimeError(f"Translator load failed recently: {err}")
        del _nmt_failures[direction]
    if direction not in _nmt_cache:
        with _nmt_lock:
            if direction not in _nmt_cache:
                try:
                    _nmt_cache[direction] = _convert_and_load_ct2(direction)
                except Exception as e:
                    _nmt_failures[direction] = (time.time(), str(e))
                    raise
    _nmt_cache[direction]["last_used"] = time.time()
    return _nmt_cache[direction]


def _translate_ct2(text: str, direction: str) -> str:
    entry = _get_ct2(direction)
    tokenizer = entry["tokenizer"]
    translator = entry["translator"]

    # opus-mt hard caps input at 512 tokens; stay well under to leave room for EOS/specials.
    MAX_INPUT_TOKENS = 400
    ids = tokenizer.encode(text, add_special_tokens=True)
    if len(ids) <= MAX_INPUT_TOKENS:
        id_batches = [ids]
    else:
        id_batches = [ids[i : i + MAX_INPUT_TOKENS] for i in range(0, len(ids), MAX_INPUT_TOKENS)]

    token_batches = [tokenizer.convert_ids_to_tokens(b) for b in id_batches]
    results = translator.translate_batch(
        token_batches,
        beam_size=2,
        max_batch_size=1,
        max_decoding_length=512,
    )
    out_parts = []
    for r in results:
        out_tokens = r.hypotheses[0]
        out_parts.append(
            tokenizer.decode(tokenizer.convert_tokens_to_ids(out_tokens), skip_special_tokens=True)
        )
    return " ".join(p for p in out_parts if p)

# ── Spell correction (symspellpy) ────────────────────────────────────────────
try:
    from symspellpy import SymSpell, Verbosity
    import importlib.resources as _ir
    import symspellpy as _symspellpy_pkg

    _sym_spell = SymSpell(max_dictionary_edit_distance=2, prefix_length=7)
    _dict_path = str(_ir.files(_symspellpy_pkg) / "frequency_dictionary_en_82_765.txt")
    _sym_spell.load_dictionary(_dict_path, term_index=0, count_index=1)
    print("SymSpell dictionary loaded.")

    def _correct_text(text: str) -> str:
        corrected_lines = []
        for line in text.splitlines():
            words = line.split()
            corrected_words = []
            for word in words:
                # Keep punctuation/numbers/short tokens as-is
                stripped = word.strip(".,!?;:\"'()-")
                if not stripped.isalpha() or len(stripped) <= 2:
                    corrected_words.append(word)
                    continue
                suggestions = _sym_spell.lookup(
                    stripped.lower(), Verbosity.CLOSEST, max_edit_distance=2
                )
                if suggestions:
                    fix = suggestions[0].term
                    # Preserve original capitalisation
                    if stripped.isupper():
                        fix = fix.upper()
                    elif stripped[0].isupper():
                        fix = fix.capitalize()
                    corrected_words.append(word.replace(stripped, fix))
                else:
                    corrected_words.append(word)
            corrected_lines.append(" ".join(corrected_words))
        return "\n".join(corrected_lines)

except Exception as _e:
    print(f"Warning: symspellpy not available: {_e}")
    def _correct_text(text: str) -> str:  # type: ignore[misc]
        return text

# ── Language detection ────────────────────────────────────────────────────────
try:
    from langdetect import detect as _langdetect
    def _detect_lang(text: str) -> str:
        try:
            lang = _langdetect(text)
            return "tl" if lang in ("tl", "fil") else "en"
        except Exception:
            return "en"
except ImportError:
    def _detect_lang(text: str) -> str:  # type: ignore[misc]
        return "en"


class OCRRequest(BaseModel):
    # Plain base64 OR data URI (data:image/...;base64,...) — both accepted
    image: str


class OCRResponse(BaseModel):
    text: str
    confidence: float


def _run_ocr_blocking(img_bytes: bytes) -> tuple[str, float]:
    """Heavy OCR work — PIL decode, resize, PaddleOCR inference. Must run in a
    thread so the asyncio event loop stays free to answer health checks."""
    import numpy as np
    import gc

    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    del img_bytes
    gc.collect()

    MAX_WIDTH  = int(os.getenv("OCR_MAX_WIDTH",  "600"))
    MAX_HEIGHT = int(os.getenv("OCR_MAX_HEIGHT", "1500"))
    MAX_PIXELS = int(os.getenv("OCR_MAX_PIXELS", "800000"))
    w_orig, h_orig = img.size

    scale = min(MAX_WIDTH / max(w_orig, 1), MAX_HEIGHT / max(h_orig, 1), 1.0)
    if w_orig * h_orig * scale * scale > MAX_PIXELS:
        scale = (MAX_PIXELS / (w_orig * h_orig)) ** 0.5

    if scale < 1.0:
        img = img.resize(
            (max(1, int(w_orig * scale)), max(1, int(h_orig * scale))),
            Image.LANCZOS,
        )

    img_np = np.array(img)
    del img
    gc.collect()

    ocr_model = _get_ocr_model()

    OCR_STRIP_HEIGHT = int(os.getenv("OCR_STRIP_HEIGHT", "300"))
    h, _w = img_np.shape[:2]

    lines: list[str] = []
    conf_sum = 0.0
    conf_count = 0

    for y in range(0, h, OCR_STRIP_HEIGHT):
        strip = img_np[y : y + OCR_STRIP_HEIGHT].copy()
        try:
            results = ocr_model.ocr(strip, cls=False)
        finally:
            del strip

        if results:
            for page in results:
                if page is None:
                    continue
                for item in page:
                    _, (text, conf) = item
                    if text and text.strip():
                        lines.append(text.strip())
                        conf_sum += float(conf)
                        conf_count += 1
        del results
        gc.collect()

    del img_np
    gc.collect()

    avg_conf = (conf_sum / conf_count * 100) if conf_count else 0.0
    raw_text = "\n".join(lines) if lines else ""
    corrected_text = _correct_text(raw_text) if raw_text else ""
    return corrected_text, round(avg_conf, 1)


@app.post("/ocr", response_model=OCRResponse)
async def run_ocr(req: OCRRequest):
    # ── Decode image & free the base64 payload ASAP ──────────────────────
    try:
        b64 = req.image
        if "," in b64:
            b64 = b64.split(",", 1)[1]
        img_bytes = base64.b64decode(b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")
    finally:
        req.image = ""

    try:
        text, conf = await asyncio.to_thread(_run_ocr_blocking, img_bytes)
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ocr] failed: {e!r}")
        raise HTTPException(status_code=500, detail=f"OCR failed: {e}")

    return OCRResponse(text=text, confidence=conf)


class TTSRequest(BaseModel):
    text: str
    language: str = "tl"  # "tl" = Tagalog/Filipino, "en" = English


@app.post("/tts")
async def run_tts(req: TTSRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text is empty")

    lang = req.language if req.language in ("tl", "en") else "tl"
    voice = _TTS_VOICES[lang]

    try:
        import edge_tts
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
            tmp_path = tmp.name
        communicate = edge_tts.Communicate(text=req.text, voice=voice)
        await communicate.save(tmp_path)
        with open(tmp_path, "rb") as f:
            audio_bytes = f.read()
        os.unlink(tmp_path)
        return Response(content=audio_bytes, media_type="audio/mpeg")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS failed: {e}")


# ── Translation ───────────────────────────────────────────────────────────────

class TranslateRequest(BaseModel):
    text: str
    source_lang: str = ""  # auto-detect if empty


class TranslateResponse(BaseModel):
    translated: str
    from_lang: str
    to_lang: str


@app.post("/translate", response_model=TranslateResponse)
async def translate_text(req: TranslateRequest):
    import gc
    import re

    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text is empty")

    text = req.text
    forced_source = req.source_lang.strip()
    doc_source = forced_source or _detect_lang(text)
    doc_source = "tl" if doc_source in ("tl", "fil") else "en"
    doc_target = "en" if doc_source == "tl" else "tl"

    # Lightweight sentence split — keeps tokenizer buffers small.
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
    if not sentences:
        sentences = [text]

    translated_parts: list[str] = []
    try:
        for sent in sentences:
            if not sent.strip():
                continue
            # Per-sentence language detection so mixed-language docs work.
            # If user forced a source lang, honor it for every sentence.
            if forced_source:
                sent_source = doc_source
            else:
                sent_source = _detect_lang(sent)
                sent_source = "tl" if sent_source in ("tl", "fil") else "en"
            sent_target = "en" if sent_source == "tl" else "tl"
            if sent_source == doc_target:
                # Sentence is already in the target language — pass through.
                translated_parts.append(sent)
                continue
            sent_direction = f"{sent_source}->{sent_target}"
            try:
                out = _translate_ct2(sent, sent_direction)
            except Exception as e:
                print(f"[translate] sentence failed ({sent_direction}): {e!r} | {sent[:80]!r}")
                out = ""
            if out.strip():
                translated_parts.append(out)
            else:
                # Fall back to original so the sentence isn't silently dropped.
                print(f"[translate] empty output, keeping original: {sent[:80]!r}")
                translated_parts.append(sent)
            gc.collect()
        translated = " ".join(translated_parts)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        print(f"Translation error: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Translation failed: {e}")

    source = doc_source
    target = doc_target

    return TranslateResponse(translated=translated, from_lang=source, to_lang=target)


class DetectRequest(BaseModel):
    text: str


@app.post("/detect")
async def detect_language(req: DetectRequest):
    lang = _detect_lang(req.text.strip() or "")
    return {"language": lang}


class CorrectRequest(BaseModel):
    text: str


class CorrectResponse(BaseModel):
    corrected: str


@app.post("/correct", response_model=CorrectResponse)
async def correct_text(req: CorrectRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text is empty")
    return CorrectResponse(corrected=_correct_text(req.text))


@app.get("/health")
async def health():
    return {"status": "ok", "nmt_loaded": list(_nmt_cache.keys())}


@app.on_event("startup")
async def _start_idle_sweeper():
    # Warm up the PaddleOCR model on boot so the first real /ocr request doesn't
    # spend ~30s loading weights (which can cause APK clients to time out).
    async def warm_ocr():
        try:
            await asyncio.to_thread(_get_ocr_model)
            print("[ocr] warm-up complete")
        except Exception as e:
            print(f"[ocr] warm-up failed: {e}")
    asyncio.create_task(warm_ocr())

    async def sweep():
        while True:
            await asyncio.sleep(30)
            try:
                _unload_idle_nmt()
            except Exception as e:
                print(f"[nmt] sweep error: {e}")
    asyncio.create_task(sweep())
