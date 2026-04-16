# YURA Research Database

A research lab and fellowship discovery platform for Yale University.

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

Go to **http://localhost:3000**. Use `http://localhost:4000/api/dev-login` to bypass CAS auth locally.

## Documentation

See **[DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)** for full setup instructions, architecture details, environment configuration, and contribution guidelines.

## Acknowledgements

Thanks [@wu-json](https://github.com/wu-json) for creating a CAS authentication [demo](https://github.com/yale-swe/cas-auth-example-express/tree/main).
