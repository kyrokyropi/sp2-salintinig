"""Real inference smoke test: venv/bin/python -m unittest test_ocr."""

import subprocess
import sys
import unittest
from pathlib import Path


class OCRSmokeTest(unittest.TestCase):
    def test_recognizes_text_without_hanging(self):
        # A subprocess bounds native crashes/hangs that a thread timeout cannot stop.
        result = subprocess.run(
            [sys.executable, "-c", """
import io
import paddle
from PIL import Image, ImageDraw
from server import _run_ocr_blocking

paddle.disable_signal_handler()
image = Image.new("RGB", (320, 100), "white")
ImageDraw.Draw(image).text((20, 30), "HELLO WORLD", fill="black", font_size=30)
buffer = io.BytesIO()
image.save(buffer, format="PNG")
text, confidence = _run_ocr_blocking(buffer.getvalue())
assert "HELLO" in text.upper() and "WORLD" in text.upper(), repr(text)
assert 0 < confidence <= 100, confidence
print(text, confidence)
"""],
            cwd=Path(__file__).parent,
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
