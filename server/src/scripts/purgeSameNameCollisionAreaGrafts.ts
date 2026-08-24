/**
 * Purge #585-class same-name-collision grafts from existing research entities
 * (#1256, #1290).
 *
 * #585 (closed) fixed the officialProfilePiBackfillScraper so a guessed
 * same-name medicine.yale.edu / ysph.yale.edu profile can no longer graft its
 * research interests and website onto an unrelated humanities/social-science
 * entity. #585's closing note called for a backfill to purge the values already
 * merged onto live `student_ready` docs; that backfill was never run, so the
 * contamination is still live and drives the search-relevance pollution
 * documented in #1256 (a military historian ranks #1 for "veterinary oncology",
 * a Caribbean historian #2 for "opioid").
 *
 * #1290 is the same collision in the opposite direction: an engineering
 * professor's engineering.yale.edu profile grafted its identity, description,
 * research areas, department, and NIH grants onto an unrelated medical-school
 * lab entity that merely shares a surname. That gap in the discipline guard is
 * fixed in officialProfilePiBackfillScraper.ts; this script purges the one
 * live record it produced before the fix (`ysm-dixit`).
 *
 * The grafted values are unbacked direct-writes (no owning observation to
 * self-scope from) and a broad regex over-purges genuine interdisciplinary
 * scholars, so this operates on an individually verified graft set from #1256 /
 * #585 / #1290 and removes only the exact strings still present. Field-scoped
 * by design (researchAreas / departments / sourceUrls / recentGrants /
 * websiteUrl / poisoned shortDescription only) to avoid the unbacked-field and
 * full-re-materialize blast-radius hazards noted in #1191 / #1177. After the
 * Mongo write it re-syncs Meilisearch so the search index stops ranking these
 * entities on the grafted domain.
 *
 *   yarn --cwd server tsx src/scripts/purgeSameNameCollisionAreaGrafts.ts            # dry-run
 *   yarn --cwd server tsx src/scripts/purgeSameNameCollisionAreaGrafts.ts --apply \
 *     --confirm-same-name-area-graft-purge
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose, { type AnyBulkWriteOperation } from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import { syncEntities } from '../services/meiliSyncService';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  planAreaGraftRemoval,
  planGrantGraftRemoval,
  planWebsiteClear,
} from './sameNameCollisionAreaGraftPurgeCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Individually verified same-name-collision grafts from #1256 (the un-run #585
 * backfill). Each entry lists the exact grafted `researchAreas` strings to
 * remove; the real discipline area(s) are left in place. `clearWebsiteUrlIfEquals`
 * clears a websiteUrl that points at a different same-name person's profile.
 * `clearPoisonedShortDescription` clears a shortDescription that echoes the
 * grafted areas (the entity's fullDescription is already correct, so the read
 * DTO falls back to it).
 */
interface GraftSpec {
  slug: string;
  removeAreas: string[];
  removeDepartments?: string[];
  removeSourceUrls?: string[];
  clearGrantIdsIfEquals?: string[];
  clearWebsiteUrlIfEquals?: string;
  clearPoisonedShortDescription?: boolean;
}

