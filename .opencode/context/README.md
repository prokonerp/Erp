# Prokon ERP — Agent Context Folder

This folder is the **persistent knowledge base** for AI agents working on this project. It is written once and updated incrementally by the `context-updater` agent after every task. Agents MUST read these files instead of re-exploring the whole repository.

## Categories

| Folder | Purpose | Contents |
|---|---|---|
| `context/` | **Knowledge base** — how the project works | overview, tech-stack, architecture, database, modules, routes, security, integrations, deployment, git state |
| `plan/` | **Plans** — one file per task/build | task plans from `context-provider`, archived after execution |
| `working/` | **Working notes** — live status | `status.md` (current branch, recent changes, pending), per-task notes |

## How agents use this folder

- `structure-scanner` reads relevant context files FIRST, then scans only new/drifted areas.
- `context-provider` builds plans from context + structure map, without re-reading source.
- `plan-reviewer` validates plans against the context knowledge base.
- `context-updater` updates these files after every completed task — keep this folder accurate.

## Project one-liner

**Prokon ERP** — an ERP for **Prokon Hi-Tech Systems** (UPS / battery / CCTV / solar equipment sales + service, Gurgaon, India). Built with TanStack Start (SSR on Cloudflare Workers), Supabase (Postgres + Auth + Storage), React 19, Tailwind v4, shadcn/ui. Modules: Tickets (service), AMC, CRM (leads/quotes), Sales (SO/DC/Invoice/GST), IMS (inventory), Indent/RMA (OEM exchange), PO, Payroll, Gatepass, Masters.

## How to keep it fresh

1. After any task, read the affected knowledge files, apply surgical edits, update `working/status.md`.
2. Never bloat — keep entries concise and factual.
3. Mark `[DRIFT]` notes when live state (Supabase schema, routes) differs from what's documented.