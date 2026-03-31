# YURA Research Database

A research lab and fellowship discovery platform for Yale University.

**Live:** [yalelabs.io](https://yalelabs.io/) · **Hosted on:** [Render](https://yalelabs.onrender.com)

## Tech Stack

| Layer | Tech |
|-------|------|
| Client | React 19, TypeScript, Vite, TailwindCSS, MUI |
| Server | Express 4, TypeScript, Passport.js (Yale CAS) |
| Database | MongoDB Atlas (Mongoose 8) |
| Search | OpenAI embeddings + MongoDB Atlas Vector Search |

## Prerequisites

- **Node.js ≥ 20.9.0** (required by `server/package.json` `engines` field)
- **Corepack** (ships with Node ≥ 16.9 — used to manage Yarn 4)

> **Note:** This repo uses **Yarn 4** via Corepack. Do not install Yarn globally via npm. The exact Yarn version is pinned in the root `package.json` `packageManager` field.

## Getting Started

### 1. Enable Corepack and install dependencies

```bash
corepack enable
yarn install:all
```

This runs `yarn` in the root, `server/`, and `client/` directories.

### 2. Configure environment variables

There are no `.env.example` files. Create `.env` files manually in both `server/` and `client/`:

#### `server/.env`

```env
PORT=4000
MONGODBURL=<MongoDB Atlas connection string for production DB>
MONGODBURL_TEST=<MongoDB Atlas connection string for test/dev DB>
SESSION_SECRET=<any random string for cookie signing>
API_MODE=production
SSOBASEURL=https://secure.its.yale.edu/cas
SERVER_BASE_URL=http://localhost:4000
YALIES_API_KEY=<API key from yalies.io>
OPENAI_API_KEY=<OpenAI API key for embedding generation>
```

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: `4000`) |
| `MONGODBURL` | **Yes** | MongoDB connection string (production) |
| `MONGODBURL_TEST` | For test mode | MongoDB connection string (test/dev) |
| `MONGODBURL_MIGRATION` | For migration mode | Second MongoDB connection for migration |
| `SESSION_SECRET` | **Yes** | Secret for cookie-session signing |
| `API_MODE` | No | `production` (default), `test`, or `productionMigration` |
| `SSOBASEURL` | **Yes** | Yale CAS SSO base URL |
| `SERVER_BASE_URL` | **Yes** | Public URL of the server (used for CAS callbacks) |
| `YALIES_API_KEY` | No | API key for [yalies.io](https://yalies.io) student lookup |
| `OPENAI_API_KEY` | No | OpenAI API key for listing embedding generation |

> For local development, use `https://secure-tst.its.yale.edu/cas` as the `SSOBASEURL` (Yale's test CAS server).

#### `client/.env`

```env
VITE_APP_SERVER=http://localhost:4000
```

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_APP_SERVER` | **Yes** | URL of the backend API server |

### 3. Start development servers

Open **two terminals**:

```bash
# Terminal 1 — Client (Vite dev server on port 3000)
yarn dev:client

# Terminal 2 — Server (Express with nodemon on port 4000)
yarn dev:server
```

Go to **http://localhost:3000** to view the application.

> **Dev login:** In development mode, the server exposes `GET /api/dev-login` which logs you in as a test user (`test123` / `student`) without CAS, then redirects to the client. Visit `http://localhost:4000/api/dev-login` to bypass CAS.

### Available Scripts (root `package.json`)

| Script | Command | Description |
|--------|---------|-------------|
| `yarn install:all` | Install deps in root + server + client | |
| `yarn dev:client` | `cd client && yarn dev` | Start Vite dev server |
| `yarn dev:server` | `cd server && yarn dev` | Start Express with nodemon |
| `yarn build` | `corepack enable && yarn install:all && yarn build:server && yarn build:client` | Full production build |
| `yarn start` | `concurrently "yarn start:client" "yarn start:server"` | Run both in production mode |
| `yarn test` | `yarn install:all && yarn build && yarn start` | Build and run (not unit tests) |

## Project Structure

```
ylabs/
├── client/                  # React frontend (Vite)
│   └── src/
│       ├── pages/           # Route-level page components
│       ├── components/      # Reusable UI components
│       ├── contexts/        # React Context definitions
│       ├── providers/       # Context providers (data fetching)
│       ├── hooks/           # Custom React hooks
│       ├── types/           # TypeScript interfaces
│       └── utils/           # Helpers, API client, constants
├── server/                  # Express backend
│   └── src/
│       ├── routes/          # Express routers
│       ├── controllers/     # Route handlers
│       ├── services/        # Business logic
│       ├── models/          # Mongoose schemas
│       ├── middleware/      # Auth, validation, error handling
│       ├── db/              # MongoDB connection management
│       ├── utils/           # Shared utilities
│       └── scripts/         # One-off data scripts
├── data-migration/          # Migration and seeding scripts
└── docs/                    # Design documents
```

## Key Integrations

| Integration | Purpose | Auth Required |
|-------------|---------|---------------|
| [Yale CAS](https://developers.yale.edu/cas-central-authentication-service) | SSO authentication | CAS server URL |
| [Yalies API](https://yalies.io) | Student/grad data lookup | API key |
| [Yale Directory](https://directory.yale.edu) | Faculty data lookup | None |
| [CourseTable](https://coursetable.com) | Professor course data | None (public API) |
| [OpenAI](https://platform.openai.com) | Listing embedding generation for semantic search | API key |

## Acknowledgements

Thanks [@wu-json](https://github.com/wu-json) for creating a CAS authentication [demo](https://github.com/yale-swe/cas-auth-example-express/tree/main).