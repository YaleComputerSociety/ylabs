import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { mongoCardSynthesisDerivationStore } from '../scrapers/cardSynthesisDerivation';
import { CARD_SYNTHESIS_MODEL, defaultCardSynthesisLLM } from '../utils/groundedCardSynthesis';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  assertCardSynthesisAllowed,
  cardSynthesisModeOf,
  collectCardRequests,
  parseCardRequests,
  parseCardSynthesisArgs,
  parseImportedCardDrafts,
  runCardImport,
  runCardPass,
} from './cardSynthesisCore';
import {
  loadWriterEntitiesBySlug,
  readJsonInputFile,
  readSlugsFile,
} from './coverageSynthesisEvidence';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const SCRIPT_NAME = 'research-entity:card-synthesis';

async function main(): Promise<void> {
  const args = parseCardSynthesisArgs(process.argv.slice(2));
  const mode = cardSynthesisModeOf(args);
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  const apiKey = process.env.OPENAI_API_KEY?.trim() || undefined;
  assertCardSynthesisAllowed(args, mode, guard.dbLabel, apiKey);
  await initializeConnections();

  const slugs = [
    ...new Set([...args.slugs, ...(args.slugsFile ? readSlugsFile(args.slugsFile) : [])]),
  ];
  const requests = args.bodiesFile
    ? parseCardRequests(readJsonInputFile(args.bodiesFile, '--bodies-file'))
    : await collectCardRequests(await loadWriterEntitiesBySlug(slugs));
  const write = (flag: string, file: string, value: unknown) =>
    fs.writeFileSync(resolveSafeJsonReportOutputPath(file, flag), JSON.stringify(value, null, 2));

  if (mode === 'capture-bodies') {
    write('--capture-bodies', args.captureBodies as string, requests);
    console.log(JSON.stringify({ mode, db: guard.dbLabel, requests: requests.length }, null, 2));
    return;
  }
  const store = mongoCardSynthesisDerivationStore;
  if (mode === 'import-derivations') {
    const report = await runCardImport({
      requests,
      drafts: parseImportedCardDrafts(
        readJsonInputFile(args.importDerivations as string, '--import-derivations'),
      ),
      store,
      validateOnly: args.validateOnly,
    });
    if (args.output) write('--output', args.output, { mode, db: guard.dbLabel, ...report });
    console.log(
      JSON.stringify(
        { mode, db: guard.dbLabel, stored: report.stored, rows: report.rows.length },
        null,
        2,
      ),
    );
    return;
  }
  const report = await runCardPass({
    requests,
    store,
    callLLM:
      args.apply && apiKey
        ? (llmInput) =>
            defaultCardSynthesisLLM({ ...llmInput, apiKey, model: CARD_SYNTHESIS_MODEL })
        : null,
    concurrency: args.concurrency,
  });
  if (args.output)
    write('--output', args.output, { mode, apply: args.apply, db: guard.dbLabel, ...report });
  console.log(
    JSON.stringify(
      {
        mode,
        apply: args.apply,
        db: guard.dbLabel,
        modelCalls: report.modelCalls,
        byStep: report.byStep,
      },
      null,
      2,
    ),
  );
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error(`${SCRIPT_NAME} failed:`, sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
