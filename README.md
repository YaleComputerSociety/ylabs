# YURA Research Database

A research lab and fellowship discovery platform for Yale University, with public research browsing, evidence/source metadata on research details, and authenticated tools for favorites, contact, and management.

**Live:** [yalelabs.io](https://yalelabs.io/) · **Beta:** [ylabs-dev.onrender.com](https://ylabs-dev.onrender.com)

## Tech Stack

| Layer           | Tech                                                         |
| --------------- | ------------------------------------------------------------ |
| Client          | React 19, TypeScript, Vite, TailwindCSS, MUI                 |
| Server          | Express 4, TypeScript, Passport.js (Yale CAS)                |
| Database        | MongoDB Atlas (Mongoose 8)                                   |
| Search          | Meilisearch (hybrid: keyword + semantic via OpenAI embedder) |
| Error Tracking  | Sentry for client and server runtime exceptions              |
| Package Manager | Yarn 4 via Corepack                                          |

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

Go to **http://localhost:3000**. Public research discovery is available at **http://localhost:3000/research** with shareable URLs for search text, filters, sorting, quick filters, and detail modals; the authenticated Find Labs page may show an empty state locally until the Development database has listings, and it links to fellowships when fellowship data is available. Use `http://localhost:4000/api/dev-login` to bypass CAS auth locally for authenticated actions.

## Documentation

See **[DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)** for full setup instructions, architecture details, environment configuration, and contribution guidelines.

## Acknowledgements

Thanks [@wu-json](https://github.com/wu-json) for creating a CAS authentication [demo](https://github.com/yale-swe/cas-auth-example-express/tree/main).
