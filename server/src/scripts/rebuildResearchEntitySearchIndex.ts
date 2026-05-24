import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { initializeConnections } from '../db/connections';
import { rebuildResearchEntitySearchIndex } from '../services/researchEntitySearchIndexService';

dotenv.config();

interface CliOptions {
  pageSize: number;
  clearExisting: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    pageSize: 250,
    clearExisting: true,
  };

  for (const arg of argv) {
    if (arg === '--clear') {
      options.clearExisting = true;
      continue;
    }
    if (arg === '--no-clear') {
      options.clearExisting = false;
      continue;
    }

    if (arg.startsWith('--page-size=')) {
      const parsed = Number(arg.split('=')[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.pageSize = parsed;
      }
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await initializeConnections();

  const result = await rebuildResearchEntitySearchIndex(options);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error('Failed to rebuild research entity Meilisearch index:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
