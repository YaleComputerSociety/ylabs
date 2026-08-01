---
name: graphify
description: Use whenever an agent needs cross-module architecture or dependency context, is about to search broadly, changes models/routes/controllers/services/schemas, finds a missing/stale/invalid Graphify cache, or encounters generated Graphify conflicts. Covers local cache freshness, scoped navigation, source verification, and deterministic CI policy.
---

# Graphify navigation cache

Graphify is a local, generated navigation cache for this repository.
It is not committed source and it is never the final authority.
Source files, tests, `AGENTS.md`, and `docs/*.md` are canonical.

## Required workflow

1. Run `yarn graphify:ensure` before cross-module exploration or broad file search.
2. Use the narrowest useful `graphify query`, `graphify path`, or `graphify explain` command.
3. Open the source files Graphify identifies.
4. Verify important relationships and behavior against source, tests, and durable docs.
5. Make the smallest safe change.
6. Run `yarn graphify:ensure` again if models, routes, controllers, services, schemas, or other architectural relationships changed.

`graphify:ensure` refreshes only when the cache is missing, invalid for the pinned Graphify version, not checked against the current commit, or stale relative to graph-relevant working-tree inputs.
Refreshes use local AST analysis and do not require an LLM or API key.

## Commands

| Command | Use |
|---------|-----|
| `yarn graphify:ensure` | Check freshness and refresh only when needed |
| `yarn graphify:status` | Print freshness and the exact refresh reasons without changing files |
| `yarn graphify:refresh` | Force a local refresh after substantial architecture changes |
| `graphify query "<question>"` | Ask a scoped cross-module architecture question |
| `graphify explain "<concept>"` | Inspect a concept and related nodes |
| `graphify path "<A>" "<B>"` | Trace relationships between two nodes |
| `yarn graphify:policy` | Verify generated Graphify output is ignored and untracked |
| `yarn graphify:verify` | Generate twice and require identical output, as CI does |

Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review.
Prefer scoped queries for implementation work.

## Trust boundaries

Graphify can suggest where code and relationships live.
It cannot establish:

- Whether an operational migration was reviewed or accepted.
- Whether a GitHub issue or pull request is currently open, closed, or merged.
- The current state of private or deployed data.
- Runtime or deployment configuration.
- The behavior of code added after the graph was generated.

Verify those facts against their authoritative systems.
Always verify code behavior against current source and tests, even when the cache is fresh.

## Failure fallback

If Graphify is unavailable or refresh fails, state the cache problem briefly and continue with targeted `rg`, source inspection, tests, and durable docs.
Do not present a stale or invalid graph as current.
Graphify should improve navigation, not block productive work.
If a clean worktree has not installed Yarn dependencies yet, run `node scripts/graphify-cache.mjs ensure` directly.
The cache helper uses only built-in Node modules.

Install the exact pinned version with:

```bash
uv tool install "graphifyy==$(cat .graphify-version)"
```

If `uv` is unavailable, use `pipx` with the same exact version.

## Git policy

- Never stage or commit anything under `graphify-out/`.
- Never manually merge generated Graphify JSON or reports.
- Never force-add ignored Graphify output.
- Keep `.graphify-version`, `.graphifyignore`, the cache scripts, and this skill committed.
- Let CI publish deterministic generated output as a temporary artifact for inspection.

If a legacy branch still has conflicts in the two formerly tracked outputs, resolve only those generated files from the target branch, then remove them from tracking:

```bash
git restore --source=origin/beta --staged --worktree -- \
  graphify-out/graph.json graphify-out/GRAPH_REPORT.md
git rm --cached -- \
  graphify-out/graph.json graphify-out/GRAPH_REPORT.md
```

Do not apply that restoration command to source files or other user changes.

## CI contract

CI enforces that no `graphify-out/` file is tracked, installs the exact `.graphify-version`, runs generation twice, and fails if the two outputs differ.
The generated graph and report are uploaded as a CI artifact instead of committed to Git.
