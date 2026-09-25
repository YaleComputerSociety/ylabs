# Contributing to y/labs

This is the front door for a human contributor.

If this is your first week, read [docs/onboarding.md](docs/onboarding.md) first.
It sequences everything below into a day-by-day path and explains the mental model that makes the rest of the repository legible.

Otherwise, read in this order:

1. This file, for how work gets picked up and landed.
2. [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) for setup, architecture, routes, and troubleshooting.
3. [docs/glossary.md](docs/glossary.md) before reading an issue, because the vocabulary here is dense and the issue tracker assumes it.

[AGENTS.md](AGENTS.md) is the contract for coding agents and the canonical statement of the landing protocol.
It is not the place to start as a human: it is written to be loaded by a tool, and it is terse on purpose.
Where this file and `AGENTS.md` disagree on protocol, `AGENTS.md` wins and this file is the bug.

## Get running

Follow [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md#local-development-setup).
Two things are worth knowing before you start, because both have cost people an afternoon:

- `server/.env` needs `MONGODBURL`, the database the process talks to. Without it the server throws `MONGODBURL is required` on boot. The `DEVELOPMENT_`, `BETA_`, and `PRODUCTION_` prefixed URLs are for cross-environment copies only and no request path reads them.
- Ask a maintainer for Development MongoDB credentials. There is no local-only data path, so you cannot get a populated app without them.

Sanity check that you are actually up:

```bash
yarn meili:health     # {"status":"available"}
yarn dev:server       # then http://localhost:4000/api/dev-login
yarn dev:client       # then http://localhost:3000
```

## Pick something to work on

Substantive work needs a GitHub issue, opened before the pull request and linked from it with `Closes #<n>`.
Trivial work (a typo, a comment, a small doc tweak) does not.
When unsure, open one.

If you are new, prefer **serve-time** work: client rendering, a DTO, a route, a visibility gate.
It is verifiable on your own machine and it reaches students on deploy, so merging it finishes it.

Avoid **stored-data** work until you have landed a few changes.
A scraper, materializer, repair script, or index-shape change is not done when it merges, because the corpus still holds the old values.
It is done when the data operation has run against Development and you have verified the result by re-reading the served output.
Data work also needs network access to Yale sources, which is why the tracker labels it `fleet:data`.

## Make the change

Work in a dedicated git worktree, never in the primary checkout:

```bash
scripts/new-agent-worktree.sh fix/short-description
```

The helper branches from `beta`, installs dependencies in isolation, and reserves a free client dev-server port.
The primary checkout at `~/Personal/ylabs` is for review and integration only.
Two people or agents sharing one checkout will switch branches under each other and serve the wrong code.
Do not symlink `node_modules` between worktrees while running dev servers, because they share Vite's `node_modules/.vite` cache and clobber each other.

While writing the change:

- Follow the existing local pattern before adding an abstraction.
- The server is layered `routes -> controllers -> services -> models`. `skills/contributing/SKILL.md` has the recipe for a new endpoint, a new page, and a schema change, including the companion changes each one needs.
- Fix the upstream cause rather than the local symptom.
- Never use em dashes. Put each full sentence on its own line in long Markdown files.
- Do not introduce deprecated vocabulary. `docs/glossary.md` has the table, and a client test guards the copy half.

## Verify

Run `yarn verify:fast` at minimum before pushing:

```bash
yarn verify:fast   # format:check, lint, tsc on both projects
```

`format:check` is CI's first step, takes about three seconds, and has been the sole cause of otherwise-green pull requests failing.

Then the suites for whatever you touched:

```bash
yarn test          # both suites, server then client
yarn test:server   # server only
yarn test:client   # client only
```

`yarn test` runs the two suites **sequentially** and that is deliberate: run in parallel they contend for the same Development data and fabricate failures that are not real.

`yarn verify` runs the full CI sequence locally.
`yarn serve:fresh` does a clean install, build, and serve, which is a smoke check rather than a test.

The suites are big: 675 server files (about 10,911 tests) and 104 client files (about 1,141 tests).
On a loaded laptop that size turns into failures that are not real, so learn to recognise them before you go debugging one.

**A local timeout is usually starvation, not a defect.**
Measured on a loaded machine: three server tests failed and all three were timeouts against the in-memory MongoDB (`Instance failed to start within 120000ms`, `connection <monitor> to 127.0.0.1:... timed out`), in files that each took over 575 seconds. On the client side, one test failed on a `cleanup()` hook timing out alongside ten `failed to start forks worker` errors; the same file passed 7/7 in 5.7 seconds on its own.

So before believing any local failure, re-run the single file:

```bash
cd server && TMPDIR=/tmp npx vitest run src/path/to/file.test.ts
cd client && TMPDIR=/tmp npx vitest run src/path/to/file.test.tsx
```

If it passes alone, it was starvation.
CI on Linux is the authority on whether a test really fails.
Close other work before running a full suite, and prefer running only the suite you touched.

None of the above verifies served output.
When a change is meant to improve what students see, re-read the served surface with `yarn --cwd server research-entity:served-scoreboard`.
An exit code is not verification and neither is a script's own counter.

## Open the pull request

- Base it on `beta`, not `main`. `main` is a stale squash snapshot.
- Title it as a Conventional Commit: `type(scope): summary`, imperative, lower case, no trailing period, under about 70 characters. Allowed types are `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `chore`.
- Link the issue with `Closes #<n>`.
- If the change depends on a data operation, say so in the body and name the operation.
- Never add an agent as a co-author.

**Write the body by predicate.**
This repository is public.
Never put a person's name, netid, email local part, or row slug next to a status or a defect judgement.
Write "the 12 rows where `manuallyLockedFields` contains `activeAtYaleCache`" rather than naming the rows.
Editing a body later does not remove the text, because GitHub serves every prior revision to anyone without an account, so the first draft is the only draft that matters.
Scan it before it exists anywhere public:

```bash
yarn security:identifiers:body <file>
```

The `Person identifier scan` check is advisory and cannot unpublish text, so a red run means "read the finding and rewrite now", never "wait for green".
See [docs/person-identifier-convention.md](docs/person-identifier-convention.md).

## Merge

Merge when CI is green and the pull request is mergeable on its current head.

`beta` is protected by the `require CI on beta` ruleset, which requires `test-and-build` and `student-journey-smoke` to pass, requires one approving review, and blocks force pushes.
`Person identifier scan` is deliberately not required, for the reason above, and `release-hold` applies only to pull requests into `main`.
Protection is configured as rulesets rather than classic branch protection, so inspect it with `gh api repos/YaleComputerSociety/ylabs/rulesets`; the `branches/beta/protection` endpoint reports 404 here and does not mean what it appears to mean.

```bash
gh pr merge <n> --squash --delete-branch
```

**Without the Admin role you cannot merge your own pull request**, because of the one-approval rule. Ask for a review.

The Admin role bypasses the ruleset unconditionally, which is what `--admin` uses.
It exists because a sole maintainer cannot approve their own pull request, and because the release watchdog's bot flow depends on it.
If you have it, use it for the review requirement and never to get past a failing `test-and-build`: fix the check, or report the blocker.

Confirm the linked issue auto-closed, then clean up:

```bash
git worktree remove <path>
git worktree prune
```

A stored-data fix does not close its issue on merge.
Close it once Development is fixed and verified.
Do not open an issue to track a promotion: one promotion replaces fifteen whole collections and delivers every pending fix together.

## Where to look things up

| Question | Read |
| --- | --- |
| I am new, where do I start? | `docs/onboarding.md` |
| What does this term mean? | `docs/glossary.md` |
| How do I set up, and what are the routes and commands? | `DEVELOPER_GUIDE.md` |
| Repo map, stack, layering, import order | `skills/architecture/SKILL.md` |
| What is the product trying to be? | `skills/product-model/SKILL.md`, `docs/product-context.md` |
| How do I add an endpoint, page, or schema field? | `skills/contributing/SKILL.md` |
| How does the scraper pipeline work? | `skills/scrapers/SKILL.md`, `docs/research-data-pipeline.md` |
| Search, indexes, browse ranking | `skills/search-data/SKILL.md` |
| Auth, sessions, CAS, rate limits | `skills/auth-security/SKILL.md` |
| UI polish and design tokens | `skills/frontend-polish/SKILL.md`, `client/DESIGN.md` |
| What counts as publishable to students? | `docs/student-ready-definition.md` |
| Why was it built this way? | `docs/decisions.md` |
| How does a release reach production? | `docs/release-process.md` |
| Wrapping up a change | `skills/finishing-work/SKILL.md` |

Source files, tests, `AGENTS.md`, and `docs/*.md` are canonical.
If a document contradicts the code, the code is right and the document is a bug worth fixing in the same pull request.
