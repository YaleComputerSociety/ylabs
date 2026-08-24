/**
 * Purge #604 unbacked grafts left by the PI-dedupe merge (#561).
 *
 * The #561 field-merge blind-unioned `researchAreas` and never best-selected a
 * description across every shell in a same-PI merge cluster; #757 fixed both at
 * write time, but does not retroactively repair canonicals a prior merge already
 * contaminated. Those grafted `researchAreas` and the hallucinated
 * `fullDescription`/`shortDescription` (#559) have no owning `fieldProvenance`
 * entry, so a field-scoped rematerialize cannot self-heal them (there is no
 * observation to resolve). This purge operates on an individually verified graft
 * set and removes only the exact grafted strings still present per field: area
 * chips are dropped while the entity's real discipline area(s) stay, and a
 * grafted description is cleared only when the stored text still exactly matches
 * the verified hallucination (a since-self-corrected record is a no-op). Each
 * field is touched only when it is confirmed unbacked (no matching
 * `fieldProvenance` entry). Re-gates student visibility for changed entities (a
 * cleared description can drop a thin shell out of student-ready) and re-syncs
 * Meilisearch after the Mongo write.
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
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { planAreaGraftRemoval, planDescriptionGraftRemoval } from './piDedupeAreaGraftPurgeCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Individually verified unbacked-graft entries. Each area in `removeAreas` was
 * confirmed as domain-incoherent against the entity's own
 * fullDescription/department, and is removed only when the field is confirmed
 * unbacked (no `fieldProvenance.researchAreas`). A `removeFullDescription` /
 * `removeShortDescription` clears that hallucinated description, but only when
 * the field is unbacked and the stored text still exactly matches the verified
 * string (a since-self-corrected record is a no-op):
 * - latham-lab-srl25 (bioethics): vehicle-emissions/environmental-policy chips
 *   from #604's own reopen comment.
 * - nih-pi-pei-yu-chen (cardiovascular medicine): full #559 optics-hallucination
 *   area set from #604's own reopen comment ("Internal Medicine" retained), plus
 *   the matching optics-hallucination full/short description (#604 Fault 2) that
 *   #1298 left in place - a soft/photonic-devices blurb on a cardiology
 *   scientist, cleared so the shell shows no description rather than a wrong one.
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
  removeAreas?: string[];
  removeFullDescription?: string;
  removeShortDescription?: string;
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
    removeFullDescription:
      'The Pei-Yu Chen Lab focuses on research in semiconductor lasers and optical devices, as well as photonic and optical devices. Additionally, the lab explores conducting polymers and their various applications.',
    removeShortDescription:
      'The Pei-Yu Chen Lab investigates semiconductor lasers, optical devices, and conducting polymers.',
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
  id: string;
  slug: string;
  name: unknown;
  set: Record<string, unknown>;
  researchAreas?: { from: string[]; to: string[]; removed: string[] };
  clearedFullDescription?: boolean;
  clearedShortDescription?: boolean;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
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
    .select({
      _id: 1,
      slug: 1,
      name: 1,
      researchAreas: 1,
      fullDescription: 1,
      shortDescription: 1,
      fieldProvenance: 1,
    })
    .lean();
  const entityBySlug = new Map(entities.map((e) => [String(e.slug), e]));

  const plannedUpdates: PlannedUpdate[] = [];
  const missing: string[] = [];
  const skippedBackedAreas: string[] = [];
  const skippedBackedDescriptions: string[] = [];
  for (const spec of VERIFIED_GRAFTS) {
    const entity = entityBySlug.get(spec.slug);
    if (!entity) {
      missing.push(spec.slug);
      continue;
    }
    // Guard each field independently against a legitimate observation that has
    // since backed it; only ever touch confirmed-unbacked grafts.
    const provenance = (entity as any).fieldProvenance || {};
    const set: Record<string, unknown> = {};
    const planned: PlannedUpdate = { id: String(entity._id), slug: spec.slug, name: entity.name, set };

    if (spec.removeAreas?.length) {
      if (provenance.researchAreas) {
        skippedBackedAreas.push(spec.slug);
      } else {
        const current = asStringArray(entity.researchAreas);
        const result = planAreaGraftRemoval({ current, removeAreas: spec.removeAreas });
        if (result.changed) {
          set.researchAreas = result.cleaned;
          planned.researchAreas = { from: current, to: result.cleaned, removed: result.removed };
        }
      }
    }

    if (spec.removeFullDescription || spec.removeShortDescription) {
      const descResult = planDescriptionGraftRemoval({
        currentFull: asOptionalString(entity.fullDescription),
        currentShort: asOptionalString(entity.shortDescription),
        removeFull: spec.removeFullDescription,
        removeShort: spec.removeShortDescription,
      });
      if (descResult.clearFull) {
        if (provenance.fullDescription) skippedBackedDescriptions.push(spec.slug);
        else {
          set.fullDescription = '';
          planned.clearedFullDescription = true;
        }
      }
      if (descResult.clearShort) {
        if (provenance.shortDescription) skippedBackedDescriptions.push(spec.slug);
        else {
          set.shortDescription = '';
          planned.clearedShortDescription = true;
        }
      }
    }

    if (Object.keys(set).length > 0) plannedUpdates.push(planned);
  }

  const summary = {
    mode: options.apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    db: guard.dbLabel,
    verifiedGrafts: VERIFIED_GRAFTS.length,
    entitiesMissing: missing,
    entitiesSkippedBackedAreas: skippedBackedAreas,
    entitiesSkippedBackedDescriptions: skippedBackedDescriptions,
    entitiesChanged: plannedUpdates.length,
    areasRemoved: plannedUpdates.reduce((sum, u) => sum + (u.researchAreas?.removed.length || 0), 0),
    descriptionsCleared: plannedUpdates.filter(
      (u) => u.clearedFullDescription || u.clearedShortDescription,
    ).length,
    visibilityTierChanges: 0,
    reindexed: 0,
  };

  if (options.apply && plannedUpdates.length > 0) {
    const operations: AnyBulkWriteOperation[] = plannedUpdates.map((u) => ({
      updateOne: {
        filter: { slug: u.slug },
        update: { $set: u.set },
      },
    }));
    await ResearchEntity.bulkWrite(operations, { ordered: false });

    const gate = await runStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: plannedUpdates.map((u) => u.id),
    });
    summary.visibilityTierChanges = gate.counts.changed;

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
