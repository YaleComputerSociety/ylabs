import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { searchPathways } from '../services/pathwaySearchService';
import { rebuildPathwaySearchIndex } from '../services/pathwaySearchIndexService';

interface CliOptions {
  pageSize: number;
  clearExisting: boolean;
  strategy: 'direct' | 'swap';
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    pageSize: 100,
    clearExisting: true,
    strategy: 'direct',
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
      continue;
    }

    if (arg === '--strategy=swap') {
      options.strategy = 'swap';
      continue;
    }
    if (arg === '--strategy=direct') {
      options.strategy = 'direct';
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await initializeConnections();

  const result = await rebuildPathwaySearchIndex(
    (page, pageSize) =>
      searchPathways({
        page,
        pageSize,
        sort: { sortBy: 'createdAt', sortOrder: 'desc' },
      }),
    options,
  );

  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error('Failed to rebuild pathway Meilisearch index:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
