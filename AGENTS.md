# Codex Guide

This file is the operating brief for Codex in this repository. Use `CLAUDE.md` as useful historical repo context, but treat the new product docs in `docs/` as the durable product direction when they conflict.

## Default Task Loop

For any non-trivial codebase task:

1. Read `graphify-out/GRAPH_REPORT.md` first when it exists.
2. Use `graphify query`, `graphify explain`, or `graphify path` to map relevant concepts before broad file search.
3. Verify important Graphify claims against source files, tests, and durable docs.
4. Make the smallest safe change using existing repo patterns.
5. Run focused verification.
6. Fold completed-task notes into durable docs, usually `docs/tasks/priority-roadmap.md`, and remove completed task-specific files under `docs/tasks/` unless the user explicitly wants a separate durable record.
7. Run `graphify update .` after code, schema, scraper, architecture, or durable-doc changes so Graphify remembers the completed work.
8. Update docs when the task changes durable product, schema, architecture, setup, or design decisions.

Graphify is the navigation layer. Source files, tests, `AGENTS.md`, and `docs/*.md` remain canonical.

## Product North Star

We are building Yale Research, a discovery app that makes the hidden undergraduate research ecosystem legible: where formal openings exist, where credible pathways exist, and how students can move from curiosity to a specific, evidence-based next step.

Do not model the product as a simple "find lab openings" job board. Yale research includes labs, centers, institutes, faculty projects, digital humanities initiatives, collections/archive projects, RA programs, fellowships, senior theses, and exploratory outreach. Research for credit is a formalization option after a student finds a research home, not an entry pathway by itself. Fellowships usually behave the same way as funding/formalization mechanisms, except when the fellowship is itself a structured discovery or mentor-matching program.

## Current Stack

- Monorepo with React/Vite client in `client/` and Express/TypeScript server in `server/`.
- MongoDB Atlas is the primary database. Mongoose models live in `server/src/models/`.
- Meilisearch powers keyword + semantic search through `server/src/utils/meiliClient.ts`.
- Yale CAS authentication is handled through Passport in `server/src/passport.ts`.
- Server architecture is `Routes -> Middleware -> Controllers -> Services -> Models`.

## Core Modeling Direction

Prefer this product model for new research-discovery work:

- `ResearchEntity`: what exists, such as a lab, center, institute, faculty project, RA program, structured fellowship program, or course sequence.
- `EntryPathway`: how a student might find or enter a plausible research home, such as posted role, recurring program, work-study or paid RA route, volunteer outreach, exploratory contact, internship, or faculty/lab-manager/program contact. Do not treat course credit itself as an entry pathway.
- `PostedOpportunity`: a specific active or time-bound instance, such as a Spring 2026 RA role, open summer fellowship, lab-posted undergraduate job, or DHLab internship. Earlier docs or code may call this `ResearchOpportunity`; prefer `PostedOpportunity` for new product language.
- `AccessSignal`: evidence-backed signal about undergraduate access, such as posted opening, recurring program, past/current undergrads, faculty supervision, fellowship compatibility, application-only, or not currently available.
- `ContactRoute`: the best known way to act, such as official application, lab manager, program manager, faculty PI, department contact, fellowship office, or course instructor.

Important distinction: not every `EntryPathway` is an active `PostedOpportunity`.
Important correction: course credit, paid RA work, fellowship funding, thesis advising, and similar arrangements are formalization or outcome options after a plausible research home is identified, unless there is a real hosted program, mentor-matching program, or posted application instance.

Do not embed pathways, signals, posted opportunities, and contact routes directly inside `ResearchEntity` long term. Students need to filter across these concepts by plausible home, evidence, funding/pay possibility, credit formalization, summer, beginner-friendly signal, thesis fit, methods, deadlines, and contact route. Prefer first-class collections while treating any remaining `ResearchGroup` naming as migration residue.

Avoid binary fields like `acceptingUndergrads`. Scrapers should produce source evidence and access signals, not overconfident claims.

The current implementation is pivoting to canonical `ResearchEntity` runtime surfaces. Treat remaining `ResearchGroup`, `lab`, and `researchGroupId` naming as migration residue unless a file is explicitly part of rollback/migration support.

## Product Surfaces

