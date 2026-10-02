---
name: architecture
description: Use when an agent needs the y/labs repo map, tech stack, commands, route inventory, service inventory, naming conventions, environments, external integrations, or general architecture context before making or explaining a code change.
---

# Architecture

y/labs is a monorepo with a React client and an Express server communicating over REST.
MongoDB Atlas is the primary data store.
Meilisearch handles search with semantic plus keyword support.
Yale CAS provides SSO authentication.

```
React (Vite) -> Express (Passport.js) -> MongoDB Atlas + Meilisearch
                    |
            External APIs: Yale CAS, Yalies, CourseTable, OpenAI via Meilisearch embedder
```

The server follows **Routes -> Middleware -> Controllers -> Services -> Models**.
Routes define endpoints and middleware chains.
Controllers extract request data, delegate to services, and format responses.
Services contain business logic, DB operations, and external API calls.
Models are Mongoose schemas with indexes.

### Import order

Read top to bottom as "may import".
`scripts/` sits at the top because an operator entrypoint composes every layer below it.

```
scripts -> routes -> controllers -> services -> scrapers -> middleware -> utils -> db -> models
```

`models/` and `db/` are the bottom, and that is the half currently enforced: `no-restricted-imports` in `eslint.config.js` fails a build where either imports a higher layer.
A stored enum is part of the storage contract rather than of whichever lane writes it, so it belongs in `models/storedVocabularies.ts`; the interpreting layer re-exports it so the prose explaining how a value is chosen stays beside the logic that chooses it.

Two known violations of the order above are measured but not yet enforced, because both need a file move rather than a rule.
Do not add a rule for either without doing the move first, and do not "fix" them with an exception list, which is how a boundary rule dies.

- **26 edges reach up into `scripts/`** from `services/`, `scrapers/`, `utils/` and `index.ts`, because 16 files there are load-bearing libraries rather than CLIs (the `*Core.ts` suffix is the tell, plus `scriptWriteGuards.ts`, `operatorDatabaseEnvironment.ts`, `sweepStageFlags.ts`, `gateRefreshScheduler.ts`). Extracting them rewrites imports in about 256 files, dominated by the 212 operator scripts that call `assertScriptApplyAllowed`. Worth doing as a dedicated change when the tree is quiet, not alongside feature work.
- **6 edges reach from `utils/` into `scrapers/utils/`** for generic text and name helpers (`htmlText`, `personNameCasing`, `profilePublicityRegions`, `researchAreaCanonicalization`, `scraperHelpers`, `prompts/index`). These have 6 to 464 importers each, and the right fix may be to move the consumer rather than the helper.

Cycles are not the problem here and a cycle rule is not worth adding: the whole tree measured 3 in 1,616 files on 2026-09-24.

## Stack

| Layer           | Technology                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| Client          | React 19, TypeScript 5.3, Vite 6.3, React Router v7, MUI v7, TailwindCSS v3                                 |
| Server          | Express 4, TypeScript 5.3, Passport.js 0.5, Mongoose 8                                                      |
| Search          | Meilisearch 0.57 with keyword search plus OpenAI `text-embedding-3-small` semantic search where appropriate |
| Database        | MongoDB Atlas with separate Development, Beta, and Production databases                                     |
| Package Manager | Yarn 4 via Corepack                                                                                         |
| Tooling         | concurrently, tsx, cross-env                                                                                |

## Repo map

| Path                      | Purpose                                                                  |
| ------------------------- | ------------------------------------------------------------------------ |
| `client/`                 | React frontend, Vite dev server on port 3000.                            |
| `server/`                 | Express backend, default port 4000.                                      |
| `server/src/routes/`      | Express routers aggregated in `routes/index.ts`.                         |
| `server/src/controllers/` | Request handlers.                                                        |
| `server/src/services/`    | Business logic and external integrations.                                |
| `server/src/models/`      | Mongoose schemas and indexes.                                            |
| `server/src/scrapers/`    | Evidence-first scraper infrastructure.                                   |
| `server/src/middleware/`  | Auth, validation, security, and error handling middleware.               |
| `server/src/db/`          | Multi-mode database connections.                                         |
| `server/src/utils/`       | Shared utilities, errors, environment helpers, Meili client, SSRF guard. |
| `docs/`                   | Durable product, architecture, and workflow documentation.               |
| `skills/`                 | On-demand agent skills.                                                  |

