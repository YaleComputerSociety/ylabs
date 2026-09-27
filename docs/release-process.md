# Release Process

Code flows Local -> Beta -> Prod.
`beta` is the default branch and the staging gate.
`main` is production.

| Branch | Render service            | Role                                              |
| ------ | ------------------------- | ------------------------------------------------- |
| `beta` | `ylabs-gr4v.onrender.com` | Staging. All feature work lands here.             |
| `main` | `yalelabs.onrender.com`   | Production. Only ever moved by a promotion merge. |

Render auto-deploys each branch from the Render dashboard.
There is no GitHub Actions deploy step, so moving a branch is what ships.

Every Render service builds with `corepack enable && yarn install:all:immutable`.
The immutable form is the security-relevant part: a plain `yarn install:all` resolves dependencies afresh at deploy time and can ship a version no lockfile in this repository pins.
This repository declares no Render blueprint, so nothing here can enforce that build command; set it in the dashboard and check it when a service is created or its build settings change.

## Promoting beta to main

`main` and `beta` share history.
The one-time reconciliation that restored that has already landed, in pull request #2341 (`a267c7b4`), so every promotion from here is an ordinary pull request.

### Do not use the ancestry check to decide whether to reconcile again

`git merge-base --is-ancestor origin/main origin/beta` fails, and it will keep failing forever.
That is not evidence the branches are severed.
The reconciliation records `main` as a second parent of a commit that lives only on `main`, so `main` is never reachable from `beta` however many promotions land.
Treating the failing check as "still severed" leads an operator to redo the `-s ours` recipe below, which silently discards anything that exists only on `main` - the single most damaging thing this runbook can be misread into doing.

The question the check was standing in for is whether a plain promotion conflicts, so probe that directly:

```bash
git fetch origin
git merge-tree --write-tree origin/main origin/beta >/dev/null   # exit 0 = ordinary pull request
```

No back-merge of `main` into `beta` is wanted.
A back-merge would make the ancestry check pass, but it buys nothing: promotions already merge cleanly, and `main` holds no content that `beta` does not, so there is nothing to carry back.

### The promotion

1. Open a pull request from `beta` into `main`.
2. Verify the change set on staging.
3. Mark the pull request ready for review and merge it.

Merge promotions with a **merge commit**.
Never squash a branch-to-branch promotion.
Squashing drops the second parent, re-severs the histories, and reproduces the phantom conflicts the reconciliation removed.
That is exactly how the earlier split arose.
The `protect main (production)` ruleset restricts `main` to merge commits so it cannot recur by accident.

Squashing individual feature pull requests into `beta` is fine and remains the norm.
The rule applies only to promotions between long-lived branches.

### The reconciliation recipe, kept only in case the branches are severed again

This ran once, in #2341.
It is recorded here because a squashed promotion would re-sever the histories and require it again.
Do not run it unless the conflict probe above fails.

Before the reconciliation, an earlier promotion had been squash-merged, so the merge base was ancient, every intentional deletion on `beta` read as a delete-versus-modify conflict, and a direct pull request conflicted on roughly 485 paths that were not real conflicts.

```bash
git fetch origin
git worktree add -b sync/beta-to-main /tmp/ylabs-sync origin/beta
cd /tmp/ylabs-sync && git merge -s ours origin/main
git diff --stat HEAD origin/beta                # must be empty
git merge-base --is-ancestor origin/main HEAD   # must succeed
git push -u origin sync/beta-to-main
gh pr create --base main --head sync/beta-to-main --draft
```

`-s ours` keeps `beta`'s tree wholesale while recording `main` as a second parent.
Before relying on it, confirm `main` holds no unique work: check that any revert pairs net to an empty diff, and that every file present only on `main` also exists somewhere in `beta` history.

`-s ours` discards anything that exists only on `main`, silently and with no conflict.
So re-confirm `main`'s unique commits immediately before merging, not only when the branch is built.
A hotfix committed directly to `main` in between would be erased without warning.

## Holding a release

The `release-hold` check fails on any pull request targeting `main` while either condition holds:

- the pull request is a draft
- the pull request carries the `hold` label

Draft state is the default hold.
Open promotion pull requests as drafts, verify on staging, then mark ready.
Use the `hold` label when a promotion must be blocked for a reason other than draft state, so the reason is visible in the pull request list.

## Holding one feature instead of the whole release

Holding the whole promotion blocks every other change queued behind it.
When only one feature is not ready, gate the feature and keep promoting.

