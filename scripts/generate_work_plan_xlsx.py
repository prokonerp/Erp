#!/usr/bin/env python3
"""
Generate the Prokon ERP Work Plan & Delivery Schedule workbook.

One-off planning document generator (not application code).
Run:  python3 scripts/generate_work_plan_xlsx.py [output.xlsx]

Structure (5 sheets):
  Dashboard               - priority summary, delivery window, legend
  Priority Plan           - manager one-pager, 6 priorities
  Work Register           - 15 items with technical change, outcome, confidence
  Timeline                - W1..W7 Gantt bands
  Estimates & Assumptions - basis, dependencies, risks, confidence notes

Conventions: Arial throughout, frozen headers, autofilter, SUM formulas for
totals with fullCalcOnLoad so Excel/Sheets recalculate on open.
"""

from __future__ import annotations

from html import unescape
import os
import re
import sys
import zipfile
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.utils.cell import range_boundaries
from openpyxl.worksheet.properties import PageSetupProperties

FONT = "Arial"

# ---------------------------------------------------------------- palette ----
NAVY = "1F3864"
SLATE = "44546A"
LIGHT = "F2F5FA"
WHITE = "FFFFFF"

PRIORITY_FILL = {
    1: "C00000",
    2: "E36C0A",
    3: "BF8F00",
    4: "1F6FEB",
    5: "2E7D32",
    6: "6A1B9A",
}

CONFIDENCE_STYLE = {
    "High":   ("C6EFCE", "006100"),
    "Medium": ("FFEB9C", "9C6500"),
    "Low":    ("FFC7CE", "9C0006"),
}

THIN = Side(style="thin", color="BFBFBF")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
TOP_RULE = Border(top=Side(style="medium", color=NAVY))


# ------------------------------------------------------------------ data -----
PRIORITIES = [
    (1, "Backup script + Sales Order fixes",
     "R-01 DB to Google Drive daily automated script; R-03 conveyance 2-month backup; "
     "R-04 Sales Order editable + PO dates; R-05 delivery terms added",
     1.0, "W1",
     "Unattended encrypted nightly backup with a tested restore; sales orders correctable "
     "without cancelling and re-creating; delivery terms printed on every customer document"),
    (2, "Billing module",
     "R-02 e-invoice / IRP end-to-end - IRN generation, signed QR, cancel and credit-note "
     "handling, production validation",
     5.0, "W1-W2",
     "An invoice raised in Prokon returns a valid IRN from the IRP; signed QR prints on the "
     "invoice; cancellation and credit notes are handled correctly"),
    (3, "Engineering module - Portal + Admin",
     "R-06 attendance from Start Duty; R-07 location permission at login; R-08 live road-snapped "
     "map tracing; R-09 closed tickets removed from queue; R-10 FSR sharing disabled; "
     "R-11 bike number validation; R-12 screenshot deterrent",
     5.0, "W2-W3",
     "Field attendance is automatic and payroll-ready; engineers see only open work; FSRs leave "
     "only through admin; location consent captured at login; routes traced on real roads"),
    (4, "Harmony Residence",
     "R-14 Lovable app migrated to real development - backend, auth, data model, go-live",
     7.0, "W5-W6",
     "Live on its own domain with real data and working authentication, not a preview URL"),
    (5, "Website + hosting",
     "R-15 Domain, DNS, SSL, environment configuration, smoke tests, handover documentation",
     2.0, "W3",
     "Production domain live with valid SSL, verified smoke tests and a written handover"),
    (6, "Oracle hosting",
     "R-13 Full Supabase to Oracle migration - discovery, schema conversion, data migration, "
     "auth replacement, cutover",
     14.0, "W7-W9",
     "Oracle replaces Supabase as the single system of record"),
]

