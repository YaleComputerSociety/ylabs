/**
 * Read-only sizing run for #3098: how much of the served biography-card class each
 * of the two existing mechanisms can reach.
 *
 * Every tier-admitted row is walked through `getResearchGroupDetail`, so the card
 * judged is the card the detail route serves. Reconstructing the projection is what
 * made three earlier measurements wrong (#2591): the route resolves the roster,
 * derives `leadMemberNames`, and only then builds the representation the DTO comes
 * from, and the card resolution runs nowhere else.
 *
 * The synthesis lane's reach is asked of the lane's own selector
 * (`selectFraProfileSynthesisTargets` plus its `entityHasNonBioSourcedDescription`
 * skip) over the lane's own projection and batch-resolved leads, rather than a
 * transcription of its rules here.
 *
 * One route call per row, thousands of them, so the walk takes tens of minutes. It
 * writes nothing to any environment.
 *
 * Connecting Mongoose builds indexes for every registered model, which recreates a
 * collection that was deliberately dropped (#2812), so `autoIndex` is disabled and
 * the collection set is compared before and after.
 *
 * Usage:
 *   yarn --cwd server research-entity:audit-served-biography-cards \
 *     --rows ./tmp/served-biography-rows.json --output ./tmp/served-biography-cards.json
 *
 * `--rows` caches the served copy the walk produced and `--from-rows` recounts from
 * that cache without touching the database, which is what sharpening a detector
 * needs. The lane-reach bucket needs the database, so `--from-rows` reports every
 * other bucket and omits it.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { MongoClient } from 'mongodb';
import { getResearchGroupDetail } from '../services/researchGroupService';
import { ResearchEntity } from '../models/researchEntity';
import { summarizeMongoUrl } from '../scrapers/scraperEnvironment';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  FRA_PROFILE_SYNTHESIS_ENTITY_FIELDS,
  entityHasNonBioSourcedDescription,
  fraProfileSynthesisLeads,
  profileUrlsOf,
  selectFraProfileSynthesisTargets,
  type FraProfileSynthesisEntity,
} from './fraProfileSynthesisLane';
import {
  assertBiographyCardReachabilityConsistent,
  buildBiographyCardPopulation,
  buildBiographyCardReachability,
  formatBiographyCardReachability,
  type ServedBiographyCardRow,
} from './servedBiographyCardReachabilityAuditCore';

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

function parseFlag(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value) throw new Error(`${flag} needs a path`);
  return value;
}

interface SynthesisLaneReach {
  scopedByLaneSelector: number;
  scopedSlugs: string[];
  betterSourcedSkip: number;
  attemptable: number;
  attemptableSlugs: string[];
}

/**
 * How many of the biography-card slugs the synthesis lane would attempt, asked of the
 * lane's own selector and its own better-sourced skip in the order the lane applies
 * them.
 */
async function measureSynthesisLaneReach(slugs: readonly string[]): Promise<SynthesisLaneReach> {
  const entities = (await ResearchEntity.find({ slug: { $in: [...slugs] } })
    .select(FRA_PROFILE_SYNTHESIS_ENTITY_FIELDS)
    .lean()) as FraProfileSynthesisEntity[];
  const leadsByEntityId = await fraProfileSynthesisLeads(entities);
  const scoped = selectFraProfileSynthesisTargets(
    entities.map((entity) => ({
      ...entity,
      leads: leadsByEntityId.get(String(entity._id)) ?? [],
    })),
  );
  const attemptableSlugs: string[] = [];
  let betterSourcedSkip = 0;
  for (const entity of scoped) {
    if (await entityHasNonBioSourcedDescription(entity)) {
      betterSourcedSkip += 1;
      continue;
    }
    if (profileUrlsOf(entity).length > 0) attemptableSlugs.push(String(entity.slug));
  }
  return {
    scopedByLaneSelector: scoped.length,
    scopedSlugs: scoped.map((entity) => String(entity.slug)),
    betterSourcedSkip,
    attemptable: attemptableSlugs.length,
    attemptableSlugs,
  };
}

function reportAudit(
  rows: ServedBiographyCardRow[],
  servesNoPage: number,
  laneReach: SynthesisLaneReach | undefined,
  safeOutput?: string,
): void {
  const population = buildBiographyCardPopulation(rows);
  const reachability = buildBiographyCardReachability(rows);
  assertBiographyCardReachabilityConsistent(reachability);
  console.log(
    `\n${formatBiographyCardReachability(population, reachability, laneReach?.attemptable)}`,
  );
  if (laneReach) {
    console.log(`  lane selector in scope              | ${laneReach.scopedByLaneSelector}`);
    console.log(`  of those, better-sourced skip       | ${laneReach.betterSourcedSkip}`);
  }
  const reached = new Set([
    ...reachability.substitutableSlugs,
    ...(laneReach?.attemptableSlugs ?? []),
  ]);
  console.log(`reached by either mechanism           | ${reached.size}`);
  console.log(`residue neither reaches              | ${reachability.population - reached.size}`);
  console.log(`serves no page                        | ${servesNoPage}`);
  if (safeOutput) {
    fs.writeFileSync(
      safeOutput,
      JSON.stringify({ population, reachability, laneReach, servesNoPage }, null, 2),
    );
    console.log(`\nSlug lists and matched examples written to ${safeOutput}`);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const requestedOutput = parseFlag(argv, '--output');
  const safeOutput = requestedOutput ? resolveSafeJsonReportOutputPath(requestedOutput) : undefined;
  const requestedRows = parseFlag(argv, '--rows');
  const safeRows = requestedRows ? resolveSafeJsonReportOutputPath(requestedRows) : undefined;
  const fromRows = parseFlag(argv, '--from-rows');

  if (fromRows) {
    const cached = JSON.parse(fs.readFileSync(resolveSafeJsonReportOutputPath(fromRows), 'utf8'));
    console.log(`Recounting ${cached.rows.length} cached served rows walked at ${cached.walkedAt}`);
    reportAudit(
      cached.rows as ServedBiographyCardRow[],
      Number(cached.servesNoPage || 0),
      undefined,
      safeOutput,
    );
    return;
  }

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
    ).map((doc) => String((doc as { slug?: unknown }).slug || ''));
    console.log(`tier-admitted rows: ${slugs.length}`);

    mongoose.set('autoIndex', false);
    await mongoose.connect(url);
    const rows: ServedBiographyCardRow[] = [];
    let servesNoPage = 0;
    let laneReach: SynthesisLaneReach | undefined;
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
            entityType: textValue(entity.entityType),
            kind: textValue(entity.kind),
          });
        }
        if (scanned % 250 === 0) {
          console.log(`  ${scanned}/${slugs.length} scanned, ${rows.length} served`);
        }
      }
      laneReach = await measureSynthesisLaneReach(buildBiographyCardPopulation(rows).slugs);
    } finally {
      await mongoose.disconnect();
    }

    const collectionsAfter = await collectionNames(client);
    if (collectionsBefore.join('\n') !== collectionsAfter.join('\n')) {
      throw new Error(
        'the collection set changed while auditing, so a dropped collection was recreated',
      );
    }

    if (safeRows) {
      fs.writeFileSync(
        safeRows,
        JSON.stringify({ walkedAt: new Date().toISOString(), servesNoPage, rows }, null, 1),
      );
      console.log(`Served copy cached at ${safeRows}`);
    }

    reportAudit(rows, servesNoPage, laneReach, safeOutput);
  } finally {
    await client.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
