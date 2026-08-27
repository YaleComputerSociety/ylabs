# Agent Workflow

This document explains where agent guidance lives.
The canonical entry point is [`AGENTS.md`](../AGENTS.md).
Detailed task procedures live in focused skills under [`skills/`](../skills/).

## Read Order

For normal coding work:

1. Read [`AGENTS.md`](../AGENTS.md).
2. Read the smallest relevant skill from [`skills/`](../skills/).
3. Use targeted source search (`rg`, then reading the named files) to locate the relevant code before broad exploration.
4. Verify important claims against source files, tests, and durable docs.

For product, schema, or architecture decisions, also check the durable docs:

- [`docs/product-context.md`](product-context.md) for stable product context.
- [`docs/research-model.md`](research-model.md) for the current schema, collection shapes, and modeling rules.
- [`docs/research-model-refactor.md`](research-model-refactor.md) for the historical rationale behind the model, not current state.
- [`docs/decisions.md`](decisions.md) for dated product and architecture decisions.
- [`docs/ui-ux-direction.md`](ui-ux-direction.md) for UI direction.

## Skill Index

The canonical skill table lives in [`AGENTS.md`](../AGENTS.md#on-demand-skills).
Read it there and open the smallest relevant skill under [`skills/`](../skills/); this router intentionally does not duplicate the per-skill list.

## Durable Notes

- Keep this file as a router, not a checklist dump.
- Put reusable task procedure in a skill.
- Put stable product, schema, architecture, or launch decisions in the durable docs above.
- Put active task state in [`docs/tasks/priority-roadmap.md`](tasks/priority-roadmap.md).
- Do not create new durable task files under `docs/tasks/` unless the user explicitly asks.