REGISTER = [
    ("R-01", 1, "Daily DB backup to Google Drive",
     "Backup of the data daily on the Google Drive - automation",
     "Wire the existing backup script to Google Drive over OAuth; add a nightly scheduled job; "
     "AES-256-GCM encryption; 60-day retention with pruning; failure alerting; execute a restore drill",
     0.4, "W1", "Unattended, encrypted, offsite nightly backup with a proven restore path",
     "The backup script already exists in the repository and the zero-rupee Drive + encryption "
     "pattern is reusable, so this is wiring and a restore test rather than new engineering",
     "Medium", "Not started"),

    ("R-03", 1, "Conveyance data - 2-month backup",
     "Conveyance data to be made backup for 2 months",
     "Add conveyance tables to the nightly export scope; dated snapshots; 60-day retention; "
     "restore verification",
     0.1, "W1", "Any conveyance dispute within 60 days is provable",
     "Reuses the R-01 pipeline; conveyance has its own tables and integrity routines, so it "
     "needs its own export scope and a restore check",
     "Medium", "Not started"),

    ("R-04", 1, "Sales Order editable + PO dates",
     "Sales order to be made editable - PO Dates and all to be taken",
     "Add the missing edit route; schema and RLS for update; revision and audit columns; editable "
     "header and line items; PO number and PO date capture; guards against editing converted or "
     "fulfilled orders",
     0.4, "W1", "A wrong PO date or line can be corrected without cancelling and re-creating the "
     "order, with every edit stamped",
     "No edit route exists in the application today, and editing a commercial document needs an "
     "audit trail plus converted-order guards - this is the largest part of Priority 1",
     "Low", "Not started"),

    ("R-05", 1, "Delivery terms added",
     "Delivery terms to be added",
     "Extend the existing delivery_terms column to every sales document; add form fields; surface "
     "on all print templates; default from master data",
     0.1, "W1", "Delivery terms appear on every customer-facing document",
     "The column already exists; the work is spreading it across the sales documents and their "
     "print templates",
     "High", "Not started"),

    ("R-02", 2, "Billing module - e-invoice / IRP end-to-end",
     "Billing Module to be made using the api and end to end",
     "GSP/IRP onboarding and credentials; IRP auth token lifecycle; IRN generation and storage; "
     "signed QR on print; cancel within 24 hours; credit and debit note linkage; error taxonomy "
     "with retry and idempotency; reconciliation; production validation. Day-by-day split on the "
     "'Billing Module Split' sheet",
     5.0, "W1-W2", "Invoice raised in Prokon returns a valid IRN from the IRP, prints a signed QR, "
     "and handles cancellation and credit notes",
     "The IRP JSON payload builder, invoice columns and the e-way bill module already exist; the "
     "remaining work is the live IRP client, credential onboarding and production validation",
     "Medium", "Not started"),

    ("R-06", 3, "Attendance from Start Duty",
     "Eng attd module - Start duty to be attendance",
     "Write an attendance record on duty start and stop; handle day boundary, overnight and missed "
     "stop; admin attendance view; payroll feed",
     1.0, "W2", "Field attendance is captured automatically and is payroll-ready",
     "Duty tracking exists, but attendance carries payroll consequences, so the edge cases must be "
     "handled before it can be trusted",
     "Medium", "Not started"),

    ("R-07", 3, "Location permission at login",
     "On login location permission",
     "Move consent from voluntary on-duty to a login-time gate; version and persist consent per "
     "user; denial and retry UX; admin audit of consent",
     0.5, "W2", "Every engineer has granted location permission before work is visible",
     "The current gate intentionally allows off-duty browsing; changing that alters a product "
     "decision and needs a per-user consent audit trail",
     "Medium", "Not started"),

    ("R-08", 3, "Live map tracing",
     "Map logics to be built robust just like real live tracing on the google maps not the point "
     "connecting",
     "Replace straight-line polylines with a road-snapping service; live marker with throttled "
     "refresh; road-snapped trail replay; quota and cost guardrails; fallback when quota is exhausted",
     1.0, "W3", "Managers see the actual road route ridden, live, instead of straight lines between stops",
     "The current map draws polylines between points, which cannot follow roads; true tracing needs "
     "an external roads API, a key, throttling and a quota fallback",
     "Low", "Not started"),

    ("R-09", 3, "Closed tickets removed from queue",
     "Closed tickets to be removed from the engineers queue only open tickets",
     "Remove the completed tab from the engineer queue and its supporting query; keep history "
     "available to admin only",
     0.5, "W2", "Engineers see only open and assigned work",
     "The queue already separates open and completed into tabs, so this is a removal plus "
     "regression testing",
     "High", "Not started"),

    ("R-10", 3, "No FSR sharing by engineer",
     "no fsr can be shared by eng",
     "Gate the FSR share entry points by role; restrict sharing and download to admin; retain "
     "print for authorised users",
     0.5, "W2", "Field Service Reports leave the system only through admin-controlled paths",
     "The share dialog is already wired into the completed tab; this is role gating plus tests",
     "High", "Not started"),

    ("R-11", 3, "Bike number validation",
     "Bike no check",
     "Validate employees.vehicle_no against the Indian vehicle-number format at entry and at "
     "conveyance claim",
     0.5, "W3", "Invalid or unregistered bike numbers are rejected at entry",
     "The vehicle column exists and the Indian vehicle-number validation already exists on the "
     "invoicing side and can be reused",
     "High", "Not started"),

    ("R-12", 3, "Screenshot deterrent",
     "screenshot permissions to be disabled and no one alowed to screeshot and all",
     "Web-only deterrent - dynamic watermark carrying user ID and timestamp; blur content when the "
     "window loses focus; log capture attempts where detectable",
     1.0, "W3", "Screenshots carry a traceable watermark; content is obscured when the app is not focused",
     "Browsers cannot block operating-system screenshots; this is agreed as a best-effort deterrent "
     "with a watermark, not an absolute block",
     "High", "Not started"),

    ("R-14", 4, "Harmony Residence - Lovable to real app",
     "Harmony Residence - app lovable to real deployment",
     "Audit the exported app; wire the real backend, auth and data model; replace demo stubs; error "
     "and loading states; custom domain with DNS and SSL; smoke tests; handover",
     7.0, "W5-W6", "Harmony Residence is live on its own domain with real data and working authentication",
     "Lovable exports ship demo-grade authentication, data and error handling; the time is in "
     "replacing those stubs and then the deployment work",
     "Medium", "Not started"),

    ("R-15", 5, "Website + hosting",
     "website + hosting",
     "Production domain, DNS records, SSL certificate, environment configuration, smoke tests, "
     "handover documentation",
     2.0, "W3", "Production domain live with valid SSL and a documented handover",
     "Standard deployment work; the days are DNS and SSL propagation plus verified smoke tests "
     "rather than code",
     "High", "Not started"),

    ("R-13", 6, "Oracle hosting - full migration",
     "Oracle migration - migration of the complete supabase and everything to the orascle database",
     "Discovery and inventory; Oracle schema conversion including types, sequences, PL/SQL "
     "equivalents of RPCs and RLS to VPD/grants; data migration with row-count and checksum "
     "validation; Auth/GoTrue replacement; Storage and Realtime equivalents; cutover rehearsal "
     "with rollback plan",
     14.0, "W7-W9", "Oracle replaces Supabase as the single system of record",
     "Supabase is five products over 107 migrations, not just a database; 10 days covers schema and "
     "data with authentication, storage and cutover compressed into the same window",
     "Low", "Not started"),
]

