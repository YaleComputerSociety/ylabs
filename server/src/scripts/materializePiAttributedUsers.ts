import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  PI_ATTRIBUTION_FIELDS,
  classifyPiAttributedUserOutcome,
  parseMaterializePiAttributedUsersArgs,
  summarizePiAttributedUserRows,
  type PiAttributedUserRow,
} from './materializePiAttributedUsersCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'observations:materialize-pi-attributed-users';

async function main(): Promise<void> {
  const args = parseMaterializePiAttributedUsersArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();

  const attributedKeys = (
    await Observation.distinct('value', {
      field: { $in: [...PI_ATTRIBUTION_FIELDS] },
      superseded: false,
    })
  )
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);

  const userKeys = new Set(
    (
      await Observation.distinct('entityKey', {
        entityType: 'user',
        superseded: false,
      })
    )
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean),
  );

  const candidates = [...new Set(attributedKeys.filter((key) => userKeys.has(key)))].sort();
  const visiting = args.limit ? candidates.slice(0, args.limit) : candidates;

  const rows: PiAttributedUserRow[] = [];
  for (const entityKey of visiting) {
    try {
      const result: any = await materializeEntity('user', { entityKey }, { dryRun: !args.apply });
      rows.push({
        entityKey,
        outcome: classifyPiAttributedUserOutcome(result ?? {}),
        skippedReason: result?.skipped,
        fieldsWritten: result?.fieldsWritten ?? 0,
        researcherId: result?.entityId,
      });
    } catch (error) {
      rows.push({
        entityKey,
        outcome: 'error',
        fieldsWritten: 0,
        error: sanitizeLogValue((error as Error)?.message ?? String(error)),
      });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    environment: process.env.SCRAPER_ENV || 'development',
    mode: args.apply ? 'apply' : 'dry-run',
    attributedKeys: attributedKeys.length,
    userObservationKeys: userKeys.size,
    candidates: candidates.length,
    visited: visiting.length,
    ...summarizePiAttributedUserRows(rows),
  };

  if (args.output) {
    const outputPath = resolveSafeJsonReportOutputPath(args.output);
    fs.writeFileSync(outputPath, JSON.stringify({ ...report, rows }, null, 2));
  }

  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
