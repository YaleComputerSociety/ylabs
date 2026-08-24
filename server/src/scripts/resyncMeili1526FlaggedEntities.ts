import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { getMeiliIndex } from '../utils/meiliClient';
import {
  RESEARCH_ENTITY_SEARCH_INDEX_NAME,
  RESEARCH_ENTITY_SEARCH_INDEX_PRIMARY_KEY,
  buildResearchEntitySearchIndexDocumentsWithMemberNames,
} from '../services/researchEntitySearchIndexService';
import { sanitizeLogValue } from '../utils/logSanitizer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SLUGS = ['nih-pi-sherry-mckee', 'mistry-lab-pkm4'];

async function main(): Promise<void> {
  const uri = process.env.MONGODBURL as string;
  const parsed = new URL(uri);
  if (parsed.pathname !== '/Development') {
    console.error(`refusing to run: MONGODBURL pathname is ${parsed.pathname}, not /Development`);
    process.exit(1);
  }

  await initializeConnections();
  const docs = await ResearchEntity.find({ slug: { $in: SLUGS } }).lean();
  console.log(`fetched ${docs.length} of ${SLUGS.length} requested entities`);

  const indexDocs = await buildResearchEntitySearchIndexDocumentsWithMemberNames(docs);
  const index = await getMeiliIndex(RESEARCH_ENTITY_SEARCH_INDEX_NAME);
  const task = await index.addDocuments(indexDocs, {
    primaryKey: RESEARCH_ENTITY_SEARCH_INDEX_PRIMARY_KEY,
  });
  console.log('meili task:', JSON.stringify(task));

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error('Failed to resync Meili for #1526 flagged entities:', sanitizeLogValue(error));
  process.exitCode = 1;
});