WEEKS = [
    ("W1", "21-25 Sep"),
    ("W2", "28 Sep-2 Oct"),
    ("W3", "5-9 Oct"),
    ("W4", "12-16 Oct"),
    ("W5", "19-23 Oct"),
    ("W6", "26-30 Oct"),
    ("W7", "2-6 Nov"),
    ("W8", "9-13 Nov"),
    ("W9", "16-20 Nov"),
]

TIMELINE = [
    ("Priority 1", "Backup script + Sales Order fixes", ["W1"]),
    ("Priority 2", "Billing module", ["W1", "W2"]),
    ("Priority 3", "Engineering module - Portal + Admin", ["W2", "W3"]),
    ("Priority 5", "Website + hosting", ["W3"]),
    ("Buffer", "Integration testing + UAT of Priorities 1, 2, 3 and 5", ["W4"]),
    ("Priority 4", "Harmony Residence", ["W5", "W6"]),
    ("Priority 6", "Oracle hosting", ["W7", "W8", "W9"]),
]

# Billing module (Priority 2) - complete 5-day split, one phase per day.
BILLING_DAYS = [
    (1, "Onboarding and schema mapping",
     "GSP/IRP sandbox and production credentials issued; application key and secret; confirm the "
     "IRP JSON schema version; close master-data gaps (buyer GSTIN, HSN, UQC unit codes, place of "
     "supply)",
     "IRP/GSP account and subscription (external)",
     "Sandbox credentials working and a real invoice payload validating against the IRP schema "
     "offline",
     "External dependency. Onboarding can take one to three calendar weeks and cannot be shortened "
     "by development effort; this day can be pulled earlier and run in parallel."),
    (2, "IRP client and IRN generation",
     "Authentication token lifecycle (client credentials, roughly six-hour refresh); generate-IRN "
     "call against the IRP; store irn, ack_no and ack_date on the invoice; idempotency key; retry "
     "with backoff; IRP error codes mapped to operator-readable messages",
     "Day 1 credentials",
     "An invoice raised in Prokon returns a valid 64-character IRN and acknowledgement number, "
     "persisted on the invoice record",
     "Builds on the existing IRP JSON payload builder, so the payload is not rebuilt. Blocked "
     "without Day 1 credentials."),
    (3, "Signed QR, print and status UI",
     "Decode and store the signed QR payload returned by the IRP; render the QR on the tax invoice "
     "print; IRN status badge (pending / generated / failed) on the invoice list and detail; a "
     "failure queue for invoices that did not generate",
     "Day 2 IRN generation",
     "A printed invoice showing the signed QR and IRN, plus a queue listing any failed generations",
     "QR rendering is low risk; the print change touches the existing invoice print view."),
    (4, "Cancellation and credit / debit notes",
     "Cancel-IRN within the 24-hour statutory window with the correct reason codes; credit-note and "
     "debit-note linkage to the original IRN; reconciliation of IRP responses against local invoice "
     "state",
     "Days 2 and 3",
     "Cancellation and credit-note flows demonstrated in sandbox with the IRP acknowledgement stored",
     "The 24-hour cancellation window is a hard IRP rule and the reason codes must be exact."),
    (5, "Production validation and handover",
     "Run a controlled set of live invoices through the production IRP; regression on the existing "
     "invoice flow; operator runbook covering failures, retries and cancellations; handover",
     "Days 1 to 4",
     "A live invoice carrying a production IRN, a documented runbook and passing regression results",
     "Production credentials required. This day is deliberately held flexible to absorb "
     "sandbox-to-production differences."),
]


# --------------------------------------------------------------- helpers -----
def font(size=10, bold=False, color="000000", italic=False):
    return Font(name=FONT, size=size, bold=bold, color=color, italic=italic)


def fill(hex_color):
    return PatternFill("solid", fgColor=hex_color)


def put(ws, row, col, value, *, bold=False, size=10, color="000000", bg=None,
        wrap=False, halign="left", valign="top", fmt=None, border=False, italic=False):
    c = ws.cell(row=row, column=col, value=value)
    c.font = font(size=size, bold=bold, color=color, italic=italic)
    c.alignment = Alignment(horizontal=halign, vertical=valign, wrap_text=wrap)
    if bg:
        c.fill = fill(bg)
    if fmt:
        c.number_format = fmt
    if border:
        c.border = BORDER
    return c


