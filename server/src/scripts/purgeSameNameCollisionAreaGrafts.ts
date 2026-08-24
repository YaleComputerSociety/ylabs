/**
 * Purge #585 same-name-collision grafts from existing research entities (#1256).
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
 * The grafted values are unbacked direct-writes (no owning observation to
 * self-scope from) and a broad regex over-purges genuine interdisciplinary
 * scholars, so this operates on an individually verified graft set from #1256 /
 * #585 and removes only the exact strings still present. Field-scoped by design
 * (researchAreas / websiteUrl / poisoned shortDescription only) to avoid the
 * unbacked-field and full-re-materialize blast-radius hazards noted in
 * #1191 / #1177. After the Mongo write it re-syncs Meilisearch so the search
 * index stops ranking these entities on the grafted domain.
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
import { syncEntities } from '../services/meiliSyncService';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { planAreaGraftRemoval, planWebsiteClear } from './sameNameCollisionAreaGraftPurgeCore';

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
];

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
    .select({ slug: 1, name: 1, researchAreas: 1, websiteUrl: 1, shortDescription: 1, fullDescription: 1 })
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

    if (update.researchAreas || update.websiteUrl || update.shortDescription) {
      plannedUpdates.push(update);
    }
  }

  const summary = {
    mode: options.apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    db: guard.dbLabel,
    verifiedGrafts: VERIFIED_GRAFTS.length,
    entitiesMissing: missing,
    entitiesChanged: plannedUpdates.length,
    researchAreasCleaned: plannedUpdates.filter((u) => u.researchAreas).length,
    websiteUrlsCleared: plannedUpdates.filter((u) => u.websiteUrl).length,
    shortDescriptionsCleared: plannedUpdates.filter((u) => u.shortDescription).length,
    reindexed: 0,
  };

  if (options.apply && plannedUpdates.length > 0) {
    const operations: AnyBulkWriteOperation[] = plannedUpdates.map((u) => {
      const set: Record<string, unknown> = {};
      if (u.researchAreas) set.researchAreas = u.researchAreas.to;
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

  const output = { summary, entries: plannedUpdates };
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
