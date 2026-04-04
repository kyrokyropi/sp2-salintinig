# OCR Scanner App

A React Native (Expo) app that scans text from images using PaddleOCR running on a local FastAPI backend.

```
sp2/
├── myApp/        ← Expo app (React Native)
└── ocr-server/   ← Python FastAPI + PaddleOCR backend
```

---

## Prerequisites

- [Node.js](https://nodejs.org) (for the Expo app)
- Python 3.12 (for the backend)
- [Expo Go](https://expo.dev/go) installed on your phone
- [ngrok](https://ngrok.com) to expose the local server to your phone

### Install ngrok (first time only)
```bash
curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc \
  | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
echo "deb https://ngrok-agent.s3.amazonaws.com buster main" \
  | sudo tee /etc/apt/sources.list.d/ngrok.list
sudo apt update && sudo apt install ngrok
ngrok config add-authtoken <your-token>   # free account at ngrok.com
```

---

## First-time setup

### 1. Backend
```bash
cd ~/sp/sp2/ocr-server
python3 -m venv venv
venv/bin/pip install -r requirements.txt
```
> The first server start will download PaddleOCR models (~100 MB). They are cached after that.

### 2. Expo app
```bash
cd ~/sp/sp2/myApp
npm install
```

---

## Running the app

You need **three terminals** open at the same time.

### Terminal 1 — PaddleOCR server
```bash
cd ~/sp/sp2/ocr-server
PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True venv/bin/uvicorn server:app --host 0.0.0.0 --port 8000
```
Wait until you see:
```
Application startup complete.
Uvicorn running on http://0.0.0.0:8000
```


### Terminal 2 — Expo
```bash
cd ~/sp/sp2/myApp
npx expo start --tunnel
```
Scan the QR code with Expo Go on your phone.

---

## Connecting the app to the server

Each time ngrok gives you a new URL, update it in:

**`myApp/components/ocr-service.ts`**
```ts
export const PADDLEOCR_URL = "https://xxxx.ngrok-free.app";
```

Then save — Expo will hot-reload automatically.

---

## Verify the server is working

```bash
curl http://localhost:8000/health
# → {"status":"ok"}
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `ModuleNotFoundError: No module named 'setuptools'` | `venv/bin/pip install setuptools` |
| `venv/bin/uvicorn: cannot execute` | The venv was moved. Delete `venv/` and run `python3 -m venv venv && venv/bin/pip install -r requirements.txt` again |
| App shows "Failed to process image" | Check the server is running and `PADDLEOCR_URL` matches the current ngrok URL |
| ngrok URL changed | Update `PADDLEOCR_URL` in `ocr-service.ts` and save |
| Server error on first OCR request | Models are still downloading — wait a moment and try again |
