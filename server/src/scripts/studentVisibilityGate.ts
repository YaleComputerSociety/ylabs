import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { runStudentVisibilityGate, type StudentVisibilityGateCollection } from '../services/studentVisibilityGateService';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

dotenv.config();

interface CliOptions {
  collection: StudentVisibilityGateCollection;
  mode: 'dry-run' | 'apply';
  sourceName?: string;
  recordIds?: string[];
  limit?: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    collection: 'all',
    mode: 'dry-run',
  };

  for (const arg of argv) {
    if (arg === '--mode=apply' || arg === '--apply') {
      options.mode = 'apply';
    } else if (arg === '--mode=dry-run' || arg === '--dry-run') {
      options.mode = 'dry-run';
    } else if (arg === '--collection=research') {
      options.collection = 'research';
    } else if (arg === '--collection=programs') {
      options.collection = 'programs';
    } else if (arg === '--collection=all') {
      options.collection = 'all';
    } else if (arg.startsWith('--source=')) {
      options.sourceName = arg.slice('--source='.length).trim();
    } else if (arg.startsWith('--record-id=')) {
      options.recordIds = [...(options.recordIds || []), arg.slice('--record-id='.length).trim()];
    } else if (arg.startsWith('--limit=')) {
      const parsed = Number(arg.slice('--limit='.length));
      options.limit = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.recordIds) {
    options.recordIds = options.recordIds.filter(Boolean);
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.mode === 'apply',
    scriptName: 'studentVisibilityGate',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const report = await runStudentVisibilityGate(options);

  console.log(
    JSON.stringify(
      {
        environment: guard.environment,
        db: guard.dbLabel,
        ...report,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error('Failed to run student visibility gate:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
