/**
 * Entry for `yarn served-check --as student` (#6079), started only by scripts/served-check.mjs.
 * Results leave on file descriptor 3 so the API's own logs never mix with them.
 */
import net from 'node:net';
import mongoose from 'mongoose';
import { installMongoWriteRefusal } from '../scrapers/utils/mongoWriteRefusal';
import { assertStudentCheckRuntime } from '../utils/servedCheckStudentSession';
import { sanitizeLogValue } from '../utils/logSanitizer';

const RESULT_FD = 3;
const WRITE_SETTLE_MS = 250;

const resultStream = new net.Socket({ fd: RESULT_FD, readable: false, writable: true });
const writeResult = (line: string) => {
  resultStream.write(`${line}\n`);
};

const readAsStudent = async () => {
  assertStudentCheckRuntime();
  const refusal = installMongoWriteRefusal(mongoose);
  const { declareRequestServingProcess } = await import('../db/devWriteGuard');
  declareRequestServingProcess();
  const { initializeConnections, mongoOptions } = await import('../db/connections');
  const { warmControlledVocabularyHeadings } =
    await import('../utils/controlledVocabularyHeadings');
  const { freshDirectoryRemovalServing } = await import('../services/directoryRemovalServing');
  const { warmResearchSearchSpellingVocabulary } =
    await import('../services/researchSearchSpellingVocabulary');
  const { default: app } = await import('../app');
  const { runStudentServedCheck } = await import('./servedCheckStudentCore');

  await initializeConnections(mongoOptions);
  await warmControlledVocabularyHeadings();
  await freshDirectoryRemovalServing();
  await warmResearchSearchSpellingVocabulary();

  await runStudentServedCheck({
    app,
    paths: process.argv.slice(2),
    write: writeResult,
    refusedWrites: () => refusal.refusedOperations(),
    settleWritesMs: WRITE_SETTLE_MS,
  });
};

const main = async () => {
  try {
    await readAsStudent();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeResult(JSON.stringify({ error: sanitizeLogValue(message) }));
    console.error(sanitizeLogValue(error));
    process.exitCode = 1;
  }
};

const { runScriptMain } = await import('../db/connections');
await runScriptMain(main);
await new Promise<void>((resolve) => resultStream.end(() => resolve()));