Release feature flags live in `RELEASE_FEATURE_FLAGS` in `server/src/services/configService.ts` and are served to the client under `features` in `GET /api/config`.

To add one:

1. Add the camelCase flag name to `RELEASE_FEATURE_FLAGS`.
2. Read `features.<flagName>` from the config payload at the point of use.
3. Set the matching environment variable in the Render environment groups.

The environment variable name is the flag name upper-snake-cased with a `FEATURE_` prefix, so `newBrowseRanking` reads `FEATURE_NEW_BROWSE_RANKING`.

Flags are fail-closed.
Only the exact string `true` enables a flag, and anything else including an unset variable leaves it off.
Undeclared `FEATURE_` variables are ignored, so the served payload is always bounded by the registry rather than by whatever happens to be in the environment.

Flipping a flag needs no redeploy.
It is an environment variable plus the five minute config cache.
Because the flag is resolved on the server, it can gate API responses as well as UI.

Retire a flag once it is fully on in production.
Delete the registry entry, the branches that read it, and the Render variable.
A flag left in place forever becomes a permanent dead branch in the code.

## Hotfixing production while beta holds unreleased work

Base the hotfix on `main`, never on `beta`.
Branching from `beta` would drag every unreleased change into production.

1. Branch from `origin/main` and open the fix as a pull request into `main`.
2. Merge it, then back-merge `main` into `beta` through a pull request so `beta` keeps the fix.

Back-merge rather than cherry-pick.
Cherry-picking produces two commits carrying the same change with no ancestry link between them, which reintroduces conflicts on the next promotion.

Keep the gap between `beta` and `main` small.
Divergence costs nothing at a handful of commits and becomes expensive at hundreds, because every hotfix then needs a back-merge across a large refactor.
If `beta` runs more than a sprint ahead of `main`, that is a signal to promote or to gate the unfinished work behind a flag.

## Promoting data, not just code

A promotion is a data migration as well as a merge.
Moving the `main` branch deploys code; it does not move a single document.
`server/src/scripts/promoteAcceptedBetaCopy.ts` copies Beta's Mongo into Production, and it contains no Meilisearch references at all, so the search index is a separate step again.

Run the steps in this order.
The order is not cosmetic and two of the orderings are the opposite of what seems natural.

1. **Dry-run the copy.** `yarn --cwd server production:promote-beta-copy --dataset-version prod-promote-YYYY-MM-DD-lane-a-beta-copy`. Dry-run is the default. Read the per-collection plan before doing anything else.
2. **Check for a collection that would copy nothing over existing documents.** Apply is blocked when `sourceCopyCount` is 0 and `targetCount` is above 0, because `copyCollection` deletes the whole target before inserting. Treat that blocker as a stop, not an obstacle.
3. **Copy the data, before deploying the code.** The copy never touches Production's retired collections, so the currently deployed code keeps reading `users`, `entry_pathways`, `access_signals`, `contact_routes` and `research_entity_members` throughout. Data-first therefore has no broken window. Code-first has one: the current model reads `signals`, `accounts`, `researchers` and `role_assignments`, and a Production that has not received them yet cannot serve the visibility gate, browse ranking, login or person pages.
4. **Re-gate visibility.** `yarn --cwd server student-visibility:gate --collection=all --apply --confirm-student-visibility-apply --max-apply=100000`. Apply mode throws without `--max-apply`, and refuses to write without `--confirm-student-visibility-apply`. Freshly copied rows do not carry a usable tier until a gate pass runs, so skipping this leaves part of the corpus stuck at `operator_review` and invisible.
5. **Rebuild the search index, after the gate and not before.** `SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=true yarn --cwd server reindex:meili --confirm`, run inside the Production Render shell because the private Meilisearch is not reachable from a laptop. `CONFIRM_PROD_SCRAPE=true` is not optional: the write guard refuses the rebuild without it, and it fires after the preflight and the index reconcile plan have already printed, so a run without it reads as working and stops at the last moment. Prefer `node scripts/reindex-search-index.mjs production --apply`, which reports every missing variable at once before anything starts. The gate writes tiers, so an index built before the gate carries pre-gate tiers. The rebuild applies the full settings object first, including `pagination.maxTotalHits`, so it also repairs an index left at Meilisearch's 1000-hit default.
6. **Then reconcile and merge `main`**, which deploys the code.

The gate refuses to apply when too many lead-requiring entities resolve no lead, and it throws rather than writing a partial result.
That is the intended behaviour, and it is why the gate must follow a complete copy: a copy that stopped after `research_entities` but before `role_assignments` would make every row read as leadless.

