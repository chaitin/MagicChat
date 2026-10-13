"""Generate native emoji fonts from Desktop's @infolektuell/noto-color-emoji@0.2.0.

Run from the repository root with Python packages:
  blackrenderer[skia]==0.8.2 fonttools[woff]==4.66.1
The original COLRv1 glyphs are rasterized at 64 ppem, with their original
cmap/GSUB retained. CBDT serves Android; sbix serves iOS. The final `JiyingEmoji.ttf` also includes MiSans Regular text glyphs for
read-only Text composition. Original MiSans files stay unchanged; each source
retains its own licensing terms. The generated `JiyingEmojiAndroid.ttf` is a
separate emoji-only CBDT/CBLC fallback for Android 10+ native inputs; it has no
`sbix` table. No system emoji glyphs are used. The OFL license is shipped
alongside the font.
"""

from copy import copy
from io import BytesIO
from math import ceil, floor
from pathlib import Path
import re
import tempfile
import sys

from fontTools.merge import Merger
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.scaleUpem import scale_upem
from fontTools.ttLib.tables._c_m_a_p import CmapSubtable
from fontTools.ttLib.tables.BitmapGlyphMetrics import SmallGlyphMetrics
from fontTools.ttLib.tables.C_B_D_T_ import cbdt_bitmap_format_17
from fontTools.ttLib.tables.E_B_L_C_ import SbitLineMetrics, Strike, eblc_index_sub_table_1
from fontTools.ttLib.tables.sbixGlyph import Glyph
from fontTools.ttLib.tables.sbixStrike import Strike as SbixStrike
from fontTools.ttLib.tables import otTables
from fontTools.misc.xmlWriter import XMLWriter

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "client/desktop/node_modules/@infolektuell/noto-color-emoji"
OUTPUT = ROOT / "assets/fonts/noto-color-emoji"
PPEM = 64


class EmojiMerger(Merger):
    def __init__(self):
        super().__init__()
        self.renamed_orders = []

    def _preMerge(self, font):
        self.renamed_orders.append(font.getGlyphOrder()[:])
        return super()._preMerge(font)


def restore_shaping(font, paths, orders):
    # Generic merging aliases cmap entries but does not retarget every ligature
    # input to those aliases. Rebuild the original ccmp lookups against one cmap.
    canonical = font.getBestCmap()
    lookups, active = [], []
    for path, order in zip(paths, orders):
        source = TTFont(path)
        names = dict(zip(source.getGlyphOrder(), order))
        for codepoint, glyph in source.getBestCmap().items():
            names[glyph] = canonical[codepoint]
        xml = BytesIO()
        writer = XMLWriter(xml)
        writer.begintag("ttFont")
        source["GSUB"].toXML(writer, source)
        writer.endtag("ttFont")
        document = xml.getvalue().decode()
        def rename(match):
            attribute, value = match.groups()
            values = value.split(",")
            if all(item in names for item in values):
                value = ",".join(names[item] for item in values)
            return f'{attribute}="{value}"'
        document = re.sub(r'(\w+)="([^\"]*)"', rename, document)
        # importXML expects the GSUB wrapper normally provided by TTFont.saveXML.
        document = document.replace("<ttFont>", "<ttFont><GSUB>").replace("</ttFont>", "</GSUB></ttFont>")
        imported = TTFont()
        imported.importXML(BytesIO(document.encode()))
        table = imported["GSUB"].table
        offset = len(lookups)
        for lookup in table.LookupList.Lookup:
            lookup.mapLookups({i: i + offset for i in range(table.LookupList.LookupCount)})
        for record in table.FeatureList.FeatureRecord:
            assert record.FeatureTag == "ccmp"
            active.extend(i + offset for i in record.Feature.LookupListIndex)
        lookups.extend(table.LookupList.Lookup)
    table = otTables.GSUB()
    table.Version = 0x00010000
    table.LookupList = otTables.LookupList()
    table.LookupList.Lookup = lookups
    table.LookupList.LookupCount = len(lookups)
    feature = otTables.FeatureRecord()
    feature.FeatureTag = "ccmp"
    feature.Feature = otTables.Feature()
    feature.Feature.FeatureParams = None
    feature.Feature.LookupListIndex = active
    feature.Feature.LookupCount = len(active)
    table.FeatureList = otTables.FeatureList()
    table.FeatureList.FeatureRecord = [feature]
    table.FeatureList.FeatureCount = 1
    language = otTables.LangSys()
    language.LookupOrder, language.ReqFeatureIndex = None, 0xFFFF
    language.FeatureIndex, language.FeatureCount = [0], 1
    script = otTables.ScriptRecord()
    script.ScriptTag = "DFLT"
    script.Script = otTables.Script()
    script.Script.DefaultLangSys = language
    script.Script.LangSysRecord, script.Script.LangSysCount = [], 0
    table.ScriptList = otTables.ScriptList()
    table.ScriptList.ScriptRecord, table.ScriptList.ScriptCount = [script], 1
    font["GSUB"].table = table


