# Meilisearch reindex runbook

How to rebuild the research-entity search index for an environment, and how to confirm it worked.

Read this before running anything against Beta or Production.

## When a reindex is required

The index stores a snapshot of each entity, so a code change that alters what gets indexed does nothing to rows already in the index.
Until the index is rebuilt, the old documents keep being served.

`#2396` is the current example.
`studentSearchTerms` was derived from unsanitized descriptions, so entities were findable by topic aliases that no served copy supports: a student searched a term, got a hit, opened the card, and the term was nowhere on the page.
The code fix landed in `e9fa5754`, but **Beta and Production keep serving the bad aliases until they are reindexed**.
Dev has already been rebuilt.

A second, unrelated reason is now pending on the same run.
`#2527` removed the `hasDocumentedWayIn` filterable attribute, and `#2540` unset the stored field and dropped its Mongo index in all three environments, but a removed `filterableAttributes` entry survives in an already-built index.
So Beta and Production still advertise `hasDocumentedWayIn` as filterable until they are rebuilt.
That residue is inert rather than harmful, since nothing sends the filter and the field is absent from every document; the next reindex clears it as a side effect.

The 2026-09-15 undergraduate-logistics retirement adds three more attributes of the same shape.
`undergraduateCurrentAvailability`, `undergraduateCompensationModel` and `undergraduateEligibleStudentLevels` were removed from `filterableAttributes`, so all three survive as advertised-but-inert entries in every already-built index until it is rebuilt.
These three differ from `hasDocumentedWayIn` in one way that matters: the stored Mongo fields are still populated until `retire:undergraduate-logistics-fields` has run, so it is the index document allowlist, `RESEARCH_ENTITY_SEARCH_INDEX_DOCUMENT_FIELDS` in `researchEntitySearchIndexService.ts`, that keeps the frozen values out of the rebuilt documents in the meantime (#3944).
The rest of the vertical was retired on 2026-09-23 (#3088), which adds no Meilisearch attribute to remove, because the five claim types were never filterable or sortable.
A rebuild therefore does not need to wait for that retirement, and running it first does not reintroduce the values.

## Where to run it

Development is the only environment you rebuild from your own machine.
Its Meilisearch is the local Docker container in `compose.yaml`, bound to `127.0.0.1:7700`.

**Beta and Production are Render private services, so run their reindex from the Render shell for that service, not from a laptop.**
The Meilisearch private service is addressed as `http://<meili-private-service>:7700`, which only resolves inside Render's network.
A local run against a private host cannot connect, so it fails rather than half-finishing, but it also means a local attempt is wasted effort.

## Which command per environment

Three routes exist and they are not interchangeable.
Use the one that matches the environment.

| Environment         | Command                                            | Notes                                                                                                                                               |
| ------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Development (local) | `yarn development:search:rebuild`                  | Wraps `meili:rebuild-research-entities --clear --confirm-meili-rebuild` through the development data profile. This is the route that works locally. |
| Beta                | `node scripts/reindex-search-index.mjs beta`       | Run from the Beta Render shell or as a one-off job (see below). Dry run. Add `--apply` to rebuild.                                                                                  |
| Production          | `node scripts/reindex-search-index.mjs production` | Run from the Production Render shell. Dry run. Add `--apply` to rebuild. Run Beta first.                                                            |

`reindex:meili`'s own error text points at "the development sweep search-rebuild stage" for local rebuilds.
That is a description of the pipeline stage, not a command you can type; `yarn development:search:rebuild` is the command.

Do not use `meili:rebuild-research-entities` directly against Beta or Production.
It rebuilds the model index but does not reconcile retired indexes, and it does not cross-check the Mongo target against the environment.

## Required environment variables

Set all four in the shell that runs the command.
`MONGODBURL`, `MEILISEARCH_HOST` and `MEILISEARCH_INDEX_PREFIX` come from the Render dashboard for the target service.
`MEILISEARCH_WRITE_API_KEY` lives on the Beta web service and on no Production service: for Production, export it in the shell session for the run (see [Meilisearch keys](#meilisearch-keys)).

| Variable                   | Shape                                                  | Why                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MONGODBURL`               | `mongodb+srv://<user>:<password>@<cluster>/<database>` | The database the index is rebuilt **from**. Cross-checked against the environment; a mismatch is refused.                                                         |
| `MEILISEARCH_HOST`         | `http://<meili-private-service>:7700`                  | The instance to rebuild. Must not be empty or the rebuild targets localhost. This is Render's internal address, which is why the run happens in the Render shell. |
| `MEILISEARCH_WRITE_API_KEY` | the environment's reindex key from [Meilisearch keys](#meilisearch-keys): on the Beta service, or exported in the Production shell | Write access. Without it the rebuild fails before the swap, and the serving index is unchanged. The legacy `MEILISEARCH_API_KEY` is still accepted in its place until the scoped key exists. |
| `MEILISEARCH_INDEX_PREFIX` | e.g. `beta` or `prod`, with **no** trailing underscore | Namespaces the indexes. An empty prefix is refused so a remote rebuild cannot clobber the unprefixed local index.                                                 |

The trailing underscore matters, and getting it wrong fails quietly rather than loudly.
The code appends the separator itself: `resolveIndexName` in `server/src/utils/meiliClient.ts:27-29` builds `${prefix}_${name}`, and `reindexMeiliForEnvironment.ts:54` builds `ownedPrefix` the same way, over the base name `researchentities`.
So `MEILISEARCH_INDEX_PREFIX=beta` gives `beta_researchentities`, which is the index the app reads, while `MEILISEARCH_INDEX_PREFIX=beta_` gives `beta__researchentities`, a different index nobody serves from.
A rebuild with the wrong prefix reports success while search keeps returning the stale index.

The wrapper reports **every** missing variable at once with its expected shape, rather than one failed run per gap.
It never echoes `MONGODBURL` or a Meilisearch key back to the terminal, since you may be sharing a screen; it reports the host, the database name, and whether the key is present.

## Meilisearch keys

The server uses two keys with different rights (#4014).

| Variable | Read by | Rights |
| -------- | ------- | ------ |
| `MEILISEARCH_SEARCH_API_KEY` | the web service: search, the similar-research rail, the embedder check, readiness | `search` and `settings.get` on `<prefix>_researchentities` only |
| `MEILISEARCH_WRITE_API_KEY` | the reindex and the sync and repair scripts (`getMeiliIndex`, `getMeiliClient`) | document, index (including delete and swap) and settings writes on `<prefix>_*` only; no key management |
| `MEILISEARCH_API_KEY` | legacy fallback for either role | whatever it is, usually the master key |

`server/src/utils/meiliClient.ts` resolves each role's own variable first and falls back to `MEILISEARCH_API_KEY`.
A deployed process that falls back logs one warning per role, naming the variable it is missing, so deploying this code before the keys exist changes nothing.
The search role never falls back to the write key.

### Creating the keys

Create keys from the **Meilisearch private service's** Render shell, where `MEILI_MASTER_KEY` is already set, so the master key never leaves that service.
The Meilisearch image ships `wget` but not `curl`, and inside that shell the instance answers on its private service address rather than on `localhost`, so a `localhost:7700` request is refused.
Long single-line commands break when pasted into the Render shell, so build each body from short lines:

```bash
U=http://<meili-private-service>:7700/keys
A="Authorization: Bearer $MEILI_MASTER_KEY"
C='Content-Type: application/json'

S='{"name":"ylabs-<prefix>-search","actions":["search","settings.get"],'
S="$S"'"indexes":["<prefix>_researchentities"],"expiresAt":null}'
wget -qO- --header "$A" --header "$C" --post-data "$S" $U; echo

R='{"name":"ylabs-<prefix>-reindex","actions":["documents.add",'
R="$R"'"documents.get","documents.delete","indexes.create",'
R="$R"'"indexes.get","indexes.update","indexes.delete",'
R="$R"'"indexes.swap","settings.get","settings.update",'
R="$R"'"tasks.get","stats.get"],"indexes":["<prefix>_*"],"expiresAt":null}'
wget -qO- --header "$A" --header "$C" --post-data "$R" $U; echo
```

Each response carries the new key in its `key` field; copy it straight into Render or a password manager and nowhere else.
A heredoc is the wrong tool here: a pasted `EOF` terminator picks up leading spaces, the shell never sees it, and nothing runs.

Replace `<prefix>` with `beta` or `prod`.
The search key needs `settings.get` because the web service reads the index's embedder settings to decide whether to run hybrid search.

Each environment's write key is scoped to `["<prefix>_*"]`, so the `beta` key answers 403 on every `prod_` index and the reverse, and no key but the master key spans both environments (#4859).
Meilisearch records an index swap with no `indexUid`, so a prefix-scoped key cannot read the swap task (`Task not found`, measured on Development on 2026-10-03).
The rebuild therefore confirms the swap from state the key can read: an index's `createdAt` moves with its contents in a swap, so the swap is confirmed once the live index reports the `createdAt` the staging index was created with, polled for up to three minutes.
An unconfirmed swap exits non-zero.
Measured on the local Meilisearch on 2026-10-04: with a key scoped to one prefix, a full rebuild of 4,193 documents created, filled, swapped and deleted its staging index, and the same key answered 403 on another prefix's index for a read, a document read and a delete; the code before this change failed the same run with `Task ... not found`.
The write key can delete and swap its environment's indexes, so where it lives is a per-environment decision.
Beta stores its `beta_*` write key on the Beta web service, because the worst a compromised staging process can do with it is wipe Beta's index, which a rebuild restores, and storing it lets a Render one-off job run the rebuild.
Production keeps its write key out of every service and exports it only in the shell session that runs the rebuild, because a compromised Production process holding it could take student search down.
A sync or repair script that only adds or deletes documents works with a key scoped to `["<prefix>_*"]`, if one is ever stored for an automated job.

### Which Render service gets which variable

| Render service | Set | Remove once the scoped keys are live |
| -------------- | --- | ------------------------------------ |
| Beta web service | `MEILISEARCH_SEARCH_API_KEY` = the `beta` search key, and `MEILISEARCH_WRITE_API_KEY` = the `beta` reindex key | `MEILISEARCH_API_KEY` |
| Production web service | `MEILISEARCH_SEARCH_API_KEY` = the `prod` search key | `MEILISEARCH_API_KEY` |
| Meilisearch private service | nothing new; `MEILI_MASTER_KEY` stays there | |

Order: create the keys, set the variables, redeploy, confirm the fallback warning is gone from the logs and search works, then delete `MEILISEARCH_API_KEY` from the web service.
For a Production reindex, export the `prod` reindex key as `MEILISEARCH_WRITE_API_KEY` in the Render shell before running the wrapper.

### Verified on Development (2026-10-03)

With a search key scoped as above, a search and an embedder read answered `200`, and a document write, a settings update, an index delete and a key listing each answered `403`.
`POST /api/research/search` through the running server with only the search key valid answered `200` from Meilisearch, not degraded.
`yarn development:search:rebuild` with only `MEILISEARCH_WRITE_API_KEY` valid rebuilt 4,487 documents and swapped them in.
The proof keys were deleted afterwards.

## Running it as a Render one-off job

A one-off job runs a command on a copy of a service's **latest successful deploy** with that service's **current** environment variables, inside Render's network, so it reaches the private Meilisearch the same way the shell does.
It needs no open shell, survives a dropped connection, and leaves its log on the service's **One-off Jobs** page.
Beta can rebuild this way because its web service holds the `beta` write key; Production cannot, because its write key lives in no service, so run Production's rebuild from its shell.

Find the service id, then confirm the deploy you are about to run is the code you expect, because a job runs the deployed build and not the branch head:

```bash
render services -o json
render deploys list <beta-service-id> -o json
```

When auto-deploy is off for the service, a merge to `beta` does not reach it until someone deploys, so deploy first when the live commit is behind:

```bash
render deploys create <beta-service-id> --commit "$(git rev-parse origin/beta)" --confirm
```

`--commit` needs the full SHA; an abbreviated one answers 404.

Dry run, then apply, each as its own job:

```bash
render jobs create <beta-service-id> --start-command "SCRAPER_ENV=beta yarn --cwd server reindex:meili" --confirm -o json
render jobs create <beta-service-id> --start-command "SCRAPER_ENV=beta yarn --cwd server reindex:meili --confirm" --confirm -o json
```

Poll the job and read its log by the `job-` id the create call prints:

```bash
render jobs list <beta-service-id> -o json
render logs -r <job-id> --limit 300 -o text
```

A job sees an environment variable as soon as it is saved, but the running web process does not until the next deploy, so redeploy after changing a key the web process reads.
Run one rebuild at a time: two concurrent rebuilds share the `_next` staging index.

Measured on Beta on 2026-10-05 with the `beta_*` reindex key: the job deleted a staging index a lost shell had left, retired two old indexes, indexed 4,230 documents, swapped, and deleted the previous copy in 99 seconds.

## Procedure

Beta first, verify, then Production.
If Beta's verification does not come back clean, **do not run Production**.

### 1. Beta dry run

```bash
node scripts/reindex-search-index.mjs beta
```

Read the output before going further.
It prints the resolved environment, Meili host, index prefix, and Mongo target, and then `reindex:meili` prints the authoritative preflight including the live document count and which indexes it would retire.
Nothing has changed at this point.

Confirm the document count looks right for Beta.
A count far below expectation means you are pointed at the wrong database — stop.

### 2. Beta apply

```bash
node scripts/reindex-search-index.mjs beta --apply
```

There is a five second pause before it starts, so Ctrl-C is available.
The rebuild builds every document into a fresh `<prefix>_researchentities_next` index with the same settings and embedder, confirms its document count, swaps it with the serving index in one Meilisearch `swapIndexes` task, and then deletes the old copy, so search never serves an empty or partial index (#4151).
A failure before the swap deletes the partial `_next` index and leaves the serving index as it was; an `_next` index left by a lost shell is deleted by the next rebuild, and the reconcile plan reports it under `staging` rather than as unknown.
After the swap, a catch-up pass re-reads every row whose `updatedAt` is at or after the rebuild's `startedAt`, re-adds the non-archived ones to the serving index and deletes the archived ones, so a live sync made during the build is not lost with the old copy; `swap.catchUpReindexedCount` and `swap.catchUpDeletedCount` report it.
The output records `startedAt`, `finishedAt`, and `durationMs`, and `swap.previousIndexDeleted: false` means only the clean-up failed: the serving index is already the rebuilt one.
A prefixed index with a stored embedder is refused when the shell has no usable `OPENAI_API_KEY`, because the fresh index would otherwise serve keyword-only search.
Retired indexes are deleted afterwards.
Unrecognized prefixed indexes are left in place and reported for manual review rather than deleted.

### 3. Verify Beta

See [Verification](#verification).
Only continue if it is clean.

### 4. Production dry run, then apply

The apply needs `CONFIRM_PROD_SCRAPE=true` in the environment.
The dry run does not, so a missing confirmation is reported by the apply rather than discovered by it.

```bash
node scripts/reindex-search-index.mjs production
CONFIRM_PROD_SCRAPE=true node scripts/reindex-search-index.mjs production --apply
```

### 5. Verify Production

Same checks as Beta.

## Verification

Success looks like: the run reports a non-zero document count reindexed, and topic searches no longer return entities whose served copy does not support the term.

For `#2396` specifically, search a broad topic term and open the top results:

1. Search a term like `neuroscience`. Every result's card should actually be about that topic. Before the fix, entities matched on aliases derived from copy the serve path blanks, so a result could be someone in an unrelated field entirely.
2. Search a second unrelated term such as `psychology` and repeat the check.
3. For any result that still looks wrong, open the entity page. If the term appears nowhere in the served copy, the index still holds a stale document and the rebuild did not cover that row — capture the slug and file it rather than re-running blindly.

The failure this checks for is a **search hit whose page does not support the search term**, so the check has to compare the query against the served card, not against the index.

The document count is the other half of the check, and it has an expected value rather than just "non-zero".
Beta and Production each hold 6440 `research_entities` documents as of 2026-09-11, so a count far below that means the rebuild covered only part of the corpus or is pointed at the wrong database.

For the retired attributes, confirm the settings rather than a search result, because an inert filterable attribute changes no query output:

```bash
curl -s -H "Authorization: Bearer $MEILISEARCH_WRITE_API_KEY" \
  "$MEILISEARCH_HOST/indexes/${MEILISEARCH_INDEX_PREFIX}_researchentities/settings" \
  | grep -oE 'hasDocumentedWayIn|undergraduateCurrentAvailability|undergraduateCompensationModel|undergraduateEligibleStudentLevels'
```

No output is the pass. Any match names a retired attribute the rebuilt index still carries.

## Safety properties you are relying on

`reindex:meili` fails closed on five preconditions, and the wrapper surfaces those failures rather than bypassing them:

1. The environment must resolve to `beta` or `production`.
2. `MEILISEARCH_HOST` must be non-empty.
3. `MEILISEARCH_INDEX_PREFIX` must be non-empty, so a remote rebuild cannot clobber the unprefixed local index.
4. The Mongo target must match the resolved environment.
5. A production rebuild requires `CONFIRM_PROD_SCRAPE=true`, that exact string.

The fifth one is the one that bites, because it is checked last.
The preflight and the index reconcile plan print first, so a production run without it looks like it is working and then refuses at the write.
The wrapper now reports it alongside the other missing variables before anything starts, which is why `node scripts/reindex-search-index.mjs production --apply` is preferable to the raw `yarn` invocation.

It also refuses to run when the database reports **zero** non-archived entities, which is the guard against replacing a live index with an empty one because a Mongo copy had not landed yet.

The rebuild is idempotent and re-runnable.
Running it twice is safe.

## A reindex reflects the promoted corpus; it never refreshes it

Beta and Production hold the materialized corpus but **zero observations** — the promotion path copies materialized collections, not the evidence store.
Development has the observations; the other two have none.

This does not affect the reindex.
`reindexMeiliForEnvironment.ts`, `rebuildResearchEntitySearchIndex.ts`, and `researchEntitySearchIndexService.ts` do not reference the `Observation` model at all.
They read `research_entities`, which is fully populated in Beta and Production, so a reindex there reads exactly the data it should.

It does affect anything you might be tempted to run _alongside_ it.
Materialization cannot do useful work in Beta or Production, because `materializeEntity` early-returns when the observation set is empty (`server/src/scrapers/entityMaterializer.ts:3846`).

So if a procedure ever tells you to "re-materialize, then reindex" against Beta or Production, **the re-materialize half is a silent no-op** and the reindex is the only step that does anything.
The practical consequence for an operator: after such a sequence, an index whose content looks unchanged is the **expected** result, not a failed reindex.
Judge the reindex by the document count it reports and by the verification queries above, never by whether entity copy changed.
That count includes a batch only after its Meilisearch task succeeded, and a failed or timed-out task fails the rebuild instead of being counted, so the reported count is what the index accepted rather than what was sent (#3720).

To actually change what the index contains, the corpus has to change first — materialize on Development, promote, then reindex.

See #2458 for the full inventory of code paths that read an empty `observations` collection in Beta and Production, two of which produce a wrong decision rather than declining.

## Open questions

Two things this runbook does not yet answer, because they need an owner decision rather than a guess:

- **Does the reindex need a maintenance window?** No. Since #4151 the rebuild builds into a fresh index and swaps it in atomically, so search serves the previous index until the new one is complete. It does need disk headroom for two copies of the index while it runs.
- **Is a partial rebuild possible?** Today it is all-documents: `reindex:meili` rebuilds every document. If only some rows are stale, a targeted rebuild would be cheaper, but no such path exists yet.