const VERIFIED_GRAFTS: GraftSpec[] = [
  {
    slug: 'eller-ae293',
    removeAreas: [
      'Opioid Use Disorder Treatment',
      'Substance Abuse Treatment and Outcomes',
      'Prenatal Substance Exposure Effects',
      'Musculoskeletal pain and rehabilitation',
      'Mental Health Treatment and Access',
    ],
  },
  {
    slug: 'polak-bp42',
    removeAreas: [
      'Liver Disease and Transplantation',
      'Liver Disease Diagnosis and Treatment',
      'Pancreatitis Pathology and Treatment',
    ],
  },
  {
    slug: 'harris-ah2323',
    removeAreas: [
      'Protein Structure and Dynamics',
      'Heart Rate Variability and Autonomic Control',
      'Pancreatic function and diabetes',
      'Erythrocyte Function and Pathophysiology',
      'Diabetes Research',
    ],
    clearPoisonedShortDescription: true,
  },
  {
    slug: 'nicholson-cn96',
    removeAreas: [
      'Diabetes Management and Education',
      'Diabetes Management and Research',
      'Clinical practice guidelines implementation',
      'Primary Care and Health Outcomes',
      'Health Policy Implementation Science',
    ],
  },
  {
    slug: 'samuels-mas278',
    removeAreas: [],
    clearWebsiteUrlIfEquals: 'https://medicine.yale.edu/profile/maurice-samuels/',
  },
  {
    slug: 'kennedy-pkennedy',
    removeAreas: [
      'Veterinary Oncology Research',
      'Virus-based gene therapy research',
      'Parasitic infections in humans and animals',
      'Veterinary Medicine and Surgery',
      'Urological Disorders and Treatments',
    ],
  },
  {
    slug: 'nih-pi-aaron-wolfe',
    removeAreas: ['Neuroscience'],
  },
  {
    // #1290: officialProfilePiBackfillScraper matched Purushottam Dixit's
    // engineering.yale.edu profile onto the unrelated ysm-dixit lab (Vishwa
    // Deep Dixit's medicine.yale.edu/lab/dixit/) by surname alone, before the
    // discipline guard covered non-medical profile hosts.
    slug: 'ysm-dixit',
    removeAreas: [],
    removeDepartments: ['Engineering and Applied Science'],
    removeSourceUrls: [
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/purushottam-dixit/',
      'https://sites.google.com/view/dixitlab/',
      'https://reporter.nih.gov/project-details/10925421',
      'https://reporter.nih.gov/project-details/11179450',
    ],
    clearGrantIdsIfEquals: ['5R35GM142547-05', '5R35GM142547-06'],
  },
];

/**
 * #1290's graft was written through the observation ledger (unlike most of
 * #1256's unbacked direct-writes), which means the mislinked observations
 * themselves must be repointed at the entity their own `entityKey` names -
 * otherwise a future field-scoped re-materialize of `ysm-dixit` would re-graft
 * the exact same Purushottam Dixit content the entity-field purge above just
 * removed. Each entry is individually verified: the observation's own
 * `entityKey` already names the correct entity (`nih-pi-purushottam-dixit`,
 * Purushottam Dixit's own real lab entity), it was only the `entityId` that
 * was wrong.
 */
interface ObservationRelink {
  observationId: string;
  fromEntitySlug: string;
  toEntitySlug: string;
}

const VERIFIED_OBSERVATION_RELINKS: ObservationRelink[] = [
  '6a6473e2b5fbd4705ec88a27',
  '6a8917dac09917b33b26ed2b',
  '6a89254a4b50e6f8062a0ade',
  '6a89254a4b50e6f8062a0adf',
  '6a89254a4b50e6f8062a0ae0',
  '6a89254a4b50e6f8062a0ae1',
  '6a89254a4b50e6f8062a0ae2',
  '6a89254a4b50e6f8062a0ae3',
].map((observationId) => ({
  observationId,
  fromEntitySlug: 'ysm-dixit',
  toEntitySlug: 'nih-pi-purushottam-dixit',
}));

interface CliOptions {
  apply: boolean;
  confirm: boolean;
  output?: string;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false, confirm: false };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--confirm-same-name-area-graft-purge') options.confirm = true;
    else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.apply && !options.confirm) {
    throw new Error('--confirm-same-name-area-graft-purge is required when --apply is set.');
  }
  return options;
}

