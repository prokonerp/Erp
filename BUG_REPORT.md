# Prokon ERP — Bug Report (from Code Review)

> **How to read this:** These were found by reviewing the source code (think of it as an
> X-ray, not a confirmed live test). Each item is a real *lead* — most are genuine, a few
> may be already guarded elsewhere. Severity = estimated business impact. The suggested
> "One-line fix" is the direction, not the final code.
>
> Format per bug: **Bug** → **What it means for you (owner/employee)** → **One-line fix**.

---

## 🔴 FINANCE & BILLING (these cost money)

### B-01 · One delivery can be invoiced twice · [Critical]
**As the person using it:** When staff convert a delivery challan into an invoice, the system
does several steps in a row. If it hiccups halfway, the invoice still gets created but the
challan still shows as "waiting to be billed" — so next week someone bills it again. The
customer gets two invoices for one delivery.
**One-line fix:** Mark the challan "converted" only *after* the invoice and its items are
safely saved, and stop hiding the error that occurs in between.

### B-02 · Double-clicking "Convert" creates duplicate documents · [Critical]
**As the person using it:** Clicking "Convert" twice (quotation → order → challan → invoice)
can silently create two sales orders or two invoices that look perfectly normal.
**One-line fix:** Disable the button during save and give every conversion step a "done"
marker so a retry cannot recreate it.

### B-03 · Invoice total ≠ sum of its own line items · [Critical]
**As the person using it:** The discount on the invoice header never gets split into the
saved line items, so the invoice shows one taxable amount but the item records add up to a
different number. When your CA files GST, the summary and item-wise data disagree.
**One-line fix:** Split the header discount across each line item before saving taxable
values.

### B-04 · Same deal charged CGST+SGST on quote but IGST on invoice · [High]
**As the person using it:** Quotations decide tax type by reading the state *name*, while
invoices use the GSTIN code — the two can disagree, so a quote shows one tax type and the
final invoice charges the other.
**One-line fix:** Decide intra/inter-state from the GSTIN in both the quotation and invoice
engines.

### B-05 · A payment can be spread across more dues than it covers · [High]
**As the person using it:** Staff can allocate a ₹10,000 payment against ₹15,000 of dues, and
two people recording payments at the same time can apply the same money twice.
**One-line fix:** Cap each allocation to the invoice's remaining balance and validate it on
the server, inside a single transaction.

### B-06 · Overselling is only blocked "on the screen" · [Critical]
**As the person using it:** Only admins should be allowed to sell stock you don't have, but
that check happens only on the screen — not in the database. Anyone with a login and a little
know-how can push the sale through.
**One-line fix:** Enforce the negative-stock permission in the database rules, not just the
form.

---

## 📦 STOCK & INVENTORY

### B-07 · The same serial number given to two customers · [Critical]
**As the person using it:** Before assigning a serial to a ticket or invoice, the system
doesn't re-check that it's still free, so two warranties can point at one physical machine.
**One-line fix:** Verify the unit is still "available" and use a guarded update before
issuing it.

### B-08 · Goods receipts can be edited after they're counted into stock · [High]
**As the person using it:** A goods-received note already marked Submitted (already added to
stock) can still be reopened and re-saved, inflating stock counts.
**One-line fix:** Block edits once status is Submitted; allow changes only via the admin
reverse flow.

### B-09 · Leave the quantity blank and the system writes "1" · [Medium]
**As the person using it:** In a goods receipt, a blank or garbage quantity quietly becomes
1 unit instead of stopping you — you receive 0 but stock goes up by 1.
**One-line fix:** Treat empty/NaN quantity as invalid and block saving until corrected.

### B-10 · Fractional quantity on a serial-tracked item slips through · [Medium]
**As the person using it:** You can bill 2.5 units of a serialized product while providing
only 2 serial numbers, so records and physical units don't match.
**One-line fix:** Require whole-number quantity on serialized lines and match the serial
count exactly.

### B-11 · After 1,000 records, older ones silently vanish from lists · [High]
**As the person using it:** Some list pages stop fetching past 1,000 rows — no error, no
warning — so challans/GRNs exist in the database but simply don't appear.
**One-line fix:** Use the existing paged fetch (or server-side pagination) for challans,
GRNs and IMS lists.

---

## ⏰ DATES & TIME (bigger impact than it sounds)

### B-12 · Documents created between midnight and 5:30 AM get yesterday's date · [High]
**As the person using it:** The system uses world-clock time, so a warehouse night shift
creating an invoice at 1 AM Tuesday dates it Monday — wrong dates on invoices, POs, payments
and indents every night.
**One-line fix:** Compute "today" in Indian time (Asia/Kolkata) instead of UTC.

