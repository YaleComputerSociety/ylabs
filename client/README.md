# Y/Labs Client

React 19 + TypeScript client built with Vite. The app talks to the Express API configured by `VITE_APP_SERVER`.

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

## Fellowship Surfaces

The `/fellowships` page derives application state with `src/utils/fellowshipStatus.ts`, grouping programs into Closing Soon, Open, Opening Soon, and Closed sections from `isAcceptingApplications`, `applicationOpenDate`, and `deadline`. Browse cards, list rows, detail modals, and admin fellowship edit forms use the same helper so deadline labels, open-window warnings, and eligibility summaries stay consistent.

Eligibility summaries come from structured fellowship filters (`yearOfStudy`, `termOfAward`, `purpose`, `globalRegions`, `citizenshipStatus`) when available, fall back to the free-form `eligibility` field, and show a warning when neither source is present.

## Scripts

```bash
yarn dev      # Vite dev server on port 3000
yarn build    # Production build
yarn preview  # Preview the production build
yarn test     # Vitest watch mode
yarn test:ci  # Single Vitest run
```
