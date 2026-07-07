### Purpose of Data Migration

Yale Labs has been collecting data over a somewhat long period of time. For this reason we have data from 2017 that is:

- Either out of date
- Not good enough

The purpose of data migration is to give a way for us to easily migrate data to new models updating or deleting old listings.

### Data acquisition and refresh safety

Run data refresh commands from this directory. Commands that were updated for safer operation default to a dry run and print validation counts before any external write is allowed.

Common options:

| Option                                    | Meaning                                                                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `--dry-run`                               | Validate inputs and print a summary without writing; this is the default for the npm commands below.                                     |
| `--execute`                               | Allow the script to write after safety checks pass.                                                                                      |
| `--target local\|test\|dev\|beta\|prod`   | Names the intended write target. Required with `--execute`; writes also verify the resolved MongoDB database and Meilisearch prefix match. |
| `--csv path/to/file.csv`                  | Uses an explicit fellowship CSV. Required when executing the fellowship import.                                                          |
| `--summary ./tmp/name.json`               | Writes a JSON summary with row counts, validation results, and target metadata; must be a `.json` file under `./tmp` or the system temp directory. |
| `--replace-existing`                      | Allows the fellowship import to replace existing fellowship rows after a dry run has been reviewed.                                      |
| `--allow-production --confirm-production` | Required together for any `--target prod` write. Do not use these from local automation without an explicit production runbook decision. |

Fellowship CSV refresh:

```sh
npm run import:fellowships -- --csv ../web-scraper/fellowships/yale_fellowships.csv --summary ./tmp/fellowships-summary.json
npm run import:fellowships:execute -- --target dev --csv ../web-scraper/fellowships/yale_fellowships.csv --summary ./tmp/fellowships-import.json
npm run import:fellowships:execute -- --target dev --replace-existing --csv ../web-scraper/fellowships/yale_fellowships.csv
```

The fellowship importer validates generated fellowship documents before connecting to MongoDB. If records already exist, execution refuses to delete them unless `--replace-existing` is supplied.

Meilisearch listing refresh:

```sh
npm run migrate:meilisearch -- --summary ./tmp/meili-listings-summary.json
MEILISEARCH_INDEX_PREFIX=dev npm run migrate:meilisearch:execute -- --target dev --summary ./tmp/meili-listings-execute.json
```

The Meilisearch migration reads listings from `MONGODBURL`, strips Mongo-only fields and private evidence notes (`_id`, `__v`, `embedding`, `evidence.internalNotes`), validates the indexing payload, and writes only when `--execute --target ...` is present.

Production and shared services:

- Do not run destructive or external data acquisition jobs against production from a disposable worktree.
- Use dry runs and summaries first; inspect validation errors and warnings before any execute run.
- Keep `MEILISEARCH_INDEX_PREFIX` set for shared Meilisearch instances so beta/dev/prod indexes stay isolated.