## Commands

| Command                                                          | Effect                                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `bash scripts/install-all.sh`                                    | Install deps in root, server, and client, also on a fresh checkout.                          |
| `yarn dev:client`                                                | Vite dev server on port 3000.                                                                |
| `yarn dev:server`                                                | Express with tsx watch on port 4000.                                                         |
| `yarn build`                                                     | Corepack enable, install all deps, build server, build client.                               |
| `yarn start`                                                     | Run both servers in production.                                                              |
| `yarn clean:all`                                                 | Remove all `node_modules` directories.                                                       |
| `yarn --cwd client test`                                         | Client Vitest watch mode.                                                                    |
| `yarn --cwd client test:ci`                                      | Client Vitest once.                                                                          |
| `yarn --cwd server test`                                         | Server Vitest suite.                                                                         |
| `yarn --cwd server scrape <cmd>`                                 | Scraper CLI.                                                                                 |
| `yarn --cwd server gates:refresh`                                | Regenerate canonical gate scorecards and store them (`docs/gate-scorecard-board.md`).        |
| `yarn --cwd server model-refactor:inventory --environment <env>` | Run the read-only research-model Phase 0 inventory.                                          |
| `yarn model-refactor:inventory:beta`                             | Run aggregate-only Beta inventory through the external read-only profile.                    |
| `yarn model-refactor:inventory:production-copy`                  | Run aggregate-only ProductionCopy inventory through its separate external read-only profile. |
| `yarn model-refactor:inventory:validate-evidence`                | Validate a private inventory against its versioned recovery manifest.                        |
| `yarn --cwd server model-refactor:identity-plan`                 | Produce the bounded read-only Phase 2 account, person, role, and quarantine plan.            |


