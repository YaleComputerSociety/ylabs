import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { getMeiliClient, getMeiliIndex } from '../utils/meiliClient';
import {
  RESEARCH_ENTITY_SEARCH_INDEX_NAME,
  RESEARCH_ENTITY_SEARCH_INDEX_PRIMARY_KEY,
} from '../services/researchEntitySearchIndexService';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  assertPruneArchivedIndexApplyAllowed,
  computeIndexDocIdsToPrune,
  parsePruneArchivedIndexArgs,
} from './pruneArchivedResearchEntitiesFromIndexCore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function loadLiveEntityIds(): Promise<string[]> {
  const docs = await ResearchEntity.find({ archived: { $ne: true } })
    .select('_id')
    .lean<Array<{ _id: unknown }>>();
  return docs.map((doc) => String(doc._id));
}

async function loadIndexedDocumentIds(pageSize: number): Promise<string[]> {
  const index = await getMeiliIndex(RESEARCH_ENTITY_SEARCH_INDEX_NAME);
  const ids: string[] = [];
  let offset = 0;
  for (;;) {
    const page = (await index.getDocuments({
      limit: pageSize,
      offset,
      fields: [RESEARCH_ENTITY_SEARCH_INDEX_PRIMARY_KEY],
    })) as { results: Array<Record<string, unknown>>; total: number };
    for (const doc of page.results) {
      const id = doc[RESEARCH_ENTITY_SEARCH_INDEX_PRIMARY_KEY];
      if (id != null) ids.push(String(id));
    }
    offset += page.results.length;
    if (page.results.length === 0 || offset >= page.total) break;
  }
  return ids;
}

async function deleteIndexDocuments(docIds: string[], pageSize: number): Promise<void> {
  const index = await getMeiliIndex(RESEARCH_ENTITY_SEARCH_INDEX_NAME);
  const client = await getMeiliClient();
  for (let start = 0; start < docIds.length; start += pageSize) {
    const batch = docIds.slice(start, start + pageSize);
    const task = await index.deleteDocuments(batch);
    await client.tasks.waitForTask(task.taskUid);
  }
}

async function verifyRemoved(docIds: string[]): Promise<number> {
  const index = await getMeiliIndex(RESEARCH_ENTITY_SEARCH_INDEX_NAME);
  let stillPresent = 0;
  for (const id of docIds) {
    try {
      await index.getDocument(id);
      stillPresent += 1;
    } catch {
      continue;
    }
  }
  return stillPresent;
}

function writeReport(report: Record<string, unknown>, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

async function main(): Promise<void> {
  const args = parsePruneArchivedIndexArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'meili:prune-archived-research-entities',
    mongoUrl: process.env.MONGODBURL,
  });
  assertPruneArchivedIndexApplyAllowed(args, guard.dbLabel);

  await initializeConnections();

  const liveEntityIds = await loadLiveEntityIds();
  const indexedDocIds = await loadIndexedDocumentIds(args.pageSize);
  const prunableDocIds = computeIndexDocIdsToPrune(liveEntityIds, indexedDocIds);

  let prunedCount = 0;
  let stillPresentAfter: number | undefined;
  if (args.apply && prunableDocIds.length > 0) {
    await deleteIndexDocuments(prunableDocIds, args.pageSize);
    stillPresentAfter = await verifyRemoved(prunableDocIds);
    prunedCount = prunableDocIds.length - stillPresentAfter;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    index: RESEARCH_ENTITY_SEARCH_INDEX_NAME,
    mode: args.apply ? 'apply' : 'dry-run',
    liveEntitiesInMongo: liveEntityIds.length,
    indexedDocumentsScanned: indexedDocIds.length,
    prunableDocumentCount: prunableDocIds.length,
    prunableDocumentIds: prunableDocIds,
    prunedCount,
    stillPresentAfter,
  };
  console.log(JSON.stringify(report, null, 2));
  writeReport(report, args.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error(
        'Failed to prune archived research entities from index:',
        sanitizeLogValue(error),
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
