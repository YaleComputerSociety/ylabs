# Onboarding

A first-week path for a new developer, and the checklist for whoever is onboarding them.

[CONTRIBUTING.md](../CONTRIBUTING.md) is the protocol for landing a change and [DEVELOPER_GUIDE.md](../DEVELOPER_GUIDE.md) is the reference.
This document is the order to do things in, and the mental model that makes the rest of the repository legible.

Read [docs/glossary.md](glossary.md) alongside it.
The vocabulary here is dense and the issue tracker assumes all of it.

## What you are actually working on

y/labs looks like a React and Express web app.
It is really a data product wearing a web app, and almost all of the difficulty is in the data.

The measurements say so plainly.
Over the 90 days to 2026-09-25 the repository took 1,684 commits, of which 1,015 were `fix`.
Roughly half of those fixes were in the scraper and data pipeline, against 83 in client, server, and serve-time code combined.
So the application is comparatively stable, and the work is keeping a scraped corpus of Yale research correct while Yale keeps changing its own pages.

This shapes everything:

- A change can be correct, merged, deployed, and still show a student nothing, because the corpus still holds the old values.
- Most bugs are not crashes.
They are a row that says something false with complete confidence.
- Therefore the repository is organised around **evidence** rather than around values, and that is the one idea you have to absorb.

## The three layers

Learn these in order.
Nothing else makes sense first.

**1. Evidence.**
Scrapers do not write product fields.
They emit append-only `Observation` rows, each saying "at time T, source S claimed entity E's field F has value V."
An observation is never wrong to record, even when its claim is false.

**2. Resolution.**
The confidence resolver takes every observation for one `(entity, field)` pair and picks a winner, weighting each candidate value by source trust multiplied by recency decay, with a bonus when sources agree.
The materializer then writes the resolved value onto the first-class record.
This is the only legitimate writer of a scraped field.

**3. Serving.**
A visibility gate assigns each entity a tier, and only `student_ready` is public.
The gate is correctness-only: it asks whether what we would show is wrong or confusing, never whether it is rich.
A detail DTO then builds the payload as an allowlist, so a field you add to the model is invisible until you add it there too.

The consequence worth memorising: **wrong output means fix the lane, not the row.**
If you can write a predicate for the wrongness it is a lane bug and belongs to whatever emits it.
If you can only tell by reading the page it is a judgement about that one row.
Writing a field directly is the illegitimate third option, because the next resolve overwrites it unless you also lock it, and a lock is a promise no future engine improvement may override.

## Day 1: get it running

