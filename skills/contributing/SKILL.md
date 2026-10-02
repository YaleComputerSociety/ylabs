---
name: contributing
description: Use when adding a new API endpoint, a new client page/route, or modifying a Mongoose schema in this repo. Covers the layered server pattern (Routes -> Middleware -> Controllers -> Services -> Models), where each piece lives, and the required companion changes (types, migrations, search config, auth/validation).
---

# Contributing: endpoints, pages, schema

Follow existing local patterns before adding abstractions. Default to making the requested change after inspecting the code; ask questions only when the answer cannot be inferred from the repo and a wrong assumption would create meaningful rework.

The server follows a layered architecture: **Routes -> Middleware -> Controllers -> Services -> Models**. Routes define endpoints and compose middleware chains. Controllers extract request data, delegate to services, and format responses. Services contain all business logic, DB operations, and external API calls. Models are Mongoose schemas with indexes.

## Adding a new endpoint

1. **Route** in `server/src/routes/<resource>.ts` - define HTTP method, path, and the middleware chain.
2. **Controller** in `server/src/controllers/<resource>Controller.ts` - extract request data, call the service, format the response.
3. **Service** in `server/src/services/<resource>Service.ts` - business logic, DB operations.
4. Apply **auth middleware** (`isAuthenticated`, `isProfessor`, `isAdmin`, etc.) and **validation middleware** in the route.
5. Add tests where risk justifies them.

Auth middleware (`server/src/middleware/auth.ts`): `isAuthenticated`, `isAdmin`, `isProfessor` (professor/faculty/admin), `isTrustworthy`, and `isConfirmed`.

Validation middleware: `validateObjectId(paramName?)`, `validateNetid(paramName?)`, `requireFields(fields[])`, `validatePagination()`, `validateQuery(allowedParams[])`.

The `asyncHandler` wrapper catches promise rejections in route handlers.

Never answer a 500 from a controller or route `catch`.
The global `errorHandler` is the only place that sanitizes a server error body and reports it to error tracking, so a handler that writes its own 500 hides the failure.
Answer only the domain-specific 4xx cases the handler owns, then forward everything else with `next(error)`, or let `asyncHandler` forward the rejection.
Throw `BadRequestError` for invalid input so it answers 400 with its bounded message; the global handler already maps mongoose validation errors to 400, a duplicate key to 409, and `NotFoundError` to 404.
`server/src/__tests__/handledServerErrorsReachErrorTracking.test.ts` pins this for every route family.

## Adding a new page

1. **Page component** in `client/src/pages/<page>.tsx`.
2. **Route** in `client/src/App.tsx`, wrapped with the appropriate guard (`PrivateRoute`, `AdminRoute`, `UnprivateRoute`).
3. Reuse existing providers/components where appropriate.

Iterate on canonical product surfaces instead of creating student-facing versioned routes. Use existing routes such as `/research`, or a non-URL feature flag when rollout safety is needed; do not add `/v1`, `/v2`, `/research-v2`, or similar route names for normal design iteration.

## Modifying a schema

