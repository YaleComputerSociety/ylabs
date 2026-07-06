# Y/Labs Client

React 19 + TypeScript client built with Vite. The app talks to the Express API configured by `VITE_APP_SERVER` through the shared client in `src/utils/axios.ts`.

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

## API Handling

Use `src/utils/axios.ts` for app API calls so base URL, credentials, and global HTTP handling stay consistent. The shared client emits app-wide events for `401` responses, which clear auth state through `UserContextProvider`, and for `429` responses, which display the server rate-limit message and retry guidance through `HttpStatusNotifier`.

## Scripts

```bash
yarn dev      # Vite dev server on port 3000
yarn build    # Production build
yarn preview  # Preview the production build
yarn test     # Vitest watch mode
yarn test:ci  # Single Vitest run
```
