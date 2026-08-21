# Working Status

*Last updated: 2026-08-21*

## Current state
- **Branch:** `fork`
- **Remote:** `origin → https://github.com/prokonerp/Erp.git` (old `gauravarora97/prokon-gatepass` remote removed)
- **Latest commit (fork):** `1468dc9 Replace designated owner email with prokonerp@gmail.com`
- **Working tree:** clean (as of context setup)

## Recent changes
1. **Repo fork setup** — cloned `gauravarora97/prokon-gatepass`, created branch `fork`, removed old remote, set new remote `prokonerp/Erp.git`.
2. **Owner email updated** — `supabase/migrations/20260803130516_13dadd82-0a90-4319-b0f8-c9b465459967.sql`: designated owner allow-list now `('gaurav@prokonhitech.com', 'prokonerp@gmail.com')`. (`gaurav@prokonhitech.com` intentionally kept — owner may want it removed later.)
3. **Agent context created** — `.opencode/agent/*` (structure-scanner, context-provider, plan-reviewer, context-updater) + `.opencode/context/` knowledge base (categorized).

## Pending / decisions
- [ ] **`.env` credentials** — still the ORIGINAL Supabase project's live values (`vimkodursmcsaptrrzbl`); `.env` is git-tracked. Owner said keep as-is for now. **Action needed before any public push: rotate keys + untrack `.env` (add to .gitignore).**
- [ ] **Push to new remote** — `prokonerp/Erp` repo existence on GitHub NOT yet verified; no push done.
- [ ] Decide whether to remove `gaurav@prokonhitech.com` from the designated-owner allow-list.
- [ ] Consider adding `.opencode/` to git (it is currently untracked) and committing the context on `fork`.

## Known issues / gotchas
- Live Supabase DB has schema drift beyond migrations (see `../context/database.md` "Drift note").
- e-Invoice IRN is mocked (`mockIrnPayload`) — real GSP integration is future work.
- Some tables still use permissive RLS (`auth.uid() IS NOT NULL`) — see `../context/security.md`.
- Route tree (`src/routeTree.gen.ts`) is auto-generated — never hand-edit.