# Yale Research - Agent Guide

This is the canonical agent-facing entry point for Yale Research.
Keep it short.
Move detailed procedures into `skills/<name>/SKILL.md` so agents load the right context only when needed.
Treat `docs/` as durable product direction when it conflicts with older lab-first framing.

## On-Demand Skills

Read the relevant skill before doing that kind of work.
Claude Code can auto-discover them if `.claude/skills` is symlinked to `skills/`; other agents should read them directly.

| Skill | Read it when |
|-------|-------------|
| `skills/graphify/SKILL.md` | Navigating or answering cross-module architecture questions before broad file search, or maintaining the shared graph snapshot. |
| `skills/product-model/SKILL.md` | Changing student-facing research discovery behavior, product vocabulary, visibility, access evidence, or entity-page content. |
| `skills/architecture/SKILL.md` | Needing the repo map, stack, commands, routes, services, naming conventions, environments, or external integrations. |
| `skills/search-data/SKILL.md` | Working on MongoDB data shape, Meilisearch indexes, browse ranking, ResearchEntity search, or search rebuild scripts. |
| `skills/auth-security/SKILL.md` | Touching auth, sessions, CAS login, middleware, rate limits, CORS, CSRF, SSRF, env vars, or sensitive files. |
| `skills/scrapers/SKILL.md` | Working in `server/src/scrapers/`, source scrapers, observations, materializers, confidence resolution, scrape CLI, or scraper write guards. |
| `skills/contributing/SKILL.md` | Adding an API endpoint, a client page or route, or modifying a Mongoose schema. |
| `skills/finishing-work/SKILL.md` | Wrapping up: verification, diff review, docs maintenance, and roadmap cleanup. |

## Default Task Loop

For any non-trivial codebase task:

1. Use a scoped `graphify query`, `graphify path`, or `graphify explain` before broad search; read `graphify-out/GRAPH_REPORT.md` only for a broad architecture review.
2. Read the smallest relevant skill or skills from the table above.
3. Verify important Graphify or skill claims against source files, tests, and durable docs.
4. Make the smallest safe change using existing repo patterns.
5. Run focused verification and review the diff.
6. Fold durable changes back into docs; leave Graphify refreshes to dedicated maintenance after groups of Beta merges.

Source files, tests, `AGENTS.md`, and `docs/*.md` are canonical.
Graphify is a navigation layer, not the source of truth.

## Core Rules

- Never use em dashes.
Use plain hyphens instead.
- When writing commit messages, never auto-add the agent name as a co-author.
- Never manually modify `CHANGELOG.md` files or files marked as auto-generated.
- When writing or substantially editing long Markdown files, put each full sentence on its own physical line.
Preserve normal Markdown structure, but avoid wrapping multiple sentences onto one physical line.
- When making technical decisions, do not give much weight to development cost.
Prefer quality, simplicity, robustness, scalability, and long-term maintainability.
- When doing bug fixes, start by reproducing the bug in an end-to-end setting as close to end-user behavior as feasible.
- When end-to-end testing product UI, be picky about polish.
If something clearly looks off, try to fix it too.
- Treat lint, test failures, and flakiness seriously.
If you see a failure, even if it is not caused by the current work, try to get it fixed.

## Implementation Rules

- Default to making the requested change after inspecting the code.
Ask questions only when the answer cannot be inferred and a wrong assumption would create meaningful rework or risk.
- When the user reports a problem, fix the upstream cause when feasible, not just the local symptom.
- Follow existing local patterns before adding abstractions.
- Prefer first-class product-model collections over embedded shortcuts.
Canonical concepts are `ResearchEntity`, `EntryPathway`, `PostedOpportunity`, `AccessSignal`, and `ContactRoute`.
- Treat remaining `ResearchGroup`, `lab`, and `researchGroupId` naming as migration residue unless the file is explicitly rollback or migration support.
- Keep scraper writes evidence-first and fail closed on contact data.
See `skills/scrapers/SKILL.md`.

## Parallel Work

Use parallel subagents only when a task is large enough to split safely into independent workstreams.
Do not use subagents for tightly coupled changes, tiny tasks, or decisions that need one coherent product judgment.

When using git worktrees, subagents work in isolated worktrees.
The main thread reviews, tests, and integrates accepted work back into the active branch before calling the task done.
If integration is unsafe, stop and report the blocker instead of leaving finished work stranded.