Never run `materialize` or a source-scoped scrape against Production after a copy that carried no observations.
`entityMaterializer` resolves `fullDescription` from ranked observation candidates, and with none to resolve from it falls through to the program-like restatement clear (`isProgramLikeResearchEntity`).
A program-like entity whose stored full description restates its stored card has `fullDescription` emptied while `shortDescription` survives, so the tier stays `student_ready` and no gate or audit fires.
The result is a healthy-looking row that has silently lost its body and serves only the surviving one-line card on its detail page.
Since #2721 the clear no longer applies to the rest of the corpus, which narrows the blast radius without removing it.
`docs/scraper-deployment-runbook.md` (`Rollback` -> `Rolling back a written description`) owns the mechanism and the repair.
Production is a serve-only environment: evidence accumulates in Development and arrives already materialised.

`--include-observations` flips the observation default.
`--include-scrape-runs` flips the run-history default, which is off: a promoted `scrape_runs` is Development's history under Production's name (#2589).
It reads like a completeness option and is not one: when the source is empty it deletes the target and copies nothing back.

### The reindex step needs Render's outbound ranges on the Atlas access list

Step 5 runs inside a Render shell, so it reaches Atlas from Render's network rather than from a laptop.
Check this before running it, because the failure looks like a broken script and is a one-line dashboard fix:

```
MongooseServerSelectionError: Could not connect to any servers in your MongoDB Atlas cluster.
```

That error during a reindex means the Atlas access list does not cover the address the shell connected from.
Read the access list first rather than the script.

A Render service has no single outbound address.
On the current workspace plan every service exits through ranges shared by all services in the same region, and it may use any address inside them.
So an access list holding one observed `/32` works until the next redeploy or instance move and then fails with no change on our side.
As of 2026-09-25 the ranges are:

```
74.220.50.0/24
74.220.58.0/24
```

Both sit inside `74.220.48.0/20`, which is registered to Render.
Read the current values from the service's page in the Render dashboard, under `Connect` then the `Outbound` tab, rather than trusting the two above: they are per region, shared across every service in that region, and Render can add a block.
The values are stable rather than immutable, and a stale `/32` left on the list is how a reader concludes the list is maintained when it is not, so delete one when you add a range.

This is the same latent failure for the running services, not just for a promotion.
A service whose only access-list entry is a `/32` loses its database the next time Render moves its container, so ranges are a correctness fix rather than a convenience.

Static addresses of our own need a Pro workspace plan plus a monthly fee per IP set, so ranges are the answer while we are below that.
Removing public network access entirely needs an Atlas Private Endpoint, which needs a dedicated cluster.
Neither is worth buying before Atlas backups, which a free cluster does not provide.

## Verifying a release

`Post-Promotion Verify` runs on every push to `main`.
It waits for the Render rollout, then runs the production smoke, so a promotion that broke production surfaces within minutes.
It verifies live hardening headers and current API routes: the things only the deployed stack can answer for, because a Render dashboard env change or a proxy can strip a header the middleware sets.

There is no standing schedule, and adding one back is a test failure in `scripts/security-preflight.test.mjs`.
The nightly `Production Security Smoke` workflow that used to exist was retired in favour of this trigger plus the manual `yarn security:smoke:production` step in the [data refresh runbook](./data-refresh-runbook.md), which is where production data actually changes.
It ran 70 times and never once passed on its own schedule, so its red state carried no information; it also printed live production payloads into this public repository's Actions log on every failure.

The guarantee it was standing watch over - that no internal operator or visibility state reaches an anonymous caller - is enforced in `toPublicResearchEntityDto`'s field allowlist and pinned by `server/src/services/__tests__/researchEntityDto.test.ts`.
That blocks a merge on every pull request rather than reporting a leak after it is already served.

It deliberately does **not** check which commit is live.
The app does not expose its deployed commit: `GET /api/config` returns only a coarse `provider`, and `scripts/security-preflight.test.mjs` forbids the commit there by source literal.
Verifying the commit over HTTP would mean adding an authenticated route and a shared secret to both Render and GitHub Actions, and the Render deploy log already records which commit is live.
So read the deployed commit from the Render dashboard, and treat the smoke as behavioural verification.

## Rolling back

To roll back, prefer the Render dashboard rollback to the previous deploy.
Otherwise revert the promotion merge on `main` with `git revert -m 1 <merge-commit>` through a pull request, and Render redeploys automatically.
