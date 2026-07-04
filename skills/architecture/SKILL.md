---
name: architecture
description: Use when an agent needs the Yale Research repo map, tech stack, commands, route inventory, service inventory, naming conventions, environments, external integrations, or general architecture context before making or explaining a code change.
---

# Architecture

Yale Research is a monorepo with a React client and an Express server communicating over REST.
MongoDB Atlas is the primary data store.
Meilisearch handles search with semantic plus keyword support.
Yale CAS provides SSO authentication.

```
React (Vite) -> Express (Passport.js) -> MongoDB Atlas + Meilisearch
                    |
            External APIs: Yale CAS, Yalies, Yale Directory, CourseTable, OpenAI via Meilisearch embedder
```

The server follows **Routes -> Middleware -> Controllers -> Services -> Models**.
Routes define endpoints and middleware chains.
Controllers extract request data, delegate to services, and format responses.
Services contain business logic, DB operations, and external API calls.
Models are Mongoose schemas with indexes.

## Stack

| Layer | Technology |
|-------|------------|
| Client | React 19, TypeScript 5.3, Vite 6.3, React Router v6, MUI v7, styled-components, TailwindCSS v3 |
| Server | Express 4, TypeScript 5.3, Passport.js 0.5, Mongoose 8 |
| Search | Meilisearch 0.57 with hybrid search and OpenAI `text-embedding-3-small` embedder |
| Database | MongoDB Atlas, single cluster with separate databases per environment |
| Package Manager | Yarn 4 via Corepack |
| Tooling | concurrently, nodemon, ts-node, cross-env |

## Repo map

| Path | Purpose |
|------|---------|
| `client/` | React frontend, Vite dev server on port 3000. |
| `server/` | Express backend, default port 4000. |
| `server/src/routes/` | Express routers aggregated in `routes/index.ts`. |
| `server/src/controllers/` | Request handlers. |
| `server/src/services/` | Business logic and external integrations. |
| `server/src/models/` | Mongoose schemas and indexes. |
| `server/src/scrapers/` | Evidence-first scraper infrastructure. |
| `server/src/middleware/` | Auth, validation, security, and error handling middleware. |
| `server/src/db/` | Multi-mode database connections. |
| `server/src/utils/` | Shared utilities, errors, environment helpers, Meili client, SSRF guard. |
| `data-migration/` | Standalone migration scripts. |
| `docs/` | Durable product, architecture, and workflow documentation. |
| `skills/` | On-demand agent skills. |

## Commands

| Command | Effect |
|---------|--------|
| `yarn install:all` | Install deps in root, server, and client. |
| `yarn dev:client` | Vite dev server on port 3000. |
| `yarn dev:server` | Express with nodemon on port 4000. |
| `yarn build` | Corepack enable, install all deps, build server, build client. |
| `yarn start` | Run both servers in production. |
| `yarn clean:all` | Remove all `node_modules` directories. |
| `yarn --cwd client test` | Client Vitest watch mode. |
| `yarn --cwd client test:ci` | Client Vitest once. |
| `yarn --cwd server test` | Server Vitest suite. |
| `yarn --cwd server scrape <cmd>` | Scraper CLI. |
| `yarn --cwd server gates:refresh` | Regenerate canonical gate scorecards. |

Migration scripts run from `data-migration/` with `npx tsx --transpile-only <script>.ts`.

Dev login bypass: `GET http://localhost:4000/api/dev-login` creates a test undergraduate session.
Pass `?userType=admin|professor|faculty|graduate|unknown` for another dev account.
Use `unknown` to reach `/unknown` onboarding locally.

## TypeScript

Server: target ES2022, module NodeNext, moduleResolution NodeNext, strict true, output to `build/`.
Built with `tsup`; dev mode uses `tsx watch`.

Client: target ES5, module ESNext, JSX `react-jsx`, strict true, noEmit true.

## Routes

All application routes mount under `/api` in `app.ts`.
Passport auth routes mount separately via `passportRoutes` before the main routes.

