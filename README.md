# Yale Research

A research-discovery app for Yale students. It helps students find research homes, evidence-backed pathways, posted opportunities when they exist, and the best next step toward a specific Yale research context.

**Live:** [yalelabs.io](https://yalelabs.io/) · **Beta:** [ylabs-dev.onrender.com](https://ylabs-dev.onrender.com)

## Tech Stack

| Layer | Tech |
|-------|------|
| Client | React 19, TypeScript, Vite, TailwindCSS, MUI |
| Server | Express 4, TypeScript, Passport.js (Yale CAS) |
| Database | MongoDB Atlas (Mongoose 8) |
| Search | Meilisearch (hybrid: keyword + semantic via OpenAI embedder) |
| Package Manager | Yarn 4 via Corepack |

## Quick Start

```bash
corepack enable
yarn install:all
```

Create `server/.env` and `client/.env` — see the [Developer Guide](DEVELOPER_GUIDE.md) for required variables.

```bash
# Terminal 1
yarn dev:client

# Terminal 2
yarn dev:server
```

Go to **http://localhost:3000**. Use `http://localhost:4000/api/dev-login` for a local session, or set `LOCAL_AUTH_BYPASS=true` in `server/.env` to inject the default `devadmin` admin user on protected API requests. Leave that flag off when testing the real CAS flow at `/api/cas`.

## Product Surfaces

- `/research`: Yale Labs, the primary discovery surface for labs, centers, institutes, faculty projects, archives, collections projects, RA programs, and other research homes. Cards are enriched with compact ways-in evidence when it exists.
- `/programs`: Programs & Fellowships, the structured application and planning surface for open cycles, closing-soon deadlines, likely next cycles, center internships, fellowships, and recurring research programs.
- `/account`: Dashboard, the private saved-planning workspace for research plans, saved programs, notes, checklist context, and next deadlines.
- `/research/:slug`: research-home detail pages with the student decision summary, evidence level, recommended next step, people, sources, and ways-in context.
- `/opportunities/:id`: detail pages for real active or time-bound posted opportunities only.

The old Listings board and public Pathways page are retired. `/listings` and `/pathways` redirect to `/research`; `/fellowships` redirects to `/programs`. New work should use `ResearchEntity`, `EntryPathway`, `AccessSignal`, `ContactRoute`, and `PostedOpportunity` concepts instead of recreating listing-style flows.

## Release Posture

Beta is live testing and the release gate. Production promotion requires a recent Beta data-quality run, scraper integrity gate, semantic Research search readiness when semantic search is enabled, backup/rollback confirmation, Meilisearch sync, and smoke tests.

Scrapers run as short-lived CLI or cron jobs outside the web service process. Do not add a separate always-on scraper server unless runtime limits, queueing, or operator-triggered job requirements make cron insufficient.

### Playwright environment fix (no root required)

If `npx playwright` crashes with missing system libs (for example `libnspr4.so`), run Playwright through the local shim:

```bash
yarn playwright:run screenshot https://example.com /tmp/example.png
```

This command downloads the required shared libraries into `./.playwright-libs` and launches Playwright with `LD_LIBRARY_PATH` pointed to that local copy.

For Codex browser exploration, register Playwright MCP through the same shim:

```bash
codex mcp add playwright -- /home/quntaoz/ylabs/scripts/with-playwright-libs.sh npx -y @playwright/mcp@latest --output-dir /home/quntaoz/ylabs/tmp/playwright-mcp
```

Use Playwright MCP for exploratory browser passes, then codify durable findings in Playwright scripts or tests such as `yarn audit:unified-research`.

## Documentation

See **[DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)** for full setup instructions, architecture details, environment configuration, and contribution guidelines. See **[docs/scraper-deployment-runbook.md](docs/scraper-deployment-runbook.md)** for scraper rollout and cron posture.

## Acknowledgements

Thanks [@wu-json](https://github.com/wu-json) for creating a CAS authentication [demo](https://github.com/yale-swe/cas-auth-example-express/tree/main).
