# Yale Research - Client

The Yale Research web client: a React 19 + TypeScript single-page app built with Vite and styled with Tailwind CSS.
It is the student-facing surface for research discovery, program and fellowship browsing, and the account dashboard.

See `PRODUCT.md` for the product model and `../AGENTS.md` for repository-wide conventions.
When changing UI, read `DESIGN.md` (the design-token system) and `../skills/frontend-polish/SKILL.md` (the polish and accessibility bar).

## Prerequisites

- Node 20 (see the repo toolchain notes; newer majors can break the jsdom test environment).
- Yarn (managed via Corepack).

Install dependencies from the repository root with `yarn install:all`, or from this directory with `yarn`.

## Scripts

Run these from the `client/` directory:

- `yarn dev` - start the Vite dev server (defaults to port 3000; pass `--port <n>` to run alongside other instances).
- `yarn build` - produce the production build.
- `yarn preview` - serve the production build locally.
- `yarn test` - run the Vitest suite in watch mode.
- `yarn test:ci` - run the Vitest suite once (used in CI).

## Structure

- `src/pages/` - route-level pages.
- `src/components/` - components grouped by domain (`admin`, `analytics`, `research`, `labs`, `fellowship`, `profile`, `accounts`), plus `components/shared/` for reusable primitives.
- `src/contexts/`, `src/providers/`, `src/reducers/` - React Context state with `useReducer`.
- `src/hooks/`, `src/utils/`, `src/types/` - shared hooks, helpers, and types.

Data is fetched over HTTP with the configured Axios client in `src/utils/axios.ts`; prefer it over importing `axios` directly so requests pass through the shared interceptors.
