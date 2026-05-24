# Codex Workflow

## Read Order

For product, schema, or architecture work, read these first:

1. `AGENTS.md`
2. `docs/product-context.md`
3. `docs/research-model.md`
4. `docs/decisions.md`
5. Relevant implementation files

Use `CLAUDE.md` as useful existing repo context, especially for architecture, commands, environment variables, and conventions. The docs in `docs/` are the current product direction when they conflict with older lab-first framing.

## Working Loop

For any non-trivial codebase task:

1. Read `graphify-out/GRAPH_REPORT.md` first when it exists.
2. Use `graphify query`, `graphify explain`, or `graphify path` to map relevant concepts before broad file search.
3. Verify important Graphify claims against source files, tests, and durable docs.
4. Prefer existing patterns, services, reducers, tests, and naming conventions.
5. Make the smallest change that satisfies the task and preserves current behavior.
6. Add or update focused tests when behavior, reducers, services, scrapers, or schema logic changes.
7. Run the most relevant verification command available.
8. Fold completed-task notes into durable docs, usually `docs/tasks/priority-roadmap.md`, and remove completed task-specific files under `docs/tasks/` unless the user explicitly wants a separate durable record.
9. Run `graphify update .` after code, schema, scraper, architecture, or durable-doc changes so Graphify remembers the completed work.
10. Update documentation only when the task changes durable product, schema, architecture, setup, or design decisions.

Default to acting after inspection. Ask questions only when the answer cannot be inferred from the repo and a wrong assumption would create meaningful rework or risk.

## Parallel Work

Use parallel subagents when work can be split into independent streams without sacrificing coherence. Good candidates include separate frontend/backend impact checks, docs updates alongside verification, or implementation tasks with disjoint file ownership.

Avoid subagents for tiny tasks, tightly coupled edits, or product decisions that need one consistent judgment. After subagents finish, the main Codex thread must review their outputs, inspect changed files, resolve conflicts, and run or recommend verification.

## Done Criteria

- Run the narrowest relevant verification command before finishing.
- Prefer focused tests, typechecks, lint, or build steps over broad commands unless the change affects shared behavior or release readiness.
- Keep tests behavior-focused and fixture-light. Avoid adding many near-duplicate regression tests, asserting full internal payloads when a few public fields prove the behavior, or using real person/lab names and production-like scraped URLs where generic fixtures would exercise the same rule.
- Do not expose internal, scraped, production-derived, or person-identifying data in tests. Use clearly synthetic fixture names, emails, URLs, profile prose, and lab labels unless an exact domain or path shape is the behavior under test.
- If verification is skipped, explain why.
- Review the final diff for bugs, regressions, risky patterns, unrelated changes, and documentation impact.
- Use `docs/tasks/priority-roadmap.md` as the single task source of truth.
- Do not create new durable task files under `docs/tasks/` unless the user explicitly asks for a separate file.
- Temporary execution trackers should be deleted or folded back into the roadmap before finishing.
- When a task completes, update the roadmap in the same change by checking off, removing, or rewriting the relevant entry.
- After folding useful details into the roadmap or another durable doc, remove completed task-specific docs from `docs/tasks/` so the folder does not accumulate stale task files.
- Refresh Graphify before final handoff whenever code or durable docs changed, so repo memory reflects the finished state.
- Keep final summaries short and include tests or checks run.

## Browser Automation

Use Playwright in two layers:

- Playwright MCP is for exploratory browser work: opening the local app, inspecting accessible UI state, checking responsiveness, and discovering flows or locators while iterating with Codex.
- Repo Playwright scripts and tests are the durable verification layer. Any MCP finding that should be repeated later must be codified in a script, component test, or end-to-end test with deterministic assertions and artifacts.

Codex is configured with a global `playwright` MCP server:

```bash
codex mcp add playwright -- /home/quntaoz/ylabs/scripts/with-playwright-libs.sh npx -y @playwright/mcp@latest --output-dir /home/quntaoz/ylabs/tmp/playwright-mcp
```

The MCP server intentionally launches through `scripts/with-playwright-libs.sh`, matching `yarn playwright:run` and `yarn audit:unified-research`, so browser sessions use the repo's no-root shared-library workaround.
Configure Playwright MCP with `--output-dir /home/quntaoz/ylabs/tmp/playwright-mcp` so generated snapshots, console logs, and session artifacts stay in the repo-local scratch directory instead of the repository root.
All temporary browser-audit screenshots, one-off reports, generated helper scripts, and JSON captures should also be written under `tmp/`, preferably a named subdirectory such as `tmp/ux-audit-2026-05-22/`. Only fold stable findings into durable docs such as `docs/ui-ux-direction.md`, `docs/product-context.md`, or `docs/tasks/priority-roadmap.md`.