interface PlannedUpdate {
  slug: string;
  name: unknown;
  researchAreas?: { from: string[]; to: string[]; removed: string[] };
  departments?: { from: string[]; to: string[]; removed: string[] };
  sourceUrls?: { from: string[]; to: string[]; removed: string[] };
  recentGrants?: {
    from: Array<Record<string, unknown>>;
    to: Array<Record<string, unknown>>;
    removed: Array<Record<string, unknown>>;
    fundingAgenciesTo: string[];
  };
  websiteUrl?: { from: string; to: string };
  shortDescription?: { from: string; to: string };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'purgeSameNameCollisionAreaGrafts',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const slugs = VERIFIED_GRAFTS.map((g) => g.slug);
  const entities = await ResearchEntity.find({ slug: { $in: slugs } })
    .select({
      slug: 1,
      name: 1,
      researchAreas: 1,
      departments: 1,
      sourceUrls: 1,
      recentGrants: 1,
      websiteUrl: 1,
      shortDescription: 1,
      fullDescription: 1,
    })
    .lean();
  const entityBySlug = new Map(entities.map((e) => [String(e.slug), e]));

  const plannedUpdates: PlannedUpdate[] = [];
  const missing: string[] = [];
  for (const spec of VERIFIED_GRAFTS) {
    const entity = entityBySlug.get(spec.slug);
    if (!entity) {
      missing.push(spec.slug);
      continue;
    }
    const update: PlannedUpdate = { slug: spec.slug, name: entity.name };

    if (spec.removeAreas.length > 0) {
      const current = asStringArray(entity.researchAreas);
      const result = planAreaGraftRemoval({ current, removeAreas: spec.removeAreas });
      if (result.changed) {
        update.researchAreas = { from: current, to: result.cleaned, removed: result.removed };
      }
    }

    if (spec.removeDepartments && spec.removeDepartments.length > 0) {
      const current = asStringArray(entity.departments);
      const result = planAreaGraftRemoval({ current, removeAreas: spec.removeDepartments });
      if (result.changed) {
        update.departments = { from: current, to: result.cleaned, removed: result.removed };
      }
    }

    if (spec.removeSourceUrls && spec.removeSourceUrls.length > 0) {
      const current = asStringArray(entity.sourceUrls);
      const result = planAreaGraftRemoval({ current, removeAreas: spec.removeSourceUrls });
      if (result.changed) {
        update.sourceUrls = { from: current, to: result.cleaned, removed: result.removed };
      }
    }

    if (spec.clearGrantIdsIfEquals && spec.clearGrantIdsIfEquals.length > 0) {
      const current = Array.isArray(entity.recentGrants) ? entity.recentGrants : [];
      const result = planGrantGraftRemoval({ current, removeGrantIds: spec.clearGrantIdsIfEquals });
      if (result.changed) {
        update.recentGrants = {
          from: current,
          to: result.cleaned,
          removed: result.removed,
          fundingAgenciesTo: result.fundingAgencies,
        };
      }
    }

    if (spec.clearWebsiteUrlIfEquals) {
      const website = planWebsiteClear({
        current: entity.websiteUrl,
        clearIfEquals: spec.clearWebsiteUrlIfEquals,
      });
      if (website.cleared) {
        update.websiteUrl = { from: website.from, to: '' };
      }
    }

    if (spec.clearPoisonedShortDescription) {
      const short = String(entity.shortDescription || '');
      if (short) {
        update.shortDescription = { from: short, to: '' };
      }
    }

    if (
      update.researchAreas ||
      update.departments ||
      update.sourceUrls ||
      update.recentGrants ||
      update.websiteUrl ||
      update.shortDescription
    ) {
      plannedUpdates.push(update);
    }
  }

  const relinkSlugs = Array.from(
    new Set(
      VERIFIED_OBSERVATION_RELINKS.flatMap((r) => [r.fromEntitySlug, r.toEntitySlug]),
    ),
  );
  const relinkEntities = await ResearchEntity.find({ slug: { $in: relinkSlugs } })
    .select({ slug: 1 })
    .lean();
  const relinkEntityIdBySlug = new Map(relinkEntities.map((e) => [String(e.slug), String(e._id)]));

