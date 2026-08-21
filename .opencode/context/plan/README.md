# Plans

This folder holds **one plan file per task/build**, produced by the `context-provider` agent and reviewed by `plan-reviewer` before execution.

## Naming convention
`YYYY-MM-DD--<short-task-slug>.md`

## Plan file template

```markdown
# Task: <one-line goal>

- **Date:** YYYY-MM-DD
- **Status:** proposed | approved | in-progress | done | cancelled
- **Context refs:** (which files in ../context/ were used)

## Goal

## Files to create/modify
- `path` — why

## Implementation steps
1. ...

## Business/data rules to respect
- ...

## Risks / gotchas
- ...

## Verification
- ...
```

## Lifecycle
1. `context-provider` writes the plan here.
2. `plan-reviewer` reviews (verdict recorded in the file).
3. Build executes; when done, `context-updater` marks it done/archived and updates `../working/status.md` and the knowledge base.
4. Finished plans stay here for history — never delete; mark with outcome.