- Explore Research: curiosity-first browsing of labs, centers, faculty projects, institutes, archives, collections projects, and thesis-adviser-like research areas.
- Pathways: practical filtering by plausible homes, evidence, next-step route, methods, timing, compensation/funding possibility, thesis fit, beginner-friendly signals, hours/week when known, Python, archival research, wet lab, social science data, and similar constraints.

Student-facing vocabulary should be warmer than internal model names: use "Pathways", "Evidence", and "Best Next Step" in product surfaces where appropriate.

Iterate on canonical product surfaces instead of creating student-facing versioned routes. Use existing routes such as `/research` and `/pathways`, or a non-URL feature flag when rollout safety is needed; do not add `/v1`, `/v2`, `/research-v2`, or similar route names for normal design iteration.

Entity pages should answer what the research structure is, what it studies, who leads it, who might supervise undergrads day to day, what methods it uses, whether undergrads have participated before, what plausible access evidence exists, what the student should do next, how the relationship might later be formalized, and what source verifies the information.

## Implementation Rules

- Default to making the requested change after inspecting the code. Ask questions only when the answer cannot be inferred from the repo and a wrong assumption would create meaningful rework or risk.
- Follow existing local patterns before adding abstractions.
- For new endpoints, add route, controller, service, model changes, auth middleware, validation middleware, and tests where risk justifies them.
- For new pages, add the page under `client/src/pages/`, wire the route in `client/src/App.tsx`, and reuse existing providers/components where appropriate.
- For schema changes, update Mongoose models, client TypeScript types, migration scripts if existing data changes, and Meilisearch configuration if fields need search/filter/sort support.
- Keep scraper writes evidence-first: preserve raw observations/source records, then materialize derived fields through resolver/materializer logic.
- Do not expose scraped contact data indiscriminately. Prefer official routes and model contact policy/visibility when adding contact surfaces.

## Parallel Work

When a task is large enough to split safely, use parallel subagents to speed up discovery, implementation, or verification. Prefer subagents for independent workstreams with clear ownership, such as one agent inspecting backend impact while another inspects frontend impact, one agent updating docs while another verifies tests, or separate implementation agents working on disjoint files or modules.

When working on ideas, prototypes, or exploratory implementation with multiple agents, apply the Superpowers worktree workflow before starting agent work so agents do not collide in the same checkout. Agents may intentionally collaborate on the same branch when the work is related, but each agent should still operate from an isolated worktree unless a shared workspace is explicitly required.

To use the worktree workflow correctly:

- First detect whether the current checkout is already a linked worktree. Do not create nested worktrees.
- Prefer any native worktree tool provided by the harness; use `git worktree` only as the fallback.
- Use one worktree per implementation agent. Same-branch collaboration is allowed for related work, but separate checkouts are still the default collision-avoidance mechanism.
- Before creating a project-local worktree, verify `.worktrees/` or `worktrees/` is ignored.
- Run setup and a narrow baseline verification in the new worktree before editing when the task is substantial enough that pre-existing failures would matter.
- Have the main Codex thread integrate agent outputs, inspect diffs from each worktree, resolve conflicts, and run final verification before reporting completion.

Do not use subagents for tightly coupled changes, tiny tasks, or decisions that require one coherent product judgment. After subagents finish, the main Codex thread must review their outputs, inspect changed files, resolve conflicts, and run or recommend verification. Do not forward subagent conclusions without integration.

## GStack Skill Routing

Use installed gstack skills proactively when their trigger matches the task, especially for work where live evidence, structured review, or end-to-end workflow discipline beats ad hoc commands.

- Use `browse` for browser evidence, screenshots, responsive checks, dogfooding, and verifying user flows.
- Use `qa` when asked to test and fix a site or when a feature is ready for systematic QA; use `qa-only` when the user wants a report without edits.
- Use `design-review` for UI/UX polish passes, visual consistency, spacing, hierarchy, and interaction issues.
- Use `review` before landing non-trivial diffs or when the user asks for code review.
- Use `ship` for commit/push/PR/deploy requests instead of manually pushing or opening PRs; use `land-and-deploy` after a PR is ready to merge and verify production.
- Use `canary` for post-deploy production monitoring and `benchmark` for performance regression checks.
- Use planning review skills such as `autoplan`, `plan-ceo-review`, `plan-eng-review`, `plan-design-review`, or `plan-devex-review` when a plan is large, ambiguous, product-sensitive, architecture-sensitive, design-sensitive, or developer-experience-sensitive.

