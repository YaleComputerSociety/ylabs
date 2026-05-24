/**
 * Syncs canonical search entities to Meilisearch.
 */
import { getMeiliIndex } from '../utils/meiliClient';

export type SyncableEntityType = 'researchEntity';

interface EntityIndexConfig {
  indexName: string;
  primaryKey: string;
  transform: (doc: any) => Record<string, any>;
}

const stripInternalFields = (doc: any): Record<string, any> => {
  const out: Record<string, any> = { ...doc, id: doc._id != null ? String(doc._id) : doc.id };
  delete out._id;
  delete out.__v;
  delete out.embedding;
  return out;
};

const ENTITY_REGISTRY: Record<SyncableEntityType, EntityIndexConfig> = {
  researchEntity: {
    indexName: 'researchentities',
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
    const meiliDoc = config.transform(doc);
    const index = await getMeiliIndex(config.indexName);
    await index.addDocuments([meiliDoc], { primaryKey: config.primaryKey });
  } catch (error) {
    console.error(`Failed to sync ${entityType} to Meilisearch:`, error);
  }
};

export const syncEntities = async (entityType: string, docs: any[]): Promise<void> => {
  const config = getConfig(entityType);
  if (!config || !docs || docs.length === 0) return;

  try {
    const meiliDocs = docs.map(config.transform);
    const index = await getMeiliIndex(config.indexName);
    await index.addDocuments(meiliDocs, { primaryKey: config.primaryKey });
  } catch (error) {
    console.error(`Failed to sync ${entityType} batch to Meilisearch:`, error);
  }
};

export const deleteFromIndex = async (entityType: string, id: string): Promise<void> => {
  const config = getConfig(entityType);
  if (!config || !id) return;

  try {
    const index = await getMeiliIndex(config.indexName);
    await index.deleteDocument(id);
  } catch (error) {
    console.error(`Failed to delete ${entityType} from Meilisearch:`, error);
  }
};
