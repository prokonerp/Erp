# P0001 Log Capture — ticket-attachments upload 500

## 1. Why
The `[500]` prefix is the HTTP status from storage-api, not Postgres.
`"database error, code: P0001"` is storage-api's redaction of a Postgres `raise_exception` — the raising function name exists only in the server-side logs.

## 2. Capture A — Postgres log
1. Trigger one fresh failed upload from the engineer portal first.
2. Open Supabase Dashboard → Logs → Logs Explorer → Product filter `postgres` (may be labelled `Database`). Timestamps are UTC — match the failure minute in UTC.
3. Filter severity/error level, time window = the exact minute of that upload.
4. Copy the full `ERROR:` line AND the `CONTEXT:` line verbatim.
Expected shape: `CONTEXT: PL/pgSQL function storage.protect_delete() line 4 at RAISE` or `storage.<something>`.

## 3. Capture B — storage log
1. Same explorer → source `storage` (Edge/API), same minute window.
2. Copy the failing request entry: request id, method, path, status 500, plus any `details`/`hint` fields.

## 4. What to paste back
- Paste both blocks verbatim, plus exact wall-clock time of the repro.
- State which entry point was used: ticket photo / equipment photo / conveyance / profile.

## 5. Two 20-second discriminators (same session)
a. Upload a <1 MB image and a >6 MB image to the same ticket — report which fails (tests versioned/multipart code path).
b. After the failure, check the browser console for `console.warn("Old photo cleanup failed:" …)` — report present/absent (closes the DELETE-path question).

## 6. Non-goals
- Do NOT run any SQL.
- Do NOT change anything.
- Do NOT retry more than twice (each retry is a log row; note the timestamps).
