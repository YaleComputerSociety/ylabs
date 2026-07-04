# Agent Workflow

This document explains where agent guidance lives.
The canonical entry point is [`AGENTS.md`](../AGENTS.md).
Detailed task procedures live in focused skills under [`skills/`](../skills/).

## Read Order

For normal coding work:

1. Read [`AGENTS.md`](../AGENTS.md).
2. Read `graphify-out/GRAPH_REPORT.md` when it exists.
3. Read the smallest relevant skill from [`skills/`](../skills/).
4. Verify important claims against source files, tests, and durable docs.

For product, schema, or architecture decisions, also check the durable docs:

- [`docs/product-context.md`](product-context.md) for stable product context.
- [`docs/research-model.md`](research-model.md) for schema and modeling decisions.
- [`docs/decisions.md`](decisions.md) for dated product and architecture decisions.
- [`docs/ui-ux-direction.md`](ui-ux-direction.md) for UI direction.

## Skill Index

| Skill | Use |
|-------|-----|
| [`graphify`](../skills/graphify/SKILL.md) | Repo navigation, graph queries, and refresh policy. |
| [`product-model`](../skills/product-model/SKILL.md) | Research discovery behavior, product vocabulary, Ways In, visibility, and entity pages. |
| [`architecture`](../skills/architecture/SKILL.md) | Repo map, commands, stack, routes, services, environments, and integrations. |
| [`search-data`](../skills/search-data/SKILL.md) | MongoDB, Meilisearch, browse ranking, migrations, and search rebuilds. |
| [`auth-security`](../skills/auth-security/SKILL.md) | CAS auth, sessions, middleware, rate limits, CORS, CSRF, SSRF, and sensitive env vars. |
| [`scrapers`](../skills/scrapers/SKILL.md) | Scraper sources, observations, materializers, confidence resolution, CLI, and write guards. |
| [`contributing`](../skills/contributing/SKILL.md) | Endpoints, client pages or routes, and Mongoose schema changes. |
| [`finishing-work`](../skills/finishing-work/SKILL.md) | Verification, diff review, docs maintenance, roadmap cleanup, and Graphify refresh. |

## Durable Notes

- Keep this file as a router, not a checklist dump.
- Put reusable task procedure in a skill.
- Put stable product, schema, architecture, or launch decisions in the durable docs above.
- Put active task state in [`docs/tasks/priority-roadmap.md`](tasks/priority-roadmap.md).
- Do not create new durable task files under `docs/tasks/` unless the user explicitly asks.
