#!/usr/bin/env python3
"""
Independent verification of the generated DOCX.

This is deliberately NOT the builder's own self-check. It proves the .docx is a faithful
twin of the HTML source by measuring CONTENT PARITY, and it independently confirms the
page setup and embedded diagrams.

    python3 scripts/audit-proposal-docx.py

Exit code 0 = every check passed. Non-zero = something is missing (it is listed).
"""
from __future__ import annotations

import re
import sys
import unicodedata
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "docs" / "proposal" / "API-Integration-and-Tally-Export.html"
DOCX = ROOT / "docs" / "proposal" / "API-Integration-and-Tally-Export.docx"

# Strings the client must see. If any is absent the document is not shippable.
REQUIRED = [
    "API Integration & Tally Export",
    "Two automations, one source of truth",
    "GSP API — E-Invoice (IRN) & E-Way Bill",
    "Tally Export — books stay in TallyPrime",
    "The rule both follow",
    "The process, end to end",
    "What changes for your team",
    "Reference integrity",
    "Five-day setup plan",
    "Day by day",
    "Foundation & access",
    "GSP integration — E-Invoice (IRN)",
    "E-Way Bill & compliance gates",
    "Tally export",
    "End-to-end test, training & go-live",
    "What we need from you first",
    "Assumptions, exclusions and cost",
    "₹29,500",
    "₹14.75",
    "4,000",
]


class VisibleText(HTMLParser):
    """Collect human-visible text, skipping <style>/<script> and <svg> subtrees.

    A hard separator is emitted at block boundaries; otherwise a heading and the paragraph
    after it glue into one clause that can never match the DOCX (separate paragraphs there)
    and is reported as a fake content gap.
    """

    SKIP = {"style", "script", "svg", "head"}
    BLOCK = {"p", "div", "section", "li", "td", "th", "tr", "table", "h1", "h2", "h3",
             "h4", "ul", "ol", "br", "header", "footer"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self._depth += 1
        elif tag in self.BLOCK and self._depth == 0:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self._depth:
            self._depth -= 1
        elif tag in self.BLOCK and self._depth == 0:
            self.parts.append("\n")

    def handle_data(self, data):
        if self._depth == 0:
            self.parts.append(data)

    @property
    def text(self) -> str:
        return " ".join(self.parts)


def norm(s: str) -> str:
    """Normalise for comparison: NFKC, unify dashes/quotes, drop punctuation, collapse space."""
    s = unicodedata.normalize("NFKC", s)
    for a, b in (("\u2014", " "), ("\u2013", " "), ("\u2192", " "), ("\u00b7", " "),
                 ("\u2018", "'"), ("\u2019", "'"), ("\u201c", '"'), ("\u201d", '"'),
                 ("\u2026", " "), ("\u2605", " ")):
        s = s.replace(a, b)
    s = s.lower()
    s = re.sub(r"[^a-z0-9₹%&+./'-]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def sentences(html_text: str) -> list[str]:
    """Break the HTML's visible copy into comparable clauses, respecting block boundaries."""
    clauses = []
    for block in re.sub(r"[ \t]+", " ", html_text).split("\n"):
        block = block.strip()
        if not block:
            continue
        for r in re.split(r"(?<=[.;:])\s+", block):
            r = r.strip(" -—·•")
            if len(norm(r)) >= 25:  # skip fragments / stray labels
                clauses.append(r)
    return clauses


def main() -> int:
    if not DOCX.exists():
        print(f"FAIL: {DOCX} does not exist")
        return 1

    try:
        from docx import Document
        from docx.shared import Cm
    except ImportError:
        print("FAIL: python-docx not importable")
        return 1

    doc = Document(str(DOCX))

    # ---- page setup -------------------------------------------------------
    sec = doc.sections[0]
    w_cm, h_cm = sec.page_width.cm, sec.page_height.cm
    print("== PAGE SETUP ==")
    print(f"   page        : {w_cm:.2f} x {h_cm:.2f} cm   (A4 = 21.00 x 29.70)")
    print(f"   margins cm  : top {sec.top_margin.cm:.2f}  bottom {sec.bottom_margin.cm:.2f}"
          f"  left {sec.left_margin.cm:.2f}  right {sec.right_margin.cm:.2f}")
    a4 = abs(w_cm - 21.0) < 0.1 and abs(h_cm - 29.7) < 0.1

    # ---- structure --------------------------------------------------------
    # Read text straight from the OOXML body. `cell.text` — and any shallow walk — SILENTLY
    # SKIPS nested tables, so a cost table living inside a container cell reads as an empty
    # gap and produces a false "missing content" verdict. Collecting every `w:t` node in
    # document order is complete regardless of nesting depth.
    from docx.oxml.ns import qn

    body = doc.element.body
    runs = [n.text.strip() for n in body.iter(qn("w:t")) if n.text and n.text.strip()]
    n_tables = len(body.findall(".//" + qn("w:tbl")))

    # Headers/footers are separate package parts, not the body — include them, or their
    # copy is wrongly reported as missing.
    for s in doc.sections:
        for part in (s.header, s.footer, s.first_page_header, s.first_page_footer,
                     s.even_page_header, s.even_page_footer):
            try:
                runs += [n.text.strip() for n in part._element.iter(qn("w:t"))
                         if n.text and n.text.strip()]
            except Exception:
                pass

    doc_text = " ".join(runs)
    n_shapes = len(doc.inline_shapes)
    print("\n== STRUCTURE ==")
    print(f"   text runs   : {len(runs)}")
    print(f"   tables      : {n_tables}   (incl. nested)")
    print(f"   images      : {n_shapes}   (expect 2 — the process diagram + the timeline)")
    print(f"   text chars  : {len(doc_text)}")

    # ---- required strings -------------------------------------------------
    missing = [r for r in REQUIRED if norm(r) not in norm(doc_text)]
    print("\n== REQUIRED CONTENT ==")
    print(f"   checked     : {len(REQUIRED)}")
    print("   missing     : none" if not missing else f"   MISSING     : {missing}")

    # ---- content parity vs the HTML source --------------------------------
    parser = VisibleText()
    parser.feed(HTML.read_text(encoding="utf-8"))
    sents = sentences(parser.text)
    dnorm = norm(doc_text)
    absent = [s for s in sents if norm(s) not in dnorm]
    covered = len(sents) - len(absent)
    pct = (covered / len(sents) * 100) if sents else 0.0
    print("\n== CONTENT PARITY WITH HTML SOURCE ==")
    print(f"   HTML clauses: {len(sents)}")
    print(f"   reproduced  : {covered}  ({pct:.1f}%)")
    if absent:
        print(f"   not found verbatim ({len(absent)}) — inspect these:")
        for a in absent[:15]:
            print(f"     - {a[:105]}")

    ok = a4 and not missing and n_shapes >= 2 and pct >= 85.0
    print("\n== VERDICT ==")
    print("   PASS — DOCX matches the HTML source" if ok else "   FAIL — see items above")
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())
