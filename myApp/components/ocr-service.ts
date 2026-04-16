export const PADDLEOCR_URL = "https://sp2-salintinig.onrender.com";

const OCR_TIMEOUT_MS = 120_000;     // 2 minutes for OCR (large images)
const CORRECT_TIMEOUT_MS = 60_000;  // 1 minute per correction chunk
const CORRECT_CHUNK_SIZE = 500;     // characters per chunk sent to /correct

export type OCRResult = {
  text: string;
  confidence: number;
};

function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

export async function correctText(text: string): Promise<string> {
  // Split long text into chunks so the server doesn't time out
  if (text.length > CORRECT_CHUNK_SIZE) {
    const chunks: string[] = [];
    // Split on sentence-ending punctuation to keep chunks meaningful
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= CORRECT_CHUNK_SIZE) {
        chunks.push(remaining);
        break;
      }
      // Find a sentence break within the chunk window
      let splitIdx = -1;
      for (let i = CORRECT_CHUNK_SIZE; i >= CORRECT_CHUNK_SIZE / 2; i--) {
        if ('.!?\n'.includes(remaining[i])) {
          splitIdx = i + 1;
          break;
        }
      }
      if (splitIdx === -1) {
        // No sentence break found — split on last space
        const spaceIdx = remaining.lastIndexOf(' ', CORRECT_CHUNK_SIZE);
        splitIdx = spaceIdx > 0 ? spaceIdx + 1 : CORRECT_CHUNK_SIZE;
      }
      chunks.push(remaining.slice(0, splitIdx));
      remaining = remaining.slice(splitIdx);
    }

    const correctedChunks = await Promise.all(
      chunks.map((chunk) => correctSingleChunk(chunk)),
    );
    return correctedChunks.join('');
  }

  return correctSingleChunk(text);
}

async function correctSingleChunk(text: string): Promise<string> {
  const response = await fetchWithTimeout(
    `${PADDLEOCR_URL}/correct`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({ text }),
    },
    CORRECT_TIMEOUT_MS,
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Correction error ${response.status}: ${body}`);
  }
  const data = await response.json();
  return data.corrected ?? text;
}

export async function recognizeImage(base64: string): Promise<OCRResult> {
  const response = await fetchWithTimeout(
    `${PADDLEOCR_URL}/ocr`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
      },
      body: JSON.stringify({ image: base64 }),
    },
    OCR_TIMEOUT_MS,
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Server error ${response.status}: ${body}`);
  }

  const data = await response.json();
  return { text: data.text ?? "", confidence: data.confidence ?? 0 };
}