  const observationIds = VERIFIED_OBSERVATION_RELINKS.map((r) => r.observationId);
  const observations = await Observation.find({ _id: { $in: observationIds } })
    .select({ entityId: 1, entityKey: 1 })
    .lean();
  const observationById = new Map(observations.map((o) => [String(o._id), o]));

  interface PlannedRelink {
    observationId: string;
    fromEntitySlug: string;
    toEntitySlug: string;
    currentEntityId: string | undefined;
    targetEntityId: string;
  }

  const plannedRelinks: PlannedRelink[] = [];
  const relinkSkipped: string[] = [];
  for (const relink of VERIFIED_OBSERVATION_RELINKS) {
    const observation = observationById.get(relink.observationId);
    const fromEntityId = relinkEntityIdBySlug.get(relink.fromEntitySlug);
    const targetEntityId = relinkEntityIdBySlug.get(relink.toEntitySlug);
    if (!observation || !targetEntityId || String(observation.entityId) !== fromEntityId) {
      relinkSkipped.push(relink.observationId);
      continue;
    }
    plannedRelinks.push({
      ...relink,
      currentEntityId: observation.entityId ? String(observation.entityId) : undefined,
      targetEntityId,
    });
  }

  const summary = {
    mode: options.apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    db: guard.dbLabel,
    verifiedGrafts: VERIFIED_GRAFTS.length,
    entitiesMissing: missing,
    entitiesChanged: plannedUpdates.length,
    researchAreasCleaned: plannedUpdates.filter((u) => u.researchAreas).length,
    departmentsCleaned: plannedUpdates.filter((u) => u.departments).length,
    sourceUrlsCleaned: plannedUpdates.filter((u) => u.sourceUrls).length,
    recentGrantsCleaned: plannedUpdates.filter((u) => u.recentGrants).length,
    websiteUrlsCleared: plannedUpdates.filter((u) => u.websiteUrl).length,
    shortDescriptionsCleared: plannedUpdates.filter((u) => u.shortDescription).length,
    observationRelinksPlanned: plannedRelinks.length,
    observationRelinksSkipped: relinkSkipped,
    reindexed: 0,
  };

  if (options.apply && plannedRelinks.length > 0) {
    await Observation.bulkWrite(
      plannedRelinks.map((r) => ({
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(r.observationId) },
          update: { $set: { entityId: new mongoose.Types.ObjectId(r.targetEntityId) } },
        },
      })),
      { ordered: false },
    );
  }

  if (options.apply && plannedUpdates.length > 0) {
    const operations: AnyBulkWriteOperation[] = plannedUpdates.map((u) => {
      const set: Record<string, unknown> = {};
      if (u.researchAreas) set.researchAreas = u.researchAreas.to;
      if (u.departments) set.departments = u.departments.to;
      if (u.sourceUrls) set.sourceUrls = u.sourceUrls.to;
      if (u.recentGrants) {
        set.recentGrants = u.recentGrants.to;
        set.recentGrantCount = u.recentGrants.to.length;
        set.fundingAgencies = u.recentGrants.fundingAgenciesTo;
      }
      if (u.websiteUrl) set.websiteUrl = u.websiteUrl.to;
      if (u.shortDescription) set.shortDescription = u.shortDescription.to;
      return { updateOne: { filter: { slug: u.slug }, update: { $set: set } } };
    });
    await ResearchEntity.bulkWrite(operations, { ordered: false });

    const changedSlugs = plannedUpdates.map((u) => u.slug);
    const fresh = await ResearchEntity.find({ slug: { $in: changedSlugs } }).lean();
    await syncEntities('researchEntity', fresh);
    summary.reindexed = fresh.length;
  }

  const output = { summary, entries: plannedUpdates, observationRelinks: plannedRelinks };
  console.log(JSON.stringify(output, null, 2));
  if (options.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(options.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(output, null, 2)}\n`);
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to purge same-name-collision area grafts:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