def subset_for_input(font):
    options = Options()
    options.layout_features = ["*"]
    options.name_IDs = []
    options.glyph_names = True
    options.notdef_glyph = True
    options.retain_gids = False
    options.recalc_average_width = False
    options.recalc_timestamp = False
    subsetter = Subsetter(options=options)
    subsetter.populate(unicodes=set(font.getBestCmap()))
    subsetter.subset(font)
    scale_upem(font, 1000)
    return font


def copy_color_tables(target, source, glyph_names):
    for tag in ("CBDT", "CBLC", "sbix"):
        target[tag] = copy(source[tag])

    for strike in target["CBDT"].strikeData:
        remapped = {glyph_names[name]: bitmap for name, bitmap in strike.items()}
        strike.clear()
        strike.update(remapped)

    for strike in target["CBLC"].strikes:
        for index in strike.indexSubTables:
            index.names = [glyph_names[name] for name in index.names]

    for strike in target["sbix"].strikes.values():
        strike.glyphs = {glyph_names[name]: glyph for name, glyph in strike.glyphs.items()}
        for name, glyph in strike.glyphs.items():
            glyph.glyphName = name
            if glyph.referenceGlyphName:
                glyph.referenceGlyphName = glyph_names[glyph.referenceGlyphName]


def merge_input_font(misans_path, emoji_path):
    emoji = subset_for_input(TTFont(emoji_path))
    merger = EmojiMerger()
    with tempfile.NamedTemporaryFile(suffix=".ttf") as subset_file:
        emoji.save(subset_file.name)
        merged = merger.merge([misans_path, subset_file.name])
    emoji_names = dict(zip(emoji.getGlyphOrder(), merger.renamed_orders[1]))
    # Keep ASCII letters/digits as MiSans, but prefer our emoji glyphs for symbols.
    emoji_cmap = emoji.getBestCmap()
    misans = TTFont(misans_path)
    misans_names = dict(zip(misans.getGlyphOrder(), merger.renamed_orders[0]))
    text_variants = CmapSubtable.newSubtable(14)
    text_variants.platformID, text_variants.platEncID = 0, 5
    text_variants.language = 0
    text_variants.cmap = {}
    text_variants.uvsDict = {0xFE0E: [(codepoint, misans_names[name]) for codepoint, name in sorted(misans.getBestCmap().items()) if codepoint in emoji_cmap]}
    merged["cmap"].tables.append(text_variants)
    for table in merged["cmap"].tables:
        if table.isUnicode() and table.format != 14:
            for codepoint, name in emoji_cmap.items():
                if codepoint >= 128 and (table.format in (12, 13) or codepoint <= 0xFFFF):
                    table.cmap[codepoint] = emoji_names[name]
    # A keycap's digit must now use the same MiSans glyph as the input cmap.
    # Merger's generic aliases alone do not retarget those sequence inputs.
    canonical = merged.getBestCmap()
    text_variants.uvsDict[0xFE0F] = [(codepoint, canonical[codepoint]) for codepoint in sorted(emoji_cmap) if codepoint not in (0x200D, 0x20E3)]
    names = dict(emoji_names)
    for codepoint, name in emoji_cmap.items():
        names[name] = canonical[codepoint]
    xml = BytesIO()
    writer = XMLWriter(xml)
    writer.begintag("ttFont")
    emoji["GSUB"].toXML(writer, emoji)
    writer.endtag("ttFont")
    def rename(match):
        attribute, value = match.groups()
        values = value.split(",")
        if all(item in names for item in values):
            value = ",".join(names[item] for item in values)
        return f'{attribute}="{value}"'
    document = re.sub(r'(\w+)="([^\"]*)"', rename, xml.getvalue().decode())
    document = document.replace("<ttFont>", "<ttFont><GSUB>").replace("</ttFont>", "</GSUB></ttFont>")
    remapped = TTFont()
    remapped.setGlyphOrder(merged.getGlyphOrder())
    remapped.importXML(BytesIO(document.encode()))
    emoji_lookups = remapped["GSUB"].table.LookupList.Lookup
    merged["GSUB"].table.LookupList.Lookup[-len(emoji_lookups):] = emoji_lookups
    table = merged["GSUB"].table
    emoji_features = [index for index, feature in enumerate(table.FeatureList.FeatureRecord) if feature.FeatureTag == "ccmp"]
    for script in table.ScriptList.ScriptRecord:
        languages = [record.LangSys for record in script.Script.LangSysRecord]
        if script.Script.DefaultLangSys:
            languages.append(script.Script.DefaultLangSys)
        for language in languages:
            language.FeatureIndex = sorted(set(language.FeatureIndex + emoji_features))
            language.FeatureCount = len(language.FeatureIndex)
    copy_color_tables(merged, emoji, emoji_names)
    for record in merged["name"].names:
        if record.nameID in (1, 4, 6, 16):
            record.string = "Jiying Emoji Input" if record.nameID != 6 else "JiyingEmojiInput"
        elif record.nameID == 3:
            record.string = "JiyingEmojiInput-MiSans-Noto-2.042"
    # Preserve the existing body-text metrics and source licensing metadata.
    for name in ("sTypoAscender", "sTypoDescender", "sTypoLineGap", "usWinAscent", "usWinDescent"):
        setattr(merged["OS/2"], name, getattr(misans["OS/2"], name))
    emoji_license = TTFont(emoji_path)["name"].getDebugName(13)
    if emoji_license:
        merged["name"].setName("Noto emoji glyphs: " + emoji_license + "\nMiSans text glyphs retain Xiaomi's separate terms; this is not an OFL grant for MiSans.", 13, 3, 1, 0x409)
    merged.recalcTimestamp = False
    return merged


