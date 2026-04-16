export const PADDLEOCR_URL = "https://sp2-salintinig.onrender.com";


export type OCRResult = {
  text: string;
  confidence: number;
};

export async function correctText(text: string): Promise<string> {
  const response = await fetch(`${PADDLEOCR_URL}/correct`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Correction error ${response.status}: ${body}`);
  }
  const data = await response.json();
  return data.corrected ?? text;
}

export async function recognizeImage(base64: string): Promise<OCRResult> {
  const response = await fetch(`${PADDLEOCR_URL}/ocr`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
    },
    body: JSON.stringify({ image: base64 }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Server error ${response.status}: ${body}`);
  }

  const data = await response.json();
  return { text: data.text ?? "", confidence: data.confidence ?? 0 };
}
