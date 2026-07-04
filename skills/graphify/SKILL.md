---
name: graphify
description: Use when navigating or answering cross-module/architecture questions in this repo, before broad file search or grep, and after durable code/schema/scraper/doc changes. Covers the Graphify knowledge-graph read order, query commands, and refresh policy.
---

# Graphify repo memory

Graphify is the shared knowledge graph and navigation layer for this repo. Output lives in `graphify-out/`. It is a navigation layer only - verify important claims against source files, tests, and `docs/*.md` before editing or summarizing.

## Read order (before broad exploration)

1. Read `graphify-out/GRAPH_REPORT.md` first when it exists - it maps the repo and is faster than grep for cross-module questions.
2. If `graphify-out/wiki/index.md` exists, navigate it before reading raw files.
3. Verify important Graphify claims against source files, tests, and durable docs.

## Query commands

| Command | Effect |
|---------|--------|
| `graphify query "<question>"` | Ask cross-module architecture questions |
| `graphify explain "<concept>"` | Get definition and related nodes for a concept |
| `graphify path "<A>" "<B>"` | Trace the relationship between two nodes |
| `graphify update .` | Rebuild graph from AST after code changes (no API cost) |
| `graphify extract .` | Optional: full semantic extraction (requires LLM key) |

For cross-module "how does X relate to Y" questions, prefer `graphify query` / `graphify path` / `graphify explain` over grep - they traverse the graph's extracted + inferred edges instead of scanning files.

## Refresh policy

Run `graphify update .` after durable changes to schema/models, scraper behavior, architecture, or product docs. If Graphify cannot be refreshed, note that in the final response.

## Committed vs ignored outputs

- **Committed** (in `graphify-out/`): `GRAPH_REPORT.md`, `graph.json`, and `graph.html` only when Graphify generates it. Large graphs may skip HTML and rely on `graph.json` + `GRAPH_REPORT.md`.
- **Not committed**: `cache/`, `cost.json`, `manifest.json`, `.graphify_root`, `.graphify_analysis.json`, `.graphify_labels.json`, `.rebuild.lock`, `memory/`.

`.graphifyignore` controls what enters the graph - keep it strict (no secrets, `node_modules`, build outputs, or raw scraped data).

## Installation

`uv tool install graphifyy` (preferred) or `pipx install graphifyy`, then `graphify install --platform <codex|claude|...>`.
