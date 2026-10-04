export const SEARCH_INDEX_WRITES_VARIABLE = 'SEARCH_INDEX_WRITES';
export const SEARCH_INDEX_WRITES_DEFERRED = 'deferred';

export const searchIndexWritesDeferred = (env: NodeJS.ProcessEnv = process.env): boolean =>
  String(env[SEARCH_INDEX_WRITES_VARIABLE] ?? '').trim() === SEARCH_INDEX_WRITES_DEFERRED;

export class SearchIndexWritesDeferredError extends Error {
  constructor() {
    super(
      `${SEARCH_INDEX_WRITES_VARIABLE}=${SEARCH_INDEX_WRITES_DEFERRED}: this run reaches no served search index, so it opens no Meilisearch connection; re-sync the index from a checkout that reaches it (docs/data-refresh-runbook.md)`,
    );
    this.name = 'SearchIndexWritesDeferredError';
  }
}
