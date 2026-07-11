# Graphify Onboarding

Graphify is the shared repo-memory layer for any coding agent.
It helps future sessions navigate architecture, schema, scraper, and product-model context without rediscovering the repo from scratch.
For day-to-day agent usage, read [`skills/graphify/SKILL.md`](../skills/graphify/SKILL.md).

## Canonical Sources

- Source code, tests, `AGENTS.md`, skills, and `docs/*.md` remain canonical.
- Graphify output is a navigation layer. Verify important claims against source files before editing or summarizing.
- `.graphifyignore` controls what enters shared repo memory.

## Setup Tasks

1. Install the official package version declared in `.graphify-version`:
   - Preferred: `uv tool install "graphifyy==$(cat .graphify-version)"`
   - Alternative: `pipx install "graphifyy==$(cat .graphify-version)"`
2. Install the agent integration for your platform:
   - `graphify install --platform <codex|claude|...>`
3. Build the no-cost code graph:
   - `graphify update .`
4. Run a scoped query and review the broad report only when needed:
   - `graphify query "how does research discovery reach its search services?"`
   - `graphify-out/GRAPH_REPORT.md`
5. Optional: run full semantic extraction when an LLM key is configured:
   - `graphify extract .`
6. Enable always-on agent guidance after review (platform-specific):
   - `graphify <platform> install`

## Shared Output Policy

Commit only the canonical shared outputs:

- `graphify-out/GRAPH_REPORT.md`
- `graphify-out/graph.json`
- Do not commit any other `graphify-out/` content, including `graph.html`, dated snapshots, caches, manifests, labels, locks, or memory.

## Refresh Policy

Feature PRs do not refresh Graphify.
After a group of changes lands on Beta, use a dedicated scheduled or manually triggered maintenance change to run `graphify update .` with the pinned version.
Run the update twice and require the second run to produce no diff in `graphify-out/graph.json` or `graphify-out/GRAPH_REPORT.md`.
Parse `graph.json`, verify it has nonempty `nodes` and `links`, and verify the report is nonempty before committing.

The report records the source commit analyzed by Graphify.
That source commit normally precedes the maintenance commit that records the outputs, so freshness means it matches the intended Beta source snapshot, not that it equals the output commit's `HEAD`.
