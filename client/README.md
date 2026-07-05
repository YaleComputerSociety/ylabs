# Y/Labs Client

React 19 + TypeScript client built with Vite. The app talks to the Express API configured by `VITE_APP_SERVER`.

Public research routes update the document title, canonical URL, description, Open Graph tags, and Twitter card tags from public-safe listing fields after the SPA loads. The production Express server also injects crawler-visible metadata into the built `index.html` for `/research` and `/research/:slug`; the client updater is the Vite/static-host fallback.

## Environment

Create `client/.env` for local development:

```bash
VITE_APP_SERVER=http://localhost:4000
# Optional Sentry client error tracking:
# VITE_SENTRY_DSN=
# VITE_SENTRY_ENVIRONMENT=development
# VITE_SENTRY_RELEASE=
```

When `VITE_SENTRY_DSN` is set, `src/utils/errorTracking.ts` initializes Sentry and the root `ErrorBoundary` reports unexpected render errors.

## Scripts

```bash
yarn dev      # Vite dev server on port 3000
yarn build    # Production build
yarn preview  # Preview the production build
yarn test     # Vitest watch mode
yarn test:ci  # Single Vitest run
```
