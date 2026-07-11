---
name: graphify
description: Use when navigating or answering cross-module/architecture questions in this repo, before broad file search or grep, or maintaining the shared Graphify snapshot. Covers scoped graph queries and the maintenance-only refresh policy.
---

# Graphify repo memory

Graphify is the shared knowledge graph and navigation layer for this repo. Output lives in `graphify-out/`. It is a navigation layer only - verify important claims against source files, tests, and `docs/*.md` before editing or summarizing.

## Navigation order (before broad exploration)

1. Start with the narrowest useful `graphify query`, `graphify path`, or `graphify explain` command.
2. Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review.
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

## Maintenance policy

Do not refresh or commit Graphify outputs in feature PRs.
Refresh the shared snapshot in a dedicated scheduled or manually triggered maintenance change after a group of Beta merges.
Use the version declared in `.graphify-version`, run `graphify update .` twice, and verify the second run leaves both canonical outputs unchanged.
The report's source commit identifies the code snapshot that was analyzed.
It is expected to differ from the later commit that records the generated outputs, so compare it with the intended Beta source commit rather than requiring equality with the maintenance commit's `HEAD`.

## Committed vs ignored outputs

- **Committed**: only `graphify-out/GRAPH_REPORT.md` and `graphify-out/graph.json`.
- **Not committed**: every other `graphify-out/` file, including dated snapshots, `graph.html`, caches, manifests, labels, locks, and memory.

`.graphifyignore` controls what enters the graph - keep it strict (no secrets, `node_modules`, build outputs, or raw scraped data).

## Installation

Install the exact version in `.graphify-version` with `uv tool install "graphifyy==$(cat .graphify-version)"` (preferred) or `pipx install "graphifyy==$(cat .graphify-version)"`, then run `graphify install --platform <codex|claude|...>`.