GStack does not replace Graphify, source inspection, or focused repo tests. Treat gstack outputs as evidence to integrate into the normal task loop: verify important claims against source, keep artifacts under ignored local paths such as `tmp/` or `.gstack/`, update durable docs only with stable conclusions, and refresh Graphify when code or durable docs change.

## Done Criteria

Before finishing, run the narrowest relevant verification command. Prefer focused tests, typechecks, lint, or build steps over broad commands unless the change affects shared behavior or release readiness. If verification is skipped, explain why.

Review the final diff for bugs, regressions, risky patterns, unrelated changes, and documentation impact. Keep final summaries short and include tests or checks run.

Use `docs/tasks/priority-roadmap.md` as the single task source of truth. Do not create new durable task files under `docs/tasks/` unless the user explicitly asks for a separate file; consolidate outstanding tasks and completion notes back into the roadmap before finishing. Temporary execution trackers should be deleted or folded back into the roadmap during cleanup.

When a task completes, leave repo memory tidy: update the roadmap or relevant durable doc with the stable outcome, remove completed task-specific docs from `docs/tasks/` after their useful details are folded in, then refresh Graphify with `graphify update .` so the graph records the finished state.

## Rule Evolution

Treat Codex rules as living workflow documentation. When Codex makes the same mistake twice, or the user gives feedback that should apply beyond the current task, update `AGENTS.md` or `docs/codex-workflow.md` with a concise durable rule.

Keep rules practical and compact. Prefer links to focused docs over expanding `AGENTS.md` with long checklists.

## Graphify Repo Memory

Use Graphify as the persistent repo knowledge base when `graphify-out/` exists, especially for architecture, schema, scraper, product-model, and cross-surface tasks.

Before answering broad codebase or architecture questions, read `graphify-out/GRAPH_REPORT.md`. If `graphify-out/wiki/index.md` exists, use it for navigation before broad raw-file exploration.

Treat Graphify as a navigation and memory layer, not the source of truth. Verify important claims against source files, tests, and durable docs before editing or summarizing.

After changes to durable schema, scraper behavior, architecture, or product docs, refresh Graphify or note that it needs refresh. Keep `.graphifyignore` strict so secrets, generated files, dependencies, build outputs, and noisy raw data do not enter the graph.

## Commands

- Install all deps: `yarn install:all`
- Client dev server: `yarn dev:client`
- Server dev server: `yarn dev:server`
- Build: `yarn build`
- Client tests: `yarn --cwd client test:ci`
- Server tests: `yarn --cwd server test`
- Server typecheck: `npx tsc --noEmit -p server/tsconfig.json`
- Scraper CLI: `yarn scrape help`

The client has had pre-existing typecheck issues; do not assume `tsc --noEmit` for the client is clean unless a task specifically addresses that cleanup.

## Sensitive Areas

- Never commit `server/.env` or `client/.env`.
- Be careful around `server/src/passport.ts`, `server/src/db/connections.ts`, and `server/src/app.ts`; these affect auth, DB routing, sessions, CORS, and rate limits.
- Production scraper writes require explicit guardrails. Respect `SCRAPER_ENV`, `CONFIRM_PROD_SCRAPE`, and related safety checks.

## Documentation Maintenance

At the end of every Codex task, update repo documentation if the task changes durable product, schema, architecture, setup, or design decisions.

Use:

- `docs/product-context.md` for stable product context.
- `docs/research-model.md` for schema and modeling decisions.
- `docs/decisions.md` for dated architecture/product decisions.
- `docs/codex-workflow.md` for how Codex should work in this repo.

Keep entries concise, preserve existing structure, add dates for major decisions, link implementation files when relevant, and do not invent decisions that were not made. Do not append noisy transcripts; summarize only stable decisions.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- ALWAYS read graphify-out/GRAPH_REPORT.md before reading any source files, running grep/glob searches, or answering codebase questions. The graph is your primary map of the codebase.
- IF graphify-out/wiki/index.md EXISTS, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
