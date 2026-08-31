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

## Promoting beta to main

`main` does not yet share history with `beta`.
An earlier promotion was squash-merged, which severed the two branches, so the merge base is ancient and every intentional deletion on `beta` reads as a delete-versus-modify conflict.
`main` currently sits 3 ahead and over 1300 behind, and a direct promotion pull request conflicts on about 485 paths that are not real conflicts.

So the **first** promotion needs a one-time reconciliation, not a plain pull request:

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

Once that has landed, `main` is an ancestor of `beta` and every later promotion is an ordinary pull request:

1. Open a pull request from `beta` into `main`.
2. Verify the change set on staging.
3. Mark the pull request ready for review and merge it.

Merge promotions with a **merge commit**.
Never squash a branch-to-branch promotion.
Squashing drops the second parent, re-severs the histories, and reproduces the phantom conflicts on the next promotion.
The `protect main (production)` ruleset restricts `main` to merge commits so this cannot happen by accident.

Squashing individual feature pull requests into `beta` is fine and remains the norm.
The rule applies only to promotions between long-lived branches.

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

## Verifying a release

`Production Security Smoke` runs on a schedule and on demand against production.
It verifies live hardening headers and current API routes.

`Post-Promotion Verify` runs on every push to `main`.
It polls `GET /api/deployment` until production reports the promoted commit, then runs the smoke with `--expect-commit` against it.
If production never serves the commit inside the deploy window, the run fails, so a promotion that silently failed to deploy is visible rather than assumed good.

The deployed commit is **not** in the public config payload.
`GET /api/config` exposes only a coarse `provider`, and `scripts/security-preflight.test.mjs` forbids the commit there by source literal.
The commit and branch live on `GET /api/deployment`, which answers only to a caller presenting `X-Deployment-Token` matching `DEPLOYMENT_FINGERPRINT_TOKEN`, compared timing-safely.
Any other caller gets `404`, not `401`, so the route does not advertise itself.
The route fails closed: with no token configured on the service, every request gets `404`.

Set `DEPLOYMENT_FINGERPRINT_TOKEN` in the Render `ylabs-prod` environment group and as the `DEPLOYMENT_FINGERPRINT_TOKEN` GitHub Actions secret.
Both must hold the same value, or post-promotion verification fails closed.

## Rolling back

To roll back, prefer the Render dashboard rollback to the previous deploy.
Otherwise revert the promotion merge on `main` with `git revert -m 1 <merge-commit>` through a pull request, and Render redeploys automatically.
