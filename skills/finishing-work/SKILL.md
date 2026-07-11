---
name: finishing-work
description: Use when wrapping up a coding task in this repo - deciding what to verify, reviewing the final diff, and folding durable changes back into docs and the task roadmap. Covers the done-criteria, verification, and documentation-maintenance workflow.
---

# Finishing work

## Verify

Before finishing, run the **narrowest relevant** verification command. Prefer focused tests, typechecks, lint, or build steps over broad commands unless the change affects shared behavior or release readiness. If verification is skipped, explain why.

| Command | Use |
|---------|-----|
| `yarn --cwd server test` | Server-side Vitest suite |
| `yarn --cwd client test:ci` | Client Vitest once (CI form) |
| `npx tsc --noEmit -p server/tsconfig.json` | Server typecheck |
| `yarn build` | Full build (server + client) |

Note: the client `tsc --noEmit` is **not** clean (pre-existing type errors) and is not in CI - do not assume it passes unless the task specifically addresses that cleanup.

CI (`.github/workflows/ci.yml`) runs: checkout -> Node 20 -> Corepack -> `yarn install:all` -> server typecheck -> server tests -> client tests -> high-severity dependency audit -> `yarn build`.

## Review the final diff

Review for bugs, regressions, risky patterns, unrelated changes, and documentation impact. Keep final summaries short and include the tests or checks run.

## Fold durable changes into docs

Update repo documentation only when the task changes **durable** product, schema, architecture, setup, or design decisions - never speculatively.

- `AGENTS.md` - the canonical agent-facing entry point. Keep it compact and route detailed context to focused skills.
- `DEVELOPER_GUIDE.md` - human-facing project documentation. Keep it accurate in the same commit as the code change.
- `docs/product-context.md` - stable product context.
- `docs/research-model.md` - schema and modeling decisions.
- `docs/decisions.md` - dated architecture/product decisions (add a date for major decisions).
- `docs/agent-workflow.md` - how an agent should work in this repo.

Keep entries concise, preserve existing structure, link implementation files when relevant, and do not invent decisions that were not made. Do not append noisy transcripts; summarize only stable decisions.

## Task roadmap

Use `docs/tasks/priority-roadmap.md` as the single task source of truth. Do not create new durable task files under `docs/tasks/` unless the user explicitly asks for one; consolidate outstanding tasks and completion notes back into the roadmap before finishing. Delete or fold back temporary execution trackers during cleanup.

## Rule evolution

Treat agent rules as living workflow documentation. When the same mistake recurs, or the user gives feedback that should apply beyond the current task, add a concise durable rule to `AGENTS.md` or `docs/agent-workflow.md`. Keep rules practical and compact; prefer links to focused docs over long inline checklists.
