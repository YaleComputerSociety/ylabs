# Y/Labs Research Database — Codebase Context

> **Live site:** [yalelabs.io](https://yalelabs.io/) · **Hosted on:** Render (`yalelabs.onrender.com`)

---

## 1. High-Level Overview

### What the Project Does

Y/Labs (originally "RDB") is a **Yale research lab discovery platform**. It enables:

- **Students**: Browse and favorite research labs and fellowships, discover opportunities matching their interests
- **Faculty**: Create and manage lab listings, view analytics on their listings, maintain public profiles
- **Admins**: Manage users, audit listings/fellowships, view platform-wide analytics

### Core Purpose & Use Cases

| User Type | Primary Use Cases |
|-----------|-------------------|
| **Undergraduates/Graduates** | Search labs by department/research area, save favorites, contact professors |
| **Professors/Faculty** | Create lab listings, track engagement (views/favorites), manage co-PIs |
| **Admins** | Audit listings, manage user types, view analytics dashboards |

### Key Features

- **Semantic Search**: OpenAI embeddings + MongoDB Atlas Vector Search for intelligent lab discovery
- **Yale CAS SSO**: Seamless authentication with Yale credentials
- **Faculty Profiles**: Auto-enriched with publications, courses, and research interests
- **Fellowship Database**: Multi-faceted filtering by eligibility, purpose, and region
- **Real-time Analytics**: Event tracking for views, favorites, searches, and user activity
- **Smart Titles**: Auto-generated listing titles based on professor name + department category

---

## 2. Architecture Overview

### System Design

**Monorepo with Client-Server Architecture**

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   React Client  │────▶│  Express Server │────▶│  MongoDB Atlas  │
│   (Vite, MUI)   │     │   (Passport.js) │     │  (Vector Search)│
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                       │                       │
         │                       ▼                       │
         │              ┌─────────────────┐              │
         │              │  External APIs  │              │
         │              │ • Yale CAS SSO  │              │
         │              │ • Yalies API    │              │
         │              │ • Yale Directory│              │
         │              │ • CourseTable   │              │
         │              │ • OpenAI        │              │
         │              └─────────────────┘              │
         │                                               │
         └───────────── Session Cookies ─────────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Client** | React 19 + TypeScript, Vite, React Router v6, MUI v7, styled-components, TailwindCSS v3 |
| **Server** | Express 4, TypeScript, Passport.js (CAS strategy) |
| **Database** | MongoDB via Mongoose 8 (multi-connection: production, migration, test) |
| **AI/ML** | OpenAI `text-embedding-3-small` for semantic search, MongoDB Atlas `$vectorSearch` |
| **Tooling** | Yarn 4 (monorepo), concurrently, nodemon, cross-env |

### Server Layered Architecture

```
Routes → Middleware → Controllers → Services → Models/DB
```

- **Routes** (`server/src/routes/`): Define HTTP endpoints, compose middleware chains
- **Middleware** (`server/src/middleware/`): Auth guards, input validation, error handling
- **Controllers** (`server/src/controllers/`): Thin layer — extract request data, delegate to services, format responses
- **Services** (`server/src/services/`): All business logic (CRUD, embedding generation, external API calls)
- **Models** (`server/src/models/`): Mongoose schemas with indexes

### External Dependencies & Integrations

| Service | Purpose | Auth Required | File |
|---------|---------|---------------|------|
| **Yale CAS SSO** | Authentication via `passport-cas` strategy | CAS server URL | `passport.ts` |
| **Yalies API** (`api.yalies.io`) | Student/grad data lookup (name, college, year, major) | API key | `yaliesService.ts` |
| **Yale Directory** (`directory.yale.edu`) | Faculty data lookup (title, department, phone, office) | None | `directoryService.ts` |
| **CourseTable** (`coursetable.com/api/catalog/public`) | Professor's courses for profile pages | None | `courseTableService.ts` |
| **OpenAI Embeddings** (`text-embedding-3-small`) | Semantic vector search for listings | API key | `embeddingService.ts` |

---

## 3. Project Structure

```
ylabs/                              # Monorepo root
├── package.json                    # Root scripts (install:all, dev:*, build, start)
├── CONTEXT.md                      # This file
├── README.md                       # Setup guide
│
├── client/                         # React frontend (Vite)
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json               # Strict mode, React JSX
│   └── src/
│       ├── main.tsx                # App entry point
│       ├── App.tsx                 # Route definitions
│       ├── pages/                  # 10 route-level pages
│       │   ├── home.tsx            # Main listing search/browse (/)
│       │   ├── fellowships.tsx     # Fellowship search (/fellowships)
│       │   ├── account.tsx         # Account management + listing editor (65KB - large!)
│       │   ├── profile.tsx         # Public faculty profile (/profile/:netid)
│       │   ├── analytics.tsx       # Admin-only dashboard (/analytics)
│       │   ├── about.tsx           # About page (/about)
│       │   ├── unknown.tsx         # User type confirmation (/unknown)
│       │   ├── login.tsx           # CAS login redirect
│       │   ├── loginError.tsx      # Login error page
│       │   └── notFound.tsx        # 404 page
│       ├── components/             # UI components
│       │   ├── admin/              # Admin-specific components
│       │   ├── accounts/           # Account page components
│       │   ├── fellowship/         # Fellowship components
│       │   ├── profile/            # Profile page components
│       │   ├── navbar/             # Navigation components
│       │   └── shared/             # Reusable components (ListingCard, etc.)
│       ├── contexts/               # React Context definitions
│       │   ├── UserContext.ts      # Auth state (netId, userType, userConfirmed)
│       │   ├── ConfigContext.ts    # Departments + research areas
│       │   ├── SearchContext.ts    # Listing search state
│       │   ├── FellowshipSearchContext.ts
│       │   └── UIContext.ts        # UI flags
│       ├── providers/              # Context providers (data fetching logic)
│       │   ├── UserContextProvider.tsx
│       │   ├── ConfigContextProvider.tsx
│       │   ├── SearchContextProvider.tsx
│       │   ├── FellowshipSearchContextProvider.tsx
│       │   └── UIContextProvider.tsx
│       ├── hooks/                  # Custom hooks
│       │   ├── useConfig.ts
│       │   ├── useInfiniteScroll.ts
│       │   └── useViewTracking.ts
│       ├── types/                  # TypeScript interfaces
│       │   ├── Listing.ts
│       │   ├── Fellowship.ts
│       │   ├── FacultyProfile.ts
│       │   └── User.ts
│       └── utils/                  # Helpers and constants
│           ├── axios.ts            # Configured Axios instance
│           ├── muiTheme.ts         # MUI theme configuration
│           ├── departmentNames.ts  # Department display names
│           ├── researchAreas.ts    # Research area constants
│           └── facultyDepartments.json  # (588KB - consider lazy loading)
│
├── server/                         # Express backend
│   ├── package.json
│   ├── tsconfig.json               # ES2017, CommonJS output
│   └── src/
│       ├── index.ts                # Entry point (server startup)
│       ├── app.ts                  # Express app setup, CORS, middleware
│       ├── passport.ts             # CAS auth + user find-or-create cascade
│       ├── routes/                 # Express routers
│       │   ├── index.ts            # Route aggregator
│       │   ├── listings.ts         # /api/listings/*
│       │   ├── fellowships.ts      # /api/fellowships/*
│       │   ├── users.ts            # /api/users/*
│       │   ├── profiles.ts         # /api/profiles/*
│       │   ├── admin.ts            # /api/admin/*
│       │   ├── analytics.ts        # /api/analytics/*
│       │   ├── config.ts           # /api/config
│       │   ├── researchAreas.ts    # /api/research-areas/*
│       │   └── seed.ts             # /api/seed/* (dev only)
│       ├── controllers/            # Route handlers
│       │   ├── listingController.ts
│       │   ├── userController.ts
│       │   ├── profileController.ts
│       │   └── fellowshipController.ts
│       ├── services/               # Business logic (11 services)
│       │   ├── listingService.ts   # Listing CRUD
│       │   ├── userService.ts      # User CRUD + relationships
│       │   ├── embeddingService.ts # OpenAI embeddings
│       │   ├── analyticsService.ts # Event logging + aggregation
│       │   ├── directoryService.ts # Yale Directory API
│       │   ├── yaliesService.ts    # Yalies.io API
│       │   ├── courseTableService.ts # CourseTable API
│       │   ├── configService.ts    # Config cache (5min TTL)
│       │   ├── profileService.ts   # Profile enrichment
│       │   ├── fellowshipService.ts # Fellowship CRUD
│       │   └── itemOperations.ts   # Generic view/favorite operations
│       ├── models/                 # Mongoose schemas
│       │   ├── user.ts             # User schema
│       │   ├── listing.ts          # Listing schema (with embedding)
│       │   ├── fellowship.ts       # Fellowship schema
│       │   ├── analytics.ts        # Analytics event schema (3yr TTL)
│       │   ├── department.ts       # Department taxonomy
│       │   └── researchArea.ts     # Research area taxonomy
│       ├── middleware/             # Express middleware
│       │   ├── auth.ts             # Auth guards (isAdmin, isProfessor, etc.)
│       │   ├── validation.ts       # Input validation
│       │   └── errorHandler.ts     # Global error handler + asyncHandler
│       ├── db/                     # Database connections
│       │   └── connections.ts      # Multi-mode: production, test, migration
│       ├── utils/                  # Utilities
│       │   ├── smartTitle.ts       # Auto-generate listing titles
│       │   ├── errors.ts           # Custom error classes
│       │   ├── permissions.ts      # Legacy auth (duplicate of middleware)
│       │   └── environment.ts      # Environment checks
│       └── scripts/                # One-off scripts
│           ├── importFaculty.ts
│           └── cleanDepartments.ts
│
└── data-migration/                 # Standalone migration/seeding scripts
    ├── MigrateDepartments.ts       # Department data migration
    ├── MigrateListings.ts          # Listing data migration
    ├── MigrateUsers.ts             # User data migration
    ├── migrateSmartTitles.ts       # Smart title migration
    ├── generateKeywords.ts         # Keyword auto-generation (OpenAI)
    ├── seedDepartments.ts          # Department seeding
    ├── seedResearchAreas.ts        # Research area seeding
    └── importFellowships.ts        # Fellowship import
```

### Entry Points

| Entry Point | Path | Description |
|-------------|------|-------------|
| **Client** | `client/src/main.tsx` | React app bootstrap |
| **Server** | `server/src/index.ts` | Express server startup |
| **Migration Scripts** | `data-migration/*.ts` | Run with `ts-node --transpile-only` |

---

## 4. Core Concepts & Patterns

### Data Models (MongoDB Collections)

#### User Model (`users`)

All Yale users — students, faculty, admins.

| Field Group | Key Fields |
|-------------|-----------|
| **Identity** | `netid` (unique), `email`, `fname`, `lname` |
| **Role** | `userType` (undergraduate/graduate/professor/faculty/unknown/admin), `userConfirmed`, `profileVerified` |
| **Academic** | `college`, `year`, `major[]`, `departments[]` |
| **Faculty Data** | `title`, `publications[]`, `h_index`, `orcid`, `openalex_id`, `research_interests[]`, `topics[]` |
| **Directory** | `unit`, `upi`, `physical_location`, `primary_department` |
| **Relationships** | `ownListings[]`, `favListings[]`, `favFellowships[]` |
| **Metadata** | `lastLogin`, `loginCount`, `lastActive`, `data_sources[]`, `createdAt`, `updatedAt` |

#### Listing Model (`listings`)

Research lab listings owned by professors.

| Field Group | Key Fields |
|-------------|-----------|
| **Ownership** | `ownerId`, `ownerFirstName`, `ownerLastName`, `ownerEmail`, `ownerTitle`, `ownerPrimaryDepartment` |
| **Co-PIs** | `professorIds[]`, `professorNames[]`, `emails[]` |
| **Content** | `title`, `description`, `applicantDescription`, `websites[]` |
| **Classification** | `departments[]`, `researchAreas[]`, `keywords[]` |
| **Status** | `archived`, `confirmed`, `audited`, `hiringStatus` |
| **Engagement** | `views`, `favorites` |
| **AI** | `embedding[]` (1536-dim vector, excluded from queries by default) |

#### Fellowship Model (`fellowships`)

Funding and fellowship opportunities.

| Field Group | Key Fields |
|-------------|-----------|
| **Basic** | `title`, `competitionType`, `summary`, `description` |
| **Application** | `applicationInformation`, `applicationLink`, `deadline`, `applicationOpenDate`, `isAcceptingApplications` |
| **Eligibility Filters** | `yearOfStudy[]`, `termOfAward[]`, `purpose[]`, `globalRegions[]`, `citizenshipStatus[]` |
| **Award** | `awardAmount`, `restrictionsToUseOfAward` |
| **Contact** | `contactName`, `contactEmail`, `contactPhone`, `contactOffice` |

#### AnalyticsEvent Model (`analytics_events`)

Event log with 3-year TTL auto-expiration.

| Event Types |
|-------------|
| `LOGIN`, `LOGOUT`, `VISITOR`, `SEARCH` |
| `LISTING_VIEW`, `LISTING_FAVORITE`, `LISTING_UNFAVORITE` |
| `LISTING_CREATE`, `LISTING_UPDATE`, `LISTING_ARCHIVE`, `LISTING_UNARCHIVE` |
| `PROFILE_UPDATE` |

#### Department Model (`departments`)

Academic departments with category mapping.

```typescript
enum DepartmentCategory {
  'Computing & AI',
  'Life Sciences',
  'Physical Sciences & Engineering',
  'Health & Medicine',
  'Social Sciences',
  'Humanities & Arts',
  'Environmental Sciences',
  'Economics',
  'Mathematics'
}
```

### Key Abstractions & Patterns

#### 1. Smart Title System (`smartTitle.ts`)

Auto-generates listing titles based on professor's last name + department category:

| Category | Suffix Example |
|----------|---------------|
| Computing & AI | "Smith Lab" |
| Mathematics | "Jones Research Group" |
| Humanities & Arts | "Lee Studio" |

Detects and preserves custom titles via regex heuristics (user-entered titles containing non-standard words).

#### 2. Config Cache (`configService.ts`)

Server-side cached config (departments + research areas) served to client:
- **TTL**: 5 minutes
- **Invalidation**: Manual on admin changes
- **Endpoint**: `GET /api/config`

#### 3. Multi-Mode Database (`connections.ts`)

Three connection modes:

| Mode | Use Case |
|------|----------|
| `production` | Normal operation (single DB) |
| `test` | Development/testing (separate DB) |
| `productionMigration` | Safe migrations (dual-DB: listings from migration, rest from prod) |

#### 4. Response Interception for Analytics

Routes intercept `res.send`/`res.json` to log analytics events *after* successful responses:

```typescript
const originalSend = res.send.bind(res);
res.send = function(body) {
  logEvent({ eventType: 'LISTING_VIEW', ... }); // Fire-and-forget
  return originalSend(body);
};
```

#### 5. Department Cascading (`profileService.ts`)

When a professor's department changes:
1. Update the professor's `departments[]`
2. Cascade to all their owned listings
3. For co-PI listings, merge departments from all professors

### Data Flow

#### Authentication Flow

```
User → Yale CAS SSO → passport.ts (findOrCreateUser)
     → Check DB (stale if >30 days? refresh)
     → Yalies API (student/grad detection)
     → Yale Directory (faculty detection)
     → Fallback (fname: "NA", userType: "unknown")
     → Create/Update User → Session cookie
```

#### Search Flow (Listings)

```
Client query → /api/listings/search
     → Generate query embedding (OpenAI)
     → MongoDB $vectorSearch (limit: 100 candidates)
     → $match filters (departments, disciplines, researchAreas)
     → Paginate → Response
```

**Fallback**: If vector search returns 0 results, falls back to Atlas full-text `$search`.

#### Listing Creation Flow

```
Professor → POST /api/listings
     → canCreateListing middleware (requires profileVerified)
     → processListingTitle (smart title or custom)
     → generateListingEmbedding (OpenAI)
     → Save listing → Link to owner + co-PIs
```

---

## 5. Development Workflow

### Prerequisites

- **Node.js ≥ 20.9.0** (required by `server/package.json` engines field)
- **Corepack** (ships with Node ≥ 16.9 — manages Yarn 4)

### Setup

```bash
# 1. Enable Corepack (manages Yarn version)
corepack enable

# 2. Install all dependencies (root + server + client)
yarn install:all

# 3. Configure environment variables (see below)

# 4. Start development servers (two terminals)
yarn dev:client    # Terminal 1: Vite on port 3000
yarn dev:server    # Terminal 2: Express with nodemon on port 4000
```

### Environment Variables

#### `server/.env`

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 4000 | Server port |
| `MONGODBURL` | **Yes** | - | MongoDB production connection string |
| `MONGODBURL_TEST` | For test mode | - | MongoDB test connection string |
| `MONGODBURL_MIGRATION` | For migration mode | - | Secondary DB for migrations |
| `SESSION_SECRET` | **Yes** | - | Cookie session signing key |
| `API_MODE` | No | `production` | `production`, `test`, or `productionMigration` |
| `SSOBASEURL` | **Yes** | - | Yale CAS URL (prod: `https://secure.its.yale.edu/cas`, test: `https://secure-tst.its.yale.edu/cas`) |
| `SERVER_BASE_URL` | **Yes** | - | Public server URL for CAS callbacks |
| `YALIES_API_KEY` | No | - | API key for yalies.io |
| `OPENAI_API_KEY` | No | - | OpenAI API key for embeddings |

#### `client/.env`

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_APP_SERVER` | **Yes** | Backend API URL (e.g., `http://localhost:4000`) |

### Common Commands

| Command | Description |
|---------|-------------|
| `yarn install:all` | Install deps in root + server + client |
| `yarn dev:client` | Start Vite dev server (port 3000) |
| `yarn dev:server` | Start Express with nodemon (port 4000) |
| `yarn build` | Full production build |
| `yarn start` | Run both servers in production mode |
| `yarn clean:all` | Remove all node_modules |

### Dev Login Bypass

In development, visit `http://localhost:4000/api/dev-login` to log in as a test user (`test123` / `student`) without CAS.

### Migration Scripts

Run data migration scripts with:

```bash
cd data-migration
npx ts-node --transpile-only <script>.ts
```

---

## 6. Conventions & Standards

### Naming Conventions

| Element | Convention | Examples |
|---------|-----------|----------|
| **Services** | camelCase + "Service" suffix | `listingService.ts`, `embeddingService.ts` |
| **Models** | PascalCase exports | `User`, `Listing`, `Fellowship` |
| **Controllers** | camelCase descriptive names | `createListingForCurrentUser`, `searchListings` |
| **Routes** | Resource-based files | `listings.ts`, `users.ts`, `profiles.ts` |
| **DB Fields** | camelCase | `ownerPrimaryDepartment`, `primaryCategory` |
| **Enums** | PascalCase | `AnalyticsEventType`, `DepartmentCategory` |
| **React Components** | PascalCase | `PrivateRoute`, `ListingForm` |
| **React Hooks** | camelCase with "use" prefix | `useConfig`, `useInfiniteScroll` |
| **Context** | PascalCase + "Context" suffix | `UserContext`, `SearchContext` |

### TypeScript Configuration

**Server** (`server/tsconfig.json`):
- Target: ES2017
- Module: CommonJS
- Strict: `noImplicitAny: true`
- Output: `build/`

**Client** (`client/tsconfig.json`):
- Target: ES5
- Module: ESNext
- Strict: `strict: true`
- JSX: `react-jsx`

### Error Handling Patterns

#### Custom Error Classes (`server/src/utils/errors.ts`)

```typescript
NotFoundError      // 404 - Resource not found
ObjectIdError      // 404 - Invalid MongoDB ObjectId
IncorrectPermissionsError  // 403 - Forbidden
```

#### Error Handler Middleware (`server/src/middleware/errorHandler.ts`)

- Maps custom errors to HTTP status codes
- Maps Mongoose `ValidationError` → 400
- Maps Mongoose `CastError` → 400
- Maps MongoDB duplicate key (11000) → 409
- Shows full error details in development, hides in production

#### Async Handler Pattern

```typescript
import { asyncHandler } from '../middleware/errorHandler';

router.get('/', asyncHandler(async (req, res) => {
  // Errors automatically caught and passed to error handler
}));
```

### Logging Approach

**Current**: Console-based logging only (`console.log`, `console.error`)

| Context | Pattern |
|---------|---------|
| Server startup | `console.log('🐶 Server ready on port ${PORT}')` |
| DB connection | `console.log('🚀 MongoDB connected')` |
| Auth flow | Detailed logging in `passport.ts` |
| Errors | `console.error('Error:', error.message)` |

**No structured logging library** (Winston, Pino) — logs are unstructured.

### Auth Middleware (`server/src/middleware/auth.ts`)

| Middleware | Description |
|------------|-------------|
| `isAuthenticated` | Checks `req.user` exists |
| `isAdmin` | Requires `userType === 'admin'` |
| `isProfessor` | Requires `userType` in `['professor', 'faculty', 'admin']` |
| `canCreateListing` | Professor/faculty + `profileVerified` (admins bypass) |
| `isTrustworthy` | Confirmed admin/professor/faculty |
| `isConfirmed` | Requires `userConfirmed === true` |

### Client Route Protection

| Guard | Description |
|-------|-------------|
| `PrivateRoute` | Requires auth; `unknownBlocked=true` redirects unknown users |
| `AdminRoute` | Requires `userType === 'admin'` |
| `UnprivateRoute` | For error pages (no auth required) |

---

## 7. Known Limitations & Future Work

### Technical Debt

| Issue | Location | Impact | Recommended Fix |
|-------|----------|--------|----------------|
| **Large component** | `client/src/pages/account.tsx` (65KB) | Hard to maintain | Split into ListingEditor, ProfileEditor, FavoritesManager |
| **Duplicate auth middleware** | `utils/permissions.ts` vs `middleware/auth.ts` | Confusion | Delete `utils/permissions.ts`, use only middleware |
| **Error handler not mounted** | `server/src/app.ts` | Unhandled promise rejections | Add `app.use(errorHandler)` after routes |
| **Non-atomic counters** | `itemOperations.ts` (`addView`, `addFavorite`) | Race conditions | Use `$inc` operator instead of read-then-update |
| **Missing await** | `listingController.ts:276` (`userExists(id)`) | Always truthy check | Add `await` |
| **Environment check mismatch** | `utils/environment.ts` | `isDevelopment()` checks `"dev"` but NODE_ENV is `"development"` | Fix string comparison |
| **Large bundled JSON** | `client/src/utils/facultyDepartments.json` (588KB) | Slow initial load | Lazy-load or serve from API |
| **No rate limiting** | All API endpoints | Abuse potential | Add express-rate-limit |
| **No automated tests** | Entire codebase | Regression risk | Add Jest/Vitest tests |

### Vector Search Limitation

The search pipeline runs `$vectorSearch` **before** `$match` with a hard limit of 100 candidates. With strict filters, this can miss relevant results that weren't in the top-100 vector candidates.

**Current behavior**: `totalCount` is counted separately via `countDocuments` on filters alone, so it may report more total results than actually available.

### Areas for Improvement

1. **Add ESLint/Prettier configuration** — No linting enforcement currently
2. **Implement proper logging** — Replace console.log with Winston or Pino
3. **Add request validation schemas** — Use Zod or Joi for input validation
4. **Implement caching layer** — Redis for frequently accessed data
5. **Add health check endpoint** — For container orchestration readiness
6. **Implement graceful shutdown** — Handle SIGTERM properly

### Planned Features (Context from Recent Commits)

- **Web scrapers** for additional faculty data sources (Medicine, History, Physics)
- **Faculty enrichment pipeline** — OpenAlex integration for publications/h-index
- **Audit workflow improvements** — Better listing/fellowship auditing flow

---

## 8. API Reference

### Base URL

- **Development**: `http://localhost:4000/api`
- **Production**: `https://yalelabs.io/api`

### Routes Overview

| Prefix | Description | Auth Required |
|--------|-------------|---------------|
| `/api/listings` | Listing CRUD and search | Varies |
| `/api/fellowships` | Fellowship CRUD and search | Varies |
| `/api/users` | User CRUD | Yes |
| `/api/profiles` | Faculty profile operations | Varies |
| `/api/analytics` | Analytics data | Admin |
| `/api/config` | Departments + research areas | No |
| `/api/research-areas` | Research area CRUD | Admin |
| `/api/admin` | Admin operations | Admin |
| `/api/seed` | Seed data (dev only) | Dev mode |

### Key Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/listings/search` | Semantic search with filters |
| `POST` | `/api/listings` | Create listing (requires `canCreateListing`) |
| `GET` | `/api/listings/:id` | Get listing by ID |
| `PUT` | `/api/listings/:id` | Update listing |
| `GET` | `/api/fellowships/search` | Search fellowships |
| `GET` | `/api/profiles/:netid` | Get faculty profile |
| `GET` | `/api/users/me` | Get current user |
| `PUT` | `/api/users/me` | Update current user |
| `GET` | `/api/config` | Get departments + research areas |
| `GET` | `/api/analytics` | Get analytics (admin) |

---

## 9. Quick Reference for Common Tasks

### Adding a New API Endpoint

1. Create/update route in `server/src/routes/<resource>.ts`
2. Add controller function in `server/src/controllers/<resource>Controller.ts`
3. Add service logic in `server/src/services/<resource>Service.ts`
4. Apply appropriate middleware (auth, validation)

### Adding a New React Page

1. Create page component in `client/src/pages/<page>.tsx`
2. Add route in `client/src/App.tsx`
3. Wrap with appropriate route guard (`PrivateRoute`, `AdminRoute`)

### Modifying Database Schema

1. Update Mongoose schema in `server/src/models/<model>.ts`
2. Update TypeScript interfaces in `client/src/types/`
3. If needed, create migration script in `data-migration/`

### Adding a New External API Integration

1. Create service in `server/src/services/<service>Service.ts`
2. Add API key to `.env` if required
3. Add error handling with graceful degradation

---

## 10. Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| CAS login not working locally | Wrong `SSOBASEURL` | Use `https://secure-tst.its.yale.edu/cas` for test CAS |
| Embeddings not generating | Missing `OPENAI_API_KEY` | Add OpenAI API key to `.env` |
| Vector search returns 0 results | No embeddings in DB | Run listing update to generate embeddings |
| "Forbidden" on listing creation | `profileVerified: false` | Verify profile on account page |
| CORS errors | Wrong origin | Add origin to `allowList` in `app.ts` or use dev-login |
