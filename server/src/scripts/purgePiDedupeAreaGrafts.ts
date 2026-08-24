/**
 * Purge #604 unbacked researchArea grafts left by the PI-dedupe merge (#561).
 *
 * The #561 field-merge blind-unioned `researchAreas` across every shell in a
 * same-PI merge cluster; #757 trust-filtered this at write time, but does not
 * retroactively repair canonicals a prior merge already contaminated. Those
 * grafted values have no owning `fieldProvenance.researchAreas` entry, so a
 * field-scoped rematerialize cannot self-heal them (there is no observation to
 * resolve). This purge operates on an individually verified graft set (2 from
 * the #604 issue thread, 2 more found by widening the unbacked-researchAreas
 * scan) and removes only the exact strings still present, leaving each
 * entity's real discipline area(s) in place. Re-syncs Meilisearch after the
 * Mongo write so search stops ranking these entities on the grafted domain.
 *
 *   yarn --cwd server tsx src/scripts/purgePiDedupeAreaGrafts.ts            # dry-run
 *   yarn --cwd server tsx src/scripts/purgePiDedupeAreaGrafts.ts --apply \
 *     --confirm-pi-dedupe-area-graft-purge
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
import { planAreaGraftRemoval } from './piDedupeAreaGraftPurgeCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Individually verified unbacked-graft entries. Each `slug` has no
 * `fieldProvenance.researchAreas` entry (confirmed unbacked), and each area in
 * `removeAreas` was confirmed as domain-incoherent against the entity's own
 * fullDescription/department:
 * - latham-lab-srl25 (bioethics): vehicle-emissions/environmental-policy chips
 *   from #604's own reopen comment.
 * - nih-pi-pei-yu-chen (internal medicine): full #559 optics-hallucination
 *   area set from #604's own reopen comment; "Internal Medicine" retained.
 * - ysm-vasiliou (metabolomics/toxicology): generic-filler chips matching the
 *   "Educational Technology" / "Research Methods" fingerprint #604 already
 *   named as a contamination category.
 * - choma-lab-mac279 (biomedical optics/medical imaging/AI, per its own
 *   fullDescription): cell-biology/photosynthesis/materials-science chips
 *   from an unrelated shell; "Optical imaging of microfluidic-scale
 *   biological fluid flow" retained as domain-coherent.
 */
interface GraftSpec {
  slug: string;
  removeAreas: string[];
}

const VERIFIED_GRAFTS: GraftSpec[] = [
  {
    slug: 'latham-lab-srl25',
    removeAreas: ['Vehicle emissions and performance', 'Environmental Policies and Emissions'],
  },
  {
    slug: 'nih-pi-pei-yu-chen',
    removeAreas: [
      'Semiconductor Lasers and Optical Devices',
      'Photonic and Optical Devices',
      'Conducting polymers and applications',
      'Thermal Radiation and Cooling Technologies',
      'Semiconductor Quantum Structures and Devices',
    ],
  },
  {
    slug: 'ysm-vasiliou',
    removeAreas: ['Educational Technology', 'Research Methods'],
  },
  {
    slug: 'choma-lab-mac279',
    removeAreas: [
      'Microtubule and mitosis dynamics',
      'Advanced Electron Microscopy Techniques and Applications',
      'Photosynthetic Processes and Mechanisms',
      'Magnetism in coordination complexes',
      'Quantum optics and atomic interactions',
    ],
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
    else if (arg === '--confirm-pi-dedupe-area-graft-purge') options.confirm = true;
    else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.apply && !options.confirm) {
    throw new Error('--confirm-pi-dedupe-area-graft-purge is required when --apply is set.');
  }
  return options;
}

interface PlannedUpdate {
  slug: string;
  name: unknown;
  researchAreas: { from: string[]; to: string[]; removed: string[] };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'purgePiDedupeAreaGrafts',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const slugs = VERIFIED_GRAFTS.map((g) => g.slug);
  const entities = await ResearchEntity.find({ slug: { $in: slugs } })
    .select({ slug: 1, name: 1, researchAreas: 1, fieldProvenance: 1 })
    .lean();
  const entityBySlug = new Map(entities.map((e) => [String(e.slug), e]));

  const plannedUpdates: PlannedUpdate[] = [];
  const missing: string[] = [];
  const skippedBacked: string[] = [];
  for (const spec of VERIFIED_GRAFTS) {
    const entity = entityBySlug.get(spec.slug);
    if (!entity) {
      missing.push(spec.slug);
      continue;
    }
    if ((entity as any).fieldProvenance?.researchAreas) {
      // Guard against re-running after a legitimate observation has since
      // backed this field; only ever touch confirmed-unbacked grafts.
      skippedBacked.push(spec.slug);
      continue;
    }

    const current = asStringArray(entity.researchAreas);
    const result = planAreaGraftRemoval({ current, removeAreas: spec.removeAreas });
    if (result.changed) {
      plannedUpdates.push({
        slug: spec.slug,
        name: entity.name,
        researchAreas: { from: current, to: result.cleaned, removed: result.removed },
      });
    }
  }

  const summary = {
    mode: options.apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    db: guard.dbLabel,
    verifiedGrafts: VERIFIED_GRAFTS.length,
    entitiesMissing: missing,
    entitiesSkippedBacked: skippedBacked,
    entitiesChanged: plannedUpdates.length,
    areasRemoved: plannedUpdates.reduce((sum, u) => sum + u.researchAreas.removed.length, 0),
    reindexed: 0,
  };

  if (options.apply && plannedUpdates.length > 0) {
    const operations: AnyBulkWriteOperation[] = plannedUpdates.map((u) => ({
      updateOne: {
        filter: { slug: u.slug },
        update: { $set: { researchAreas: u.researchAreas.to } },
      },
    }));
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
      console.error('Failed to purge PI-dedupe area grafts:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
