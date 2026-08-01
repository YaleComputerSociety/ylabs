# Graphify Onboarding

Graphify is a local generated navigation cache for coding agents.
It helps agents navigate architecture, schema, scraper, and product-model relationships without treating generated output as canonical source.
For day-to-day usage and failure handling, read [`skills/graphify/SKILL.md`](../skills/graphify/SKILL.md).

## Canonical Sources

- Source code, tests, `AGENTS.md`, skills, and `docs/*.md` remain canonical.
- Graphify output is a navigation layer.
- Important claims must be verified against current source before editing or summarizing.
- `.graphifyignore` controls what enters the local graph.

## Setup

1. Install the exact version declared in `.graphify-version`:

   ```bash
   uv tool install "graphifyy==$(cat .graphify-version)"
   ```

   Use `pipx` with the same exact version if `uv` is unavailable.

2. Install the agent integration when the platform requires it:

   ```bash
   graphify install --platform <codex|claude|...>
   ```

3. Build or validate the local cache:

   ```bash
   yarn graphify:ensure
   ```

   In a clean worktree without Yarn install state, use `node scripts/graphify-cache.mjs ensure` directly.

4. Run a scoped query:

   ```bash
   graphify query "how does research discovery reach its search services?"
   ```

## Local Cache Policy

Everything under `graphify-out/` is ignored and must remain untracked.
Keep `.graphify-version`, `.graphifyignore`, the cache scripts, and the Graphify skill committed.
Never manually merge, force-add, or commit generated Graphify JSON and reports.

`yarn graphify:ensure` refreshes when output is missing, the installed version differs, the cache was not checked against `HEAD`, or graph-relevant working-tree inputs changed.
Use `yarn graphify:status` to inspect the reasons without changing files.
Use `yarn graphify:refresh` to force regeneration after substantial architecture changes.

If Graphify is unavailable, continue with targeted source search and tests rather than relying on stale output.

## CI Policy

CI rejects tracked `graphify-out/` files.
It installs the exact pinned Graphify version and runs generation twice.
The check fails when the second generation changes the graph or report.
Successful output is uploaded as a temporary CI artifact instead of committed to Git.
