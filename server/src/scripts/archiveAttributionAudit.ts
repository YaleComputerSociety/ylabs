/**
 * research-entity:audit-archive-attribution - reports which archived research
 * entities record the lane that archived them, and which record nothing (#2558).
 *
 * Read-only: opens a connection, reads `research_entities`, writes nothing. Emits
 * machine-readable JSON and a non-zero exit code while any archived row is
 * unattributable, so the governance gap is visible without anyone reading the
 * collection by hand.
 *
 *   yarn --cwd server research-entity:audit-archive-attribution
 *   yarn --cwd server research-entity:audit-archive-attribution --entity-type=LAB
 *   yarn --cwd server research-entity:audit-archive-attribution --output=/tmp/archive-attribution.json
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  ARCHIVE_ATTRIBUTION_ALARM_EXIT_CODE,
  summarizeArchiveAttribution,
  type ArchivedRowAttributionInput,
} from './archiveAttributionAuditCore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ArchiveAttributionAuditOptions {
  output?: string;
  entityType?: string;
}

export function parseArchiveAttributionAuditArgs(argv: string[]): ArchiveAttributionAuditOptions {
  const options: ArchiveAttributionAuditOptions = {};
  for (const arg of argv) {
    if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else if (arg.startsWith('--entity-type=')) {
      const value = arg.slice('--entity-type='.length).trim();
      if (!value) throw new Error('--entity-type must name an entity type');
      options.entityType = value;
    } else {
      throw new Error(`Unknown research-entity:audit-archive-attribution argument: ${arg}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArchiveAttributionAuditArgs(process.argv.slice(2));
  await initializeConnections();

  const match: Record<string, unknown> = { archived: true };
  if (options.entityType) match.entityType = options.entityType;
  const rows = (await ResearchEntity.find(match, {
    entityType: 1,
    archivedReason: 1,
    canonicalGroupId: 1,
    studentVisibilitySuppressionReason: 1,
  }).lean()) as ArchivedRowAttributionInput[];

  const report = {
    generatedAt: new Date().toISOString(),
    db: mongoose.connection.name,
    entityTypeFilter: options.entityType || null,
    ...summarizeArchiveAttribution(rows),
  };

  console.log(JSON.stringify(report, null, 2));
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  }

  await mongoose.disconnect();
  if (report.status === 'unattributable-archives') {
    process.exitCode = ARCHIVE_ATTRIBUTION_ALARM_EXIT_CODE;
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
  main().catch((error) => {
    console.error('Failed to audit archive attribution:', sanitizeLogValue(error));
    process.exitCode = 1;
  });
}
