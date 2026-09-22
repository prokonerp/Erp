#!/usr/bin/env python3
"""
Prove the rendered PDF lost no copy to clipping.

Compares the visible text of the HTML source against the text ACTUALLY PRESENT in the
rendered PDF. A page that overflows (`.page` is `overflow:hidden`) silently drops content,
so every HTML clause must be found in the PDF. This is the check that catches it.

    python3 scripts/audit-proposal-pdf.py
"""
from __future__ import annotations

import re
import sys
import unicodedata
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "docs" / "proposal" / "API-Integration-and-Tally-Export.html"
PDF = ROOT / "docs" / "proposal" / "API-Integration-and-Tally-Export.pdf"


class VisibleText(HTMLParser):
    """Visible text with a hard separator at block boundaries.

    Without the boundary separator a heading and the paragraph after it get glued into one
    clause, which then never matches the PDF (they are separate blocks there) and shows up
    as a fake "clipped" finding.
    """

    SKIP = {"style", "script", "svg", "head"}
    BLOCK = {"p", "div", "section", "li", "td", "th", "tr", "table", "h1", "h2", "h3",
             "h4", "ul", "ol", "br", "header", "footer"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self._d = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self._d += 1
        elif tag in self.BLOCK and self._d == 0:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self._d:
            self._d -= 1
        elif tag in self.BLOCK and self._d == 0:
            self.parts.append("\n")

    def handle_data(self, data):
        if self._d == 0:
            self.parts.append(data)

    @property
    def text(self):
        return " ".join(self.parts)


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)
    for a, b in (("\u2014", " "), ("\u2013", " "), ("\u2192", " "), ("\u00b7", " "),
                 ("\u2018", "'"), ("\u2019", "'"), ("\u201c", '"'), ("\u201d", '"'),
                 ("\u2026", " "), ("\u2605", " ")):
        s = s.replace(a, b)
    s = s.lower()
    s = re.sub(r"[^a-z0-9₹%&+./'-]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def main() -> int:
    try:
        import pymupdf
    except ImportError:
        print("FAIL: pymupdf not installed")
        return 1
    if not PDF.exists():
        print(f"FAIL: {PDF} missing — run scripts/build-proposal.mjs first")
        return 1

    doc = pymupdf.open(PDF)
    pdf_text = " ".join(p.get_text() for p in doc)
    dnorm = norm(pdf_text)
    # Letter-spaced CSS (e.g. the uppercase masthead kicker) extracts from the PDF as
    # "P R O KO N ...", so fall back to a whitespace-free comparison. Same characters in the
    # same order is still a real presence test — it just tolerates tracking and line wraps.
    dsquash = re.sub(r"\s+", "", dnorm)

    parser = VisibleText()
    parser.feed(HTML.read_text(encoding="utf-8"))
    # split on block boundaries first, then on sentence enders within a block
    clauses = []
    for block in re.sub(r"[ \t]+", " ", parser.text).split("\n"):
        block = block.strip()
        if not block:
            continue
        for c in re.split(r"(?<=[.;:])\s+", block):
            c = c.strip(" -—·•")
            if len(norm(c)) >= 25:
                clauses.append(c)

    absent = []
    for c in clauses:
        nc = norm(c)
        if nc in dnorm:
            continue
        if re.sub(r"\s+", "", nc) in dsquash:
            continue
        absent.append(c)
    covered = len(clauses) - len(absent)

    print("== RENDERED PDF ==")
    print(f"   pages        : {doc.page_count}")
    for i, p in enumerate(doc):
        print(f"   page {i + 1}       : {p.rect.width / 72 * 25.4:.0f} x {p.rect.height / 72 * 25.4:.0f} mm")
    print("\n== HTML -> PDF TEXT PARITY (clipping detection) ==")
    print(f"   HTML clauses : {len(clauses)}")
    print(f"   in the PDF   : {covered}  ({covered / len(clauses) * 100:.1f}%)")
    if absent:
        print(f"   CLIPPED / MISSING ({len(absent)}):")
        for a in absent[:15]:
            print(f"     - {a[:105]}")

    ok = doc.page_count == 2 and not absent
    print("\n== VERDICT ==")
    print("   PASS — 2 pages, and every clause of the source is present in the PDF"
          if ok else "   FAIL — see items above")
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())
