# y/labs - Agent Guide

This is the canonical agent-facing entry point for y/labs.
Keep it short.
Move detailed procedures into `skills/<name>/SKILL.md` so agents load the right context only when needed.
Treat `docs/` as durable product direction when it conflicts with older lab-first framing.

## On-Demand Skills

Read the relevant skill before doing that kind of work.
Claude Code can auto-discover them if `.claude/skills` is symlinked to `skills/`; other agents should read them directly.

| Skill | Read it when |
|-------|-------------|
| `skills/product-model/SKILL.md` | Changing student-facing research discovery behavior, product vocabulary, visibility, access evidence, or entity-page content. |
| `skills/architecture/SKILL.md` | Needing the repo map, stack, commands, routes, services, naming conventions, environments, or external integrations. |
| `skills/search-data/SKILL.md` | Working on MongoDB data shape, Meilisearch indexes, browse ranking, ResearchEntity search, or search rebuild scripts. |
| `skills/auth-security/SKILL.md` | Touching auth, sessions, CAS login, middleware, rate limits, CORS, CSRF, SSRF, env vars, or sensitive files. |
| `skills/scrapers/SKILL.md` | Working in `server/src/scrapers/`, source scrapers, observations, materializers, confidence resolution, scrape CLI, or scraper write guards. |
| `skills/contributing/SKILL.md` | Adding an API endpoint, a client page or route, or modifying a Mongoose schema. |
| `skills/frontend-polish/SKILL.md` | Building or changing client UI: applying the polish, accessibility, and design-token bar. Pairs with `client/DESIGN.md`. |
| `skills/finishing-work/SKILL.md` | Wrapping up: verification, diff review, docs maintenance, and roadmap cleanup. |
| `docs/release-process.md` | Promoting `beta` to `main`, holding a release, feature flags, hotfix ordering, and the data-migration sequence a promotion requires. Read before any promotion or production data operation. |
| `docs/glossary.md` | Needing the definition of a term (observation, lane, materializer, refusal, the gate, `student_ready`, served) or checking whether wording is deprecated. Retiring a term is not done until its entry here is updated. |

Human-facing entry points, which agents maintain but do not need to read for context: `docs/onboarding.md` (first-week path and the maintainer checklist) and `CONTRIBUTING.md` (the landing protocol, which defers to this file).
`skills/finishing-work/SKILL.md` records what triggers an update to each.

## Default Task Loop

For any non-trivial codebase task:

1. Read the smallest relevant skill or skills from the table above.
2. Use targeted source search (`rg`, then reading the named files) to locate the relevant code before making changes.
3. Verify important skill claims against source files, tests, and durable docs.
4. Make the smallest safe change using existing repo patterns.
5. Run focused verification and review the diff.
6. Fold durable changes back into docs.
7. When an action becomes a recurring workflow, improve the relevant skill with the reusable procedure and verify that its guidance still matches the repository.

Source files, tests, `AGENTS.md`, and `docs/*.md` are canonical.

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
- This repository is public, so identify rows by predicate and never by a person-bearing identifier.
Write "the 12 rows where `manuallyLockedFields` contains `activeAtYaleCache`" rather than a list of slugs, in issues, pull requests, and commit messages alike.
Editing a body later does not remove the text, because GitHub serves every prior revision to anyone without an account, so the first draft is the only draft that matters.
The harm is the pairing rather than the name, so a prose name next to `departed`, `suppressed` or a defect judgement is the thing to avoid, not just a slug.
Check a draft with `yarn security:identifiers:body <file>` before posting it.
See `docs/person-identifier-convention.md`.
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
- Write the PR body by predicate.
This applies to whoever or whatever writes it, automation included: never put a person's name, netid, email local part, or row slug next to a status or a defect judgement.
Write "the 12 rows where `manuallyLockedFields` contains `activeAtYaleCache`" rather than naming the rows.
A flagged body cannot be repaired by editing it, because GitHub serves every prior revision to anyone without an account, so the draft is the only chance.
Scan it before it exists anywhere public: `yarn security:identifiers:body <file>`, or `node scripts/check-no-person-identifiers.mjs --body-file <file>` when yarn is unavailable.
The `Person identifier scan` check fails when a posted body is flagged.
It is not a required check and it cannot unpublish the text, so treat a failure as "rewrite by predicate now and know the original is already public", never as a gate to wait on.