def build():
    import uharfbuzz as hb
    from blackrenderer.backends.skia import SkiaPixelSurface
    from blackrenderer.font import BlackRendererFont

    paths = [SOURCE / f"files/{i}.woff2" for i in range(11)]
    assert '"version": "0.2.0"' in (SOURCE / "package.json").read_text()
    merger = EmojiMerger()
    font = merger.merge(paths)
    font.flavor = None
    restore_shaping(font, paths, merger.renamed_orders)
    sbix = font["sbix"] = newTable("sbix")
    sbix.version, sbix.flags = 1, 1
    sbix.strikes = {PPEM: SbixStrike(ppem=PPEM)}
    bitmaps = {}

    for path, renamed in zip(paths, merger.renamed_orders):
        source = TTFont(path)
        source.flavor = None
        sfnt = BytesIO()
        source.save(sfnt)
        renderer = BlackRendererFont(ttFont=source, hbFont=hb.Font(hb.Face(sfnt.getvalue())))
        mapping = dict(zip(source.getGlyphOrder(), renamed))
        scale = PPEM / source["head"].unitsPerEm
        for record in source["COLR"].table.BaseGlyphList.BaseGlyphPaintRecord:
            name = record.BaseGlyph
            bounds = renderer.getGlyphBounds(name)
            x0, y0 = (floor(value * scale) for value in bounds[:2])
            x1, y1 = (ceil(value * scale) for value in bounds[2:])
            if x0 == x1 or y0 == y1:
                continue
            surface = SkiaPixelSurface()
            with surface.canvas((x0, y0, x1, y1)) as canvas:
                canvas.scale(scale)
                renderer.drawGlyph(name, canvas)
            png = bytes(surface._image.encodeToData())
            glyph_name = mapping[name]
            sbix.strikes[PPEM].glyphs[glyph_name] = Glyph(
                glyphName=glyph_name, originOffsetX=x0, originOffsetY=y0,
                graphicType="png ", imageData=png,
            )
            bitmap = cbdt_bitmap_format_17(None, None)
            bitmap.imageData = png
            bitmap.metrics = SmallGlyphMetrics()
            bitmap.metrics.width, bitmap.metrics.height = x1 - x0, y1 - y0
            bitmap.metrics.BearingX, bitmap.metrics.BearingY = x0, y1
            bitmap.metrics.Advance = round(source["hmtx"][name][0] * scale)
            bitmaps[glyph_name] = bitmap

    cbdt = font["CBDT"] = newTable("CBDT")
    cbdt.version, cbdt.strikeData = 3.0, [bitmaps]
    cblc = font["CBLC"] = newTable("CBLC")
    cblc.version = 3.0
    strike = Strike()
    metrics = strike.bitmapSizeTable
    metrics.colorRef, metrics.ppemX, metrics.ppemY = 0, PPEM, PPEM
    metrics.bitDepth, metrics.flags = 32, 1
    line = SbitLineMetrics()
    line.ascender, line.descender, line.widthMax = 59, -16, 107
    line.caretSlopeNumerator, line.caretSlopeDenominator = 1, 0
    line.maxBeforeBL, line.minAfterBL = 59, -16
    for attr in ("caretOffset", "minOriginSB", "minAdvanceSB", "pad1", "pad2"):
        setattr(line, attr, 0)
    metrics.hori, metrics.vert = line, copy(line)
    index = eblc_index_sub_table_1(None, None)
    index.indexFormat, index.imageFormat = 1, 17
    index.names = sorted(bitmaps, key=font.getGlyphID)
    strike.indexSubTables = [index]
    cblc.strikes = [strike]
    for record in font["name"].names:
        if record.nameID in (1, 4, 6, 16):
            record.string = "Jiying Emoji" if record.nameID != 6 else "JiyingEmoji"
        elif record.nameID == 3:
            record.string = "JiyingEmoji-Noto-2.042-64ppem"
    font["name"].setName((SOURCE / "LICENSE").read_text(), 13, 3, 1, 0x409)
    font.recalcTimestamp = False
    OUTPUT.mkdir(parents=True, exist_ok=True)
    destination = OUTPUT / "JiyingEmoji.ttf"
    with tempfile.NamedTemporaryFile(suffix=".ttf") as emoji_only:
        font.save(emoji_only.name)
        input_font = merge_input_font(ROOT / "assets/fonts/misans/MiSans-Regular.ttf", emoji_only.name)
        input_font.save(destination)
    (OUTPUT / "OFL.txt").write_bytes((SOURCE / "LICENSE").read_bytes())
    reloaded = TTFont(destination)
    assert {"CBDT", "CBLC", "sbix", "GSUB"} <= set(reloaded.keys())
    assert len(reloaded["CBDT"].strikeData[0]) > 3_500
    assert len(reloaded.getBestCmap()) > 30_000
    shaping_font = hb.Font(hb.Face(destination.read_bytes()))
    catalog = ROOT / "client/mobile/src/features/conversation/composer/emoji-catalog.ts"
    examples = re.findall(r'^\s*\["([^\"]+)",', catalog.read_text(), re.MULTILINE)
    examples.extend(["👍🏽", "👨‍👩‍👧‍👦", "🇨🇳", "1️⃣", "👩‍❤️‍💋‍👩"])
    for text in examples:
        buffer = hb.Buffer()
        buffer.add_str(text)
        buffer.guess_segment_properties()
        hb.shape(shaping_font, buffer)
        glyphs = [reloaded.getGlyphName(glyph.codepoint) for glyph in buffer.glyph_infos]
        assert len(glyphs) == 1 and glyphs[0] in reloaded["CBDT"].strikeData[0], (text, glyphs)
    print(f"Generated {destination}: {len(bitmaps)} color glyphs, {destination.stat().st_size} bytes")


