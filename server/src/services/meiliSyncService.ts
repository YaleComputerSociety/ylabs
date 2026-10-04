/**
 * Syncs research entities to Meilisearch.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { getMeiliIndex } from '../utils/meiliClient';
import { searchIndexWritesDeferred } from '../utils/searchIndexWrites';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertMeiliTaskSucceeded, MEILI_DOCUMENT_TASK_WAIT_TIMEOUT_MS } from '../utils/meiliTask';
import { buildResearchEntitySearchIndexDocumentsWithMemberNames } from './researchEntitySearchIndexService';

export type SyncableEntityType = 'researchEntity';
type MaybePromise<T> = T | Promise<T>;

interface EntityIndexConfig {
  indexName: string;
  primaryKey: string;
  transform: (doc: any) => MaybePromise<Record<string, any> | null>;
  transformMany?: (docs: any[]) => Promise<Record<string, any>[]>;
}

const ENTITY_REGISTRY: Record<SyncableEntityType, EntityIndexConfig> = {
  researchEntity: {
    indexName: 'researchentities',
    primaryKey: 'id',
    transform: async (doc: any) =>
      (await buildResearchEntitySearchIndexDocumentsWithMemberNames([doc]))[0] || null,
    transformMany: buildResearchEntitySearchIndexDocumentsWithMemberNames,
  },
};

/**
 * The index primary key for a row, read the same way the document builder reads it, so a
 * delete addresses the document an add would have written.
 */
const indexDocumentId = (doc: any): string | undefined => {
  const raw = doc?._id ?? doc?.id;
  if (raw == null) return undefined;
  const id = String(raw);
  return id.length > 0 ? id : undefined;
};

const getConfig = (entityType: string): EntityIndexConfig | null => {
  return (ENTITY_REGISTRY as Record<string, EntityIndexConfig>)[entityType] ?? null;
};

export const isSyncableEntityType = (entityType: string): entityType is SyncableEntityType => {
  return getConfig(entityType) !== null;
};

/**
 * A row that is archived must not hold an index document, whatever path is syncing it.
 *
 * Archiving a row removed it from the rebuild's query but nothing removed the document
 * it already had, so the index accumulated rows that serve no page. `deleteFromIndex`
 * existed, but only four specific paths called it, and every future archiving path would
 * have had to remember. Deciding it HERE is what makes that impossible to forget: this is
 * the one chokepoint `syncEntity` and `syncEntities` both pass through, the same reason
 * the uncitable-host and description-ownership refusals live at their write chokepoints
 * rather than in each caller (#3449).
 *
 * Measured on Development twelve hours after a `--clear` rebuild: 4 archived rows had
 * already re-accumulated documents, and an earlier rebuild found 307 of them, so the
 * drift is continuous rather than a one-off.
 */
const isArchivedRow = (doc: any): boolean => doc?.archived === true;

const confirmDocumentTask = (index: any, enqueued: unknown, label: string): Promise<void> =>
  assertMeiliTaskSucceeded(index, enqueued, label, MEILI_DOCUMENT_TASK_WAIT_TIMEOUT_MS);

interface EnqueuedDocumentWrite {
  index: any;
  enqueued: unknown;
  label: string;
}

type LatestDocumentWrites = Map<string, EnqueuedDocumentWrite | 'enqueue-failed'>;

const deferredConfirmationScope = new AsyncLocalStorage<LatestDocumentWrites>();

export interface DeferredIndexConfirmation<T> {
  value: T;
  failedDocumentIds: Set<string>;
}

/**
 * Waiting for each row's task serializes Meilisearch work that it would otherwise batch:
 * with an embedder, every wait costs one embedding round trip, so a sequential pass of a
 * few thousand rows spent tens of minutes waiting. Inside this scope `syncEntity` only
 * enqueues and returns true, and the scope confirms the latest write for every document
 * once `work` finishes. Its `failedDocumentIds`, not the per-call return, is the outcome.
 *
 * Measured against a throwaway Meilisearch with a 300 ms embedder: 300 rows took 113.8 s
 * confirmed per row and 1.5 s confirmed at the end, so a 4,550-row pass falls from about
 * 29 minutes to under a minute. Meilisearch auto-batches the enqueued writes, so one bad
 * document can fail the batch its neighbours share; this reports every document of a
 * failed enqueue, which over-reports rather than hides a row search may not be serving.
 */
export async function withDeferredIndexConfirmation<T>(
  work: () => Promise<T>,
): Promise<DeferredIndexConfirmation<T>> {
  const latestWrites: LatestDocumentWrites = new Map();
  const value = await deferredConfirmationScope.run(latestWrites, work);
  const failedDocumentIds = new Set<string>();
  const outcomeByTaskUid = new Map<unknown, Promise<boolean>>();
  for (const [documentId, write] of latestWrites) {
    if (write === 'enqueue-failed') {
      failedDocumentIds.add(documentId);
      continue;
    }
    const taskUid = (write.enqueued as { taskUid?: unknown } | null | undefined)?.taskUid;
    let outcome = taskUid === undefined ? undefined : outcomeByTaskUid.get(taskUid);
    if (!outcome) {
      outcome = confirmDocumentTask(write.index, write.enqueued, write.label).then(
        () => true,
        (error) => {
          console.error('Deferred Meilisearch write failed:', sanitizeLogValue(error));
          return false;
        },
      );
      if (taskUid !== undefined) outcomeByTaskUid.set(taskUid, outcome);
    }
    if (!(await outcome)) failedDocumentIds.add(documentId);
  }
  return { value, failedDocumentIds };
}