### Merging

- Merge only when CI checks are all green and the PR is mergeable on its current head.
`Person identifier scan` is the one exception, because it is not required and its prose-name rule is fuzzy on purpose: a red run means "read the finding", never "wait for green".
Rewrite the body by predicate when the pairing is real, and when the match is a Title Case product phrase rather than a person, say so in a comment and merge on the red.
Never clear a red scan with an `identifier-exempt:` line, which suppresses the whole body including a real name elsewhere in it.
- Squash-merge with a clean Conventional-Commit message derived from the PR title: `gh pr merge <n> --squash --admin --delete-branch`.
- `--admin` is load-bearing here rather than a shortcut, and the reason is worth knowing so it is not "cleaned up". Protection on this repository is **rulesets**, not classic branch protection, so `GET /branches/beta/protection` answers 404 and that 404 means nothing; read `gh api repos/YaleComputerSociety/ylabs/rulesets`.
`require CI on beta` requires `test-and-build` and `student-journey-smoke`, requires **one approving review**, and blocks force pushes; `protect main (production)` additionally requires `release-hold` and allows merge commits only.
A sole maintainer cannot approve their own PR, so without the Admin bypass nothing merges at all.
- What `--admin` may and may not be used for: the review requirement, the watchdog's bot flow, and a red `Person identifier scan` that has been read and answered, yes.
To get past a red `test-and-build` or `student-journey-smoke`, never; fix the check or report the blocker.
The bypass is unconditional, so the flag really will override a failing suite, which makes the restraint the contract rather than the configuration.
- The `Closes #<n>` link auto-closes the linked issue on merge; confirm it closed.
- After merging, remove the worktree with `git worktree remove <path>` and prune stale entries with `git worktree prune`.
- Asking after the fact whether a merge was gated is an **ancestry** question, never an equality one, and the report that answers it lives in the watchdog repository rather than here (#2452).
A correctly gated head moves after the run, because the gate rebases and pushes its own review and document commits, so no recorded SHA equals the head that merged.
Compare against the pull request's `headRefOid` and never against the commit the merge produces: every merge here is a squash, so the branch head is not an ancestor of it, measured 20 of 20 on the last 20 merged pull requests.
Read `last_pushed_sha`, the head the gate actually pushed, not `submitted_head_sha`, the head it started from, which a later rebase routinely rewrites out of the branch.
Measured over the same 20: 7 carried no run row at all, and of the 13 that did, equality on `submitted_head_sha` held for 0, ancestry on `submitted_head_sha` for 5, and ancestry on `last_pushed_sha` for 10.
That last 10 of 13 is the ceiling, so the signal is advisory by construction and must never become a merge precondition.

### Definition of done

Merging is not the finish line for every kind of fix.
Decide which of the two kinds you are landing before you open the PR.

A **serve-time** fix changes a DTO, a visibility gate, a sanitizer, or client rendering.
It reaches students on deploy, so merging it is done.

A **stored-data** fix changes a scraper, a materializer, a repair script, an index shape, or a facet catalog.
Merging it changes nothing a student sees, because the corpus still holds the old values.
It is done when the data operation has run against Development and the result has been verified by reading the served output.

- A PR whose effect depends on a data operation says so in its body and names the operation.
- Run the operation against Development, not against each environment in turn.
Beta and Production receive whole-collection copies, so a repair applied to Development reaches them through promotion.
Running the same repair three times is redundant and multiplies the number of writes against a student-facing database.
- Do not open an issue to track a promotion, and do not hold a fix's issue open waiting for one.
Promotion is not per-fix work: `promoteAcceptedBetaCopy` replaces fifteen whole collections at once, so a single promotion delivers every pending fix together.
An issue per fix implies a queue of operations that does not exist, and the tracker fills with entries nobody can act on individually.
- What is undelivered is a property of the environments, so read it rather than file it.
Close a stored-data issue when Development is fixed and verified.
- Verification is a re-read of the served surface.
An exit code is not verification, and neither is a script's own counter: #2440 records that the repair queue's patch count overstates promotions, so the counter is now named `patched` and the promotion count is `resolvedByGate`.
A dry run applies no patch, so it reports `resolvedByGate: null` with a note rather than a `0` that reads as "the gate promotes nothing"; take a promotion count from an apply run only.
- The scoreboard is the instrument for both reads, per-fix verification and cross-environment drift: `yarn --cwd server research-entity:served-scoreboard`, documented in `docs/served-corpus-scoreboard.md`.
- Is the corpus getting better over time? Read the Corpus Quality panel on `/analytics`, or take a measurement with `yarn --cwd server corpus:snapshot`, documented in `docs/corpus-quality-panel.md`.
Do not answer a coverage or quality question with a throwaway script when a stored measurement already exists.
- An operational change needs the same treatment, and needs evidence that it actually ran.
A merged cron, dashboard, or scheduled-job config is not a run.
#2513 found that Production's scheduled scrape crons show no run at any trigger window, and because Production `scrape_runs` is mirrored from Development a cron that never fired still reads as successful.
A green-looking signal that was never exercised is the same failure as an unapplied data fix.

## Implementation Rules

- Default to making the requested change after inspecting the code.
Ask questions only when the answer cannot be inferred and a wrong assumption would create meaningful rework or risk.
- When the user reports a problem, fix the upstream cause when feasible, not just the local symptom.
- Follow existing local patterns before adding abstractions.
- Prefer first-class product-model collections over embedded shortcuts.
See `skills/product-model/SKILL.md` for the canonical concepts.
- Treat remaining `ResearchGroup`, `lab`, and `researchGroupId` naming as migration residue unless the file is explicitly rollback or migration support.
- Treat remaining "research home" and "research area" wording, and `researchHome` naming, as migration residue too.
The 2026-08-25 "Simple Directory First" decision retires both phrases in favor of plain directory language, so never introduce either in copy, a label, a comment, or a new identifier.
Say "research", or the entity's own kind noun (lab, center, faculty research profile), for the thing itself; "research website" for `websiteUrl`; and "topics" for `researchAreas`.
The stored `researchAreas` field keeps its name, because renaming a schema field is a migration.
A client guard test enforces the copy half (`client/src/__tests__/deprecatedVocabularyGuard.test.ts`).
- Keep scraper writes evidence-first and fail closed on contact data.
See `skills/scrapers/SKILL.md`.

### Evidence, Lanes, And Operator Judgement

This contract was ratified on 2026-09-24.
`docs/decisions.md` holds its reasoning, its measurements, and the ordered list of the four legitimate places to correct output; point at that entry rather than restating any of it.

- The scraper asserts evidence, and evidence is the only thing that may set a field.
A direct field write is not evidence: where rival observations exist the next resolve overwrites it, so it sticks only behind a `manuallyLockedFields` entry, and where no observation exists at all it persists while no lane can reach it again.
Neither outcome is durable correctness.
- Wrong output means fix the lane, not the row, because a bug affects a class and so should the fix.
At this layer the operator's job is to notice and to measure rather than to patch rows.
- The operator acts only where evidence cannot decide: a refusal that a specific value is inadmissible, an archive, or a review verdict on one row.
That is a judgement about that row, which is why the lead-edge retirement review queue is read-only by construction and has no bulk-apply path.
- Some rows are not fixable, and that is the answer.
Recording them by predicate with a count and a reason is finishing the work rather than deferring it.

Two tests decide where a correction belongs, and running them is most of the skill.

- Does the wrongness have a shape?
If you can write a predicate for it, it is a lane bug and belongs to the lane.
If you can only tell by reading the page, it is an operator judgement and belongs to one row.
- Run it twice.
If the second run re-derives the same answer from evidence, it is a lane.
If the second run is a no-op because the first wrote a field, it is a repair that will need a lock.

Post-processing is legitimate and necessary, because the lanes are not perfect.
Post-processing that runs on every resolve is derivation rather than repair: it reads evidence, applies a correction, writes no field, and needs no lock.
The one illegitimate form is a script that writes a field directly and locks it to make it stick.

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
