"""Focused font checks. Requires fonttools[woff] and uharfbuzz; no APK build."""
import hashlib
import importlib.util
from pathlib import Path
import re
import unittest

import uharfbuzz as hb
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[3]
FONT = ROOT / "assets/fonts/noto-color-emoji/JiyingEmoji.ttf"
MISANS = ROOT / "assets/fonts/misans/MiSans-Regular.ttf"


class InputEmojiFontTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.font = TTFont(FONT)
        cls.misans = TTFont(MISANS)
        cls.shaper = hb.Font(hb.Face(FONT.read_bytes()))
        catalog = ROOT / "client/mobile/src/features/conversation/composer/emoji-catalog.ts"
        cls.emoji = re.findall(r'^\s*\["([^\"]+)",', catalog.read_text(), re.MULTILINE)
        cls.emoji += ["👍🏽", "👨‍👩‍👧‍👦", "🇨🇳", "1️⃣", "👩‍❤️‍💋‍👩", "🏴\U000E0067\U000E0062\U000E0065\U000E006E\U000E0067\U000E007F"]

    def shape(self, text, script=None):
        buffer = hb.Buffer()
        buffer.add_str(text)
        buffer.guess_segment_properties()
        if script:
            buffer.script = script
        hb.shape(self.shaper, buffer)
        return [self.font.getGlyphName(glyph.codepoint) for glyph in buffer.glyph_infos]

    def test_all_catalog_and_complex_sequences_are_single_color_glyphs(self):
        for text in self.emoji:
            with self.subTest(text=text):
                glyphs = self.shape(text)
                self.assertEqual(len(glyphs), 1)
                glyph = glyphs[0]
                self.assertIn(glyph, self.font["CBDT"].strikeData[0])
                self.assertIn(glyph, self.font["sbix"].strikes[64].glyphs)
                self.assertEqual(self.font["CBDT"].strikeData[0][glyph].imageData,
                                 self.font["sbix"].strikes[64].glyphs[glyph].imageData)

    def test_mixed_script_sequences_use_same_bitmap_as_picker(self):
        for text in self.emoji:
            for script in ("latn", "hani", "DFLT"):
                with self.subTest(text=text, script=script):
                    glyphs = self.shape("a" + text + "b", script)
                    self.assertEqual(len(glyphs), 3)
                    self.assertEqual(glyphs[1], self.shape(text)[0])

    def test_text_ascii_and_chinese_remain_misans_outlines_and_advances(self):
        for char in "中文ABCabc123 #*，。测试输入":
            with self.subTest(char=char):
                actual = self.font.getBestCmap()[ord(char)]
                expected = self.misans.getBestCmap()[ord(char)]
                self.assertNotIn(actual, self.font["CBDT"].strikeData[0])
                self.assertEqual(self.font["hmtx"][actual], self.misans["hmtx"][expected])
                self.assertEqual(self.font["glyf"][actual].compile(self.font["glyf"]),
                                 self.misans["glyf"][expected].compile(self.misans["glyf"]))

    def test_body_metrics_and_original_sources_are_unchanged(self):
        for name in ("ascent", "descent", "lineGap"):
            self.assertEqual(getattr(self.font["hhea"], name), getattr(self.misans["hhea"], name))
        for name in ("sTypoAscender", "sTypoDescender", "sTypoLineGap", "usWinAscent", "usWinDescent"):
            self.assertEqual(getattr(self.font["OS/2"], name), getattr(self.misans["OS/2"], name))
        self.assertEqual(hashlib.sha256(MISANS.read_bytes()).hexdigest(),
                         "9c120f0a849bc0aa5048daae2a3c0f6eecd828b5b33fce682a9622833f5feea6")

    def test_text_variant_of_shared_symbols_stays_noncolor(self):
        for text in ("©\uFE0E", "®\uFE0E", "™\uFE0E"):
            for glyph in self.shape(text):
                self.assertNotIn(glyph, self.font["CBDT"].strikeData[0])

    def test_bitmap_count_and_truetype_limits(self):
        self.assertLess(len(self.font.getGlyphOrder()), 65536)
        self.assertGreater(len(self.font.getBestCmap()), 30000)
        self.assertGreater(len(self.font["CBDT"].strikeData[0]), 3500)
        self.assertEqual(self.font["head"].unitsPerEm, 1000)
        self.assertGreater(len(self.font["GSUB"].table.LookupList.Lookup), 54)


if __name__ == "__main__":
    unittest.main()