def build_android_fallback():
    font = TTFont(OUTPUT / "JiyingEmoji.ttf")
    # Android must not see Apple's sbix: FreeType can treat such mixed faces
    # as bitmap-only and suppress the ordinary outline glyphs.
    del font["sbix"]
    font["cmap"].tables = [table for table in font["cmap"].tables if table.format != 14]
    bitmaps = set(font["CBDT"].strikeData[0])
    unicode = {codepoint for codepoint, name in font.getBestCmap().items() if name in bitmaps}
    unicode.update(map(ord, "0123456789#*\u200d\u20e3"))
    options = Options()
    options.layout_features = ["ccmp"]
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    options.recalc_timestamp = False
    subsetter = Subsetter(options=options)
    subsetter.populate(unicodes=unicode)
    subsetter.subset(font)
    variants = CmapSubtable.newSubtable(14)
    variants.platformID, variants.platEncID, variants.language = 0, 5, 0
    variants.cmap = {}
    variants.uvsDict = {0xFE0F: [(codepoint, name) for codepoint, name in sorted(font.getBestCmap().items()) if codepoint not in (0x200D, 0x20E3)]}
    font["cmap"].tables.append(variants)
    for record in font["name"].names:
        if record.nameID in (1, 4, 6):
            record.string = "JiyingEmojiAndroid"
    font.recalcTimestamp = False
    destination = OUTPUT / "JiyingEmojiAndroid.ttf"
    font.save(destination)
    assert not any(ord(char) in font.getBestCmap() for char in "中文abc")
    print(f"Generated {destination}: {destination.stat().st_size} bytes")


