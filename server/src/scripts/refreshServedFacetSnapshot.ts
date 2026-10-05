import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { RESEARCH_ENTITY_SEARCH_INDEX_NAME } from '../services/researchEntitySearchIndexService';
import {
  buildServedFacetSnapshot,
  type ServedFacetDocument,
} from '../services/personalization/servedFacetSnapshot';
import { getMeiliIndex } from '../utils/meiliClient';
import { sanitizeLogValue } from '../utils/logSanitizer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const PAGE_SIZE = 1000;
const SERVED_FILTER = 'studentVisibilityTier = student_ready';

export const SERVED_FACET_SNAPSHOT_PATH = path.resolve(
  __dirname,
  '../services/personalization/servedFacetValues.snapshot.json',
);

async function loadServedFacetDocuments(): Promise<ServedFacetDocument[]> {
  const index = await getMeiliIndex(RESEARCH_ENTITY_SEARCH_INDEX_NAME);
  const documents: ServedFacetDocument[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = (await index.getDocuments({
      filter: SERVED_FILTER,
      fields: ['researchAreas', 'departments'],
      limit: PAGE_SIZE,
      offset,
    })) as { results: ServedFacetDocument[]; total: number };
    documents.push(...page.results);
    if (page.results.length === 0 || documents.length >= page.total) break;
  }
  return documents;
}

async function main(): Promise<void> {
  const documents = await loadServedFacetDocuments();
  const snapshot = buildServedFacetSnapshot(documents, new Date().toISOString().slice(0, 10));
  fs.writeFileSync(SERVED_FACET_SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(
    `Wrote ${Object.keys(snapshot.researchAreas).length} research areas and ${
      Object.keys(snapshot.departments).length
    } departments from ${snapshot.servedRowCount} served rows to ${SERVED_FACET_SNAPSHOT_PATH}`,
  );
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