def title_block(ws, title, subtitle, last_col):
    put(ws, 1, 1, title, bold=True, size=15, color=NAVY)
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=last_col)
    put(ws, 2, 1, subtitle, size=9, color=SLATE, italic=True)
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=last_col)
    ws.row_dimensions[1].height = 22


def header_row(ws, row, headers, widths=None):
    for i, h in enumerate(headers, start=1):
        put(ws, row, i, h, bold=True, size=10, color=WHITE, bg=NAVY,
            wrap=True, halign="center", valign="center", border=True)
    ws.row_dimensions[row].height = 30
    if widths:
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(i)].width = w


# ----------------------------------------------------------------- build -----
def build_priority_sheet(wb):
    ws = wb.create_sheet("Priority Plan")
    title_block(ws, "Priority Plan - Scope and Commitment",
                "Prokon ERP  |  19 September 2026  |  Delivery window 21 Sep - 20 Nov 2026",
                6)
    header_row(ws, 3,
               ["#", "Workstream", "Scope Included", "Days", "Target Week",
                "Outcome / Definition of Done"],
               [5, 32, 62, 8, 12, 58])

    r = 4
    for num, name, scope, days, week, outcome in PRIORITIES:
        put(ws, r, 1, num, bold=True, size=11, color=WHITE, bg=PRIORITY_FILL[num],
            halign="center", valign="center", border=True)
        put(ws, r, 2, name, bold=True, size=10, wrap=True, border=True)
        put(ws, r, 3, scope, size=9, wrap=True, border=True)
        put(ws, r, 4, days, size=11, bold=True, halign="center", valign="center",
            fmt="0.0", border=True)
        put(ws, r, 5, week, size=10, halign="center", valign="center", border=True)
        put(ws, r, 6, outcome, size=9, wrap=True, border=True)
        ws.row_dimensions[r].height = 58
        r += 1

    put(ws, r, 1, None, bg=LIGHT)
    put(ws, r, 2, "TOTAL COMMITTED MAN-DAYS", bold=True, size=10, bg=LIGHT, border=True)
    put(ws, r, 3, None, bg=LIGHT, border=True)
    put(ws, r, 4, f"=SUM(D4:D{r - 1})", bold=True, size=12, color=NAVY, bg=LIGHT,
        halign="center", valign="center", fmt="0.0", border=True)
    put(ws, r, 5, None, bg=LIGHT, border=True)
    put(ws, r, 6, None, bg=LIGHT, border=True)
    ws.row_dimensions[r].height = 22
    ws.freeze_panes = "A4"
    return ws


def build_register_sheet(wb):
    ws = wb.create_sheet("Work Register")
    title_block(ws, "Work Register - Item Level Detail",
                "Committed days per priority are as agreed. Confidence flags where the "
                "engineering estimate exceeds the committed days.",
                11)
    headers = ["Sr", "Pri", "Item", "Requirement (as requested)",
               "Technical Change Required", "Days", "Target Week",
               "Outcome / Definition of Done", "Why This Duration",
               "Confidence", "Status"]
    header_row(ws, 3, headers,
               [7, 5, 28, 34, 56, 7, 11, 46, 52, 11, 12])

    r = 4
    sr = 1
    for (code, pri, item, req, change, days, week, outcome, why, conf, status) in REGISTER:
        put(ws, r, 1, sr, halign="center", valign="center", border=True)
        put(ws, r, 2, f"P{pri}", bold=True, color=WHITE, bg=PRIORITY_FILL[pri],
            halign="center", valign="center", border=True)
        put(ws, r, 3, f"{code}  {item}", bold=True, size=9, wrap=True, border=True)
        put(ws, r, 4, req, size=9, wrap=True, border=True)
        put(ws, r, 5, change, size=9, wrap=True, border=True)
        put(ws, r, 6, days, bold=True, halign="center", valign="center", fmt="0.0",
            border=True)
        put(ws, r, 7, week, size=9, halign="center", valign="center", border=True)
        put(ws, r, 8, outcome, size=9, wrap=True, border=True)
        put(ws, r, 9, why, size=9, wrap=True, border=True)
        bg, fg = CONFIDENCE_STYLE[conf]
        put(ws, r, 10, conf, bold=True, size=9, color=fg, bg=bg,
            halign="center", valign="center", border=True)
        put(ws, r, 11, status, size=9, halign="center", valign="center", border=True)
        ws.row_dimensions[r].height = 62
        r += 1
        sr += 1

    last = r - 1
    for i in range(1, 12):
        ws.cell(row=r, column=i).fill = fill(LIGHT)
        ws.cell(row=r, column=i).border = TOP_RULE
    put(ws, r, 3, "TOTAL COMMITTED MAN-DAYS", bold=True, size=10, bg=LIGHT)
    put(ws, r, 6, f"=SUM(F4:F{last})", bold=True, size=12, color=NAVY, bg=LIGHT,
        halign="center", valign="center", fmt="0.0")
    ws.row_dimensions[r].height = 22
    ws.freeze_panes = "C4"
    ws.auto_filter.ref = f"A3:K{last}"
    return ws


