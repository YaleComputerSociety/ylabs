# Root Scripts

These files are active repo tooling, not leftovers.
Check this inventory before deleting or moving anything in this directory.

| File | Current use |
|------|-------------|
| `check-no-secrets.mjs` | Root `security:secrets` script. |
| `check-no-secrets-core.mjs` | Shared implementation for `check-no-secrets.mjs` and `check-no-secrets.test.mjs`. |
| `check-no-secrets.test.mjs` | Node test coverage for the secret scanner. |
| `ensure-server-build-fresh.mjs` | Server `start` preflight in `server/package.json`. |
| `research-detail-professor-audit.mjs` | Root `audit:research-detail-professors` script. |
| `research-detail-professor-audit-core.mjs` | Shared helpers for the audit script and server-side tests. |
| `security-preflight.test.mjs` | Root `security:policy` script and broad security policy coverage. |
| `unified-research-search-audit.mjs` | Root `audit:unified-research` script. |
| `with-playwright-libs.sh` | Root `playwright:run` wrapper and Playwright MCP setup helper. |

The root audit scripts are intentionally kept here because they exercise the built application across client and server boundaries.
Server-only data repair, scraper, and migration commands belong under `server/src/scripts/`.
