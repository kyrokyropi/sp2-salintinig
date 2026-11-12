import { fetchWithTimeout, PADDLEOCR_URL } from './ocr-service';

export type TTSLanguage = 'tl' | 'en';

/**
 * Fetches synthesized speech from the FastAPI /tts endpoint (edge-tts).
 * Returns a base64-encoded MP3 string ready for expo-av.
 */
export async function fetchTTS(text: string, language: TTSLanguage): Promise<string> {
  const response = await fetchWithTimeout(`${PADDLEOCR_URL}/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify({ text, language }),
  }, 90_000);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`TTS error ${response.status}: ${body}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export type TranslateResult = {
  translated: string;
  from_lang: TTSLanguage;
  to_lang: TTSLanguage;
};

/**
 * Auto-detects the source and translates to the requested language, or the other
 * language when no target is supplied (English ↔ Filipino).
 */
export async function translateText(text: string, targetLang?: TTSLanguage): Promise<TranslateResult> {
  const response = await fetchWithTimeout(`${PADDLEOCR_URL}/translate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify({ text, target_lang: targetLang }),
  }, 120_000);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Translate error ${response.status}: ${body}`);
  }

  return response.json() as Promise<TranslateResult>;
}

/**
 * Translates `text` to the specified target language.
 * If the text is already in `targetLang`, it is returned as-is.
 */
export async function translateTo(text: string, targetLang: TTSLanguage): Promise<string> {
  const result = await translateText(text, targetLang);
  return result.translated;
}

/**
 * Detects whether `text` is English ('en') or Filipino/Tagalog ('tl').
 */
export async function detectLanguage(text: string): Promise<TTSLanguage> {
  const response = await fetchWithTimeout(`${PADDLEOCR_URL}/detect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify({ text }),
  }, 15_000);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Detect error ${response.status}: ${body}`);
  }

  const data = await response.json();
  return (data.language === 'tl' ? 'tl' : 'en') as TTSLanguage;
}
