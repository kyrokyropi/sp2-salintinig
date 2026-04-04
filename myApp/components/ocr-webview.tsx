import { useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { StyleSheet } from 'react-native';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';

export type OCRWebViewRef = {
  recognize: (base64Image: string) => void;
};

type Props = {
  onResult: (text: string, confidence?: number) => void;
  onError: (error: string) => void;
  onProgress?: (progress: number) => void;
};

const HTML = `
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"></script>
</head>
<body>
<canvas id="cv" style="display:none"></canvas>
<script>
  // ─── Image Preprocessing Pipeline ───
  function preprocessImage(base64) {
    return new Promise(function(resolve) {
      var img = new Image();
      img.onload = function() {
        var canvas = document.getElementById('cv');
        var ctx = canvas.getContext('2d');

        // 1. Scale up small images (Tesseract works best at ~300 DPI / large text)
        var scale = 1;
        if (img.width < 1000) {
          scale = 1500 / img.width;
        }
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);

        // Draw scaled image
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        var data = imageData.data;

        // 2. Convert to grayscale
        for (var i = 0; i < data.length; i += 4) {
          var gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
          data[i] = gray;
          data[i+1] = gray;
          data[i+2] = gray;
        }

        // 3. Increase contrast (stretch histogram)
        var min = 255, max = 0;
        for (var i = 0; i < data.length; i += 4) {
          if (data[i] < min) min = data[i];
          if (data[i] > max) max = data[i];
        }
        var range = max - min || 1;
        for (var i = 0; i < data.length; i += 4) {
          var val = Math.round(((data[i] - min) / range) * 255);
          data[i] = val;
          data[i+1] = val;
          data[i+2] = val;
        }

        // 4. Unsharp mask (sharpen)
        ctx.putImageData(imageData, 0, 0);
        var sharpened = ctx.getImageData(0, 0, canvas.width, canvas.height);
        var sd = sharpened.data;
        var w = canvas.width;
        // Simple 3x3 sharpen kernel
        for (var y = 1; y < canvas.height - 1; y++) {
          for (var x = 1; x < w - 1; x++) {
            var idx = (y * w + x) * 4;
            var center = data[idx] * 5;
            var neighbors = data[idx - 4] + data[idx + 4]
              + data[idx - w*4] + data[idx + w*4];
            var val = Math.min(255, Math.max(0, center - neighbors));
            sd[idx] = val;
            sd[idx+1] = val;
            sd[idx+2] = val;
          }
        }

        // 5. Adaptive thresholding (Sauvola-like binarization)
        // Use a local window to determine threshold per pixel
        var blockSize = 25;
        var k = 0.3;
        var half = Math.floor(blockSize / 2);
        var binary = ctx.createImageData(canvas.width, canvas.height);
        var bd = binary.data;
        var src = sd;

        // Build integral image for fast local mean
        var integral = new Float64Array((canvas.width + 1) * (canvas.height + 1));
        var integralSq = new Float64Array((canvas.width + 1) * (canvas.height + 1));
        var iw = canvas.width + 1;
        for (var y = 0; y < canvas.height; y++) {
          for (var x = 0; x < canvas.width; x++) {
            var val = src[(y * canvas.width + x) * 4];
            integral[(y+1)*iw + (x+1)] = val + integral[y*iw + (x+1)] + integral[(y+1)*iw + x] - integral[y*iw + x];
            integralSq[(y+1)*iw + (x+1)] = val*val + integralSq[y*iw + (x+1)] + integralSq[(y+1)*iw + x] - integralSq[y*iw + x];
          }
        }

        for (var y = 0; y < canvas.height; y++) {
          for (var x = 0; x < canvas.width; x++) {
            var x1 = Math.max(0, x - half);
            var y1 = Math.max(0, y - half);
            var x2 = Math.min(canvas.width, x + half + 1);
            var y2 = Math.min(canvas.height, y + half + 1);
            var area = (x2 - x1) * (y2 - y1);
            var sum = integral[y2*iw + x2] - integral[y1*iw + x2] - integral[y2*iw + x1] + integral[y1*iw + x1];
            var sumSq = integralSq[y2*iw + x2] - integralSq[y1*iw + x2] - integralSq[y2*iw + x1] + integralSq[y1*iw + x1];
            var mean = sum / area;
            var variance = (sumSq / area) - (mean * mean);
            var stddev = Math.sqrt(Math.max(0, variance));
            var threshold = mean * (1 + k * (stddev / 128 - 1));

            var px = src[(y * canvas.width + x) * 4];
            var out = px > threshold ? 255 : 0;
            var idx = (y * canvas.width + x) * 4;
            bd[idx] = out;
            bd[idx+1] = out;
            bd[idx+2] = out;
            bd[idx+3] = 255;
          }
        }

        ctx.putImageData(binary, 0, 0);

        // 6. Add white border (helps Tesseract with edge detection)
        var finalCanvas = document.createElement('canvas');
        var pad = 20;
        finalCanvas.width = canvas.width + pad * 2;
        finalCanvas.height = canvas.height + pad * 2;
        var fctx = finalCanvas.getContext('2d');
        fctx.fillStyle = '#ffffff';
        fctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
        fctx.drawImage(canvas, pad, pad);

        resolve(finalCanvas.toDataURL('image/png'));
      };
      img.src = base64;
    });
  }

  // ─── OCR with tuned Tesseract settings ───
  async function runOCR(base64) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'progress', value: 0.1 }));

      // Preprocess
      var processed = await preprocessImage(base64);
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'progress', value: 0.3 }));

      // Run Tesseract with tuned parameters
      var result = await Tesseract.recognize(processed, 'eng', {
        logger: function(m) {
          if (m.status === 'recognizing text' && m.progress) {
            var p = 0.3 + m.progress * 0.7;
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'progress', value: p }));
          }
        },
        tessedit_pageseg_mode: '3',      // PSM 3: Fully automatic page segmentation (best general purpose)
        tessedit_ocr_engine_mode: '2',    // OEM 2: Legacy + LSTM combined for best accuracy
        preserve_interword_spaces: '1',   // Keep word spacing
        textord_heavy_nr: '1',            // Heavy noise removal
      });

      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'result', text: result.data.text, confidence: result.data.confidence }));
    } catch (e) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', message: e.message }));
    }
  }

  // Listen for messages from React Native
  window.addEventListener('message', function(event) { runOCR(event.data); });
  document.addEventListener('message', function(event) { runOCR(event.data); });

  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
</script>
</body>
</html>
`;

export const OCRWebView = forwardRef<OCRWebViewRef, Props>(
  ({ onResult, onError, onProgress }, ref) => {
    const webviewRef = useRef<WebView>(null);

    useImperativeHandle(ref, () => ({
      recognize: (base64Image: string) => {
        webviewRef.current?.postMessage(base64Image);
      },
    }));

    const onMessage = useCallback(
      (event: WebViewMessageEvent) => {
        try {
          const data = JSON.parse(event.nativeEvent.data);
          if (data.type === 'result') {
            onResult(data.text, data.confidence);
          } else if (data.type === 'error') {
            onError(data.message);
          } else if (data.type === 'progress') {
            onProgress?.(data.value);
          }
        } catch {
          onError('Failed to parse OCR response');
        }
      },
      [onResult, onError, onProgress]
    );

    return (
      <WebView
        ref={webviewRef}
        source={{ html: HTML }}
        onMessage={onMessage}
        style={styles.hidden}
        javaScriptEnabled
        originWhitelist={['*']}
      />
    );
  }
);

const styles = StyleSheet.create({
  hidden: {
    height: 0,
    width: 0,
    opacity: 0,
    position: 'absolute',
  },
});