def build_ios_fallback():
    font = TTFont(OUTPUT / "JiyingEmoji.ttf")
    bitmaps = set(font["CBDT"].strikeData[0])
    unicode = {codepoint for codepoint, name in font.getBestCmap().items() if name in bitmaps}
    unicode.update(map(ord, "0123456789#*\u200d\u20e3"))
    del font["CBDT"]
    del font["CBLC"]
    font["cmap"].tables = [table for table in font["cmap"].tables if table.format != 14]
    options = Options()
    options.layout_features = ["ccmp"]
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    options.recalc_timestamp = False
    subsetter = Subsetter(options=options)
    subsetter.populate(unicodes=unicode)
    subsetter.subset(font)
    variants = CmapSubtable.newSubtable(14)
    variants.platformID, variants.platEncID, variants.language = 0, 5, 0
    variants.cmap = {}
    variants.uvsDict = {0xFE0F: [(codepoint, name) for codepoint, name in sorted(font.getBestCmap().items()) if codepoint not in (0x200D, 0x20E3)]}
    font["cmap"].tables.append(variants)
    for record in font["name"].names:
        if record.nameID in (1, 4, 6):
            record.string = "JiyingEmojiIOS"
    font.recalcTimestamp = False
    destination = OUTPUT / "JiyingEmojiIOS.ttf"
    font.save(destination)
    assert not any(ord(char) in font.getBestCmap() for char in "中文abc")
    print(f"Generated {destination}: {destination.stat().st_size} bytes")


if __name__ == "__main__":
    if "--ios-fallback" in sys.argv:
        build_ios_fallback()
    elif "--android-fallback" in sys.argv:
        build_android_fallback()
    else:
        build()
        build_android_fallback()
        build_ios_fallback()
