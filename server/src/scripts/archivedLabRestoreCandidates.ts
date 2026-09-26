/**
 * research-entity:audit-archived-lab-restore-candidates - narrows the archived `LAB`
 * rows to the ones whose own research site is still live and is served by nothing
 * else, so a restore argument starts from evidence instead of a URL proxy (#2558).
 *
 * Read-only: opens a connection, reads `research_entities`, writes nothing.
 *
 *   yarn --cwd server research-entity:audit-archived-lab-restore-candidates
 *   yarn --cwd server research-entity:audit-archived-lab-restore-candidates --output=/tmp/restore.json
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { LIVE_ENTITY_FILTER } from '../models/entityArchival';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  normalizeSiteUrl,
  summarizeArchivedLabRestoreCandidates,
  type ArchivedLabRestoreRowInput,
} from './archivedLabRestoreCandidatesCore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ArchivedLabRestoreAuditOptions {
  output?: string;
}

export function parseArchivedLabRestoreAuditArgs(argv: string[]): ArchivedLabRestoreAuditOptions {
  const options: ArchivedLabRestoreAuditOptions = {};
  for (const arg of argv) {
    if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(
        `Unknown research-entity:audit-archived-lab-restore-candidates argument: ${arg}`,
      );
    }
  }
  return options;
}

const sourceUrlText = (entry: unknown): string =>
  typeof entry === 'string' ? entry : ((entry as { url?: string } | null)?.url ?? '');

async function main() {
  const options = parseArchivedLabRestoreAuditArgs(process.argv.slice(2));
  await initializeConnections();

  const liveRows = await ResearchEntity.find(LIVE_ENTITY_FILTER, {
    _id: 1,
    websiteUrl: 1,
    sourceUrls: 1,
  }).lean();

  const liveServedSiteUrls = new Set<string>();
  const liveIds = new Set<string>();
  for (const row of liveRows) {
    liveIds.add(String(row._id));
    const site = normalizeSiteUrl(row.websiteUrl);
    if (site) liveServedSiteUrls.add(site);
    for (const entry of (row.sourceUrls as unknown[]) || []) {
      const normalized = normalizeSiteUrl(sourceUrlText(entry));
      if (normalized) liveServedSiteUrls.add(normalized);
    }
  }

  const archivedLabs = await ResearchEntity.find(
    { archived: true, entityType: 'LAB' },
    {
      slug: 1,
      name: 1,
      websiteUrl: 1,
      description: 1,
      archivedReason: 1,
      canonicalGroupId: 1,
      sourceLinkHealth: 1,
    },
  ).lean();

  const rows: ArchivedLabRestoreRowInput[] = archivedLabs.map((row) => {
    const site = normalizeSiteUrl(row.websiteUrl);
    const ownHealth = ((row.sourceLinkHealth as unknown[]) || [])
      .map((entry) => entry as { url?: string; healthStatus?: string })
      .find((entry) => normalizeSiteUrl(entry?.url) === site);
    return {
      slug: row.slug,
      name: row.name,
      websiteUrl: row.websiteUrl,
      archivedReason: (row as { archivedReason?: unknown }).archivedReason,
      descriptionChars: typeof row.description === 'string' ? row.description.trim().length : 0,
      canonicalResolvesToLiveRow: row.canonicalGroupId
        ? liveIds.has(String(row.canonicalGroupId))
        : false,
      ownSiteHealthStatus: ownHealth?.healthStatus,
    };
  });

  const report = {
    generatedAt: new Date().toISOString(),
    db: mongoose.connection.name,
    liveRows: liveRows.length,
    ...summarizeArchivedLabRestoreCandidates(rows, { liveServedSiteUrls }),
  };

  console.log(JSON.stringify(report, null, 2));
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  }

  await mongoose.disconnect();
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
  main().catch((error) => {
    console.error('Failed to audit archived-lab restore candidates:', sanitizeLogValue(error));
    process.exitCode = 1;
  });
}
