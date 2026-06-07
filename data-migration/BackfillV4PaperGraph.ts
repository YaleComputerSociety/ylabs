/**
 * Deprecated v4 paper graph backfill.
 *
 * PaperGroupLink/paper_entity_links were removed from runtime cleanup, so this
 * command must fail explicitly instead of importing deleted models.
 */
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

import {
  buildV4MigrationOutput,
  type MigrationOptions,
  parseMigrationOptions,
} from './v4MigrationUtils';

const PAPER_GRAPH_BLOCKED_REASON =
  'BackfillV4PaperGraph is blocked because the PaperGroupLink/paper_entity_links surface was removed from runtime. A new implementation must target current paper_authors, research_scholarly_links, and research_scholarly_attributions semantics instead of recreating PaperGroupLink.';

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

export function buildV4PaperGraphBlockedOutput(metadata: DeprecatedV4BackfillMetadata) {
  return buildV4MigrationOutput<DeprecatedV4BackfillOutput>(
    {
      status: 'blocked',
      deprecatedSurface: 'PaperGroupLink',
      requiresNewImplementation: true,
      blockedReason: PAPER_GRAPH_BLOCKED_REASON,
      nextAction:
        'Design a canonical research-activity backfill against paper_authors and research_scholarly_* collections before enabling this migration.',
    },
    metadata,
  );
}

export async function writeV4PaperGraphBlockedOutput(
  outputPath: string | undefined,
  output: ReturnType<typeof buildV4PaperGraphBlockedOutput>,
): Promise<void> {
  if (!outputPath) return;
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
}

export async function backfillV4PaperGraph(
  argv = process.argv.slice(2),
): Promise<ReturnType<typeof buildV4PaperGraphBlockedOutput>> {
  const options = parseMigrationOptions(argv);
  const output = buildV4PaperGraphBlockedOutput({
    environment: process.env.SCRAPER_ENV || 'local',
    options,
  });
  await writeV4PaperGraphBlockedOutput(options.output, output);
  console.log(JSON.stringify(output, null, 2));
  throw new Error(PAPER_GRAPH_BLOCKED_REASON);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  backfillV4PaperGraph().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
