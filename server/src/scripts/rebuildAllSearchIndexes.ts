import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { initializeConnections } from '../db/connections';
import { rebuildResearchEntitySearchIndex } from '../services/researchEntitySearchIndexService';
import { searchPathways } from '../services/pathwaySearchService';
import { rebuildPathwaySearchIndex } from '../services/pathwaySearchIndexService';

dotenv.config();

interface CliOptions {
  researchPageSize: number;
  pathwayPageSize: number;
  clearExisting: boolean;
  strategy: 'direct' | 'swap';
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    researchPageSize: 250,
    pathwayPageSize: 100,
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
    if (arg === '--strategy=swap') {
      options.strategy = 'swap';
      continue;
    }
    if (arg === '--strategy=direct') {
      options.strategy = 'direct';
      continue;
    }
    if (arg.startsWith('--page-size=')) {
      const parsed = Number(arg.split('=')[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.researchPageSize = parsed;
        options.pathwayPageSize = Math.min(100, parsed);
      }
      continue;
    }
    if (arg.startsWith('--research-page-size=')) {
      const parsed = Number(arg.split('=')[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.researchPageSize = parsed;
      }
      continue;
    }
    if (arg.startsWith('--pathway-page-size=')) {
      const parsed = Number(arg.split('=')[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.pathwayPageSize = parsed;
      }
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await initializeConnections();

  const researchEntities = await rebuildResearchEntitySearchIndex({
    pageSize: options.researchPageSize,
    clearExisting: options.clearExisting,
    strategy: options.strategy,
  });
  const pathways = await rebuildPathwaySearchIndex(
    (page, pageSize) =>
      searchPathways({
        page,
        pageSize,
        sort: { sortBy: 'createdAt', sortOrder: 'desc' },
      }),
    {
      pageSize: options.pathwayPageSize,
      clearExisting: options.clearExisting,
      strategy: options.strategy,
    },
  );

  console.log(JSON.stringify({ researchEntities, pathways }, null, 2));
}

main()
  .catch((error) => {
    console.error('Failed to rebuild Meilisearch indexes:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