1. **Mongoose schema** in `server/src/models/<model>.ts`.
2. **TypeScript interfaces** in `client/src/types/`.
3. **Backfill script** in `server/src/scripts/` if existing data needs transformation, wired as a `package.json` command and dry-run by default.
4. If the model affects Research search, update the relevant **Meilisearch** rebuild/index config and the release gate.
5. **An added `schema.index(...)` does not build itself.** `db/connections.ts` sets `autoIndex: false` and `autoCreate: false`, so connecting is not a schema-mutating act (#2233): shipping an index no longer builds it on the next boot. That holds for every process, not only the API: a CLI or script connects through `connectScriptMongo` or `createScriptMongoConnection` from the same module, and `db/__tests__/everyEntryPointConnectsWithMongoOptions.test.ts` fails on a direct `mongoose.connect`, `createConnection`, or global `autoIndex`/`autoCreate` setting anywhere else (#3932). Build it deliberately with `yarn --cwd server db:build-indexes` (dry-run, reports what is missing) then `--apply`. The command is additive and never drops, so **removing** an index is still a reviewed migration with its own issue. Boot logs the drift, so a forgotten build is loud rather than a silent slow query. Run the build against Development only: Beta and Production receive indexes through promotion, which copies them from the source collection.
6. **Narrowing or widening an existing index needs a drop first.** MongoDB allows one text index per collection and refuses a changed spec under the same name, so a widened index fails to build. The build command reports the failure and leaves the old index alone rather than dropping it for you. Measured on Development: two declared indexes had been failing to build silently for the database's whole life under `autoIndex: true`, one a unique index blocked by a duplicate value and one a text index blocked by that one-per-collection rule.

## Adding a script that writes

A new entry script anywhere under `server/src/scripts` that calls `assertScriptApplyAllowed` or parses an `--apply` flag must be one of three things, or CI fails (`server/src/scripts/__tests__/humanRunWriteScriptGuard.test.ts`, #3524).

1. A sweep stage: register its npm command in `DEVELOPMENT_POST_RUN_STAGE_DEFINITIONS` (or `FELLOWSHIP_POST_RUN_STAGE_DEFINITIONS` for a fellowship writer) in `runScraperSweep.ts`, so it runs every sweep rather than when someone remembers.
2. A lane or projection change instead of a script, when the correction has a shape a predicate can express.
3. A standing operator tool, added to `OPERATOR_TOOLS` with its reason, only when it records a judgement about one row or operates infrastructure.

A read-only instrument that names `--apply` only to refuse it goes in `INSTRUMENTS_THAT_REFUSE_APPLY` instead.

Pass `mongoUrl: process.env.MONGODBURL` at every `assertScriptApplyAllowed` call, so the call says out loud which database the apply would write.
The guard also resolves `MONGODBURL` itself when the argument is absent, because before #3725 four apply-capable scripts omitted it: `summarizeMongoUrl(undefined)` returned `missing`, no production pattern matched, and the refusal could not fire while the script connected through `MONGODBURL` anyway.
Omission is therefore no longer unsafe, and the convention is what keeps the target reviewable.
Never hand the guard an `env` override while omitting `mongoUrl`: the guard would resolve its target from that stub while the script connects through the real `process.env`, which is the one remaining way past the check.
`server/src/scripts/__tests__/scriptWriteGuards.test.ts` closes the argument-shape space rather than enumerating call sites, so a new apply path is covered by whichever shape it uses, and the shape that resolves nothing is recorded there as the one to avoid.

Every module under `server/src/scripts` whose code names `--apply` must reach `assertScriptApplyAllowed`, either itself, through a helper it imports, or through the entry script that imports it, or be listed in `APPLY_GUARD_EXEMPTIONS` with the guard that stands in for it (`server/src/scripts/__tests__/everyApplyPathReachesTheApplyGuard.test.ts`, #4320).
The test parses each module with the TypeScript compiler rather than grepping, so a comment that mentions the flag is not an apply path; the exemptions are the read-only instruments that throw on `--apply`, the Development-only scripts that check the database name themselves, and the promotion and sync tooling.
`assertScraperEnvironmentMatchesMongoTarget` resolves `mongoUrl ?? env.MONGODBURL` the same way the apply guard does, so a scraper caller that omits the URL is still checked against the database it will connect to.

`humanRunWriteScripts.pending.json` lists the legacy one-offs awaiting conversion.
Converting or deleting one means removing it from that list and lowering `PENDING_CONVERSION_CEILING` to match, because the test requires the two to be equal, which is what keeps the count moving in one direction.

## General implementation rules

- The evidence-first design contract is stated once in `AGENTS.md` under Implementation Rules, with the reasoning and the measurements in `docs/decisions.md`. Read it before adding a repair script, a direct field write on `ResearchEntity`, or a bulk-apply path to a review surface, and do not restate it here.
- When the user reports a problem, treat it as a signal to fix the upstream cause when feasible. Do not settle for a local symptom patch if a durable code, data, test, or workflow change would prevent the same class of issue from recurring.
- Prefer first-class product-model collections (`ResearchEntity`, `Signal`, `ResearchEntityRelationship`) over embedding signals or access evidence inside `ResearchEntity`. Treat remaining `ResearchGroup`/`lab`/`researchGroupId` naming as migration residue unless the file is explicitly part of rollback/migration support.
