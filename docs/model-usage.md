# Model call usage

Every OpenAI call the server makes goes through one client, `server/src/utils/modelClient.ts` (#5523).
It owns the endpoint, the auth header, the timeout and the request shape, and it records one `model_call_usages` document per call that reached the network.
A regression test (`server/src/utils/__tests__/modelClientIsTheOnlyOpenAiCaller.test.ts`) drives each lane's and script's default model call through its public entry and fails when one reaches OpenAI without leaving a record under its caller.

## Reading spend

```bash
yarn --cwd server model-usage:report --environment development --since-days 30
```

The report groups calls by caller and model, with call and failure counts, prompt tokens (and how many were billed at the cached rate), completion tokens, and an estimated cost.
Rows are ranked by estimated cost, so the first row is the lane or script to look at first.
`--environment` must match the database `MONGODBURL` names, exactly as `corpus:snapshot` checks it.

The cost is an estimate at the list prices in `server/src/utils/modelPricing.ts`, not the invoice.
A model missing from that table is reported as `unpriced` rather than counted as free, so add its price when a lane adopts a new model.

## What is and is not recorded

- Each caller is a name from `MODEL_CALLERS` in `modelClient.ts`: the lane's source name for a scraper lane, or the script's name for an operator script.
- A failed call is recorded with `succeeded: false` and zero tokens, so a run that retries a failing upstream shows up as failures rather than vanishing.
- A response a benchmark replay serves from its frozen pages is not recorded, because nothing was billed. `snapshotBenchmarkMode.ts` marks such a response with the `FROZEN_MODEL_RESPONSE_HEADER` header.
- A request a benchmark replay refuses because it has no frozen response is not recorded either, because it never left the process.
- `scrape:canary` is write-free by construction, so it switches recording off with `setModelUsageSink(null)`, and its model calls are not in the report.
- The record is written before the call returns, so a script that disconnects right after its last call still keeps it.
- A process with no open database connection records nothing, and a write that fails is dropped without failing the call it describes.
- Meilisearch's own embedder calls OpenAI with the key it was configured with, during an index rebuild and for a hybrid search that arrives without a vector. Those calls never pass through this client, so the report does not include them.

## Where it lives

`model_call_usages` is environment-local (`NEVER_COPY_COLLECTIONS` and `PRESERVED_ENVIRONMENT_LOCAL_COLLECTIONS` in `server/src/scripts/mirrorCollectionPolicy.ts`): it records the calls this environment's processes made, so a promotion or refresh never copies or clears it.
Documents expire 365 days after `calledAt` through a TTL index, because the web service records one per search embedding and the collection would otherwise grow without bound.
A year covers any window the report is asked for when deciding on cost work.
The TTL index is built deliberately with `yarn --cwd server db:build-indexes --apply`, like every other index, and nothing expires until it is.
