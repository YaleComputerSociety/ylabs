# Yale Research - Agent Guide

This is the canonical agent-facing entry point for Yale Research.
Keep it short.
Move detailed procedures into `skills/<name>/SKILL.md` so agents load the right context only when needed.
Treat `docs/` as durable product direction when it conflicts with older lab-first framing.

## On-Demand Skills

Read the relevant skill before doing that kind of work.
Claude Code can auto-discover them if `.claude/skills` is symlinked to `skills/`; other agents should read them directly.

| Skill | Read it when |
|-------|-------------|
| `skills/graphify/SKILL.md` | Navigating cross-module architecture, refreshing the local graph cache, or resolving stale/invalid Graphify output. |
| `skills/product-model/SKILL.md` | Changing student-facing research discovery behavior, product vocabulary, visibility, access evidence, or entity-page content. |
| `skills/architecture/SKILL.md` | Needing the repo map, stack, commands, routes, services, naming conventions, environments, or external integrations. |
| `skills/search-data/SKILL.md` | Working on MongoDB data shape, Meilisearch indexes, browse ranking, ResearchEntity search, or search rebuild scripts. |
| `skills/auth-security/SKILL.md` | Touching auth, sessions, CAS login, middleware, rate limits, CORS, CSRF, SSRF, env vars, or sensitive files. |
| `skills/scrapers/SKILL.md` | Working in `server/src/scrapers/`, source scrapers, observations, materializers, confidence resolution, scrape CLI, or scraper write guards. |
| `skills/contributing/SKILL.md` | Adding an API endpoint, a client page or route, or modifying a Mongoose schema. |
| `skills/finishing-work/SKILL.md` | Wrapping up: verification, diff review, docs maintenance, and roadmap cleanup. |

## Default Task Loop

For any non-trivial codebase task:

1. Run `yarn graphify:ensure`, then use a scoped `graphify query`, `graphify path`, or `graphify explain` before broad search.
If refresh is unavailable, state the fallback and use targeted source search.
2. Read the smallest relevant skill or skills from the table above.
3. Verify important Graphify or skill claims against source files, tests, and durable docs.
4. Make the smallest safe change using existing repo patterns.
5. Run focused verification and review the diff.
6. Fold durable changes back into docs and refresh the ignored local Graphify cache when the architectural shape changed.
7. When an action becomes a recurring workflow, improve the relevant skill with the reusable procedure and verify that its guidance still matches the repository.

Source files, tests, `AGENTS.md`, and `docs/*.md` are canonical.
Graphify is a navigation layer, not the source of truth.
Never stage or commit generated files under `graphify-out/`.

## Core Rules

- Never use em dashes.
Use plain hyphens instead.
- When writing commit messages, never auto-add the agent name as a co-author.
- Never manually modify `CHANGELOG.md` files or files marked as auto-generated.
- When writing or substantially editing long Markdown files, put each full sentence on its own physical line.
Preserve normal Markdown structure, but avoid wrapping multiple sentences onto one physical line.
- When making technical decisions, do not give much weight to development cost.
Prefer quality, simplicity, robustness, scalability, and long-term maintainability.
- When doing bug fixes, start by reproducing the bug in an end-to-end setting as close to end-user behavior as feasible.
- When end-to-end testing product UI, be picky about polish.
If something clearly looks off, try to fix it too.
- Treat lint, test failures, and flakiness seriously.
If you see a failure, even if it is not caused by the current work, try to get it fixed.
- Never expose internal personal data in tests, fixtures, snapshots, logs, screenshots, or committed artifacts.
Use synthetic or redacted values, and write ephemeral test files under `/tmp` when a filesystem artifact is needed.
- Track substantive repository work in GitHub issues and link the issue from the implementation pull request.
GitHub issues are repository-wide; open pull requests against the `beta` base branch unless explicitly directed otherwise.

## Commit, Issue, and Merge Protocol

This is the canonical protocol for landing work.
Every thread that opens a PR or merges is responsible for following it directly, without waiting for an orchestrator to restate it.

### What needs an issue

- Substantive work needs a GitHub issue: a feature, a bug fix, a schema or API change, a data operation, a refactor, or anything a reviewer would want to track.
Open the issue first, then link it from the PR with a closing keyword (`Closes #<n>`).
- Trivial work does not need an issue: a typo, a comment, a tiny formatting or doc tweak, or a one-line follow-up to an already-tracked change.
- When unsure, prefer opening an issue.

### Commit and PR title format

- Use Conventional Commits for every commit subject and PR title: `type(scope): summary`.
- Allowed types: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `chore`.
- Write the summary in the imperative mood, lower case, no trailing period, under about 70 characters.
- Never use em dashes and never auto-add the agent name as a co-author.

### Opening the PR

- Base the PR on the `beta` branch unless explicitly directed otherwise.
- Give the PR a Conventional-Commit title and link its issue with `Closes #<n>` in the body.

### Merging

- Merge only when CI checks are all green and the PR is mergeable on its current head.
- Squash-merge with a clean Conventional-Commit message derived from the PR title: `gh pr merge <n> --squash --admin --delete-branch`.
- The `Closes #<n>` link auto-closes the linked issue on merge; confirm it closed.
- After merging, remove the worktree with `git worktree remove <path>` and prune stale entries with `git worktree prune`.

## Implementation Rules

- Default to making the requested change after inspecting the code.
Ask questions only when the answer cannot be inferred and a wrong assumption would create meaningful rework or risk.
- When the user reports a problem, fix the upstream cause when feasible, not just the local symptom.
- Follow existing local patterns before adding abstractions.
- Prefer first-class product-model collections over embedded shortcuts.
See `skills/product-model/SKILL.md` for the canonical concepts.
- Treat remaining `ResearchGroup`, `lab`, and `researchGroupId` naming as migration residue unless the file is explicitly rollback or migration support.
- Keep scraper writes evidence-first and fail closed on contact data.
See `skills/scrapers/SKILL.md`.

## Parallel Work

Use parallel subagents only when a task is large enough to split safely into independent workstreams.
Do not use subagents for tightly coupled changes, tiny tasks, or decisions that need one coherent product judgment.

When using git worktrees, subagents work in isolated worktrees.
The main thread reviews, tests, and integrates accepted work back into the active branch before calling the task done.
If integration is unsafe, stop and report the blocker instead of leaving finished work stranded.

### Worktree workflow

Each parallel workstream gets its own git worktree and branch so agents can run and test independently at the same time.

- The primary checkout (`~/Personal/ylabs`) is the integration and review spot only.
Never `git switch`, commit, or edit feature work directly in it.
Multiple agents sharing one checkout will switch branches under each other and serve the wrong code.
- Create one worktree plus branch per workstream, based on `beta`:
`scripts/new-agent-worktree.sh <branch-name>`.
The helper creates the worktree, runs `yarn install:all` so dependencies are fully isolated, and reserves a free client dev-server port.
- Do not symlink `node_modules` between worktrees when running dev servers concurrently.
They share Vite's `node_modules/.vite` cache and clobber each other.
A real per-worktree install is the isolation boundary.
- Run each worktree's client dev server on its own port (`yarn dev --port <port>`) so they coexist, and test each at its own `localhost:<port>`.
- Integrate an approved branch by merging or landing its pull request, then remove the worktree with `git worktree remove <path>` and prune stale entries with `git worktree prune`.
