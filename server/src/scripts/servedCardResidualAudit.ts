/**
 * Read-only sizing run for the residual copy classes the 2026-08-31 hand-read of
 * 100 `student_ready` cards left behind (#2299).
 *
 * Every tier-admitted row is walked through `getResearchGroupDetail`, so the copy
 * judged is the copy the detail route serves. Reconstructing the projection is
 * what made three earlier measurements wrong (#2591): the route resolves the
 * roster, derives `leadMemberNames`, and only then builds the representation the
 * DTO is built from, and the representation's sanitizer passes run nowhere else.
 *
 * One route call per row, thousands of them, so this takes tens of minutes. It
 * writes nothing to any environment.
 *
 * Connecting Mongoose builds indexes for every registered model, which recreates
 * a collection that was deliberately dropped (#2812), so `autoIndex` is disabled
 * and the collection set is compared before and after.
 *
 * Usage:
 *   yarn --cwd server research-entity:audit-served-card-residuals \
 *     --output ./tmp/served-card-residuals.json
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { MongoClient } from 'mongodb';
import { getResearchGroupDetail } from '../services/researchGroupService';
import { summarizeMongoUrl } from '../scrapers/scraperEnvironment';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  assertServedCardResidualAuditConsistent,
  buildServedCardResidualAudit,
  formatServedCardResidualAudit,
  type ServedCardResidualRow,
} from './servedCardResidualAuditCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const RESEARCH_ENTITIES_COLLECTION = 'research_entities';
const SERVED_TIER = 'student_ready';

const collectionNames = async (client: MongoClient): Promise<string[]> =>
  (await client.db().listCollections({}, { nameOnly: true }).toArray())
    .map((entry) => entry.name)
    .sort();

const textValue = (value: unknown): string => (typeof value === 'string' ? value : '');

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((entry) => String(entry)) : [];

function parseOutput(argv: string[]): string | undefined {
  const index = argv.indexOf('--output');
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value) throw new Error('--output needs a path');
  return value;
}

async function main(): Promise<void> {
  const requestedOutput = parseOutput(process.argv.slice(2));
  const safeOutput = requestedOutput ? resolveSafeJsonReportOutputPath(requestedOutput) : undefined;

  const url = String(process.env.MONGODBURL || '').trim();
  if (!url) {
    throw new Error(
      'MONGODBURL is required. A worktree has no server/.env of its own, so copy or symlink one in.',
    );
  }
  console.log(`Reading ${summarizeMongoUrl(url)}`);

  const client = new MongoClient(url);
  await client.connect();
  try {
    const db = client.db();
    const collectionsBefore = await collectionNames(client);
    const slugs = (
      await db
        .collection(RESEARCH_ENTITIES_COLLECTION)
        .find(
          { studentVisibilityTier: SERVED_TIER, archived: { $ne: true } },
          { projection: { slug: 1 } },
        )
        .toArray()
    ).map((doc) => String((doc as any).slug || ''));
    console.log(`tier-admitted rows: ${slugs.length}`);

    mongoose.set('autoIndex', false);
    await mongoose.connect(url);
    const rows: ServedCardResidualRow[] = [];
    let servesNoPage = 0;
    try {
      let scanned = 0;
      for (const slug of slugs) {
        scanned += 1;
        const entity = (await getResearchGroupDetail(slug))?.researchEntity as
          | Record<string, unknown>
          | undefined
          | null;
        if (!entity) {
          servesNoPage += 1;
        } else {
          rows.push({
            slug,
            shortDescription: textValue(entity.shortDescription),
            fullDescription: textValue(entity.fullDescription),
            researchAreas: stringList(entity.researchAreas),
          });
        }
        if (scanned % 250 === 0) {
          console.log(`  ${scanned}/${slugs.length} scanned, ${rows.length} served`);
        }
      }
    } finally {
      await mongoose.disconnect();
    }

    const collectionsAfter = await collectionNames(client);
    if (collectionsBefore.join('\n') !== collectionsAfter.join('\n')) {
      throw new Error(
        'the collection set changed while auditing, so a dropped collection was recreated',
      );
    }

    const audit = buildServedCardResidualAudit(rows);
    assertServedCardResidualAuditConsistent(audit);
    console.log(`\n${formatServedCardResidualAudit(audit)}`);
    console.log(`serves no page              | ${servesNoPage}`);

    if (safeOutput) {
      fs.writeFileSync(safeOutput, JSON.stringify({ ...audit, servesNoPage }, null, 2));
      console.log(`\nSlug lists written to ${safeOutput}`);
    }
  } finally {
    await client.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