Server test timeouts are owned by `server/vitest.config.ts`: `testTimeout` 30000 ms and `hookTimeout` 180000 ms.
The hook budget is derived in `server/src/test/testTimeBudgets.ts` as the in-memory MongoDB launch budget (120000 ms, applied to every launch by `server/src/test/mongoMemoryLaunchBudget.ts`) plus 60000 ms for the connect and index build that follow it, so the two cannot drift apart again (#3734).
Before that, `hookTimeout` was 60000 ms, so vitest cut a `beforeAll` off at half the launch budget and a slow launch failed as `Hook timed out in 60000ms`.
The hook budget is deliberately long because over a hundred suites start a `MongoMemoryReplSet` or `MongoMemoryServer` in `beforeAll` and stop it in `afterAll`, and both outlast vitest's 10000 ms default under parallel load.
Do not add a per-hook timeout, because the config already covers it, and `server/src/scripts/__tests__/vitestHookBudget.test.ts` pins both the config value and its relation to the launch budget.
An explicit hook argument wins over the config, so the guard parses every hook call in the `server/src` test and spec files and fails on an argument at or below the config value, on one it cannot resolve to a numeric literal, and on a config value that does not exceed the launch budget.
Only a setup genuinely slower than 180000 ms may carry its own larger argument.
Raising `hookTimeout` also raises the guard's threshold, so raise the budget and delete the hook arguments it overtakes in the same change.
This applies to hooks only.
`testTimeout` stays at 30000 ms, so a slow `it` still needs its own argument.

A local server run uses at most 4 vitest workers (`server/src/test/localWorkerBudget.ts`), because each integration suite starts its own `mongod` and vitest's default of one worker per spare core put about 39 of them on a 14-core laptop when three runs overlapped, which is the normal state with several worktrees or gate runs testing at once.
Set `YLABS_VITEST_MAX_WORKERS=<n>` to override it, or pass `--maxWorkers` on the command line.
CI (`CI` set) keeps vitest's default, so CI timing is unchanged.

The server suite is fenced off from the local environment by `server/src/test/hermeticEnvironment.ts`, registered as the only `setupFiles` entry.
It neutralises `dotenv.config()` and `dotenv/config`, deletes every name `server/.env` and `server/.env.example` declare except the ones the runner and the operating system own (`NODE_ENV`, `CI`, `PATH`, `HOME`, `TMPDIR`, `TZ`), and replaces `utils/meiliClient` with a client that refuses every call.
A test run therefore sees the environment CI sees whether or not a `server/.env` is present, which is the point: before the fence, `browseSchoolFacet()` in one suite asserted against the live Yale school list, and four suites upserted synthetic fixture documents into the search index the local dev stack serves (#2966).
A suite that needs a search index declares its own `vi.mock('../../utils/meiliClient', ...)`, and a suite that needs a database starts its own `mongodb-memory-server`.
A suite that spawns a real CLI builds the child environment with `hermeticChildEnvironment({ MONGODBURL: <memory uri> })` from the same file, never with `{ ...process.env }`.
A module mock stops at the process boundary and a spawned script re-runs `dotenv.config()` for itself, so the child is fenced by its environment alone: unroutable backend values it cannot re-resolve, because `dotenv` only fills a name that is absent, plus the `YLABS_SKIP_LOCAL_DOTENV=true` the scripts honour.
Never read a connection string or a feature flag from `process.env` in a test, and never re-load an env file inside one.

Each server test run writes its temp files into its own directory, `ylabs-vitest-<pid>-<random>` under the system temp directory (#3735).
`server/src/test/vitestGlobalSetup.ts` creates it, points `TMPDIR` at it before any worker starts, and removes it recursively at teardown, so a `mkdtemp(os.tmpdir(), ...)` a suite never removes, and the `mongo-mem-*` directory `mongodb-memory-server` deliberately keeps after a failed launch, both go with the run.
The same setup first reaps what a killed run left behind: a `ylabs-vitest-*` root whose owning process is gone, and a `mongo-mem-*` directory older than an hour that no live `mongod` references (`server/src/test/runTempRoot.ts`).
A suite therefore needs no cleanup of its own for temp residue, although removing what it creates is still the better habit.
The root-level `node --test` suites under `scripts/` have no such runner hook, so each one removes its own temp directories in an `after` hook.
That root makes `os.tmpdir()` about 75 bytes deep on macOS, which leaves too little room for a Unix socket name under the 104-byte `sun_path` limit, and libuv truncates a longer path silently rather than failing (#4117).
So build any socket path with `brokerSocketPath` from `server/src/scrapers/utils/hostSlotBroker.ts`, which falls back to `/tmp` when the requested directory is too deep, and never with `path.join(os.tmpdir(), ...)`.

Dev login bypass: `GET http://localhost:4000/api/dev-login` creates a test undergraduate session.
It answers `404` unless the caller is loopback, as does the `LOCAL_AUTH_BYPASS` user; see `skills/auth-security/SKILL.md`.
Pass `?userType=admin|professor|faculty|graduate|unknown` for another dev account.
`?userType=admin` mints a local bootstrap `AdminGrant`, so admin authority comes from a grant rather than `userType`.

## Server startup and shutdown

`server/src/index.ts` is the only entry point the deployed process runs, and `tsup` bundles every module it reaches into `build/index.js`.
Boot connects MongoDB with `initializeConnections()`, warms the controlled-vocabulary headings, then listens and starts the keep-alive and the two in-process schedulers.
A failed connect is deliberately fatal: it logs and exits 1 so the platform restarts the instance, which is the only correct answer to a database the process cannot reach.
Nothing on the boot path may disconnect the shared MongoDB connection, because every request serves from it.
That is not a style rule.
`source:health` used to tear it down on every deploy, because its `process.argv[1]` direct-run guard is true inside the bundle, where the module's own path is the bundle's path (#4186).
A module that needs to tell a direct CLI run from an import asks `isDirectScriptInvocation(import.meta.url, '<module name>')` in `server/src/scripts/directScriptInvocation.ts`, which also requires the entry file to carry the script's own name, so the bundle can never satisfy it.
Any other module the server entry reaches owes the same, and `server/src/scripts/__tests__/directScriptInvocation.test.ts` pins the bundle shape it has to survive: with the entry argument and the module's own path both `build/index.js`, the answer is false.
`server/src/scripts/__tests__/bundledScriptCliBody.test.ts` proves the consequence end to end: it bundles the script under both names with the real bundler, and only the copy named after the script runs its CLI body.
The keep-alive is the only thing that heals a connection no request has touched, so `mongoKeepAliveTick` reconnects a connection that is disconnected or was never established instead of pinging a `connection.db` that is undefined in exactly that state.

Shutdown is the mirror of that, and it lives in `server/src/serverShutdown.ts` rather than in the entry point so it can be tested.
The hosting platform stops an instance by sending `SIGTERM` and killing it after a shutdown delay that defaults to 30 seconds, and Node's default action for `SIGTERM` is to exit at once, so before #4189 every request in flight during a deploy was cut with an empty reply.
`registerGracefulShutdown` now stops accepting new connections, closes idle keep-alive sockets so no browser holds the drain open, waits up to `DRAIN_TIMEOUT_MS` (20 seconds, deliberately inside the 30 second kill timeout) for the requests already in flight, disconnects MongoDB, and exits 0, or 1 when the window expired and it had to cut what was left.
A later `SIGTERM` or `SIGINT` during the drain joins the shutdown already running rather than starting a second one that would exit early.
Lengthening the drain window means raising the platform's shutdown delay first, because a drain the platform interrupts is the same defect under another name.
The timer stops come before the disconnect, and that order is load-bearing: the keep-alive pass reconnects a connection it finds down, so a shutdown that disconnected first would have the connection re-opened under it.

## Request-path database waits

The serving process and an operator script want opposite things from the driver, so `server/src/db/connections.ts` gives them different budgets.
`mongoOptions` is the serving budget: 5 s to select a server, a 5 s Mongoose command buffer, and a 20 s socket ceiling.
`scriptMongoConnectOptions` restores the long ones, 30 s selection and no socket timeout, because a sweep that starts during a replica-set election should wait for it rather than abort.
`initializeConnections()` connects with the script budget by default, because nearly every caller is an operator entry point, and `server/src/index.ts` is the one caller that passes `mongoOptions`.
`triggerReconnect` reuses whichever budget the process connected with, so a reconnect never moves a script onto the serving budget or the server onto the script one.
The numbers come from measurement rather than taste: a reachable database answers a detail request in under 10 ms, while the driver's 30 s and 60 s defaults turned an unreachable or hung one into a 30 s to 63 s wait that ended in a generic 500 (#4188).
The socket ceiling stays above the slowest request this server makes and under the hosting platform's own request timeout.
Any single in-process operation that legitimately needs longer than the socket ceiling belongs in a script or a child process, which is where the heavy audits already run.

A request that could not reach the database answers `503` with a `Retry-After`, never `500`, and `isMongoUnavailableError` is the one predicate that decides it.
Every arm except a lost topology is still reported to error tracking, because a socket timeout against a reachable database is a slow query that needs fixing rather than an outage.
Selection timeouts, socket timeouts, a closed client, and a Mongoose buffering timeout are all the same condition under different names, so adding a newly observed name means adding it there rather than at a call site.
`triggerReconnect` stays scoped to a lost topology, because the driver recovers from the others on its own and reconnecting under them would close the pool the next request is about to use.
On the client, `isRetryableUnavailableError` in `client/src/utils/clientErrorMessage.ts` turns that `503` into the existing limited-search notice with its retry action, so an outage never renders as "no research matches".

## TypeScript

Server: target ES2022, module NodeNext, moduleResolution NodeNext, strict true, output to `build/`.
Built with `tsup`; dev mode uses `tsx watch`.

Client: target ES5, module ESNext, JSX `react-jsx`, strict true, noEmit true.

## Routes

All application routes mount under `/api` in `app.ts`.
Passport auth routes mount separately via `passportRoutes` before the main routes.

| Prefix            | File                | Auth                                                |
| ----------------- | ------------------- | --------------------------------------------------- |
| `/research`       | `researchGroups.ts` | Varies, with public search and detail.              |
| `/programs`       | `programs.ts`       | Varies; current Programs and Fellowships surface.   |
| `/fellowships`    | `fellowships.ts`    | Auth; legacy, with `/api/programs` as successor.    |
| `/users`          | `users.ts`          | Auth required.                                      |
| `/profiles`       | `profiles.ts`       | Varies.                                             |
| `/analytics`      | `analytics.ts`      | Admin.                                              |
| `/config`         | `config.ts`         | Public.                                             |
| `/admin`          | `admin.ts`          | Admin.                                              |
| `/seed`           | `seed.ts`           | Local development runtime only.                     |

## Key services

| Service                                                                                                                                     | Responsibility                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `researchEntityDto.ts` / `researchEntityQuality.ts`                                                                                         | Public ResearchEntity DTO shaping and quality scoring.               |
| `researchEntityMembershipAccessor.ts`                                                                                                       | Canonical roster reads (`getResearchEntityRoster`/`getResearchEntityRosterByEntityId`). |
| `researcherPersonNameResolver.ts`                                                                                                           | Keystone `resolveResearcherIdForPersonName`: resolves a scraped person name (netid or surname-plus-given-name) to a canonical `Researcher`. |
| `researchEntityBrowseRank.ts` / `researchEntityBrowseRankService.ts`                                                                        | Best-first browse ranking scorer and persist plus Meili resync.      |
| `researchEntitySearchIndexService.ts`                                                                                                       | Meilisearch index sync and query.                                    |
| `meiliSyncService.ts`                                                                                                                       | Syncs ResearchEntity upserts into the Meilisearch index.             |
| `signalService.ts`                                                                                                                          | Source-backed access read layer.                                     |
| `adminOperatorBoardService.ts` / `adminAccessReviewService.ts` / `adminGrantService.ts`                                                     | Operator board, access review, and admin grants.                     |
| `sourceHealthService.ts` / `scholarlyActivityAuditService.ts` / `paperQualityService.ts`                                                    | Scraper/source health and paper-quality scoring.                     |
| `studentVisibilityTier.ts` / `studentVisibilityGateService.ts` / `visibilityRepairQueueService.ts`                                          | Student visibility tiering and repair queue.                         |
| `programClassifier.ts`                                                                                                                      | Program classification.                                              |
| `yaliesService.ts` / `courseTableService.ts`                                                                                               | External integrations.                                               |

## Naming conventions

| Element          | Convention                                                |
| ---------------- | --------------------------------------------------------- |
| Services         | camelCase plus `Service`, e.g. `fellowshipService.ts`.    |
| Models           | PascalCase exports, e.g. `Account`, `Researcher`, `Fellowship`. |
| Controllers      | camelCase descriptive names.                              |
| Routes           | Resource-based files.                                     |
| DB fields        | camelCase.                                                |
| Enums            | PascalCase.                                               |
| React components | PascalCase.                                               |
| React hooks      | camelCase with `use` prefix.                              |
| Contexts         | PascalCase plus `Context`.                                |

## Environments

Code flows Local -> Beta -> Prod.
Beta is the staging gate.

| Environment | Hosting                           | `MEILISEARCH_INDEX_PREFIX` |
| ----------- | --------------------------------- | -------------------------- |
| Development | Atlas MongoDB + local Meilisearch | unset                      |
| Beta        | Render `ylabs-gr4v.onrender.com`  | `beta`                     |
| Prod        | Render `yalelabs.onrender.com`    | `prod`                     |

Scraper fetches run from the local machine and need no Yale VPN or campus wifi; only private-address hosts such as `ensemble.yale.edu` are Yale-network-only.
Development is the only environment scrapers write to: every sweep fetches and materializes there.
Beta receives the accepted Development dataset through `beta:refresh-from-development`, Production receives accepted Beta through `production:promote-beta-copy`, and each target then re-gates and reindexes from its Render shell.
Those copies and the Beta-to-Development mirror are the only allowed database pairs, listed by their real database names (`Development`, `Beta`, `Prod`) in `DATABASE_COPY_PAIRS` in `server/src/scripts/databaseCopyPairs.ts`; each copy script refuses any other source or target, and `yarn --cwd server database:verify-names` runs the same check from a shell (#4150).
The scrape CLI refuses a `run` or `materialize` write against Beta or Production.
Use `docs/data-refresh-runbook.md` for the canonical commands.

## External integrations

| Service        | Purpose                                                | Location                                       |
| -------------- | ------------------------------------------------------ | ---------------------------------------------- |
| Yale CAS SSO   | Authentication                                         | `passport.ts`                                  |
| Yalies API     | Student, faculty and staff lookup at login             | `yaliesService.ts`                             |
| CourseTable    | Professor course data                                  | `courseTableService.ts`                        |
| Meilisearch    | Hybrid search                                          | `meiliClient.ts`                               |
| OpenAI         | Embeddings via Meilisearch embedder and LLM extractors | Meilisearch/index setup and scraper extractors |
