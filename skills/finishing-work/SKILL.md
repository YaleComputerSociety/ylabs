---
name: finishing-work
description: Use when wrapping up a coding task in this repo - deciding what to verify, reviewing the final diff, and folding durable changes back into docs and the task roadmap. Covers the done-criteria, verification, and documentation-maintenance workflow.
---

# Finishing work

## Verify

Before finishing, run the **narrowest relevant** verification command. Prefer focused tests, typechecks, lint, or build steps over broad commands unless the change affects shared behavior or release readiness. If verification is skipped, explain why.

| Command | Use |
|---------|-----|
| `yarn format:check` | Prettier check. **CI's first gate**, and the most common CI failure |
| `yarn format` | Fix formatting in place |
| `yarn lint` | ESLint. **A CI gate as of #3070**: an error fails the required check, a warning does not |
| `yarn lint:fix` | Fix the auto-fixable lint findings in place |
| `yarn --cwd server test` | Server-side Vitest suite |
| `yarn --cwd client test:ci` | Client Vitest once (CI form) |
| `npx tsc --noEmit -p server/tsconfig.json` | Server typecheck |
| `yarn build` | Full build (server + client) |
| `yarn verify:fast` | `format:check` + `lint` + both typechecks. Under a minute; run before every push |
| `yarn verify` | Every CI gate in CI's order. Passing this predicts CI passing |

The full server suite is hermetic as of #2966, so `server/.env` no longer has to be moved aside before running it.
`server/src/test/hermeticEnvironment.ts` fences every suite off from that file and from a reachable search index, so a worktree with an `.env` copied in for a data operation can no longer leak a real `MONGODBURL` into the integration tests.
Treat a failure that appears only when that file exists as a hole in the fence rather than a local-only false failure; `skills/architecture/SKILL.md` owns the fence's contract.

**Before pushing, run `yarn verify:fast` at minimum.** `format:check` is CI's first step and takes about three seconds, and it has been the sole cause of otherwise-green PRs failing (#2305, #2322, #2327, #2334 - see #2335). Running `security:preflight` alone is not enough: it sits late in CI and does not check formatting.

CI (`.github/workflows/ci.yml`) `test-and-build` runs, in this order:

1. checkout -> Node 20 -> Corepack -> immutable root, server, and client installs
2. `yarn format:check`
3. `yarn lint`
4. `npx tsc --noEmit -p server/tsconfig.json`
5. `npx tsc --noEmit -p client/tsconfig.json`
6. `yarn --cwd server test`
7. `yarn model-refactor:inventory:test-operator-tools`
8. `yarn test:data-profiles`
9. `yarn --cwd client test:ci`
10. `yarn security:preflight` (= `security:policy` + `security:secrets` + `security:identifiers` + `security:audit:production`)
11. recursive moderate dependency audits
12. `yarn build`

`yarn lint` became a gate in #3070, and it gates on **errors only**: `yarn lint` passes no `--max-warnings`, so ESLint's unlimited default applies and the two standing unused-variable warnings do not fail CI.
Do not add `--max-warnings` without first clearing those warnings, and expect a lint error to fail the required check before any suite runs.
`yarn verify` runs steps 2-10; keep it in sync with this list if `ci.yml` changes.
`scripts/security-preflight.test.mjs` pins the lint step's presence and its position ahead of the suites, so a step reordering that contradicts this list fails step 10.

Steps 10 and 11 gate at moderate. A low advisory below that gate is a judgement call, and the ones already judged are recorded in `docs/dependency-decisions.md` - read it before triaging a low Dependabot or audit PR. First check whether the patched version satisfies every parent's declared range: if it does, pin it in `resolutions` and the advisory is gone, and only if it does not is accepting it a judgement worth recording.

None of the above verifies served output. When a change is meant to improve the copy students see, re-read the served surface with the scoreboard in `docs/served-corpus-scoreboard.md` (`yarn --cwd server research-entity:served-scoreboard`). It is read-only, renders a fixed slug set through the real serve path, and prints the served text rather than a diff count, because a changed description is not necessarily a fixed one.

## Review the final diff

Review for bugs, regressions, risky patterns, unrelated changes, and documentation impact. Keep final summaries short and include the tests or checks run.

## Check that the invariant you fixed has one owner (#2421)

