import { PADDLEOCR_URL } from './ocr-service';

export type TTSLanguage = 'tl' | 'en';

/**
 * Fetches synthesized speech from the FastAPI /tts endpoint (edge-tts).
 * Returns a base64-encoded MP3 string ready for expo-av.
 */
export async function fetchTTS(text: string, language: TTSLanguage): Promise<string> {
  const response = await fetch(`${PADDLEOCR_URL}/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify({ text, language }),
  });

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
 * Auto-detects the language of `text` and translates it to the other language
 * (English ↔ Filipino). Returns the translated text plus source/target language codes.
 */
export async function translateText(text: string): Promise<TranslateResult> {
  const response = await fetch(`${PADDLEOCR_URL}/translate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify({ text }),
  });

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
  const srcLang = await detectLanguage(text);
  if (srcLang === targetLang) return text;
  const result = await translateText(text);
  return result.translated;
}

/**
 * Detects whether `text` is English ('en') or Filipino/Tagalog ('tl').
 */
export async function detectLanguage(text: string): Promise<TTSLanguage> {
  const response = await fetch(`${PADDLEOCR_URL}/detect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Detect error ${response.status}: ${body}`);
  }

  const data = await response.json();
  return (data.language === 'tl' ? 'tl' : 'en') as TTSLanguage;
}