| Prefix | File | Auth |
|--------|------|------|
| `/research` | `researchGroups.ts` | Varies, with public search and detail. |
| `/programs` | `programs.ts` | Varies; current Programs and Fellowships surface. |
| `/opportunities` | `opportunities.ts` | Public. |
| `/pathways` | `pathways.ts` | Auth required. |
| `/listings` | `listings.ts` | Auth; legacy API remains mounted and functional. |
| `/fellowships` | `fellowships.ts` | Auth; legacy, with `/api/programs` as successor. |
| `/users` | `users.ts` | Auth required. |
| `/profiles` | `profiles.ts` | Varies. |
| `/analytics` | `analytics.ts` | Admin. |
| `/config` | `config.ts` | Public. |
| `/research-areas` | `researchAreas.ts` | Admin for writes. |
| `/admin` | `admin.ts` | Admin. |
| `/seed` | `seed.ts` | Local development runtime only. |

## Key services

| Service | Responsibility |
|---------|----------------|
| `researchEntityDto.ts` / `researchEntityQuality.ts` | Public ResearchEntity DTO shaping and quality scoring. |
| `researchEntityBrowseRank.ts` / `researchEntityBrowseRankService.ts` | Best-first browse ranking scorer and persist plus Meili resync. |
| `researchEntitySearchIndexService.ts` / `pathwaySearchIndexService.ts` / `pathwaySearchService.ts` | Meilisearch index sync and query. |
| `meiliSyncService.ts` | Syncs collection upserts into Meilisearch indexes. |
| `accessSignalService.ts` / `accessSummaryService.ts` / `entryPathwayService.ts` / `contactRouteService.ts` / `postedOpportunityService.ts` | Product-model access layer. |
| `adminOperatorBoardService.ts` / `adminAccessReviewService.ts` / `adminGrantService.ts` | Operator board, access review, and admin grants. |
| `sourceHealthService.ts` / `scholarlyActivityAuditService.ts` / `paperQualityService.ts` | Scraper/source health and paper-quality scoring. |
| `studentVisibilityTier.ts` / `studentVisibilityGateService.ts` / `visibilityRepairQueueService.ts` / `studentDecisionExplanationService.ts` | Student visibility tiering, repair queue, and decision explanations. |
| `fellowshipMatchingService.ts` / `fellowshipApplicationCycleEvidenceService.ts` / `programClassifier.ts` | Fellowship matching, cycle evidence, and program classification. |
| `listingResearchEntityProfile.ts` | Keeps legacy listings synced to ResearchEntity profiles. |
| `directoryService.ts` / `yaliesService.ts` / `courseTableService.ts` | External integrations. |

## Naming conventions

| Element | Convention |
|---------|------------|
| Services | camelCase plus `Service`, e.g. `listingService.ts`. |
| Models | PascalCase exports, e.g. `User`, `Listing`, `Fellowship`. |
| Controllers | camelCase descriptive names. |
| Routes | Resource-based files. |
| DB fields | camelCase. |
| Enums | PascalCase. |
| React components | PascalCase. |
| React hooks | camelCase with `use` prefix. |
| Contexts | PascalCase plus `Context`. |

## Environments

Code flows Local -> Beta -> Prod.
Beta is the staging gate.

| Environment | Hosting | `MEILISEARCH_INDEX_PREFIX` |
|-------------|---------|----------------------------|
| Local | localhost | unset |
| Beta | Render `ylabs-gr4v.onrender.com` | `beta` |
| Prod | Render `yalelabs.onrender.com` | `prod` |

## External integrations

| Service | Purpose | Location |
|---------|---------|----------|
| Yale CAS SSO | Authentication | `passport.ts` |
| Yalies API | Student and graduate data lookup | `yaliesService.ts` |
| Yale Directory | Faculty data lookup | `directoryService.ts` |
| CourseTable | Professor course data | `courseTableService.ts` |
| Meilisearch | Hybrid search | `meiliClient.ts` |
| OpenAI | Embeddings via Meilisearch embedder and LLM extractors | Meilisearch/index setup and scraper extractors |