def build_billing_sheet(wb):
    """Priority 2 broken into its five days, one phase per day."""
    ws = wb.create_sheet("Billing Module Split")
    title_block(ws, "Billing Module - Complete 5 Day Split (Priority 2)",
                "e-invoice / IRP end-to-end  |  One phase per day  |  Targets weeks W1-W2",
                6)
    header_row(ws, 3,
               ["Day", "Phase", "What Gets Built", "Depends On",
                "Evidence at End of Day", "Risk / Note"],
               [7, 30, 60, 24, 46, 56])

    r = 4
    for day, phase, build, depends, evidence, risk in BILLING_DAYS:
        put(ws, r, 1, f"Day {day}", bold=True, size=10, color=WHITE, bg=PRIORITY_FILL[2],
            halign="center", valign="center", border=True)
        put(ws, r, 2, phase, bold=True, size=10, wrap=True, border=True)
        put(ws, r, 3, build, size=9, wrap=True, border=True)
        put(ws, r, 4, depends, size=9, wrap=True, border=True)
        put(ws, r, 5, evidence, size=9, wrap=True, border=True)
        put(ws, r, 6, risk, size=9, wrap=True, border=True)
        ws.row_dimensions[r].height = 78
        r += 1

    for i in range(1, 7):
        ws.cell(row=r, column=i).fill = fill(LIGHT)
        ws.cell(row=r, column=i).border = TOP_RULE
    put(ws, r, 2, "TOTAL", bold=True, size=10, bg=LIGHT)
    put(ws, r, 3, f"=COUNTA(A4:A{r - 1})", bold=True, size=11, color=NAVY,
        bg=LIGHT, halign="center", fmt="0")
    put(ws, r, 4, "committed days", bold=True, size=10, bg=LIGHT)
    put(ws, r, 5, "5 phases", bold=True, size=10, bg=LIGHT)
    put(ws, r, 6, None, bg=LIGHT)
    ws.row_dimensions[r].height = 22

    note = r + 2
    put(ws, note, 1,
        "Day 1 is an external dependency: GSP/IRP onboarding is a calendar wait, not "
        "development effort. If credentials are secured before Week 1, Day 1 collapses into "
        "Day 2 and the remaining four days fit inside a single week.",
        size=9, italic=True, color=SLATE, wrap=True)
    ws.merge_cells(start_row=note, start_column=1, end_row=note, end_column=6)
    ws.row_dimensions[note].height = 30
    ws.freeze_panes = "C4"
    return ws


def build_timeline_sheet(wb):
    ws = wb.create_sheet("Timeline")
    title_block(ws, "Timeline - 9 Week Delivery Schedule",
                "W1-W3 and W5-W6 product delivery  |  W4 reserved as buffer  |  W7-W9 Oracle hosting", 9)
    header_row(ws, 3, ["Ref", "Workstream"] + [w for w, _ in WEEKS],
               [12, 46] + [11] * len(WEEKS))
    put(ws, 4, 1, "Week commencing", italic=True, size=9, color=SLATE)
    put(ws, 4, 2, None)
    for i, (_, dates) in enumerate(WEEKS, start=3):
        put(ws, 4, i, dates, size=8, italic=True, color=SLATE, halign="center")
    ws.row_dimensions[4].height = 16

    r = 5
    for ref, name, active in TIMELINE:
        is_buffer = ref == "Buffer"
        put(ws, r, 1, ref, bold=True, size=9,
            color=SLATE if is_buffer else NAVY, border=True,
            halign="center", valign="center")
        put(ws, r, 2, name, size=9, wrap=True, border=True,
            italic=is_buffer, color=SLATE if is_buffer else "000000")
        for i, (wk, _) in enumerate(WEEKS, start=3):
            if wk in active:
                colour = LIGHT if is_buffer else PRIORITY_FILL[int(ref.split()[-1])] \
                    if ref.startswith("Priority") else SLATE
                # White marker merges into the fill in Excel but keeps the bar
                # legible in text exports, printouts and for colour-blind readers.
                put(ws, r, i, "\u25a0", bg=colour, border=True, color=WHITE,
                    size=9, halign="center", valign="center")
            else:
                put(ws, r, i, None, border=True)
        ws.row_dimensions[r].height = 26
        r += 1

    put(ws, r + 1, 1,
        "W4 is a deliberate buffer: it absorbs slippage from Priorities 1-3 before "
        "Harmony Residence begins, rather than hiding the risk.", size=9, italic=True,
        color=SLATE)
    ws.merge_cells(start_row=r + 1, start_column=1, end_row=r + 1, end_column=9)
    ws.freeze_panes = "C5"
    return ws


