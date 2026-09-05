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

## Which command per environment

Three routes exist and they are not interchangeable.
Use the one that matches the environment.

| Environment         | Command                                            | Notes                                                                                                                                               |
| ------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Development (local) | `yarn development:search:rebuild`                  | Wraps `meili:rebuild-research-entities --clear --confirm-meili-rebuild` through the development data profile. This is the route that works locally. |
| Beta                | `node scripts/reindex-search-index.mjs beta`       | Dry run. Add `--apply` to rebuild.                                                                                                                  |
| Production          | `node scripts/reindex-search-index.mjs production` | Dry run. Add `--apply` to rebuild. Run Beta first.                                                                                                  |

`reindex:meili`'s own error text points at "the development sweep search-rebuild stage" for local rebuilds.
That is a description of the pipeline stage, not a command you can type; `yarn development:search:rebuild` is the command.

Do not use `meili:rebuild-research-entities` directly against Beta or Production.
It rebuilds the model index but does not reconcile retired indexes, and it does not cross-check the Mongo target against the environment.

## Required environment variables

Set all four in the shell that runs the command.
They come from the Render dashboard for the target service.

| Variable                   | Shape                                              | Why                                                                                                               |
| -------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `MONGODBURL`               | `mongodb+srv://<user>:<password>@<cluster>/<database>` | The database the index is rebuilt **from**. Cross-checked against the environment; a mismatch is refused.         |
| `MEILISEARCH_HOST`         | `https://<host>`                                   | The instance to rebuild. Must not be empty or the rebuild targets localhost.                                      |
| `MEILISEARCH_API_KEY`      | the master or admin key                            | Write access. Without it the rebuild fails **after** clearing.                                                    |
| `MEILISEARCH_INDEX_PREFIX` | e.g. `beta_`                                       | Namespaces the indexes. An empty prefix is refused so a remote rebuild cannot clobber the unprefixed local index. |

The wrapper reports **every** missing variable at once with its expected shape, rather than one failed run per gap.
It never echoes `MONGODBURL` or `MEILISEARCH_API_KEY` back to the terminal, since you may be sharing a screen; it reports the host, the database name, and whether the key is present.

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
The index is cleared and rebuilt, and retired indexes are deleted.
Unrecognized prefixed indexes are left in place and reported for manual review rather than deleted.

### 3. Verify Beta

See [Verification](#verification).
Only continue if it is clean.

### 4. Production dry run, then apply

```bash
node scripts/reindex-search-index.mjs production
node scripts/reindex-search-index.mjs production --apply
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

## Safety properties you are relying on

`reindex:meili` fails closed on four preconditions, and the wrapper surfaces those failures rather than bypassing them:

1. The environment must resolve to `beta` or `production`.
2. `MEILISEARCH_HOST` must be non-empty.
3. `MEILISEARCH_INDEX_PREFIX` must be non-empty, so a remote rebuild cannot clobber the unprefixed local index.
4. The Mongo target must match the resolved environment.

It also refuses to run when the database reports **zero** non-archived entities, which is the guard against clearing a live index because a Mongo copy had not landed yet.

The rebuild is idempotent and re-runnable.
Running it twice is safe.

## Open questions

Two things this runbook does not yet answer, because they need an owner decision rather than a guess:

- **Does the reindex need a maintenance window?** The index is cleared before it is rebuilt, so there is a window where searches return few or no results. How long depends on document count and page size (`--page-size`, default 250). If that window matters for students, the rebuild should be scheduled rather than run ad hoc, or changed to build into a new index and swap.
- **Is a partial rebuild possible?** Today it is all-documents: `reindex:meili` clears and rebuilds. If only some rows are stale, a targeted rebuild would be cheaper and would remove the empty-index window, but no such path exists yet.
