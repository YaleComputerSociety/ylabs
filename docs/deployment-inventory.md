# Deployment Inventory and Service Rebuild Checklist

This is the record of what each deployed service is and which environment variables it needs, so a deleted or misconfigured service can be rebuilt from the repository rather than from memory (#4153).
It records names, owners, and consequences only.
Never write a value, a host, a password, a key, or a connection string here, and never copy one out of a `.env` file into this page.

The repository declares no Render blueprint, so the Render dashboard is the only place the live configuration exists.
`scripts/deployment-inventory.test.mjs` fails when code under `server/src`, `client/src`, `client/scripts`, or `scripts/` reads an environment variable name that this page does not mention, so a new variable cannot ship without an entry.
That test proves a name is listed, not that the dashboard holds it, so a rebuild still reads each service's settings against the tables below.

Incident response, including how to rotate every secret named here, is owned by [the incident runbook](./incident-runbook.md).

## Services

| Service | Role | Branch | What it runs | Notes |
| ------- | ---- | ------ | ------------ | ----- |
| Beta web service | Staging API and client, `ylabs-gr4v.onrender.com` | `beta` | The server bundle, which also serves `client/dist` | Auto-deploys on every push to `beta`. |
| Production web service | Production API and client, `yalelabs.onrender.com`, custom domain `yalelabs.io` | `main` | The same, built from `main` | Auto-deploys on every push to `main`, which is a promotion merge or a hotfix. |
| Meilisearch private service | Search index, reachable only inside Render at `http://<meili-private-service>:7700` | none | The Meilisearch image | Holds `MEILI_MASTER_KEY`. Each environment's indexes are namespaced by prefix (`beta_*`, `prod_*`). |
| Beta operator service | Render cron job that exists so a one-off job can run `promote:remote-phase` for Beta | `beta` | `true`, on a schedule that never matters, such as `0 0 1 1 *` | Same region as the private Meilisearch (Ohio). Owned by `docs/data-refresh-runbook.md` ("What to set up once"). |
| Production operator service | The same for Production | `main` | The same | Holds the only stored copy of the Production write key. |
| `ylabs-scraper` | Weekly Development sweep cron job | `beta`, but each run clones `beta` HEAD itself | `deploy/sweep-runner/Dockerfile` and its `entrypoint.sh` | Virginia (US East), Docker, `4c-8g`. Owned by `docs/data-refresh-runbook.md` ("Render Cron Job Settings"). |

The repository does not record whether Beta and Production share one Meilisearch private service or run one each.
The reindex runbook's key table names a single private service, and the prefix-scoped keys from #4859 are what keep the two environments apart on a shared instance.
The maintainer should confirm which it is in the Render dashboard and correct this table.

Every Render service that builds this repository with Node uses the build command `docs/release-process.md` gives, which begins `npm install -g corepack@0.36.0 && corepack enable && bash scripts/install-all.sh --immutable`.
The Node major comes from `.node-version`.
The web services' start command, instance type, region, and health check path are not recorded in the repository, so read them from each service's Settings page and fill them in here.
`yarn --cwd server start` runs `node ../scripts/ensure-server-build-fresh.mjs` and then `node --enable-source-maps build/index.js`.

## External Accounts

| Account | What depends on it | Who administers it |
| ------- | ------------------ | ------------------ |
| MongoDB Atlas, one free cluster `yalelabs0` | Three databases on it, `Development`, `Beta`, and `Prod`, sharing one storage quota | Maintainer |
| Atlas Network Access list | Every Render service that connects to Atlas, by Render's per-region outbound ranges (`docs/release-process.md`, "The reindex step needs Render's outbound ranges on the Atlas access list") | Maintainer |
| Render workspace | Every service above, their environment variables, shells, and one-off jobs | Maintainer |
| GitHub organization | The repository, its rulesets, the merge queue, and Actions | Maintainer |
| Sentry | Server and browser error reports (`docs/research-journey-analytics.md`, Error Reporting) | Maintainer |
| OpenAI | Search query embeddings, the Meilisearch embedder, and the LLM scraper lanes | Maintainer |
| Yalies | Login classification and the directory scraper | Maintainer |
| Yale CAS | Login; it needs no credential, only `SSOBASEURL` and a callback on `SERVER_BASE_URL` | Yale |
| External uptime monitor on `https://yalelabs.io/api/ready` | Production outage alerts (`docs/release-process.md`, "Monitoring production") | Maintainer; the provider is not yet recorded |

The free Atlas cluster provides no backups, and no off-cluster dump exists yet (#4148).

## Web Service Variables (Beta and Production)

Both web services read the same names; only the values differ.
"Deployed runtime" below means any process that is not CI, a test, or a `development` process whose `SERVER_BASE_URL` is a localhost URL (`requiresDeployedRuntimeSecurity` in `server/src/utils/environment.ts`).
A Render service is therefore a deployed runtime whatever `NODE_ENV` says, unless it is set to `ci` or `test`, which it must never be.

| Variable | Required | What breaks without it | Secret |
| -------- | -------- | ---------------------- | ------ |
| `MONGODBURL` | Yes | Boot fails: `initializeConnections` throws `MONGODBURL is required` and the process exits 1. It must name the environment's own database, which `yarn --cwd server database:verify-names --serving <beta\|production>` checks without connecting. | Yes |
| `SESSION_SECRET` | Yes | Boot fails in `server/src/app.ts` when it is shorter than 32 characters, has fewer than 8 distinct characters, or contains a weak word such as `secret` or `production`. Changing it signs every user out (#4484). | Yes |
| `TRUSTED_PROXY_CIDRS` | Yes | Boot fails when it is empty, and an entry wider than IPv4 `/8`, IPv6 `/29`, or IPv4-mapped `/104` refuses startup (`server/src/utils/trustedProxyCidrs.ts`). A wrong but valid list puts callers in the wrong rate-limit bucket instead of failing. | No |
| `SSOBASEURL` | Yes | Boot fails unless it is an HTTPS URL with no credentials, query, fragment, or private host. | No |
| `SERVER_BASE_URL` | Yes | The same checks. It is also the CAS callback base, so a wrong value breaks login. | No |
| `MEILISEARCH_HOST` | Yes | Boot fails in a deployed runtime (`assertDeployedMeiliConnectionConfig`). | No, but it is an internal address, so do not publish it |
| `MEILISEARCH_INDEX_PREFIX` | Yes | Boot fails in a deployed runtime. The value is `beta` or `prod`, with no trailing underscore. | No |
| `MEILISEARCH_SEARCH_API_KEY` | Yes, once created | Without it and without the legacy key, search answers `503` and `/api/ready` reports `search: false`. | Yes |
| `MEILISEARCH_API_KEY` | No; legacy | The fallback for either Meilisearch role, which logs one warning per role. Remove it from the web service once the scoped key is live. | Yes |
| `MEILISEARCH_WRITE_API_KEY` | Beta only | Beta stores its `beta_*` write key here so a Render one-off job can reindex Beta. It must never be set on the Production web service. | Yes |
| `OPENAI_API_KEY` | No | Search query embedding is skipped and search serves its keyword leg only. | Yes |
| `YALIES_API_KEY` | No | Login still works, but classification falls back to the `userType` a previous login stored, or `unknown`. | Yes |
| `SENTRY_DSN` | No | No server error reports. | Treat as secret, because it lets anyone post events into the project |
| `SENTRY_ENVIRONMENT` | No | Reports are labelled with `NODE_ENV`, or `development`. | No |
| `SENTRY_RELEASE` | No | Falls back to `RENDER_GIT_COMMIT`, which Render sets on every deploy, so leave it unset. | No |
| `RENDER_GIT_COMMIT` | Set by Render | Reports carry no release. Never set it by hand. | No |
| `RENDER` | Set by Render | `GET /api/config` reports `provider: unknown` instead of `render`. | No |
| `RENDER_EXTERNAL_URL` | Set by Render | CORS trusts the service's own origin only through the allowlist, so a pull request preview, whose `onrender.com` origin is on no allowlist, renders a blank page. Only an exact `https` `onrender.com` origin with no port or path is trusted (`server/src/middleware/corsOrigin.ts`). Never set it by hand. | No |
| `VITE_SENTRY_DSN` | No | The server reads it too: `server/src/middleware/securityHeaders.ts` opens `connect-src` to the Sentry ingest origin only when it is set, so without it the browser cannot deliver reports. | No; it ships in the client bundle by design |
| `NODE_ENV` | Recommended, `production` | See "Deployed runtime" above. | No |
| `PORT` | Set by Render | Defaults to 4000. | No |
| `FIRST_CONTACT_RATE_LIMIT_MAX` | No | Defaults to 300 per 15 minutes per address, floored at 50. Boot logs the effective value. | No |
| `RESEARCH_SEARCH_EMBEDDING_MAX_PER_MINUTE` | No | Defaults to 600, floored at 60. | No |
| `RESEARCH_SEARCH_EMBEDDING_MAX_PER_CLIENT_PER_MINUTE` | No | Defaults to 120, floored at 10. | No |
| `RESEARCH_SEARCH_EMBEDDING_COOLDOWN_MS` | No | Defaults to 60000, floored at 1000. | No |
| `GATE_REFRESH_INTERVAL_MINUTES` | No | The in-process gate-scorecard refresh stays off. | No |
| `GATE_REFRESH_SKIP_HEAVY` | No | Heavy refresh work runs when the refresh is on. | No |
| `GATE_SCORECARD_MAX_AGE_HOURS` | No | The operator board uses its default staleness window. | No |
| `GATE_ARTIFACT_DIR` | No | Gate scorecard artifacts are read from and written to the operating system's temporary directory. | No |
| `CORPUS_SNAPSHOT_DISABLED` | No | Unset means the in-process corpus quality snapshot runs; only `true` turns it off. | No |
| `CORPUS_SNAPSHOT_MAX_AGE_HOURS` | No | The snapshot scheduler uses its default age before taking a new measurement. | No |
| `BETA_DATA_QUALITY_SCORECARD_PATH`, `BETA_REPAIR_QUEUE_REPORT_PATH`, `SCRAPER_INTEGRITY_SCORECARD_PATH`, `PROMOTION_COPY_DRY_RUN_REPORT_PATH`, `LAUNCH_TRUST_SCORECARD_PATH`, `LAUNCH_REVIEW_EXCEPTIONS_REPORT_PATH`, `LAUNCH_ACQUISITION_REPORT_PATH` | No | Each overrides one artifact path the admin operator board reads, which otherwise sits under `GATE_ARTIFACT_DIR`. | No |
| `FEATURE_<FLAG>` | Per flag | One per entry in `RELEASE_FEATURE_FLAGS`, which is empty today. Only the exact string `true` turns a flag on (`docs/release-process.md`, "Holding one feature instead of the whole release"). | No |

These must never be set on a web service: `LOCAL_AUTH_BYPASS`, `LOCAL_AUTH_BYPASS_NETID`, `LOCAL_AUTH_BYPASS_USER_TYPE`, and `AUTH_DEBUG`.
The bypass applies only to a loopback caller in a local development runtime, so it is inert on Render, but a value there is a sign that someone copied a local `.env`.

### Client build variables

The web service builds the client, so these are read at build time from the same service's environment.
A change needs a redeploy, not only a restart.

| Variable | Required | What breaks without it | Secret |
| -------- | -------- | ---------------------- | ------ |
| `VITE_APP_SERVER` | Beta only | `client/src/utils/apiBaseUrl.ts` uses `https://yalelabs.io` on the production host and this value everywhere else, falling back to `http://localhost:4000`, so a Beta build without it calls a localhost API. | No |
| `VITE_SENTRY_DSN` | No | No browser error reports. | No; public in the bundle |
| `VITE_SENTRY_ENVIRONMENT` | No | Falls back to the Vite `MODE`. | No |
| `VITE_SENTRY_RELEASE` | No | Browser reports carry no release. | No |

`DEV` and `MODE` are Vite built-ins, not variables anyone sets.

## Meilisearch Private Service Variables

| Variable | Required | What breaks without it | Secret |
| -------- | -------- | ---------------------- | ------ |
| `MEILI_MASTER_KEY` | Yes | Without it the instance either runs unprotected or refuses to start, depending on its environment mode. Meilisearch derives every API key from it, so changing it changes every key's value. | Yes |

The master key never leaves this service, because keys are created from its own shell (`docs/meilisearch-reindex-runbook.md`, "Creating the keys").
Whether the service has a persistent disk is not recorded in the repository.
Without one, a restart starts an empty instance and every environment needs a reindex.

## Operator Service Variables (Beta and Production)

A one-off job runs on the operator service's latest build with that service's current variables, and the API cannot add a variable per job.

| Variable | Beta | Production | What breaks without it | Secret |
| -------- | ---- | ---------- | ---------------------- | ------ |
| `SCRAPER_ENV` | `beta` | `production` | Guarded scripts cannot resolve the environment and refuse. | No |
| `MONGODBURL` | Beta database | `Prod` database | Every phase refuses. | Yes |
| `MEILISEARCH_HOST` | Yes | Yes | The reindex refuses. | No |
| `MEILISEARCH_INDEX_PREFIX` | `beta` | `prod` | The reindex refuses an empty prefix. | No |
| `MEILISEARCH_WRITE_API_KEY` | `beta_*` key | `prod_*` key | The rebuild fails before the swap, and the serving index is unchanged. | Yes |
| `OPENAI_API_KEY` | Yes | Yes | A rebuild of an index with a stored embedder is refused, rather than silently serving keyword-only search. | Yes |
| `PFR3_MEILI_RESTORE_POINT` | No | Before each promotion | `promote:remote-phase` refuses for Production. | No |
| `CONFIRM_PROD_SCRAPE` | No | Set by the job command | The Production reindex refuses at the write, after the preflight has printed. | No |

## Weekly Sweep Cron Variables (`ylabs-scraper`)

| Variable | Required | What breaks without it | Secret |
| -------- | -------- | ---------------------- | ------ |
| `MONGODBURL` | Yes, the `Development` database | The job refuses unless it names `Development`. | Yes |
| `OPENAI_API_KEY` | Yes | The job refuses in its first second. Give it its own key so it can be spend-capped and rotated alone. | Yes |
| `YALIES_API_KEY` | Yes | The job refuses in its first second. | Yes |
| `SCRAPLING_RENDERER_ENABLED` | No | Defaults to `false`, so the rendered-fetch lanes fetch plainly. | No |
| `SCRAPER_PER_HOST_CONCURRENCY` | No | Per-host pacing uses its defaults. | No |
| `SWEEP_REPOSITORY_URL` | No | Leave it unset on Render; it overrides the repository the entrypoint clones. | No |
| `SCRAPER_SWEEP_AUTO_MERGE_FRA`, `SCRAPER_SWEEP_DEDUPE_RESEARCHERS`, `SCRAPER_SWEEP_PORT_GRANT_SHELLS`, `SCRAPER_SWEEP_DELETE_MERGE_RESIDUE`, `SCRAPER_SWEEP_MERGE_URL_IDENTITY_DUPLICATES` | No | Each sweep stage runs by default; a value such as `0` or `false` turns that stage off (`server/src/scripts/sweepStageFlags.ts`). | No |

The entrypoint sets `SWEEP_TARGET_SHA` to the `beta` HEAD it resolved and `SEARCH_INDEX_WRITES=deferred`, and unsets every `MEILISEARCH_*` variable, so none of those belong in the dashboard.
The job refuses when `BETA_MONGODBURL`, `PRODUCTION_MONGODBURL`, `PROD_MONGODBURL`, or any other copy-pair URL is present, because it holds Development credentials only.
Scope its database user to the `Development` database, because Render's outbound ranges are shared by every service in the region.

## Operator Laptop Variables

These live in the operator's own `server/.env` or shell, never in Render and never in a commit.

| Variable | Used by | Secret |
| -------- | ------- | ------ |
| `MONGODBURL` | Development work and `yarn promote:beta` | Yes |
| `DEVELOPMENT_MONGODBURL`, `BETA_MONGODBURL`, `PRODUCTION_MONGODBURL`, `ATLAS_DEVELOPMENT_MONGODBURL` | The copy pairs: `database:verify-names --pair <pair>`, the two mirrors, and `production:promote-beta-copy` | Yes |
| `RENDER_API_KEY` | `yarn promote:beta` and `yarn promote:production`, which read the operator services and start their jobs | Yes |
| `RENDER_BETA_OPERATOR_SERVICE_ID`, `RENDER_PRODUCTION_OPERATOR_SERVICE_ID` | The same | No |
| `OPENAI_API_KEY`, `YALIES_API_KEY` | Laptop sweeps and `yarn development:search:rebuild` | Yes |
| `MEILISEARCH_HOST`, `MEILISEARCH_INDEX_PREFIX`, `MEILISEARCH_WRITE_API_KEY`, `MEILISEARCH_API_KEY` | Local Development search, where the prefix is unset | Local keys only |
| `TAVILY_API_KEY`, `EXA_API_KEY`, `BRAVE_SEARCH_API_KEY`, `PARALLEL_API_KEY` | `server/src/scripts/findLabWebsites.ts`, the lab-site discovery script | Yes |
| `YALIES_OLD_API_KEY`, `YALIES_NEW_API_KEY` | `yarn security:verify-yalies-rotation`, set only for that one command | Yes |
| `SMOKE_COOKIE` | `yarn security:smoke:production` with a signed-in check; it is a live session cookie | Yes |

## Guard and Confirmation Variables

These are typed for one command and never stored on a service.

| Variable | Meaning |
| -------- | ------- |
| `SCRAPER_ENV`, `APP_ENV` | Which environment a script believes it targets. |
| `ALLOW_NON_PROD_SCRAPER_WRITES` | Required for a Development scrape or materialize write; without it the run is silently dry. |
| `CONFIRM_PROD_SCRAPE` | Required for every guarded Production write, including the promotion copy and the reindex. |
| `CONFIRM_LANE_A_COPY` | Required for `production:promote-beta-copy --apply`. |
| `CONFIRM_DEVELOPMENT_TO_BETA_SYNC`, `CONFIRM_BETA_TO_DEVELOPMENT_SYNC`, `CONFIRM_ATLAS_DEVELOPMENT_OVERWRITE` | Required by the two mirrors. |
| `CONFIRM_PROD_MONGO_VALIDATORS` | Required to apply MongoDB validators to Production. |
| `ALLOW_REMOTE_E2E_SEED` | Allows the end-to-end smoke seed against a non-local database. |
| `PROMOTION_DATASET_VERSION` | The dataset version label the promotion copy records. |
| `SCRAPER_DEVELOPMENT_DB_NAME`, `SCRAPER_BETA_DB_NAME`, `SCRAPER_PRODUCTION_DB_NAME` | Override the database names the scraper guards expect. |
| `YLABS_SKIP_LOCAL_DOTENV` | Stops a script loading `server/.env`; the test fence sets it for spawned children. |

## Scraper and Script Tuning Variables

None of these is a secret, and none belongs on a web service.

| Variable | Read by |
| -------- | ------- |
| `SCRAPER_FIELD_RETRACTION`, `SCRAPER_FACULTY_DEPARTURE_DETECTION`, `SCRAPER_YSM_LAB_DELISTING_DETECTION`, `C4_LOSSLESS_INGEST`, `C4_RESOLVE_AT_MINT_ENTITIES` | Scraper and materializer behaviour switches |
| `SCRAPER_PER_HOST_CONCURRENCY`, `SCRAPER_ROSTER_LANE_CONCURRENCY` | Fetch pacing |
| `SCRAPER_HTTP_CACHE`, `SCRAPER_HTTP_CACHE_DIR`, `SCRAPER_HTTP_CACHE_MAX_MB`, `XDG_CACHE_HOME` | The HTTP validator cache and the host-slot broker |
| `SCRAPER_MACHINE_HOST_SLOTS`, `SCRAPER_MACHINE_HOST_SLOT_DIR`, `SCRAPER_HOST_SLOT_ACQUIRE_TIMEOUT_MS`, `SCRAPER_HOST_SLOT_BROKER` | Machine-wide host-slot sharing; the sweep sets `SCRAPER_HOST_SLOT_BROKER` for its children |
| `SCRAPER_SWEEP_PAGE_REUSE`, `SCRAPER_SWEEP_PAGE_REUSE_MAX_MB` | Sweep page reuse; the sweep sets `SCRAPER_SWEEP_PAGE_REUSE` for its children |
| `SCRAPLING_RENDERER_ENABLED`, `SCRAPLING_FETCH_MODE`, `SCRAPLING_PYTHON_COMMAND`, `SCRAPLING_BRIDGE_PATH`, `SCRAPLING_TIMEOUT_MS` | The rendered-fetch bridge |
| `SCRAPER_SWEEP_CANARY_LIMIT`, `SCRAPER_SWEEP_CANARY_CONCURRENCY`, `SCRAPER_SWEEP_CANARY_TIMEOUT_MS`, `SCRAPER_SWEEP_CLUSTER_QUOTA_MB`, `SCRAPER_SWEEP_MIN_HEADROOM_MB` | The sweep preflight |
| `SWEEP_TARGET_SHA`, `SEARCH_INDEX_WRITES` | Set by the sweep entrypoint, as above |
| `GIT_COMMIT`, `SOURCE_COMMIT`, `TMPDIR` | Code identity and temporary paths in benchmark and sweep scripts |
| `PHASE0_SEARCH_BASELINE_SALT`, `YLABS_INVENTORY_PROFILE_ACTIVE`, `YLABS_INVENTORY_PROFILE_NAME`, `YLABS_INVENTORY_PROFILE_PATH`, `YLABS_INVENTORY_SOURCE_COMMIT`, `YLABS_IDENTITY_AUDIT_PROFILE_ACTIVE`, `YLABS_SEARCH_BASELINE_PROFILE_ACTIVE`, `YLABS_SEARCH_BASELINE_PROFILE_PATH`, `YLABS_PHASE0_ALLOW_AMBIENT_TARGET` | The research-model inventory and search-baseline profiles |
| `AUDIT_LIMIT`, `AUDIT_PAGE_SIZE`, `AUDIT_QUERY`, `CLIENT_BASE`, `SERVER_BASE`, `HEADLESS`, `SCREENSHOT_FAILURES`, `RESEARCH_QUERY`, `MOBILE_QUERY`, `E2E_BASE_URL`, `OUT_DIR` | Browser audit and end-to-end smoke scripts |
| `SMOKE_API_BASE`, `SMOKE_APP_BASE`, `SMOKE_OPPORTUNITY_ID`, `SMOKE_OUT_DIR` | `yarn security:smoke:production` |
| `DEPENDENCY_AUDIT_ALLOW_UNREACHABLE`, `DEPENDENCY_AUDIT_ATTEMPTS`, `DEPENDENCY_AUDIT_RETRY_DELAY_MS`, `DEPENDENCY_AUDIT_TIMEOUT_MS`, `DEPENDENCY_AUDIT_VERDICT_FILE` | The dependency audit |
| `GH_REPO`, `GH_IDENTIFIER_GUARD_SHIM`, `PATH` | The `gh` identifier guard |

GitHub Actions holds no repository secret.
The workflows read one repository variable, `ALLOW_UNREACHABLE_ADVISORY_AUDIT`, in `ci.yml`.

## Ownership Record

The prerequisites in `docs/data-refresh-runbook.md` ("Sustainable Ownership") call for at least two administrators on every platform and a team secret manager.
Record the count by role, never by name, and the date it was last checked.

| Platform | Administrators | Last checked |
| -------- | -------------- | ------------ |
| GitHub organization | not recorded | never |
| Render workspace | not recorded | never |
| MongoDB Atlas project | not recorded | never |
| Meilisearch master key holders | not recorded | never |
| Sentry, OpenAI, and Yalies | not recorded | never |
| Team secret manager holding the Beta and Production operator credentials | not recorded | never |

Until a second approved operator holds the Production credentials, a lost laptop or a lost dashboard login stops every promotion, re-gate, and reindex.

## Rebuilding a Service

Rebuild in this order, because each step needs the one before it.
Everything here except the verification is a maintainer action in a dashboard.

1. **Atlas.** Confirm the cluster is up and the target database exists. Create or confirm the service's database user, scoped to that service's one database.
2. **Create the service** in the Render dashboard with the branch, runtime, and region from [Services](#services). For a web service use the build command above. For `ylabs-scraper` use Docker with `deploy/sweep-runner/Dockerfile` and the build context at the repository root.
3. **Set every required variable** from the matching table above, and mark each secret as a secret. Do not copy a variable another service holds unless the table says this service needs it; in particular, never put a Production write key on the Production web service.
4. **Allow its outbound ranges into Atlas.** On the new service open Connect, then the Outbound tab, and add each range to Atlas Network Access. Ranges are per region, so a service in a new region needs new entries. Remove any stale `/32`.
5. **Deploy, then read the boot log.** A missing required variable fails boot with a message naming it, which is the point of the fail-fast checks.
6. **Restore search.** For a rebuilt Meilisearch service, create the scoped keys from its shell, set them on the web and operator services, redeploy those, and reindex each environment per `docs/meilisearch-reindex-runbook.md`: Beta by one-off job, Production from its shell.
7. **Point the domain.** If the rebuilt service is the Production web service, attach `yalelabs.io` to it and keep `SERVER_BASE_URL` equal to the public origin CAS calls back.
8. **Verify.** `curl -s https://<host>/api/ready` answers `200` with `{"mongo":true,"search":true}`. For Production, also run `yarn security:smoke:production` from a laptop. For Beta, the next `Keep Alive` run closes any open `beta-probe-failing` issue.
9. **Update this page** with anything the rebuild found that it did not record.