def build_assumptions_sheet(wb):
    ws = wb.create_sheet("Estimates & Assumptions")
    title_block(ws, "Estimates & Assumptions",
                "Basis for the committed days, dependencies and known risks", 3)
    ws.column_dimensions["A"].width = 34
    ws.column_dimensions["B"].width = 100
    ws.column_dimensions["C"].width = 3

    sections = [
        ("BASIS", [
            ("Unit of estimation",
             "One working day = 7 productive hours, including testing and self-review. "
             "Five-day working week. No leave, meetings or interruption time is included."),
            ("Delivery window",
             "21 September 2026 to 20 November 2026 - nine weeks: five weeks of product "
             "delivery (Priorities 1-5) with one buffer week, followed by three weeks of "
             "Oracle hosting (Priority 6)."),
            ("Resource assumption",
             "The five-week product plan assumes two parallel contributors. A single "
             "contributor extends the product portion to roughly eight weeks."),
            ("Committed vs engineering days",
             "Committed days per priority are as directed. Where the engineering estimate "
             "exceeds the committed days, the item is flagged Low confidence rather than "
             "silently absorbed."),
        ]),
        ("CONFIDENCE NOTES", [
            ("Priority 1 - 1 day",
             "The backup half is fast because the backup script already exists. The Sales "
             "Order edit half is Low confidence because no edit route exists in the "
             "application today; schema, RLS, audit columns and converted-order guards are "
             "all new work."),
            ("Priority 2 - 5 days",
             "Medium confidence. The IRP JSON payload builder, invoice columns and e-way bill "
             "module already exist, so the work is the live IRP client and credential "
             "onboarding. GSP onboarding is an external lead time, not a development task."),
            ("Priority 3 - 5 days",
             "Low confidence overall: seven separate items share five days. Live map tracing "
             "is the highest risk because the current map draws straight lines between points "
             "and true tracing requires an external roads API."),
            ("Priority 5 - 2 days",
             "High confidence. Standard deployment work; the days are DNS and SSL propagation "
             "plus verified smoke tests."),
            ("Priority 4 - 7 days",
             "Medium confidence. Lovable exports generally ship demo-grade authentication, "
             "data model and error handling that must be replaced before go-live."),
            ("Priority 6 - 14 days",
             "Low confidence. Supabase is five products over 107 migrations, not just a "
             "database. Fourteen days covers schema conversion, data migration, authentication "
             "and storage; the live cutover should still be scheduled with its own rollback "
             "window rather than compressed into the final day."),
        ]),
        ("DEPENDENCIES / EXTERNAL BLOCKERS", [
            ("GSP / IRP onboarding (Priority 2)",
             "Credentials and approval can take one to three calendar weeks and cannot be "
             "shortened by development effort. This is the critical path for the billing module."),
            ("Google OAuth refresh token (Priority 1)",
             "A one-time manual authorisation that only the account owner can perform. The "
             "backup automation cannot be completed without it."),
            ("Scheduled backup job activation",
             "The nightly job requires a repository workflow to be published. This is a "
             "user-applied step under the current push policy."),
            ("Roads / Maps API key (Priority 3, R-08)",
             "A key with billing enabled is required before route snapping can be built or "
             "tested."),
        ]),
        ("RISKS", [
            ("Scope density in Priority 3",
             "Seven items in five days leaves no recovery room; a single difficult item "
             "displaces the rest of the priority."),
            ("Oracle cutover",
             "Authentication, storage and cutover now share fourteen days. A cutover without a "
             "separate rollback window risks the system of record."),
            ("No edit route for Sales Order",
             "The editable-order requirement has no existing implementation to build on, "
             "making the one-day commitment the tightest estimate in the plan."),
            ("Screenshot blocking",
             "Delivered as a web-only deterrent (watermark plus blur on focus loss). It does "
             "not prevent operating-system screenshots and should not be represented as "
             "an absolute control."),
        ]),
    ]

    r = 4
    for section, rows in sections:
        put(ws, r, 1, section, bold=True, size=11, color=WHITE, bg=NAVY, border=True)
        put(ws, r, 2, None, bg=NAVY, border=True)
        ws.row_dimensions[r].height = 20
        r += 1
        for label, text in rows:
            put(ws, r, 1, label, bold=True, size=9, wrap=True, border=True,
                valign="top", bg=LIGHT)
            put(ws, r, 2, text, size=9, wrap=True, border=True, valign="top")
            ws.row_dimensions[r].height = max(30, 14 * (len(text) // 95 + 1))
            r += 1
        r += 1

    legend_row = r + 1
    put(ws, legend_row, 1, "LEGEND", bold=True, size=11, color=WHITE, bg=NAVY, border=True)
    put(ws, legend_row, 2, None, bg=NAVY, border=True)
    lr = legend_row + 1
    for k, (label, desc) in enumerate([
        ("Highlight 1-6", "Priority number; 1 is highest priority"),
        ("High", "Committed days are sufficient; low risk of overrun"),
        ("Medium", "Committed days are achievable; overrun possible if a dependency slips"),
        ("Low", "Engineering estimate exceeds committed days; overrun likely without "
                "scope change or additional time"),
        ("Requested", "Wording as supplied by the requester"),
        ("Status", "Not started / In progress / Blocked / Done"),
    ]):
        bg, fg = CONFIDENCE_STYLE.get(label, (LIGHT, "000000"))
        put(ws, lr, 1, label, bold=True, size=9, bg=bg, color=fg, border=True,
            halign="center")
        put(ws, lr, 2, desc, size=9, border=True, wrap=True)
        ws.row_dimensions[lr].height = 20
        lr += 1

    return ws


def build_dashboard(wb, reg_first, reg_last, pri_first):
    ws = wb.create_sheet("Dashboard")
    title_block(ws, "Prokon ERP - Work Plan & Delivery Schedule",
                "Prepared for Management  |  Prepared by: Jai  |  19 September 2026", 5)
    put(ws, 3, 1, "Delivery window: 21 September 2026 - 20 November 2026 "
                  "(9 weeks: 5 weeks product delivery + 1 week buffer + 3 weeks Oracle hosting)",
        size=10, color=SLATE, italic=True)
    ws.merge_cells(start_row=3, start_column=1, end_row=3, end_column=5)

    put(ws, 5, 1, "PRIORITY SUMMARY", bold=True, size=11, color=NAVY)
    ws.merge_cells(start_row=5, start_column=1, end_row=5, end_column=5)
    header_row(ws, 6, ["#", "Workstream", "Days", "Target Week", "Confidence"],
               [6, 42, 9, 13, 13])

    conf_by_priority = {
        1: "Low", 2: "Medium", 3: "Low", 4: "Medium", 5: "High", 6: "Low",
    }
    r = 7
    for num, name, _scope, days, week, _outcome in PRIORITIES:
        put(ws, r, 1, num, bold=True, color=WHITE, bg=PRIORITY_FILL[num],
            halign="center", valign="center", border=True)
        put(ws, r, 2, name, size=10, border=True, wrap=True)
        put(ws, r, 3, f"='Priority Plan'!D{pri_first + num - 1}", size=10, bold=True,
            halign="center", fmt="0.0", border=True)
        put(ws, r, 4, week, size=9, halign="center", border=True)
        c = conf_by_priority[num]
        bg, fg = CONFIDENCE_STYLE[c]
        put(ws, r, 5, c, size=9, bold=True, color=fg, bg=bg, halign="center", border=True)
        ws.row_dimensions[r].height = 20
        r += 1

    last = r - 1
    for i in range(1, 6):
        ws.cell(row=r, column=i).fill = fill(LIGHT)
        ws.cell(row=r, column=i).border = TOP_RULE
    put(ws, r, 2, "TOTAL COMMITTED MAN-DAYS", bold=True, size=10, bg=LIGHT)
    put(ws, r, 3, f"=SUM(C7:C{last})", bold=True, size=12, color=NAVY, bg=LIGHT,
        halign="center", fmt="0.0")
    ws.row_dimensions[r].height = 22
    total_row_idx = r

    r += 2
    put(ws, r, 1, "DELIVERY BREAKDOWN", bold=True, size=11, color=NAVY)
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=5)
    r += 1
    for label, formula in [
        ("Product delivery (Priorities 1-5)", f"=SUM(C7:C{last - 1})"),
        ("Oracle hosting (Priority 6)", f"=C{last}"),
        ("Total committed man-days", f"=C{total_row_idx}"),
        ("Items in the register", f"=COUNTA('Work Register'!C{reg_first}:C{reg_last})"),
    ]:
        put(ws, r, 1, label, size=10, border=True, bg=LIGHT, bold=True)
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=2)
        put(ws, r, 3, formula, size=10, bold=True, halign="center", fmt="0.0", border=True)
        r += 1

    r += 1
    put(ws, r, 1, "HOW TO READ THIS PLAN", bold=True, size=11, color=NAVY)
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=5)
    r += 1
    for text in [
        "Confidence flags where the engineering estimate exceeds the committed days. Low "
        "confidence means overrun is likely without scope change or additional time.",
        "Planned working week is Monday to Friday. Week 4 is a deliberate buffer before "
        "Harmony Residence begins.",
        "The billing module's five days are split day by day on the 'Billing Module Split' "
        "sheet. Full basis, dependencies and risks are on the 'Estimates & Assumptions' sheet.",
    ]:
        put(ws, r, 1, "\u2022  " + text, size=9, wrap=True, valign="top")
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=5)
        ws.row_dimensions[r].height = 28
        r += 1

    return ws