Do not run `pkill`, `kill`, or broad cleanup commands against `playwright-mcp` from the same Codex session that is using Playwright MCP. That kills the stdio MCP server attached to the active session, and subsequent `browser_*` calls will fail with `Transport closed` until Codex is restarted or a new session is opened. If MCP is already closed, restart Codex or continue browser checks through `yarn playwright:run` / a direct Playwright script in a fresh process.

When doing UI/UX work, a good loop is:

1. Explore with Playwright MCP or `yarn playwright:run`.
2. Record stable issues in `docs/ui-ux-direction.md`, `docs/product-context.md`, `docs/tasks/priority-roadmap.md`, or another relevant durable product/design doc.
3. Turn regressions and important flows into Playwright scripts or focused tests.
4. Re-run the script/test before claiming the issue is fixed.

## MongoDB MCP

Codex may be configured with a global `mongodb-ylabs` MCP server for MongoDB exploration. Treat it as a read-only diagnostic lens for inspecting collections, sampling records, and understanding data shape.

Do not use MongoDB MCP as the durable write path for this project. Any operation that creates, updates, deletes, backfills, materializes, migrates, or repairs data should still be implemented through repo scripts or services so the logic is reviewable, repeatable, and aligned with Mongoose models, scraper evidence rules, and product invariants.

Local Codex setup uses the official MongoDB MCP package in read-only mode:

```bash
codex mcp add mongodb-ylabs -- /home/quntaoz/.codex/bin/mongodb-ylabs-mcp.cjs
```

## Rule Evolution

When Codex makes the same mistake twice, or the user gives feedback that should apply beyond the current task, update `AGENTS.md` or this file with a concise durable rule. Keep rules practical and compact; prefer links to focused docs over long checklists.

## Graphify Workflow

Use Graphify as shared repo memory when `graphify-out/` exists. Read `graphify-out/GRAPH_REPORT.md` before broad architecture or codebase answers, and use `graphify-out/wiki/index.md` for navigation when present.

Graphify is not canonical. Confirm important claims against source files, tests, and durable docs before changing code or summarizing behavior.

Onboarding steps:

1. Install the official package: `uv tool install graphifyy` or `pipx install graphifyy`.
2. Install Codex integration: `graphify install --platform codex`.
3. Build the no-cost code graph: `graphify update .`.
4. Optional: run full semantic extraction with an LLM key configured: `graphify extract .`.
5. Install always-on Codex guidance after reviewing output: `graphify codex install`.
6. Commit useful shared outputs from `graphify-out/`, but keep local cost, manifest, root, analysis, labels, lock, cache, and memory files ignored.

Refresh with `graphify update .` after changes to durable schema, scraper behavior, architecture, or product docs. Keep `.graphifyignore` strict so secrets, generated files, dependencies, build outputs, and noisy raw data stay out of the graph.

## Documentation Rules

- Keep docs concise and durable.
- Do not paste chat transcripts.
- Do not invent decisions that were not made.
- Add dates for major product or architecture decisions.
- Link implementation files when relevant.
- Preserve existing structure when updating docs.

Use:

- `docs/product-context.md` for stable product context.
- `docs/research-model.md` for schema and modeling decisions.
- `docs/scraper-audit-guide.md` for scraper audit order, collection writes, and production-readiness checks.
- `docs/scraper-deployment-runbook.md` for development, Beta, production, cron, cost-control, and rollback flow.
- `docs/ui-ux-direction.md` for durable UI/UX direction grounded in Graphify and verified against source files.
- `docs/decisions.md` for dated architecture/product decisions.
- `docs/codex-workflow.md` for Codex operating guidance.

## Implementation Reminders

- Server changes usually follow `routes -> middleware -> controllers -> services -> models`.
- Client route pages live in `client/src/pages/` and are wired through `client/src/App.tsx`.
- Reducers should keep state transitions pure; side effects belong in providers/components.
- Schema changes may require Mongoose model updates, client type updates, migrations, and Meilisearch index updates.
- Scraper-derived claims should remain evidence-first: store raw observations/source evidence, then materialize derived access signals/pathways.
- Contact and outreach features need guardrails. Prefer official application/contact routes and avoid encouraging mass outreach.

## Useful Commands

- `git status --short`
- `yarn install:all`
- `yarn dev:server`
- `yarn dev:client`
- `yarn --cwd server test`
- `yarn --cwd client test:ci`
- `npx tsc --noEmit -p server/tsconfig.json`
- `yarn build`
- `yarn scrape help`
