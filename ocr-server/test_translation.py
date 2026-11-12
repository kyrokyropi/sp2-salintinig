import unittest
from unittest.mock import patch

from server import _correct_text, _detect_lang, _run_translate_blocking


class TranslationTest(unittest.TestCase):
    def test_short_bilingual_text(self):
        for text, language in [("Kumusta ka?", "tl"), ("Salamat", "tl"), ("Ako ay masaya.", "tl"), ("I am very handsome.", "en"), ("Hello, how are you?", "en")]:
            with self.subTest(text=text):
                self.assertEqual(_detect_lang(text), language)

    def test_english_spell_checker_preserves_tagalog(self):
        self.assertEqual(_correct_text("Kumusta ka?"), "Kumusta ka?")

    def test_requested_language_controls_direction(self):
        for source, target in [("en", "tl"), ("tl", "en")]:
            with self.subTest(source=source), patch("server._detect_lang", return_value=source), patch(
                "server._translate_ct2", return_value="Translated text"
            ) as translate:
                result = _run_translate_blocking("Source text", "", target)
                self.assertEqual(result, ("Translated text", source, target))
                translate.assert_called_once_with("Source text", f"{source}->{target}")

    def test_same_language_does_not_load_translation_model(self):
        with patch("server._detect_lang", return_value="tl"), patch("server._translate_ct2") as translate:
            self.assertEqual(_run_translate_blocking("Kumusta ka?", "", "tl"), ("Kumusta ka?", "tl", "tl"))
            translate.assert_not_called()

    def test_model_failure_is_not_reported_as_success(self):
        with patch("server._translate_ct2", side_effect=RuntimeError("offline")):
            with self.assertRaisesRegex(RuntimeError, "unavailable"):
                _run_translate_blocking("Hello", "en", "tl")

    def test_empty_translation_is_not_reported_as_success(self):
        with patch("server._translate_ct2", return_value=" "):
            with self.assertRaisesRegex(RuntimeError, "no text"):
                _run_translate_blocking("Hello", "en", "tl")


if __name__ == "__main__":
    unittest.main()
