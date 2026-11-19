#!/usr/bin/env python3
"""Generate src/bundled-coverage.json from the bundled fonts' original files.

Coverage = code points whose cmap glyph is not .notdef, merged into sorted
[start, end] ranges. Run from the web/ directory:
    python3 scripts/gen-bundled-manifest.py <fontdir>
where <fontdir> holds the original TTF/OTF files used to build the WOFF2
assets in public/fonts/. The WOFF2 conversion does not change the cmap,
so coverage computed from the originals applies to the shipped files.
"""
import json
import sys
from fontTools.ttLib import TTFont

FONTS = {
    "rii-pop-kaku": "RiiPopkkR.otf",
    "mochiy-pop-one": "MochiyPopOne-Regular.ttf",
    "yusei-magic": "YuseiMagic-Regular.ttf",
    "hachi-maru-pop": "HachiMaruPop-Regular.ttf",
    "yomogi": "Yomogi-Regular.ttf",
    "tekitou-poem": "TekitouPoem.ttf",
    "tekitou-poem-bold": "TekitouPoem_Bold.ttf",
}


def ranges_for(path: str) -> list[list[int]]:
    font = TTFont(path, fontNumber=0, lazy=True)
    cmap = font.getBestCmap()
    cps = sorted(cp for cp, name in cmap.items() if name != ".notdef")
    ranges: list[list[int]] = []
    for cp in cps:
        if ranges and cp == ranges[-1][1] + 1:
            ranges[-1][1] = cp
        else:
            ranges.append([cp, cp])
    return ranges


def main() -> None:
    fontdir = sys.argv[1]
    out = {}
    for font_id, filename in FONTS.items():
        ranges = ranges_for(f"{fontdir}/{filename}")
        total = sum(e - s + 1 for s, e in ranges)
        out[font_id] = ranges
        print(f"{font_id}: {total} code points, {len(ranges)} ranges")
    with open("src/bundled-coverage.json", "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"))
        fh.write("\n")
    print("wrote src/bundled-coverage.json")


if __name__ == "__main__":
    main()
