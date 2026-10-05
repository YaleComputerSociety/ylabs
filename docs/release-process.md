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

Every Render service's build command should begin with `npm install -g corepack@0.36.0 && corepack enable && bash scripts/install-all.sh --immutable`, the same Corepack pin and the same three immutable builtin installs CI runs.
The immutable form is the security-relevant part: a plain install resolves dependencies afresh at deploy time and can ship a version no lockfile in this repository pins.
The command this page used to give, `corepack enable && yarn install:all:immutable`, fails on a clean build for two independent reasons: Node 25 and later ship no Corepack, so `corepack enable` alone exits non-zero, and Yarn cannot run a `package.json` script such as `install:all:immutable` before an install has created its state file (#4035).
A service still configured with that command builds only while Render's build cache happens to hold an earlier install, so read each service's Build Command in the dashboard and replace it, then run a clear-cache deploy on Beta first.
This repository declares no Render blueprint, so nothing here can enforce that build command; set it in the dashboard and check it when a service is created or its build settings change.

The Node major is declared once, in `.node-version` at the repository root.
CI's `setup-node` reads it with `node-version-file`, and Render reads the same file, so the tested runtime and the deployed runtime cannot drift apart (#3915).
`engines.node` in the root, server, and client manifests is bounded to that major, so a bump is one commit that moves all four together.
Without that file the deployed major was decided outside the repository, by the provider's default for the date the service was created.

## The post-merge signal on beta

`CI` and `E2E Smoke` run on pushes to `beta`, not only on pull requests.
The merge gate is the squash merge queue on `beta` (#4512).
The queue runs both workflows on the exact squash commit that will land, on top of every pull request queued ahead of it, so a semantic conflict between two individually green pull requests is caught before it reaches `beta` rather than after (#1151, #1153, #3913).
The `beta` ruleset still does not require branches to be up to date (#3425), because the queue does that rebase itself.

A push run is a post-merge safety net, not a merge gate.
It catches anything that reaches `beta` outside the queue, which the rulesets should make impossible.

A red push run on `beta` blocks promotion.
Fix it before opening a promotion pull request, because `beta` is the source of every promotion and a red `beta` otherwise surfaces as a failure on the next unrelated pull request.
Consecutive merges cancel the older push run, so only the newest `beta` head is tested to completion.

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

The check, `scripts/release-hold-check.sh`, reads both conditions from the pull request itself at run time, with `gh pr view --json isDraft,labels`, rather than from the webhook payload that started the run.
The label match ignores case, so `Hold` holds as well as `hold`, and a failure to read the live state fails the check.
That is what makes "while" true.
A re-run of a workflow run replays the original event, so a payload-driven check would re-read the labels and draft state as they were at that earlier event and could report clear on a promotion that is still held (#3911).
Re-running the check is therefore safe: it always evaluates the current state.

## Keeping beta warm

The `Keep Alive` workflow pings `GET /api/config` on the beta service.
It is a warm-up that doubles as the only scheduled signal about beta, so `scripts/keep-alive-probe.sh` fails when the route does not answer 2xx after three attempts twenty seconds apart, and it prints the final HTTP status so a red run names what it saw (#3910).

The probed route is deliberately `/api/config` rather than the service root.
The root answers 2xx from a cold instance and keeps answering 2xx while the API is broken, which is how #3910's three days of HTTP 500 produced an unbroken green history.
`/api/config` is the route the client cannot start without, so it is the one worth reporting on, and a cold start is absorbed by the retries rather than by narrowing what is probed.
That makes this job a monitor of the served API that also keeps the instance warm, not a liveness check on the instance alone.

A 500 is a running service returning an error, not a cold start, and it is reported as a failure.
A timeout or refused connection counts as a failed attempt and is reported as HTTP `000`, so a cold start that outlasts one attempt still gets the remaining retries.

Its cadence is best-effort and much lower than the cron line suggests.
GitHub delays and drops scheduled runs under load; the observed rate has been roughly 6 to 7 runs a day against a cron that asks for 144.
So read a red run as a real signal about beta, but never read a green history as proof that beta stayed warm, or that it was healthy, between runs.

A red run is relayed as an issue, because GitHub notifies only the account that last edited a scheduled workflow's cron line (#4143).
After every passing or failing probe, the workflow's `alert` job runs `scripts/keep-alive-alert.sh`.
A failing probe opens one issue titled `ops: beta probe failing` with the `beta-probe-failing` label, or comments on that issue if one is already open, so an outage is one issue rather than one per run.
The first passing probe closes it with a comment, so an open `beta-probe-failing` issue means Beta is failing as of the last run.
The posted text carries only the probed route, the validated last HTTP status, the attempt count, and the run URL, never a response body.
Only the `alert` job holds `issues: write`; the job that talks to Beta keeps the read-only token.
Watch the repository's issues from the maintainer account, or the issue reaches nobody either.

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

Before Development is copied to Beta, run `yarn --cwd server research-homes:backfill-browse-rank --fail-on-drift` from a `beta` checkout against Development.
A non-zero exit means some rows hold a `browseRankScore` the current scorer does not compute, usually written by a stale checkout (#4642), and the copy would carry that ranking forward; rerun with `--apply --confirm-browse-rank` first.

Run the steps in this order.
The order is not cosmetic and two of the orderings are the opposite of what seems natural.
`yarn promote:production` runs steps 1 to 5 in this order and then prints step 6; `docs/data-refresh-runbook.md` ("One-Command Promotion") owns what it checks.

1. **Dry-run the copy.** `yarn --cwd server production:promote-beta-copy --dataset-version prod-promote-YYYY-MM-DD-lane-a-beta-copy`. Dry-run is the default. Read the per-collection plan before doing anything else. The script refuses unless `BETA_MONGODBURL` names the database `Beta` and `PRODUCTION_MONGODBURL` names `Prod`, both on remote hosts, and `yarn --cwd server database:verify-names --pair beta-to-production` runs the same check without connecting (#4150).
2. **Check for a collection that would copy nothing over existing documents.** Apply is blocked when `sourceCopyCount` is 0 and `targetCount` is above 0, because `copyCollection` deletes the whole target before inserting. Treat that blocker as a stop, not an obstacle.
3. **Copy the data, before deploying the code.** The copy never touches Production's retired collections, so the currently deployed code keeps reading `users`, `entry_pathways`, `access_signals`, `contact_routes` and `research_entity_members` throughout. Data-first therefore has no broken window. Code-first has one: the current model reads `signals`, `accounts`, `researchers` and `role_assignments`, and a Production that has not received them yet cannot serve the visibility gate, browse ranking, login or person pages.
4. **Re-gate visibility.** `yarn --cwd server student-visibility:gate --collection=all --apply --confirm-student-visibility-apply --max-apply=100000`. Apply mode throws without `--max-apply`, and refuses to write without `--confirm-student-visibility-apply`. Freshly copied rows do not carry a usable tier until a gate pass runs, so skipping this leaves part of the corpus stuck at `operator_review` and invisible.
5. **Rebuild the search index, after the gate and not before.** `SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=true yarn --cwd server reindex:meili --confirm`, run inside the Production Render shell because the private Meilisearch is not reachable from a laptop. `CONFIRM_PROD_SCRAPE=true` is not optional: the write guard refuses the rebuild without it, and it fires after the preflight and the index reconcile plan have already printed, so a run without it reads as working and stops at the last moment. Prefer `node scripts/reindex-search-index.mjs production --apply`, which reports every missing variable at once before anything starts. The gate writes tiers, so an index built before the gate carries pre-gate tiers. The rebuild applies the full settings object first, including `pagination.maxTotalHits`, so it also repairs an index left at Meilisearch's 1000-hit default. It builds into a fresh `prod_researchentities_next` index and swaps it in atomically once every document is confirmed, so student search keeps serving the previous index throughout and a failed rebuild changes nothing; the swap only protects against an incomplete rebuild and deletes the previous copy, so the restore point in `docs/data-refresh-runbook.md` is still required, the instance needs disk headroom for two copies, and the shell needs `OPENAI_API_KEY`, because a rebuild that cannot recreate the stored embedder is refused (#4151).
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

`accounts` is the one promoted collection that Production also writes, because every Production login upserts an account and every saved plan in `research_plans` references one.
Beta's accounts never carry a Production login, so a plain swap deleted every account a real login had created and orphaned the plans that pointed at it: on 2026-09-30, 277 of 319 Production plans referenced an account that no longer existed (#4091).
Beta does hold its own logins, though, and has since #4139 made the Development-to-Beta sync carry the target's login rows across the swap, so "Beta is a pseudonymized staging copy that holds no student data" is no longer true of `accounts` and must not be relied on.
The promotion therefore carries every Production account with login evidence (`lastLoginAt`, or an owned research plan) from the pre-swap backup into the swapped collection before verification, and keeps its Production `_id`.
Where the promoted row shares that `_id` or netid, the carry writes the target's `lastLoginAt`, `profile` and `sessionVersion` onto it, because the promoted row is reduced to the mirrored allow-list and holds none of them.
`sessionVersion` is what sign-out increments to revoke every session, so a swap that dropped it would reset it to `0` and revive every cookie minted at `0` that a later sign-out revoked (#4575).
The synthetic-user exclusion applies only to the Beta rows being promoted, so a Production account with login evidence is carried whatever its netid or email looks like and its plans never lose their owner.
Where Beta holds the same netid under another `_id`, the Beta row is re-keyed to the Production `_id` and every account reference follows it.

Because Beta holds real logins, the promotion also constrains what crosses in the other direction, so Production's accounts stay Production's (#4244).
Every promoted account row is reduced to the same allow-list the Development mirror uses, `MIRRORED_ACCOUNT_FIELDS` and `MIRRORED_ACCOUNT_PROFILE_FIELDS` in `server/src/scripts/mirroredAccountFields.ts`, so a Beta `lastLoginAt` and the student profile fields `college`, `year` and `major` never leave Beta.
A Beta account that carries login evidence and that no promoted collection references is not promoted at all, because such a row describes a Beta login rather than the identity spine.
Reachability is measured over the promoted collections only, which is why owning a Beta `research_plans` row is login evidence rather than spine membership: `research_plans` is not promoted, so keeping the account would leave nothing in Production pointing at it.
That exclusion is deliberately narrower than "every Beta login": an account a promoted `researchers` row reaches is the identity spine and still crosses, reduced to the allow-list.
Without both halves a promoted Beta login becomes permanent, because its promoted `lastLoginAt` makes the carry read it as a Production login and re-carry it on every later promotion.
The dry-run report's `productionAccountCarry` counts what will be carried; an `inserted` of 0 while Production has logged-in users is a stop.
`excludedBetaLoginAccounts` counts the Beta logins the promotion will leave behind and `excludedSyntheticUsers` counts the synthetic rows, the two disjoint parts of the `accounts` row's `excludedCount`.
A synthetic row that also carries a Beta login is counted once, as a synthetic row, because `excludedSyntheticUsers` is derived by subtracting the one count from `excludedCount`.

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

The research search check fails rather than warns on anything short of a working index (#4147).
The empty-query search must answer 200, must not say `degraded: true`, and must return at least one row, and the slug it yields must open the detail route.
A degraded or empty answer fails at once, with no retry, because a promotion should not pass on a second look at an index that just answered badly.
The check records only the status, the `degraded` flag and the row count, never payload content, because the Actions log is public.

## Monitoring production

`GET /api/ready` is the route an external monitor polls (#4142).
It runs a MongoDB `ping` and a Meilisearch `health()` call in parallel, each bounded at two seconds, and answers `{ "mongo": <boolean>, "search": <boolean> }` with 200 when both are true and 503 otherwise.
It is never cached, and it carries no version, host, commit, error text or timing, so it is safe to leave public.
`/health` and `/` are the wrong targets, because the SPA shell answers 200 from disk through a full API outage, and `/api/config` is cached for five minutes and never touches Meilisearch.
A one-minute cadence from one monitor stays far inside both the per-session limiter and the per-address first-contact ceiling in `server/src/middleware/rateLimiters.ts`.

The monitor lives outside GitHub Actions, because `scripts/security-preflight.test.mjs` forbids a standing schedule against production.
The maintainer owns it: an external HTTP monitor against `https://yalelabs.io/api/ready` at a one-minute cadence, alerting the maintainer on a non-2xx answer for two consecutive checks.
Record the monitor's provider here when it is created.

## Rolling back

To roll back, prefer the Render dashboard rollback to the previous deploy.
Otherwise revert the promotion merge on `main` with `git revert -m 1 <merge-commit>` through a pull request, and Render redeploys automatically.