def _parse_range(arg, cur_sheet):
    """Return (sheet, min_col, min_row, max_col, max_row) or None."""
    m = re.match(r"^'?([^'!]+)'?!(\$?[A-Z]{1,3}\$?\d+):(\$?[A-Z]{1,3}\$?\d+)$", arg)
    if m:
        sheet = m.group(1)
        a, b = m.group(2).replace("$", ""), m.group(3).replace("$", "")
    else:
        m2 = re.match(r"^(\$?[A-Z]{1,3}\$?\d+):(\$?[A-Z]{1,3}\$?\d+)$", arg)
        if not m2:
            return None
        sheet = cur_sheet
        a, b = m2.group(1).replace("$", ""), m2.group(2).replace("$", "")
    min_c, min_r, max_c, max_r = range_boundaries(f"{a}:{b}")
    return sheet, min_c, min_r, max_c, max_r


def _parse_ref(expr, cur_sheet):
    m = re.match(r"^'?([^'!]+)'?!(\$?[A-Z]{1,3}\$?\d+)$", expr)
    if m:
        return m.group(1), m.group(2).replace("$", "")
    if re.match(r"^\$?[A-Z]{1,3}\$?\d+$", expr):
        return cur_sheet, expr.replace("$", "")
    return None


def _resolve(formula, cur_sheet, values, pending):
    """Evaluate the small formula vocabulary this workbook uses."""
    expr = formula[1:].strip()
    m = re.match(r"^(SUM|COUNTA)\((.+)\)$", expr, re.I)
    if m:
        fn, arg = m.group(1).upper(), m.group(2)
        rng = _parse_range(arg, cur_sheet)
        if not rng:
            return None
        sheet, min_c, min_r, max_c, max_r = rng
        total, count = 0.0, 0
        for r in range(min_r, max_r + 1):
            for c in range(min_c, max_c + 1):
                coord = f"{get_column_letter(c)}{r}"
                if (sheet, coord) in pending:
                    return None  # dependency not yet resolved
                v = values.get((sheet, coord))
                if v is None:
                    continue
                total += v if isinstance(v, (int, float)) else 0
                count += 1
        return total if fn == "SUM" else count

    ref = _parse_ref(expr, cur_sheet)
    if ref is not None:
        if ref in pending:
            return None
        return values.get(ref)
    return None