A recurring defect shape here is not a wrong predicate but a duplicated one: several modules each carry their own slightly different version of the same rule, so fixing the copy you found leaves the others deciding differently. It has four sub-shapes, and they need different fixes:

1. **Several owners, divergent predicates.** The same question is answered in more than one place and the answers disagree. Fix by deleting all but one owner, not by aligning them.
2. **An owner whose inputs never arrive.** The predicate is correct and its producer never supplies the fields it reads, so it decides nothing. Fix the producer or delete the guard; do not leave it as decoration.
3. **A criterion wired to a narrower check than its name.** A name that promises card-and-content agreement, wired to a check that only fires for one name shape, will be trusted for the promise and deliver the narrow case. Rename it to what it checks, or widen it to what it says.
4. **A declared mirror with no test.** Two places asserted to be byte-identical drift silently. Pin the pair with a contract test.

Two detection habits that have each caught a real defect:

- **Recompute the served value and check that the reason you believe is protecting a row actually appears.** A row can hold the right outcome for a reason nobody recorded, which reads as clean and is not.
- **Any audit that counts `operator_review` rows must split on whether the gate has decided them.** A row that was never evaluated and a row that was evaluated and held are the same count and not the same fact.
Read `studentVisibilityEvaluatedAt`, which the gate stamps on every row it decides.
Do not read `studentVisibilityComputedAt` for this: it only moves on a material change, so a row the gate re-decided and correctly left alone carries no fresh stamp and reads as never evaluated (issue #2604).
Use `hasRecordedGateVerdict` in `server/src/scripts/visibilityRecoverabilityAuditCore.ts` rather than restating the predicate, and note that a row last decided before the stamp existed still answers only through the older field, so a re-gate is verifiable from the run that stamped it forward, not retroactively.

Known live instance, so it is not re-discovered from scratch: `entityContentMatchesCard` in `server/src/services/studentVisibilityTier.ts` is sub-shape 3. It is `!isLabNameOrgTypeMismatch`, which does compare the name against the description, but only after two preconditions that almost nothing meets: the name must end in "lab" or "laboratory", and the `entityType` must be `CENTER` or `INSTITUTE`. So a criterion that reads as general card-and-content agreement reports it only for that one name shape, and the narrowing to fix is the precondition, not a missing description comparison. The inert merge veto is sub-shape 2 and is tracked separately in #2270.

## Fold durable changes into docs

Update repo documentation only when the task changes **durable** product, schema, architecture, setup, or design decisions - never speculatively.

- `AGENTS.md` - the canonical agent-facing entry point. Keep it compact and route detailed context to focused skills.
- `DEVELOPER_GUIDE.md` - human-facing project documentation. Keep it accurate in the same commit as the code change.
- `CONTRIBUTING.md` - the human landing protocol. Update it when the issue, branch, PR, or merge convention changes, and keep it deferring to `AGENTS.md` rather than restating it.
- `docs/onboarding.md` - the first-week path and the maintainer's onboarding checklist. Its measured figures carry the date they were taken, so refresh the number and the date together or leave both alone; never update one and not the other.
- `docs/glossary.md` - the definition list for product and pipeline vocabulary. **Retiring or renaming a term is not done until its entry here is updated**, including the deprecated-vocabulary table. Each entry names the file that owns the concept, so a file move updates the pointer.
- `docs/product-context.md` - stable product context.
- `docs/research-model.md` - schema and modeling decisions.
- `docs/decisions.md` - dated architecture/product decisions (add a date for major decisions).
- `docs/dependency-decisions.md` - dated dependency advisory and version-pin decisions.
- `docs/agent-workflow.md` - how an agent should work in this repo.

Keep entries concise, preserve existing structure, link implementation files when relevant, and do not invent decisions that were not made. Do not append noisy transcripts; summarize only stable decisions.

## Task roadmap

Track outstanding work in GitHub issues, which are the task source of truth. `docs/tasks/priority-roadmap.md` records standing launch priorities and the operating baseline, so update it only when a standing priority or baseline changes, not to log per-task progress. Do not create new durable task files under `docs/tasks/` unless the user explicitly asks for one. Delete or fold back temporary execution trackers during cleanup.

## Rule evolution

Treat agent rules as living workflow documentation. When the same mistake recurs, or the user gives feedback that should apply beyond the current task, add a concise durable rule to `AGENTS.md` or `docs/agent-workflow.md`. Keep rules practical and compact; prefer links to focused docs over long inline checklists.
