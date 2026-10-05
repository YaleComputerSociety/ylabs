# Incident and Rollback Runbook

What to do when the site is down, when bad data has reached students, and when a credential has leaked (#4152).
Each section is read, decide, act, verify, and each step names who acts.
The variables, services, and accounts this page refers to are listed in [the deployment inventory](./deployment-inventory.md).

## Who Acts

| Role | Can do | Cannot do |
| ---- | ------ | --------- |
| Maintainer | Everything in the Render dashboard (rollback, environment variables, shells, one-off jobs), Atlas (cluster, users, Network Access), the Meilisearch master key, the GitHub organization, Sentry, and the OpenAI and Yalies accounts | |
| Approved promotion operator | `yarn promote:beta` and `yarn promote:production` from a laptop holding the Beta and Production credentials | Change Render or Atlas settings, unless also the maintainer |
| Any contributor, including an agent | Diagnose from public signals, read the repository and Actions, prepare and land a fix through a pull request | Run anything against Beta or Production, or read a secret |

No second administrator is recorded for any platform yet ([Ownership Record](./deployment-inventory.md#ownership-record)).
If the maintainer is unreachable, nobody can roll back, rotate a secret, or reach Atlas, so the most a contributor can do is prepare the fix and say so on the incident issue.

## First Five Minutes, For Every Incident

1. **Open one issue** titled for the symptom, never for a person or a row. Write it by predicate per `docs/person-identifier-convention.md`, and never paste a secret, a connection string, or a response body. Anyone can do this.
2. **Ask the readiness route.** `curl -s -w ' %{http_code}\n' https://yalelabs.io/api/ready` for Production, or `https://ylabs-gr4v.onrender.com/api/ready` for Beta. It answers `{"mongo":<boolean>,"search":<boolean>}`, `200` only when both are true and `503` otherwise, never cached, with each probe bounded at two seconds (`server/src/services/readinessService.ts`). Do not use `/` or `/health`, which answer `200` from the static client through a full API outage.
3. **Read the live commit** from the service's deploy log in the Render dashboard (maintainer), because the app deliberately exposes no commit over HTTP. A Sentry report carries it too, as its release, from `RENDER_GIT_COMMIT`.
4. **Read the recent signals.** Sentry, for `mongo_topology_lost`, `embedding_breaker_open`, and new errors. The latest `Post-Promotion Verify` run on `main` (`gh run list --workflow post-promotion-verify.yml --limit 3`). For Beta, an open issue labelled `beta-probe-failing` means the last `Keep Alive` run failed. The external monitor on `/api/ready` is the maintainer's to read.
5. **Classify** the incident into one of the three sections below.

## 1. The Site Is Down or Erroring

### Read

| What you see | What it means | Where to look next |
| ------------ | ------------- | ------------------ |
| No answer, or Render's own error page | The process is not running. Boot is deliberately fail-fast, so a missing or invalid required variable, or a database it cannot reach at boot, exits 1 and Render restarts it in a loop. | The service's log for `Failed to start app:` and the message after it. |
| `503` with `"mongo":false` | Atlas cannot be reached. The serving process gives up after 5 seconds of server selection or buffering and answers `503` with `Retry-After` instead of hanging, so pages fail fast rather than slowly (#4188). | Atlas cluster status, storage, and Network Access; the log for `MongooseServerSelectionError`. |
| `503` with `"search":false` | The Meilisearch private service is down, or the web service's search key is wrong or deleted. Search answers `503` with `Retry-After`, and `/research` shows the limited-search notice rather than "no matches". | The Meilisearch service's status in Render, and the web service log for a key fallback warning. |
| `200`, but pages fail or misbehave | A code regression, or a configuration change that did not fail boot, such as a wrong `VITE_APP_SERVER` or `TRUSTED_PROXY_CIDRS`. | Sentry by release, and whether the problem started at the latest deploy. |
| A burst of empty replies during a deploy | Expected only for a request still running 20 seconds after `SIGTERM`. The server drains for 20 seconds, under Render's 30-second kill, then cuts what is left and logs `requests were still in flight` (`server/src/serverShutdown.ts`). | Nothing, unless it recurs outside a deploy. |

Boot refuses, with a message naming the variable, when any of these is wrong: `MONGODBURL`, `SESSION_SECRET` (shorter than 32 characters or weak), `TRUSTED_PROXY_CIDRS` (empty, or an entry wider than IPv4 `/8`, IPv6 `/29`, or IPv4-mapped `/104`), `SSOBASEURL` and `SERVER_BASE_URL` (not plain public HTTPS), `MEILISEARCH_HOST`, and `MEILISEARCH_INDEX_PREFIX`.

### Decide

- If it started at a deploy and the previous deploy was healthy, it is a code regression: roll back first, fix second.
- If the process will not boot and the log names a variable, it is configuration: fix the variable, never roll back code to get past a refusal.
- If `/api/ready` names a dependency, it is that dependency: a code rollback will not help.

### Act

**Code regression: roll back (maintainer).**
In the Render dashboard, open the service's Events or Deploys page and roll back to the last healthy deploy.
This is the fastest action and touches no data.
Check the service's auto-deploy setting afterwards: whether the next push to `main` replaces the rollback depends on it, and the repository cannot see it.
Re-enable auto-deploy once the fix has shipped.

Rolling Production code back past a promotion is safe for reads, because the promotion copies data before code and never touches the retired collections the older code reads (`docs/release-process.md`, "Promoting data, not just code").
Those retired collections hold the data from before the copy, though, so an old-code Production serves older data until the fix ships.

**Code regression: fix forward on `main` (any contributor prepares, maintainer merges).**
`beta` usually runs far ahead of `main`, so never fix Production by promoting whatever `beta` holds.
Branch from `origin/main`, open the fix as a pull request into `main`, and merge it with a merge commit once `test-and-build`, `student-journey-smoke`, and `release-hold` pass; `main` has no merge queue.
Then back-merge `main` into `beta` through a pull request, which goes through the `beta` merge queue like any other change (`docs/release-process.md`, "Hotfixing production while beta holds unreleased work").

Reverting the promotion merge instead, with `git revert -m 1 <merge-commit>`, removes every change that promotion carried, not just the broken one.
List what a revert would remove before choosing it:

```bash
git fetch origin
git log --oneline <merge-commit>^1..<merge-commit>^2
git rev-list --count origin/main..origin/beta
```

**Configuration (maintainer).**
Correct the variable on the service in Render and redeploy, because a running process reads its environment only at start.
A client build variable such as `VITE_APP_SERVER` or `VITE_SENTRY_DSN` needs a full deploy, since the client is built with it.

**Atlas unreachable (maintainer).**
Check, in order: the cluster is running and not paused; storage is under the free tier's quota, which `Development`, `Beta`, and `Prod` share, so a large Development write can take Production down; and Network Access holds the Render outbound ranges for the service's region, not a single `/32` (`docs/release-process.md`, "The reindex step needs Render's outbound ranges on the Atlas access list").
The serving process reconnects by itself once Atlas answers, so no redeploy is needed after the fix.

**Meilisearch down (maintainer).**
Restart the Meilisearch private service from Render.
If it comes back with no index, which happens when it has no persistent disk, reindex each environment per `docs/meilisearch-reindex-runbook.md`: Beta as a one-off job, Production from its shell with `CONFIRM_PROD_SCRAPE=true node scripts/reindex-search-index.mjs production --apply`.
If the instance is up and only the key is wrong, see [Meilisearch keys](#meilisearch-keys) below.

### Verify

- `/api/ready` answers `200` with both fields `true`.
- `yarn security:smoke:production` from a laptop passes for Production. A push to `main` also runs `Post-Promotion Verify`, and a failed run can be re-run with `gh run rerun <run-id>`.
- For Beta, the next passing `Keep Alive` run closes the `beta-probe-failing` issue.
- Sentry shows no new events for the incident's signal.
- Record the cause, the live commit before and after, and the time to recover on the incident issue, then close it.

## 2. Bad Data Reached Students

### Read

First decide which kind of defect it is, using the definition in `AGENTS.md` ("Definition of done").

- **Serve-time:** the stored data is right but a DTO, visibility gate, sanitizer, or client rendering shows it wrongly. A code change fixes it on deploy.
- **Stored-data:** the stored value is wrong. A code change alone fixes nothing a student sees.
- **Search-only:** Mongo is right but the index serves an older snapshot, so a search hit or card disagrees with the detail page.

Then decide how it got there.
Production receives data only through `yarn promote:production`, which copies Beta, which copies Development, so a stored-data defect in Production is almost always present in Development and Beta as well.
Check Development first, because it is the environment you can read and fix.

### What recovery cannot do

- **A code rollback is not a data rollback.** Rolling back a deploy or reverting a promotion merge moves no document.
- **There is no restore point.** The promotion's staged swap rolls back a copy that fails before its verification passes, but once a promotion succeeds it drops the backups, so nothing of the previous Production state survives (#4091). The free Atlas cluster has no managed backups, and no off-cluster dump exists yet (#4148). `docs/data-refresh-runbook.md` ("Recovery") still says Production recovery restores a recorded Atlas restore point; no such point exists today.
- **Production-owned rows have no second copy.** `accounts` login rows, `research_plans`, `analytics_events`, and `admin_audit_events` are written by Production itself, so they cannot be recovered from Beta or Development if lost.

So recovery from bad data is forward: correct it at its source and promote again.

### Decide and act

1. **If the wrongness has a shape, contain it at serve time (any contributor prepares, maintainer merges).** A predicate that a DTO or the visibility gate can apply is a lane or serve bug, and a serve-time guard reaches students on deploy. Land it as a hotfix on `main` if waiting for the next promotion is too slow, as in section 1.
2. **Fix the stored data at its source (any contributor prepares; the promotion operator promotes).** Fix the lane in Development, never the row, per `AGENTS.md` ("Evidence, Lanes, And Operator Judgement"). Verify on Development with `yarn --cwd server research-entity:served-scoreboard --baseline <path.json>` and `yarn --cwd server journey:eval`. Then `yarn promote:beta`, then `yarn promote:production`, each with its dry run first, per `docs/data-refresh-runbook.md` ("One-Command Promotion"). A promotion replaces whole collections, so it carries every pending fix at once.
3. **If only search is wrong, reindex (maintainer).** Production: `CONFIRM_PROD_SCRAPE=true node scripts/reindex-search-index.mjs production --apply` from the Production Render shell, after its dry run. The rebuild swaps a complete new index in atomically, so students keep the previous index until it finishes.
4. **If one row is harmful now, for example it exposes personal contact data, act on that row and record the judgement (maintainer).** No admin route archives a research row in Production. The maintainer can archive the one row in Atlas and then reindex Production, whose rebuild drops archived rows. That write is overwritten by the next promotion, so record the refusal or archive in Development before that promotion runs; it is a containment, not a fix.
5. **If a promotion is the cause and it has not finished,** stop it. A failed apply rolls itself back. A Beta gate failure leaves Beta's Mongo holding the new copy while Beta search keeps the previous index; fix Development and run `yarn promote:beta` again, never patch Beta.

Never run `materialize` or a source-scoped scrape against Beta or Production to repair data: both hold no observations, and the CLI refuses the write.

### Verify

- Re-read the served surface, not a script's counter: open the affected pages on Production, and for a class of rows run the scoreboard against Development before promoting.
- `yarn security:smoke:production` passes after a Production reindex.
- Close the issue only when the served output is right in Production, or, for a stored-data fix, when Development is fixed and verified and the next promotion is the only remaining step (`AGENTS.md`, "Definition of done").

## 3. A Credential Leaked

### Read

- Name the credential, never its value. Assume it has been used.
- If it reached this public repository, an issue, a pull request, or an Actions log, rotating it is the fix. Editing or deleting the text does not remove it, because GitHub serves prior revisions and forks keep copies. Run `yarn security:secrets` to find any other copy in the tree.
- Find every place it is configured from [the deployment inventory](./deployment-inventory.md) before rotating, so no holder is left with a dead credential.

### Decide

For a credential that is being abused, revoke the old one first and accept the outage while the new one is set.
Otherwise create the new one, switch every holder, verify, and then revoke the old one, which avoids downtime.

### Act, per credential

All of these are maintainer actions unless marked otherwise.
Generate a new random secret in your own terminal, for example `openssl rand -base64 48`, and paste it straight into Render or the provider; never into a file, a chat, or an issue.

#### `SESSION_SECRET`

Set a new value on the leaking environment's web service and redeploy.
One `SESSION_SECRET` signs every cookie, and there is no overlap window, so rotation signs every user in that environment out (#4484 tracks a rotation that does not).
Accept that during an incident, because a leaked secret lets anyone mint a session for any account.
The new value must be at least 32 characters with at least 8 distinct characters, or boot refuses.

A single leaked session cookie is different: rotate nothing.
Every session carries the account's `sessionVersion`, and signing out increments it, which ends every session of that account on every device (`skills/auth-security/SKILL.md`, "Sessions are revocable and expire on the server").
Ask the account holder to sign in and sign out once.
No admin route can end another account's sessions yet (#4484), so if the holder cannot, the maintainer increments that one account's `sessionVersion` in Atlas.
Every session also expires 30 days after sign-in regardless.
`SMOKE_COOKIE` is such a cookie; sign that account out.

#### MongoDB users (`MONGODBURL` and the copy-pair URLs)

A connection string carries a database user's password.
In Atlas Database Access, create a new user scoped to the same single database, update every holder listed in the inventory (the web service, the operator service, `ylabs-scraper` for Development, and each operator's laptop), redeploy the Render services, and then delete the old user.
If the old user is being abused, delete it first instead, and expect `/api/ready` to report `"mongo":false` until every holder is updated.
Then confirm the Network Access list holds only Render's ranges and the operators' known entries.

#### Meilisearch keys

The search key and the write key are created and deleted from the Meilisearch private service's shell with the master key, which never leaves that service (`docs/meilisearch-reindex-runbook.md`, "Creating the keys").

1. Create the replacement key with the same actions and index scope.
2. Set it on its holders: `MEILISEARCH_SEARCH_API_KEY` on the web service; `MEILISEARCH_WRITE_API_KEY` on the operator service and, for Beta only, the Beta web service. Redeploy each web service.
3. Delete the leaked key by its `uid` with a `DELETE` request to `/keys/<uid>` from the same shell.
4. Each environment's keys are scoped to its own prefix (#4859), so a leaked `beta_*` key cannot read or write `prod_*` indexes and needs no Production change.

If `MEILI_MASTER_KEY` leaked, set a new one on the Meilisearch service and restart it.
Meilisearch derives every key from the master key, so every search and write key changes value too: recreate them, update every holder, and redeploy.
Search is unavailable between the restart and the web service redeploy.

#### `OPENAI_API_KEY`

Revoke the key in the OpenAI dashboard and create a new one.
Set it on every holder: each web service, each operator service, `ylabs-scraper`, and each laptop.
The key is also stored inside each index's embedder settings, so reindex every environment afterwards (Beta by one-off job, Production from its shell, Development with `yarn development:search:rebuild`), or Meilisearch keeps calling OpenAI with the revoked key.
Until then, search falls back to keyword results and the embedding breaker reports `embedding_breaker_open`.

#### `YALIES_API_KEY`

Rotate it with the Yalies service, set it on each web service, `ylabs-scraper`, and the laptops, and redeploy.
Confirm the old key is dead with `YALIES_OLD_API_KEY=... YALIES_NEW_API_KEY=... yarn security:verify-yalies-rotation`, typed in your own shell, which passes only when the old key is rejected and the new one accepted and never prints either.

#### Everything else

| Credential | Rotate at | Holders |
| ---------- | --------- | ------- |
| `RENDER_API_KEY` | Render account settings | The promotion operator's laptop |
| `SENTRY_DSN` | Sentry project client keys: create a new key, then disable the old one | Each web service; `VITE_SENTRY_DSN` is public by design and needs no rotation |
| `TAVILY_API_KEY`, `EXA_API_KEY`, `BRAVE_SEARCH_API_KEY`, `PARALLEL_API_KEY` | Each provider's dashboard | Operator laptops only |
| A GitHub token | GitHub settings | The person's own `gh` login; Actions holds no repository secret |

### Verify

- The old credential is rejected. For a Mongo user, a connection with the old string fails authentication. For a Meilisearch key, a request with it answers `401` or `403`. For OpenAI and Yalies, the provider rejects it.
- `/api/ready` answers `200` with both fields `true` in every environment that held the credential.
- The web service log shows no Meilisearch fallback warning, which would mean a scoped key is missing.
- Record on the incident issue which credential was rotated, when, and where it was set, never the value, and run `yarn security:identifiers:body <file>` on the text before posting it.
