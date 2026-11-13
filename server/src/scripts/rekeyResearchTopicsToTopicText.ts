/**
 * `research-topics:rekey-topic-text` (#5882): moves each row's cached topic reading to the key
 * of its text under `researchPageTextEntriesForTopics`. It reads no page and writes no
 * observation or row. Dry run by default; an apply needs
 * `--confirm-research-topics-topic-text-rekey`, takes the Development write lease, and must
 * run before the next `researchAreas` materialize.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchTopicsDerivation } from '../models/researchTopicsDerivation';
import {
  RESEARCH_PAGE_TEXT_FIELD,
  RESEARCH_PAGE_TEXT_SOURCE,
} from '../scrapers/utils/researchPageText';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { loadStoredPageTextRows } from './deriveResearchTopics';
import { parseDeriveResearchTopicsArgs } from './deriveResearchTopicsCore';
import type { ResearchTopicsDerivationRecord } from './deriveResearchTopicsCore';
import type { RekeyResearchTopicsStore } from './rekeyResearchTopicsToStrippedTextCore';
import {
  parseRekeyTopicTextArgs,
  rekeyResearchTopicsToTopicText,
  topicTextRekeyChunk,
  type TopicTextRekeyRow,
} from './rekeyResearchTopicsToTopicTextCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const mongoRekeyStore: RekeyResearchTopicsStore = {
  async find(inputHash) {
    return (await ResearchTopicsDerivation.findOne({ inputHash })
      .select('-_id inputHash promptHash model writer extractedTopics extractedField derivedAt')
      .lean()) as ResearchTopicsDerivationRecord | null;
  },
  async insert(record) {
    await ResearchTopicsDerivation.updateOne(
      { inputHash: record.inputHash },
      { $setOnInsert: record },
      { upsert: true },
    );
  },
};

interface SupersededPageText {
  entityId?: unknown;
  entityKey?: unknown;
  value?: unknown;
  observedAt?: Date;
}

const observedAtMillis = (observation: SupersededPageText): number => {
  const time = new Date(observation.observedAt ?? 0).getTime();
  return Number.isFinite(time) ? time : 0;
};

async function loadRowsWithPriorText(): Promise<TopicTextRekeyRow[]> {
  const rows = await loadStoredPageTextRows(parseDeriveResearchTopicsArgs(['--all']));
  const superseded = (
    (await Observation.find({
      entityType: 'researchEntity',
      sourceName: RESEARCH_PAGE_TEXT_SOURCE,
      field: RESEARCH_PAGE_TEXT_FIELD,
      superseded: true,
      'rollback.rolledBackAt': { $exists: false },
    })
      .select('entityId entityKey value observedAt')
      .lean()) as SupersededPageText[]
  ).sort((a, b) => observedAtMillis(b) - observedAtMillis(a));
  const priorByAnchor = new Map<string, unknown[]>();
  const remember = (anchor: string, value: unknown) =>
    priorByAnchor.set(anchor, [...(priorByAnchor.get(anchor) ?? []), value]);
  for (const observation of superseded) {
    if (observation.entityId) remember(`id:${String(observation.entityId)}`, observation.value);
    if (typeof observation.entityKey === 'string' && observation.entityKey) {
      remember(`key:${observation.entityKey}`, observation.value);
    }
  }
  return rows.map((row) => ({
    ...row,
    priorValues: [
      ...new Set([
        ...(row.entityId ? (priorByAnchor.get(`id:${row.entityId}`) ?? []) : []),
        ...(row.entityKey ? (priorByAnchor.get(`key:${row.entityKey}`) ?? []) : []),
      ]),
    ],
  }));
}

async function main() {
  const args = parseRekeyTopicTextArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'research-topics:rekey-topic-text',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${args.apply ? 'apply' : 'dry-run'}`,
  );
  await initializeConnections();
  const report = await rekeyResearchTopicsToTopicText({
    rows: topicTextRekeyChunk(await loadRowsWithPriorText(), args),
    store: mongoRekeyStore,
    apply: args.apply,
  });
  const summary = { ...report, rows: `${report.rows.length} rows` };
  console.log(
    JSON.stringify(
      { mode: args.apply ? 'apply' : 'dry-run', db: guard.dbLabel, ...summary },
      null,
      2,
    ),
  );
  if (args.output) {
    fs.writeFileSync(resolveSafeJsonReportOutputPath(args.output), JSON.stringify(report, null, 2));
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to re-key research topics to topic text:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect().catch(() => undefined);
    });
}
