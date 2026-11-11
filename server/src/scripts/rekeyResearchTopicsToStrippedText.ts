/**
 * `research-topics:rekey-stripped` (#5577): copies each row's cached topic reading from the
 * key of its raw stored page text to the key of the same text with site chrome removed, so
 * the lane's chrome strip withdraws no topics and needs no model call. It reads no page and
 * writes no observation or row. Dry run by default; an apply needs
 * `--confirm-research-topics-rekey` and must run before the next materialize.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchTopicsDerivation } from '../models/researchTopicsDerivation';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { loadStoredPageTextRows } from './deriveResearchTopics';
import { parseDeriveResearchTopicsArgs } from './deriveResearchTopicsCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  parseRekeyResearchTopicsArgs,
  rekeyResearchTopicsToStrippedText,
  type RekeyResearchTopicsStore,
} from './rekeyResearchTopicsToStrippedTextCore';
import type { ResearchTopicsDerivationRecord } from './deriveResearchTopicsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const mongoRekeyStore: RekeyResearchTopicsStore = {
  async find(inputHash) {
    return (await ResearchTopicsDerivation.findOne({ inputHash })
      .select('-_id inputHash promptHash model extractedTopics extractedField derivedAt')
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

async function main() {
  const args = parseRekeyResearchTopicsArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'research-topics:rekey-stripped',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${args.apply ? 'apply' : 'dry-run'}`,
  );
  await initializeConnections();
  const rows = await loadStoredPageTextRows(parseDeriveResearchTopicsArgs(['--all']));
  const report = await rekeyResearchTopicsToStrippedText({
    rows,
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
      console.error('Failed to re-key research topics:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect().catch(() => undefined);
    });
}
