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

Auth middleware (`server/src/middleware/auth.ts`): `isAuthenticated`, `isAdmin`, `isProfessor` (professor/faculty/admin), `isTrustworthy`, `isConfirmed`, `canCreateListing`.

Validation middleware: `validateObjectId(paramName?)`, `validateNetid(paramName?)`, `requireBody()`, `requireFields(fields[])`, `validatePagination()`, `validateSort(allowedFields[])`, `validateQuery(allowedParams[])`.

The `asyncHandler` wrapper catches promise rejections in route handlers.

## Adding a new page

1. **Page component** in `client/src/pages/<page>.tsx`.
2. **Route** in `client/src/App.tsx`, wrapped with the appropriate guard (`PrivateRoute`, `AdminRoute`, `UnprivateRoute`).
3. Reuse existing providers/components where appropriate.

Iterate on canonical product surfaces instead of creating student-facing versioned routes. Use existing routes such as `/research`, or a non-URL feature flag when rollout safety is needed; do not add `/v1`, `/v2`, `/research-v2`, or similar route names for normal design iteration.

## Modifying a schema

1. **Mongoose schema** in `server/src/models/<model>.ts`.
2. **TypeScript interfaces** in `client/src/types/`.
3. **Migration script** in `data-migration/` if existing data needs transformation.
   Prefer package scripts with dry-run defaults, safe JSON summaries under `./tmp` or system temp, and explicit `--execute --target ...` guards when they exist.
4. If the model affects Research or Pathways search, update the relevant **Meilisearch** rebuild/index config and the release gate.

## General implementation rules

- When the user reports a problem, treat it as a signal to fix the upstream cause when feasible. Do not settle for a local symptom patch if a durable code, data, test, or workflow change would prevent the same class of issue from recurring.
- Prefer first-class product-model collections (`ResearchEntity`, `EntryPathway`, `PostedOpportunity`, `AccessSignal`, `ContactRoute`) over embedding pathways/signals/routes inside `ResearchEntity`. Treat remaining `ResearchGroup`/`lab`/`researchGroupId` naming as migration residue unless the file is explicitly part of rollback/migration support.