Follow [DEVELOPER_GUIDE.md](../DEVELOPER_GUIDE.md#local-development-setup).
You are done when all four of these hold:

```bash
yarn meili:health          # {"status":"available"}
yarn dev:server            # boots without MONGODBURL errors
yarn dev:client            # http://localhost:3000 renders the directory
```

Then log in at `http://localhost:4000/api/dev-login` and confirm `/research` returns cards with real text.

You need Development MongoDB credentials from a maintainer.
There is no local-only data path, so an empty app is not a setup you can debug your way out of.

## Day 2: read the product before the code

Spend a session as a student rather than as a developer.

1. Browse `/research` with no query, then search for a topic you know something about.
2. Open five detail pages and read them critically. Does the description describe that thing? Is the named lead the right person? Do the topics look like topics?
3. Open `/programs` and `/dashboard`.
4. Then read [skills/product-model/SKILL.md](../skills/product-model/SKILL.md) and [docs/student-ready-definition.md](student-ready-definition.md).

This order matters.
The definition of `student_ready` reads like bureaucracy until you have seen a page that should not have been published.

Finish by taking a measurement, so you learn the instrument before you need it:

```bash
yarn --cwd server research-entity:served-scoreboard
```

It renders a fixed set of rows through the real serve path and prints the served text.
Whenever you want to know what a student sees, this rather than a database query is the answer.

## Day 3: the two kinds of change

This is the distinction that decides when your work is finished, and it is the most common way a newcomer's change quietly delivers nothing.

**A serve-time change** touches a DTO, a visibility gate, a sanitizer, or client rendering.
It reaches students on deploy, so merging it is done.

**A stored-data change** touches a scraper, a materializer, a repair script, an index shape, or a facet catalog.
Merging it changes nothing a student sees, because the corpus is unchanged.
It is done when the data operation has run against Development and you have verified the result by re-reading the served output.

Work only on Development.
Beta and Production receive whole-collection copies, so a fix applied to Development reaches them through promotion.
Never run the same repair three times against three environments.

Start with serve-time work for your first few changes.
It is verifiable on your own machine and the definition of done is simple.

## Where it is safe to move fast

Measured churn over the 90 days to 2026-09-25, which is a decent proxy for where the risk is.

| Area | Risk | Why |
| --- | --- | --- |
| `client/src/pages`, `client/src/components` | Low | Test LOC meets or exceeds source LOC in `pages`, `utils`, `hooks`, and `reducers`. Failures are loud and local. |
| `client/src/providers` | Medium | 775 source lines against 215 test lines, the thinnest ratio in the client. |
| `server/src/routes`, `controllers` | Low | 9 route files, thin by design. The layering is `routes -> controllers -> services -> models`. |
| `server/src/services` | Medium | 72 files. `researchGroupService.ts` was modified 123 times in 90 days and is 3,089 lines. |
| `server/src/scrapers/entityMaterializer.ts` | **High** | 6,040 lines, modified 175 times in 90 days, roughly twice a day. Every lane fix passes through it. It does have 36 test files and 9,583 test lines behind it, so lean on them. |
| `server/src/models` | **High** | Bottom of the import order and enforced by lint. A schema change needs a deliberate index build, and narrowing an existing index needs a reviewed drop. |
| `server/src/scripts` | Careful | 388 files, of which about 210 are reachable `yarn` commands and most are one-shot repairs that already ran. A `*Core.ts` file is a library, not a CLI. Do not assume a script here is safe to re-run. |

## Day 4: your first change

1. Find or file an issue. Substantive work needs one; a typo does not.
2. `scripts/new-agent-worktree.sh fix/short-name`. Never work in the primary checkout, because two people sharing it will switch branches under each other.
3. Make the smallest change that fixes the cause rather than the symptom.
4. `yarn verify:fast`, then `yarn test:client` or `yarn test:server` for what you touched.
5. Open the PR against `beta` with a Conventional Commit title and `Closes #<n>`.
6. Write the body by predicate. This repository is public and GitHub serves every prior revision of an edited body, so the first draft is the only draft. Scan it with `yarn security:identifiers:body <file>` before it exists anywhere public.

[CONTRIBUTING.md](../CONTRIBUTING.md) has the full protocol.

## How we work, honestly

You should know the real state of the guardrails rather than discovering it.

**Velocity is high.**
1,684 commits and 685 issues closed in the last 30 days alone.
Expect the tree to move under you, and rebase often.

**The test suite is the real safety net, and it is good.**
The suites execute 779 files and about 12,052 tests: 675 files and 10,911 tests on the server, 104 files and 1,141 tests on the client.
Two reverts and three hotfixes in 90 days across all that traffic.
Trust it, extend it, and do not merge around it.

**Both branches are protected, and you will need a reviewer.**
Protection here is implemented as GitHub **rulesets**, not as classic branch protection.
That distinction matters the moment you go looking: `GET /repos/.../branches/beta/protection` returns `404 Branch not protected` even though `beta` is protected, because that endpoint only reports the classic kind.
Read `gh api repos/YaleComputerSociety/ylabs/rulesets` instead.

`require CI on beta` governs `beta`.
It requires `test-and-build` and `student-journey-smoke` to pass, requires a pull request with **one approving review**, and blocks force pushes.

`protect main (production)` governs `main`, and is stricter.
It requires `test-and-build`, `student-journey-smoke`, and `release-hold`, allows only merge commits rather than squashes, and demands an extra approval for unattributed changes.

So as a new contributor you cannot merge your own work, by design.
Someone has to review it.
Plan for that rather than being surprised by it at the end.

The Admin repository role bypasses both rulesets unconditionally, which is why every pull request merged to date shows no approving review and why the protocol reaches for `gh pr merge --admin`.
That is not sloppiness: a sole maintainer cannot approve their own pull request, so the bypass is what makes a one-person team able to ship at all.
It also keeps the release watchdog's bot flow working.
If you have admin, the restraint is yours to supply: the flag really will override a failing `test-and-build`, so use it for the review requirement and not to get past a red check.

Two checks are deliberately **not** required on `beta`.
`Person identifier scan` is advisory because its prose rule is fuzzy on purpose, so a red run means read the finding rather than wait for green.
`release-hold` is the promotion hold and only runs on pull requests into `main`.

**A local test failure is usually your laptop.**
The suites are large and on a loaded machine they produce timeouts that are not real: in-memory MongoDB failing to start, or vitest workers timing out.
Re-run the single file with `TMPDIR=/tmp npx vitest run <path>` from that workspace before you go debugging.
If it passes alone it was starvation, and CI on Linux is the authority.

## Traps that have caught people before

Each of these produced a confident wrong conclusion in real work here.
They are worth reading once now and again the first time a number surprises you.

- **A green signal over an empty population.** A check that passes because it matched nothing is not a pass. Always report the denominator.
- **A shape count is not a defect count.** Counting rows that look like a defect overstates it. Run the fix's own evidence predicate before filing.
- **Stored is not served.** Stored topics outnumber served topics, and a repaired field can still be served from a stale index. Take a number from the route, not from the model.
- **An exit code is not verification.** Neither is a script's own counter. Re-read the served surface.
- **A dry run applies no patch.** A promotion count from a dry run is `null`, not `0`.
- **Two full suites in parallel fabricate failures.** They contend for the same Development data. `yarn test` runs them sequentially for this reason.
- **A consistency audit cannot find a consistently wrong row.** If every source agrees on the wrong value, agreement is not evidence.
- **Re-scraping does not retract a dead URL.** Removing an assertion needs a revocation, not another scrape.
- **A 404 from an API can mean "wrong endpoint", not "absent".** `GET /branches/beta/protection` returns `404 Branch not protected` on this repository, which reads as "there is no protection" and is false: protection is configured as rulesets, which that endpoint does not report. The negative answer was authoritative-looking and wrong. When an absence surprises you, confirm you are asking the instrument that would know.

`docs/decisions.md` records the reasoning and measurements behind the contracts these traps sit inside.

## First-week checklist

- [ ] App runs locally, `/research` renders real cards, dev login works.
- [ ] Read `docs/glossary.md`, `CONTRIBUTING.md`, `skills/product-model/SKILL.md`, `docs/student-ready-definition.md`.
- [ ] Used the product as a student and read five detail pages critically.
- [ ] Ran `research-entity:served-scoreboard` once and understood its output.
- [ ] Can explain the difference between a serve-time and a stored-data fix, and when each is done.
- [ ] Can explain why a scraper emits an observation instead of writing a field.
- [ ] Landed one serve-time change through the full protocol: issue, worktree, verify, PR to `beta`, green CI, squash merge, worktree removed.

## For the maintainer onboarding someone

Do these before their first day, because each one blocks them entirely.

- [ ] GitHub write access to the repository.
- [ ] Development MongoDB credentials. Do not hand out Beta or Production.
- [ ] `OPENAI_API_KEY` if they will touch search or any LLM extraction lane.
- [ ] Confirm whether they need Yale network access. Scraper and data work reaches Yale sources, which is what the `fleet:data` label marks; serve-time work does not.
- [ ] Pick their first task yourself, and pick a serve-time one. Every currently open issue is deep data-quality work written in internal vocabulary, so an unlabelled tracker is not a starting point.
- [ ] Decide whether they get the Admin repository role, and default to no. Admin bypasses both rulesets unconditionally, so it hands a newcomer the power to merge past a failing `test-and-build`. Without it the `require CI on beta` ruleset does its job.
- [ ] Commit to reviewing their pull requests. `require CI on beta` needs one approving review, and a contributor without admin genuinely cannot merge without you. This is the rule that turns "I will look at it eventually" into a blocked newcomer.
- [ ] Decide the review rule for their first changes. Zero-review works for a maintainer holding the model in their head; it does not work for a newcomer's first stored-data change, which can merge green and deliver nothing at all.
