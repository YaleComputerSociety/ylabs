# Graphify Onboarding

Graphify is the shared repo-memory layer for Codex. It helps future sessions navigate architecture, schema, scraper, and product-model context without rediscovering the repo from scratch.

## Canonical Sources

- Source code, tests, `AGENTS.md`, and `docs/*.md` remain canonical.
- Graphify output is a navigation layer. Verify important claims against source files before editing or summarizing.
- `.graphifyignore` controls what enters shared repo memory.

## Setup Tasks

1. Install the official package:
   - Preferred: `uv tool install graphifyy`
   - Alternative: `pipx install graphifyy`
2. Install Codex integration:
   - `graphify install --platform codex`
3. Build the no-cost code graph:
   - `graphify update .`
4. Review:
   - `graphify-out/GRAPH_REPORT.md`
   - `graphify-out/graph.json`
5. Optional: run full semantic extraction when an LLM key is configured:
   - `graphify extract .`
6. Enable always-on Codex guidance after review:
   - `graphify codex install`

## Shared Output Policy

Commit useful shared outputs:

- `graphify-out/GRAPH_REPORT.md`
- `graphify-out/graph.json`
- `graphify-out/graph.html` only when Graphify generates it; large graphs may skip HTML output and rely on `graph.json` plus `GRAPH_REPORT.md`

Do not commit local-only state:

- `graphify-out/cache/`
- `graphify-out/cost.json`
- `graphify-out/manifest.json`
- `graphify-out/.graphify_root`
- `graphify-out/.graphify_analysis.json`
- `graphify-out/.graphify_labels.json`
- `graphify-out/.rebuild.lock`
- `graphify-out/memory/`

## Refresh Policy

Run `graphify update .` after durable changes to:

- schema or model collections
- scraper behavior or source-evidence handling
- architecture or cross-surface flows
- durable product docs or decisions

If Graphify cannot be refreshed during a task, note that in the final response.