const settleDocumentWrite = async (
  index: any,
  documentId: string | undefined,
  enqueue: () => Promise<unknown>,
  label: string,
): Promise<void> => {
  const latestWrites = deferredConfirmationScope.getStore();
  if (!latestWrites || !documentId) {
    await confirmDocumentTask(index, await enqueue(), label);
    return;
  }
  try {
    latestWrites.set(documentId, { index, enqueued: await enqueue(), label });
  } catch (error) {
    latestWrites.set(documentId, 'enqueue-failed');
    throw error;
  }
};

export const syncEntity = async (entityType: string, doc: any): Promise<boolean> => {
  const config = getConfig(entityType);
  if (!config || !doc || searchIndexWritesDeferred()) return false;

  try {
    const index = await getMeiliIndex(config.indexName);
    const documentId = indexDocumentId(doc);
    if (isArchivedRow(doc)) {
      if (documentId) {
        await settleDocumentWrite(
          index,
          documentId,
          () => index.deleteDocument(documentId),
          'deleteDocument',
        );
      }
      return true;
    }
    const meiliDoc = await config.transform(doc);
    if (!meiliDoc) return false;
    await settleDocumentWrite(
      index,
      documentId,
      () => index.addDocuments([meiliDoc], { primaryKey: config.primaryKey }),
      'addDocuments',
    );
    return true;
  } catch (error) {
    console.error(`Failed to sync ${entityType} to Meilisearch:`, sanitizeLogValue(error));
    return false;
  }
};

/**
 * Returns the number of documents whose Meilisearch task succeeded, and 0 when the
 * batch failed, including a batch the index accepted and then rejected (#3720).
 * Callers still get best-effort behaviour by ignoring the value, but one that reports
 * a resync has to read it: inferring success from the input length let a repair script
 * print "20 entities resynced" while the index kept serving the text the corpus no
 * longer held (#2874).
 */
export const syncEntities = async (entityType: string, docs: any[]): Promise<number> => {
  const config = getConfig(entityType);
  if (!config || !docs || docs.length === 0 || searchIndexWritesDeferred()) return 0;

  try {
    const index = await getMeiliIndex(config.indexName);
    // Archived rows are removed rather than transformed, so a batch mixing live and
    // archived rows leaves the index holding only the live ones.
    const archivedIds = docs.filter(isArchivedRow).map(indexDocumentId).filter(Boolean);
    if (archivedIds.length > 0) {
      await confirmDocumentTask(
        index,
        await index.deleteDocuments(archivedIds as string[]),
        'deleteDocuments',
      );
    }
    const liveDocs = docs.filter((doc) => !isArchivedRow(doc));
    if (liveDocs.length === 0) return 0;
    const meiliDocs = config.transformMany
      ? await config.transformMany(liveDocs)
      : (await Promise.all(liveDocs.map(config.transform))).filter(
          (meiliDoc): meiliDoc is Record<string, any> => meiliDoc !== null,
        );
    if (meiliDocs.length === 0) return 0;
    await confirmDocumentTask(
      index,
      await index.addDocuments(meiliDocs, { primaryKey: config.primaryKey }),
      'addDocuments',
    );
    return meiliDocs.length;
  } catch (error) {
    console.error(`Failed to sync ${entityType} batch to Meilisearch:`, sanitizeLogValue(error));
    return 0;
  }
};

const INDEXED_FIELD_PAGE_SIZE = 1000;

/**
 * Projects one field of every indexed document, keyed by primary key, so a caller
 * can compare what the index serves against what the corpus holds.
 *
 * Unlike the sync helpers this deliberately does not catch: a swallowed read is
 * indistinguishable from "no drift", which is how a gate apply came to report a
 * clean run while the index kept serving a tier the corpus no longer held (#3049).
 *
 * It pages the whole index rather than requesting the ids it wants because
 * Meilisearch 1.13 rejects an `ids` argument on the documents-fetch endpoint and
 * the primary key is not a filterable attribute, so per-id reads would be one
 * request per row.
 */
export const readIndexedFieldByDocumentId = async (
  entityType: string,
  field: string,
): Promise<Map<string, unknown>> => {
  const config = getConfig(entityType);
  if (!config) return new Map();
  const index = await getMeiliIndex(config.indexName);
  const byDocumentId = new Map<string, unknown>();
  let offset = 0;
  for (;;) {
    const page = (await index.getDocuments({
      limit: INDEXED_FIELD_PAGE_SIZE,
      offset,
      fields: [config.primaryKey, field],
    })) as { results: Array<Record<string, unknown>>; total: number };
    for (const doc of page.results) {
      const id = doc[config.primaryKey];
      if (id == null) continue;
      byDocumentId.set(String(id), doc[field]);
    }
    offset += page.results.length;
    if (page.results.length === 0 || offset >= page.total) break;
  }
  return byDocumentId;
};

export const deleteFromIndex = async (entityType: string, id: string): Promise<boolean> => {
  const config = getConfig(entityType);
  if (!config || !id) return false;

  try {
    const index = await getMeiliIndex(config.indexName);
    await confirmDocumentTask(index, await index.deleteDocument(id), 'deleteDocument');
    return true;
  } catch (error) {
    console.error(`Failed to delete ${entityType} from Meilisearch:`, sanitizeLogValue(error));
    return false;
  }
};
