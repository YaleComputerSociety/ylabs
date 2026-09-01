import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { runInferredPiLeadMaterializationBackfill } from './backfillInferredPiLeadMaterializationCore';
import { createInferredPiLeadMaterializationDeps } from '../scrapers/inferredPiLeadReclaim';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function parseOutputPath(argv: string[]): string | undefined {
  const inline = argv.find((arg) => arg.startsWith('--output='));
  if (inline) return resolveSafeJsonReportOutputPath(inline.slice('--output='.length));
  const flagIndex = argv.indexOf('--output');
  if (flagIndex >= 0) return resolveSafeJsonReportOutputPath(argv[flagIndex + 1]);
  return undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const scope = argv.includes('--all') ? 'all' : 'grant-shells';
  const output = parseOutputPath(argv);

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'backfillInferredPiLeadMaterialization',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const report = await runInferredPiLeadMaterializationBackfill(
    createInferredPiLeadMaterializationDeps(scope),
    { apply },
  );

  const outputReport = {
    mode: apply ? 'apply' : 'dry-run',
    scope,
    environment: guard.environment,
    db: guard.dbLabel,
    ...report,
  };
  console.log(JSON.stringify(outputReport, null, 2));
  if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(outputReport, null, 2)}\n`);
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to materialize inferred PI leads:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
