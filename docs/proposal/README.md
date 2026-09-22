# Client proposal — API Integration & Tally Export

Two-page, client-facing document explaining how GSP API integration (e-Invoice IRN +
E-Way Bill) and Tally export will work inside the Prokon CRM, with an end-to-end process
diagram and a day-by-day five-day setup plan.

## Files

| File | What it is |
|---|---|
| `API-Integration-and-Tally-Export.pdf` | **The deliverable.** Exactly 2 pages of A4, all-vector. This is what you send. |
| `API-Integration-and-Tally-Export.html` | Source of truth. Print-ready HTML: two fixed 210×297 mm pages, inline SVG diagrams, `@page { size: A4 }`. Edit content here. |
| `API-Integration-and-Tally-Export.docx` | Editable Word twin of the same content, with both diagrams embedded. |
| `assets/diagram-flow.png` | 3× export of the process diagram (used by the DOCX). |
| `assets/diagram-timeline.png` | 3× export of the five-day timeline (used by the DOCX). |

## Rebuilding

```bash
# 1. PDF + diagram PNGs from the HTML  (Playwright, chromium)
node scripts/build-proposal.mjs

# 2. DOCX from the same content        (python-docx)
python3 scripts/build-proposal-docx.py

# 3. Layout check on the HTML — page boxes, clipping, margin escapes, diagram sizes
node scripts/audit-proposal-layout.mjs

# 4. Prove the rendered PDF lost nothing to clipping (HTML -> PDF text parity)
python3 scripts/audit-proposal-pdf.py

# 5. Independent check that the DOCX is a faithful twin of the HTML
python3 scripts/audit-proposal-docx.py
```

Order matters: the DOCX embeds the PNGs that step 1 produces, so run step 1 before step 2.
Steps 3–5 are read-only audits; each prints a PASS/FAIL verdict and exits non-zero on FAIL.

> **Why step 4 exists.** Each page is a fixed 210×297 mm box with `overflow: hidden`, so a
> page that grows past A4 loses its bottom content *silently* — no error, no warning. Step 4
> compares every clause of the HTML against the text actually present in the PDF, which is
> what makes that failure visible. During the first build it caught page 2 overflowing by
> 41.5 mm.

### Verifying the DOCX

Step 5 checks page size, margins, table/image counts and content parity against the HTML, but
it reads the package — it does **not** prove how the DOCX paginates.

Pagination *can* be verified on this machine through Microsoft Word, but Word's file access is
blocked by the default file sandbox, so the conversion must run with wider permissions
(`danger-full-access`):

```bash
osascript <<'EOF'
tell application "Microsoft Word"
  activate
  open (POSIX file "/Users/jai/Desktop/Prokon Erp/docs/proposal/API-Integration-and-Tally-Export.docx")
  delay 1
  set d to active document
  save as d file name "/Users/jai/Desktop/Prokon Erp/docs/proposal/_verify.docx.pdf" file format format PDF
  close d saving no
end tell
EOF
# then read _verify.docx.pdf with PyMuPDF and check .page_count
```

Note the `activate` / `active document` form — binding the result of `open` directly
(`set d to open …`) fails with `-2753, variable d is not defined`.

LibreOffice, `pdftoppm` and `pandoc` are **not installed** here, so Word is the only renderer.

> **Verified result:** the DOCX renders to exactly **2 pages** of A4 (Word 16.110.3), each
> filling the page, with the cost table, both diagrams and every heading present. The `.docx`
> is a true two-page twin of the PDF, not merely an editable extra.

## Where the content comes from

Every figure and claim in the document is grounded in the engineering plans next to it:

- `../GSP_INTEGRATION_AND_TALLY_EXPORT.md` — API design, commercial terms, what is built,
  what is not, and the open decisions (D1–D7). Source of the cost figures
  (₹25,000 + 18% GST = ₹29,500/yr, 4,000 calls, ≈₹14.75 per e-invoiced despatch).
- `../../TALLY_BRIDGE_PLAN.md` — the TallyPrime architecture and the "Pass Bill" workflow.

## Open inputs before Day 1

The document ends by asking the client for three things — they are the only items that can
delay the plan:

1. Exact **ledger names** from their TallyPrime company (Chart of Accounts → Ledgers).
2. **GSP sandbox credentials** and sign-off on the API proposal (4,000-call tier).
3. The **accountant's call** on the one-paisa CGST/SGST rounding drift.
