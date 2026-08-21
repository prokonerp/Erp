# Working Notes

Live, mutable state for agents. The `context-updater` agent refreshes these after every task.

## Contents
- `status.md` — **current state**: branch, remote, recent commits, changed files, pending items, known issues. Read this first when starting any task.
- Per-task notes may be added as `YYYY-MM-DD--<task>.md` for longer investigations; summarize findings back into `../context/` knowledge files when stable.

## Rules
- Keep `status.md` current — it is the first thing agents read.
- When a fact becomes permanent (new table, new route, new behavior), move it into the knowledge base under `../context/` and trim the working note.
- Never store secrets here.