### B-13 · AMC expiry flips to the wrong status · [Medium]
**As the person using it:** Contracts ending "today" can show as already expired (or still
active when expired) depending on the hour.
**One-line fix:** Compare contract dates in IST, not UTC midnight.

### B-14 · Returnables flagged "overdue" about 5.5 hours early · [Medium]
**As the person using it:** Returnable challans show as overdue before they actually are,
triggering premature follow-ups.
**One-line fix:** Evaluate overdue using IST date terms, not a UTC timestamp.

### B-15 · SLA / response timers differ from one computer to another · [Medium]
**As the person using it:** Ticket SLA clocks use whichever device's timezone is set, so
field staff abroad and HQ see different "truths."
**One-line fix:** Pin all SLA computations to IST.

---

## 🤐 SILENT FAILURES (you find out months later)

### B-16 · Backend errors are quietly ignored · [High]
**As the person using it:** Several steps hide their failures, so you see "Success!" while
the record was never saved — ticket activity history, negative-stock logs, and status updates
are the usual victims.
**One-line fix:** Surface the error to the user and retry or roll back instead of swallowing
it.

### B-17 · Some actions fire and forget (logout tracking, deletes) · [Medium]
**As the person using it:** Background actions like logging out or deleting a setting can
fail with no message, leaving gaps in audit trails.
**One-line fix:** Await these calls and report failure instead of ignoring it.

---

## 🔐 ADMIN & SECURITY

### B-18 · "Admin" is sometimes just a label on the screen · [High]
**As the person using it:** In places, who is an admin is decided in the browser, not
enforced at the data level — so sensitive actions (payroll corrections, deleting GRNs,
reversing stock) may be reachable by non-admins with the right tools.
**One-line fix:** Enforce admin/role checks in the database policies, not just the UI.

### B-19 · The first person to click "Claim Admin" becomes admin · [Medium]
**As the person using it:** A self-promotion button lets the first user grant themselves
admin rights without real verification.
**One-line fix:** Gate the admin-claim process behind a verified owner/init step.

---

## 🔄 RACES & CONCURRENCY (two people, same record)

### B-20 · Two managers can both approve the same transfer · [Medium]
**As the person using it:** Approving a stock transfer doesn't check its current status, so
a double-click or two admins can approve it twice.
**One-line fix:** Update only if the current status matches what was expected (conditional
update).

### B-21 · Autosave can overwrite your newer edits with older ones · [Medium]
**As the person using it:** In indents, a delayed autosave can land after you've already
changed the record again, clobbering your latest work.
**One-line fix:** Guard in-flight saves with a version/abort token so stale writes cancel.

### B-22 · Print counts get lost when printing the same batch twice · [Low]
**As the person using it:** Printing labels twice can fail to increment the printed count,
so you can't tell what was actually printed.
**One-line fix:** Use an atomic "add 1" update with error handling.

---

## 💰 PAYROLL

### B-23 · Salary calculations have never been automatically tested · [High]
**As the person using it:** The salary/advance math is complex and unverified, so a small
logic slip can silently pay the wrong amount to everyone.
**One-line fix:** Add automated tests for the salary math and wrap paired writes
(attendance+audit, payment+advance) in transactions.

### B-24 · Attendance corrections can lose their audit trail · [Medium]
**As the person using it:** Undoing/clearing attendance deletes records and updates an audit
flag in two steps; if the second fails, you get payroll changes with no record of who did
what.
**One-line fix:** Ensure the audit update completes with, or rolls back alongside, the delete.

---

## 🔗 CRM / DOCUMENT CONVERSION

### B-25 · Only the first conversion step is protected against duplicates · [High]
**As the person using it:** Quotation→Sales Order is safe, but Sales Order→Challan and
→Invoice are not, so retries/duplicates desync statuses across documents.
**One-line fix:** Add a "converted" marker to every conversion step, not just the first.

---

## 🖨️ PRINT / PDF

### B-26 · Printed invoices can disagree with the saved invoice · [Medium]
**As the person using it:** The print/PDF view recomputes GST totals instead of reading the
stored values, so what the customer receives can differ from what's on file.
**One-line fix:** Print from the stored breakdown values, not by recalculating.

---

## Suggested fix order (by "costs money now")
1. B-01, B-02, B-03, B-04, B-06, B-07 — money/tax/stock integrity (Critical).
2. B-05, B-08, B-11, B-12, B-16, B-18, B-23, B-25 — correctness & compliance (High).
3. B-09, B-10, B-13, B-14, B-15, B-17, B-19, B-20, B-21, B-24, B-26 — robustness (Medium).
4. B-22 — polish (Low).

> Next step recommended: a verification pass on each Critical/High item (read the actual code
> + the database rules) before writing fixes, so we fix the real bug and not a guess.
