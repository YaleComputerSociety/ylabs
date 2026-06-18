/**
 * Deprecated v4 research group stats backfill.
 *
 * ResearchGroupStats/research_entity_stats were removed from runtime cleanup,
 * so this command must fail explicitly instead of importing deleted models.
 */
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

import {
  buildV4MigrationOutput,
  type MigrationOptions,
  parseMigrationOptions,
} from './v4MigrationUtils';

const RESEARCH_GROUP_STATS_BLOCKED_REASON =
  'BackfillV4ResearchGroupStats is blocked because the ResearchGroupStats/research_entity_stats surface was removed from runtime. A new implementation must target current canonical analytics or visibility artifacts instead of recreating ResearchGroupStats.';

export interface DeprecatedV4BackfillMetadata {
  generatedAt?: string;
  environment?: string;
  db?: string;
  options: MigrationOptions;
}

export interface DeprecatedV4BackfillOutput {
  status: 'blocked';
  deprecatedSurface: string;
  requiresNewImplementation: true;
  blockedReason: string;
  nextAction: string;
}

export function buildV4ResearchGroupStatsBlockedOutput(metadata: DeprecatedV4BackfillMetadata) {
  return buildV4MigrationOutput<DeprecatedV4BackfillOutput>(
    {
      status: 'blocked',
      deprecatedSurface: 'ResearchGroupStats',
      requiresNewImplementation: true,
      blockedReason: RESEARCH_GROUP_STATS_BLOCKED_REASON,
      nextAction:
        'Design a canonical stats or operator-report backfill against current ResearchEntity analytics before enabling this migration.',
    },
    metadata,
  );
}

export async function writeV4ResearchGroupStatsBlockedOutput(
  outputPath: string | undefined,
  output: ReturnType<typeof buildV4ResearchGroupStatsBlockedOutput>,
): Promise<void> {
  if (!outputPath) return;
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
}

export async function backfillV4ResearchGroupStats(
  argv = process.argv.slice(2),
): Promise<ReturnType<typeof buildV4ResearchGroupStatsBlockedOutput>> {
  const options = parseMigrationOptions(argv);
  const output = buildV4ResearchGroupStatsBlockedOutput({
    environment: process.env.SCRAPER_ENV || 'local',
    options,
  });
  await writeV4ResearchGroupStatsBlockedOutput(options.output, output);
  console.log(JSON.stringify(output, null, 2));
  throw new Error(RESEARCH_GROUP_STATS_BLOCKED_REASON);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  backfillV4ResearchGroupStats().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
