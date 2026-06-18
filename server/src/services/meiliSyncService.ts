/**
 * Syncs entities (listings, research entities, papers, ...) to Meilisearch.
 */
import { getMeiliIndex } from '../utils/meiliClient';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { serializedDocumentId } from '../utils/idSerialization';
import {
  buildResearchEntitySearchIndexDocumentsWithMemberNames,
} from './researchEntitySearchIndexService';

export type SyncableEntityType = 'listing' | 'researchEntity' | 'paper';
type MaybePromise<T> = T | Promise<T>;

interface EntityIndexConfig {
  indexName: string;
  primaryKey: string;
  transform: (doc: any) => MaybePromise<Record<string, any> | null>;
  transformMany?: (docs: any[]) => Promise<Record<string, any>[]>;
}

const stripInternalFields = (doc: any): Record<string, any> | null => {
  const id = serializedDocumentId(doc?._id) || serializedDocumentId(doc?.id);
  if (!id) return null;
  const out: Record<string, any> = { ...doc, id };
  delete out._id;
  delete out.__v;
  delete out.embedding;
  return out;
};

const ENTITY_REGISTRY: Record<SyncableEntityType, EntityIndexConfig> = {
  listing: {
    indexName: 'listings',
    primaryKey: 'id',
    transform: stripInternalFields,
  },
  researchEntity: {
    indexName: 'researchentities',
    primaryKey: 'id',
    transform: async (doc: any) =>
      (await buildResearchEntitySearchIndexDocumentsWithMemberNames([doc]))[0] || null,
    transformMany: buildResearchEntitySearchIndexDocumentsWithMemberNames,
  },
  paper: {
    indexName: 'papers',
    primaryKey: 'id',
    transform: stripInternalFields,
  },
};

const getConfig = (entityType: string): EntityIndexConfig | null => {
  return (ENTITY_REGISTRY as Record<string, EntityIndexConfig>)[entityType] ?? null;
};

export const isSyncableEntityType = (entityType: string): entityType is SyncableEntityType => {
  return getConfig(entityType) !== null;
};

export const syncEntity = async (entityType: string, doc: any): Promise<void> => {
  const config = getConfig(entityType);
  if (!config || !doc) return;

  try {
    const meiliDoc = await config.transform(doc);
    if (!meiliDoc) return;
    const index = await getMeiliIndex(config.indexName);
    await index.addDocuments([meiliDoc], { primaryKey: config.primaryKey });
  } catch (error) {
    console.error(`Failed to sync ${entityType} to Meilisearch:`, sanitizeLogValue(error));
  }
};

export const syncEntities = async (entityType: string, docs: any[]): Promise<void> => {
  const config = getConfig(entityType);
  if (!config || !docs || docs.length === 0) return;

  try {
    const meiliDocs = config.transformMany
      ? await config.transformMany(docs)
      : (await Promise.all(docs.map(config.transform))).filter(
          (meiliDoc): meiliDoc is Record<string, any> => meiliDoc !== null,
        );
    if (meiliDocs.length === 0) return;
    const index = await getMeiliIndex(config.indexName);
    await index.addDocuments(meiliDocs, { primaryKey: config.primaryKey });
  } catch (error) {
    console.error(`Failed to sync ${entityType} batch to Meilisearch:`, sanitizeLogValue(error));
  }
};

export const deleteFromIndex = async (entityType: string, id: string): Promise<void> => {
  const config = getConfig(entityType);
  if (!config || !id) return;

  try {
    const index = await getMeiliIndex(config.indexName);
    await index.deleteDocument(id);
  } catch (error) {
    console.error(`Failed to delete ${entityType} from Meilisearch:`, sanitizeLogValue(error));
  }
};
