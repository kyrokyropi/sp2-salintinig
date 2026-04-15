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

import nltk

nltk.download("punkt_tab", quiet=True)
nltk.download("punkt", quiet=True)

import edge_tts
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
_use_angle_cls = os.getenv("PADDLE_USE_ANGLE_CLS", "0") == "1"


def _get_ocr_model():
    global _ocr_model
    if _ocr_model is None:
        with _ocr_lock:
            if _ocr_model is None:
                from paddleocr import PaddleOCR

                print("Loading PaddleOCR model...")
                _ocr_model = PaddleOCR(use_angle_cls=_use_angle_cls, lang="en", show_log=False)
                print("PaddleOCR model loaded.")
    return _ocr_model

# ── EasyNMT translation model ─────────────────────────────────────────────────
# EasyNMT is memory-heavy; keep it optional and lazy-loaded.
_enable_easynmt = os.getenv("ENABLE_EASYNMT", "0") == "1"
nmt_model = None
_nmt_lock = Lock()


def _get_nmt_model():
    global nmt_model
    if not _enable_easynmt:
        raise RuntimeError("Translation disabled on this deployment")
    if nmt_model is None:
        with _nmt_lock:
            if nmt_model is None:
                from easynmt import EasyNMT

                print("Loading EasyNMT translation model...")
                nmt_model = EasyNMT("opus-mt")
                # Pre-download both language-pair models so the first
                # real request doesn't trigger a ~300 MB HuggingFace download.
                print("Pre-warming tl->en model...")
                nmt_model.translate("Kamusta", target_lang="en", source_lang="tl")
                print("Pre-warming en->tl model...")
                nmt_model.translate("Hello", target_lang="tl", source_lang="en")
                print("EasyNMT model loaded and warmed.")
    return nmt_model

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


@app.post("/ocr", response_model=OCRResponse)
async def run_ocr(req: OCRRequest):
    # Decode image
    try:
        b64 = req.image
        if "," in b64:
            b64 = b64.split(",", 1)[1]
        img_bytes = base64.b64decode(b64)
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    # PaddleOCR 2.x works with numpy arrays directly
    import numpy as np
    img_np = np.array(img)
    ocr_model = _get_ocr_model()

    # Chunk tall images into horizontal strips to avoid memory overload.
    # Each strip is at most OCR_STRIP_HEIGHT pixels tall.
    OCR_STRIP_HEIGHT = int(os.getenv("OCR_STRIP_HEIGHT", "1000"))
    h, w = img_np.shape[:2]
    strips = [
        img_np[y : y + OCR_STRIP_HEIGHT]
        for y in range(0, h, OCR_STRIP_HEIGHT)
    ]

    lines: list[str] = []
    confidences: list[float] = []

    for strip in strips:
        try:
            results = ocr_model.ocr(strip, cls=_use_angle_cls)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"OCR failed: {e}")

        if results:
            for page in results:
                if page is None:
                    continue
                for item in page:
                    # item = (box, (text, confidence))
                    _, (text, conf) = item
                    if text and text.strip():
                        lines.append(text.strip())
                        confidences.append(float(conf))

    avg_conf = (sum(confidences) / len(confidences) * 100) if confidences else 0.0

    raw_text = "\n".join(lines) if lines else ""
    corrected_text = _correct_text(raw_text) if raw_text else ""

    return OCRResponse(
        text=corrected_text,
        confidence=round(avg_conf, 1),
    )


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
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text is empty")
    try:
        model = _get_nmt_model()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))

    source = req.source_lang.strip() or _detect_lang(req.text)
    # Normalise: only 'en' and 'tl' supported (display names)
    source = "tl" if source in ("tl", "fil") else "en"
    target = "en" if source == "tl" else "tl"

    source_code = source
    target_code = target

    # Split into sentence chunks to avoid overloading the model's memory.
    # NLTK punkt tokeniser is already downloaded at startup.
    try:
        from nltk.tokenize import sent_tokenize
        sentences = sent_tokenize(req.text)
    except Exception:
        # Fallback: split on newlines if NLTK fails
        sentences = [s for s in req.text.splitlines() if s.strip()] or [req.text]

    CHUNK_SIZE = 4  # sentences per batch
    translated_parts: list[str] = []
    try:
        for i in range(0, len(sentences), CHUNK_SIZE):
            chunk = " ".join(sentences[i : i + CHUNK_SIZE])
            result = model.translate(chunk, target_lang=target_code, source_lang=source_code)
            translated_parts.append(result)
        translated = " ".join(translated_parts)
    except Exception as e:
        print(f"Translation error: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Translation failed: {e}")

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
    return {"status": "ok"}