def inject_cached_values(path):
    """
    openpyxl writes formulas with no cached result, so every formula cell shows
    blank in viewers that do not recalculate (previews, pandas, markitdown).
    Inject the computed <v> next to each <f> so values render everywhere while
    Excel/Sheets still recalculate on edit.
    """
    wb = load_workbook(path)

    values, formulas = {}, {}
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                if cell.value is None:
                    continue
                if isinstance(cell.value, str) and cell.value.startswith("="):
                    formulas[(ws.title, cell.coordinate)] = cell.value
                else:
                    values[(ws.title, cell.coordinate)] = cell.value

    pending = dict(formulas)
    for _ in range(len(formulas) + 2):
        if not pending:
            break
        for key in list(pending):
            sheet, coord = key
            result = _resolve(pending[key], sheet, values, pending)
            if result is not None:
                values[key] = result
                del pending[key]
    if pending:
        raise RuntimeError(f"unresolved formulas: {sorted(pending)}")

    # map sheet name -> xl/worksheets/sheetN.xml
    zf = zipfile.ZipFile(path)
    workbook_xml = zf.read("xl/workbook.xml").decode("utf-8")
    rels_xml = zf.read("xl/_rels/workbook.xml.rels").decode("utf-8")

    rel_map = {}
    for m in re.finditer(r"<Relationship\b[^>]*/>", rels_xml):
        tag = m.group(0)
        rid = re.search(r'Id="([^"]+)"', tag)
        tgt = re.search(r'Target="([^"]+)"', tag)
        if rid and tgt:
            rel_map[rid.group(1)] = tgt.group(1)

    def _norm(target):
        t = unescape(target).lstrip("/")
        if t.startswith("xl/"):
            t = t[3:]
        return "xl/" + t

    sheet_files = {}
    for name, rid in re.findall(
            r'<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"', workbook_xml):
        target = rel_map.get(rid)
        if target:
            sheet_files[unescape(name)] = _norm(target)

    replacements = {}
    for name, member in sheet_files.items():
        if member not in zf.namelist():
            continue
        xml = zf.read(member).decode("utf-8")

        def _sub(match, _name=name):
            cell_xml, ref = match.group(0), match.group(1)
            key = (_name, ref)
            if key not in formulas:
                return cell_xml
            val = values.get(key)
            if val is None:
                return cell_xml
            text = f"{val:g}"
            if "<v></v>" in cell_xml:
                return cell_xml.replace("<v></v>", f"<v>{text}</v>", 1)
            if "<v>" in cell_xml:
                return cell_xml
            return cell_xml.replace("</f>", f"</f><v>{text}</v>", 1)

        xml = re.sub(r'<c r="([A-Z]{1,3}\d+)"[^>]*>.*?</c>', _sub, xml, flags=re.S)
        if xml != zf.read(member).decode("utf-8"):
            replacements[member] = xml

    zf.close()

    tmp = str(path) + ".tmp"
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = replacements.get(item.filename)
            zout.writestr(item, data if data is not None else zin.read(item.filename))
    os.replace(tmp, path)

    return len(formulas)


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
        "/Users/jai/Desktop/Prokon_ERP_Work_Plan_2026-09-19.xlsx")

    wb = Workbook()
    default = wb.active
    if default is not None:
        wb.remove(default)

    # Row indices are deterministic, so the Dashboard can be created first with
    # correct cross-sheet references.
    pri_first = 4
    reg_first = 4
    reg_last = 3 + len(REGISTER)

    build_dashboard(wb, reg_first=reg_first, reg_last=reg_last, pri_first=pri_first)
    build_priority_sheet(wb)
    build_billing_sheet(wb)
    build_register_sheet(wb)
    build_timeline_sheet(wb)
    build_assumptions_sheet(wb)

    for ws in wb.worksheets:
        ws.sheet_view.showGridLines = False
        ws.page_setup.orientation = "landscape"
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 0
        ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)

    wb.calculation.fullCalcOnLoad = True
    wb.save(out)

    n = inject_cached_values(out)

    committed = round(sum(p[3] for p in PRIORITIES), 2)
    registry = round(sum(r[5] for r in REGISTER), 2)
    print(f"wrote {out}")
    print(f"priority total = {committed}  register total = {registry}  "
          f"register rows = {len(REGISTER)}  cached formulas = {n}")
    assert committed == registry == 34.0, "day totals disagree"
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
