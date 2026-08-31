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

1. Open a pull request from `beta` into `main`.
2. Verify the change set on staging.
3. Mark the pull request ready for review and merge it.

Merge promotions with a **merge commit**.
Never squash a branch-to-branch promotion.
Squashing severs `main` from `beta` history, which makes the merge base ancient and turns every intentional deletion on `beta` into a delete-versus-modify conflict.
This already happened once: `main` drifted to 1304 commits behind and a direct promotion pull request conflicted on 485 paths that were not real conflicts.
Recovering required a branch based on `beta` that merged `main` with `-s ours` to keep `beta`'s tree while recording `main` as a second parent.

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

## Verifying and rolling back

`Production Security Smoke` runs on a schedule and on demand against production.
It verifies live hardening headers and current API routes.

It cannot currently verify **which commit** is live.
The smoke script's `--expect-commit` check reads `deployment.gitCommit` from `GET /api/config`, but the public config deliberately exposes only a coarse `provider` field, and `scripts/security-preflight.test.mjs` forbids the commit by source literal.
So a non-empty `expect_commit` always fails with a missing-fingerprint reason.
Until that is resolved, treat the smoke as a surface health check rather than a release verification, and confirm the deployed commit in the Render dashboard.

To roll back, prefer the Render dashboard rollback to the previous deploy.
Otherwise revert the promotion merge on `main` with `git revert -m 1 <merge-commit>` through a pull request, and Render redeploys automatically.
