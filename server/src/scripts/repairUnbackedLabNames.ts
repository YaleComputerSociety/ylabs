import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import { LEAD_ROLE_CANONICAL_VALUES } from '../models/canonicalRoleMapping';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { getResearchGroupDetail } from '../services/researchGroupService';
import {
  runStudentVisibilityGate,
  type StudentVisibilityGateReport,
} from '../services/studentVisibilityGateService';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  LAB_NAME_SUFFIX_RE,
  planUnbackedLabNameCorrections,
  summarizeUnbackedLabNameRefusals,
  type UnbackedLabNameObservation,
  type UnbackedLabNameRow,
} from './repairUnbackedLabNamesCore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:repair-unbacked-lab-names';
export const CONFIRM_FLAG = '--confirm-repair-unbacked-lab-names';

interface Options {
  dryRun: boolean;
  confirmed: boolean;
  output?: string;
}

export function parseRepairUnbackedLabNameArgs(argv: string[]): Options {
  const options: Options = { dryRun: true, confirmed: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.dryRun = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === CONFIRM_FLAG) options.confirmed = true;
    else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return options;
}

interface ServedReading {
  slug: string;
  served: boolean;
  name: string;
  nameAssertsALab: boolean;
}

/**
 * What the detail route actually serves, which is the only verification that counts:
 * a counter scoped to the rows a repair acted on cannot see a refusal, which #3230
 * had to correct in this family, and a reimplemented predicate reports a different
 * number than the route.
 */
async function readServedSurface(slugs: readonly string[]): Promise<ServedReading[]> {
  const readings: ServedReading[] = [];
  for (const slug of slugs) {
    const detail = await getResearchGroupDetail(slug);
    const entity = detail?.researchEntity as { name?: unknown; displayName?: unknown } | undefined;
    const name =
      typeof entity?.name === 'string'
        ? entity.name
        : typeof entity?.displayName === 'string'
          ? entity.displayName
          : '';
    readings.push({
      slug,
      served: Boolean(detail),
      name,
      nameAssertsALab: LAB_NAME_SUFFIX_RE.test(name),
    });
  }
  return readings;
}

async function loadLeadNamesBySlug(
  rows: readonly UnbackedLabNameRow[],
): Promise<Map<string, string[]>> {
  const idBySlug = new Map<string, string>();
  for (const row of rows) idBySlug.set(row.id, row.slug);
  const entityIds = rows
    .map((row) => row.id)
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  const assignments = (await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': { $in: entityIds },
    role: { $in: [...LEAD_ROLE_CANONICAL_VALUES] },
    archived: { $ne: true },
    state: { $ne: 'HISTORICAL' },
  })
    .select('personId target')
    .lean()) as unknown as Array<Record<string, any>>;

  const personIds = [
    ...new Set(assignments.map((doc) => serializedDocumentId(doc.personId)).filter(Boolean)),
  ];
  const researchers = (await Researcher.find({
    _id: { $in: personIds.map((id) => new mongoose.Types.ObjectId(id as string)) },
    archived: { $ne: true },
  })
    .select('_id displayName')
    .lean()) as unknown as Array<Record<string, any>>;
  const nameByPerson = new Map<string, string>();
  for (const person of researchers) {
    const id = serializedDocumentId(person._id);
    const displayName = String(person.displayName || '').trim();
    if (id && displayName) nameByPerson.set(id, displayName);
  }

  const leadsBySlug = new Map<string, string[]>();
  for (const assignment of assignments) {
    const slug = idBySlug.get(serializedDocumentId(assignment.target?.id) || '');
    const personName = nameByPerson.get(serializedDocumentId(assignment.personId) || '');
    if (!slug || !personName) continue;
    const existing = leadsBySlug.get(slug) || [];
    if (!existing.includes(personName)) leadsBySlug.set(slug, [...existing, personName]);
  }
  return leadsBySlug;
}

export async function repairUnbackedLabNames(options: {
  dryRun: boolean;
}): Promise<Record<string, unknown>> {
  const entityDocs = (await ResearchEntity.find({
    archived: { $ne: true },
    name: LAB_NAME_SUFFIX_RE,
    entityType: { $in: ['FACULTY_RESEARCH_AREA', 'FACULTY_PROJECT'] },
  })
    .select(
      '_id slug name displayName entityType websiteUrl manuallyLockedFields fieldProvenance.name.sourceName',
    )
    .lean()) as unknown as Array<Record<string, unknown>>;
  const rows: UnbackedLabNameRow[] = entityDocs.flatMap((doc) => {
    const id = serializedDocumentId(doc._id);
    if (!id) return [];
    const provenance = (doc.fieldProvenance as { name?: { sourceName?: unknown } } | undefined)
      ?.name?.sourceName;
    return [{ id, ...doc, nameProvenanceSourceName: provenance } as UnbackedLabNameRow];
  });

  const observations = (await Observation.find({
    entityType: 'researchEntity',
    entityKey: { $in: rows.map((row) => String(row.slug)) },
    field: { $in: ['name', 'displayName'] },
  })
    .select('entityKey field value sourceUrl superseded')
    .lean()) as unknown as UnbackedLabNameObservation[];

  const outcome = planUnbackedLabNameCorrections(
    rows,
    observations,
    await loadLeadNamesBySlug(rows),
  );
  const plannedSlugs = outcome.plans.map((plan) => plan.slug);
  const before = await readServedSurface(plannedSlugs);

  let namesCorrected = 0;
  let displayNamesCorrected = 0;
  let rematerialized = 0;
  let gateCounts: StudentVisibilityGateReport['counts'] | null = null;
  let after: ServedReading[] = [];
  let survivedRematerialize = 0;

  if (!options.dryRun && outcome.plans.length > 0) {
    for (const plan of outcome.plans) {
      const set: Record<string, unknown> = { name: plan.correctedName };
      if (plan.correctsDisplayName) set.displayName = plan.correctedName;
      const result = await ResearchEntity.updateOne(
        { _id: new mongoose.Types.ObjectId(plan.id), archived: { $ne: true } },
        { $set: set },
      );
      if (result.modifiedCount) {
        namesCorrected += 1;
        if (plan.correctsDisplayName) displayNamesCorrected += 1;
      }
    }

    // Nothing is locked, so prove the corrected value survives the ordinary
    // materialize pass rather than assuming it. A row whose old name no live
    // observation asserts has nothing to reassert it; this is where that would show.
    for (const plan of outcome.plans) {
      await materializeEntity('researchEntity', { entityKey: plan.slug }, {});
      rematerialized += 1;
    }
    const afterRemat = (await ResearchEntity.find({
      slug: { $in: plannedSlugs },
    })
      .select('slug name')
      .lean()) as unknown as Array<Record<string, unknown>>;
    const correctedBySlug = new Map(outcome.plans.map((plan) => [plan.slug, plan.correctedName]));
    survivedRematerialize = afterRemat.filter(
      (doc) => String(doc.name ?? '') === correctedBySlug.get(String(doc.slug)),
    ).length;

    const gate = await runStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: outcome.plans.map((plan) => plan.id),
    });
    gateCounts = gate.counts;
    after = await readServedSurface(plannedSlugs);
  }

  // Counted over every scanned row rather than the planned ones, because a refusal is
  // a row still asserting an unbacked lab, not a row out of scope (#3230).
  const stillServingAnUnbackedLabName = (
    await ResearchEntity.find({
      archived: { $ne: true },
      name: LAB_NAME_SUFFIX_RE,
      entityType: { $in: ['FACULTY_RESEARCH_AREA', 'FACULTY_PROJECT'] },
      studentVisibilityTier: { $in: publicStudentVisibilityTiers },
    })
      .select('_id')
      .lean()
  ).length;

  return {
    script: SCRIPT_NAME,
    mode: options.dryRun ? 'dry-run' : 'apply',
    labNamedPersonScopedRowsScanned: rows.length,
    planned: outcome.plans.length,
    refusedByReason: summarizeUnbackedLabNameRefusals(outcome.refused),
    namesCorrected,
    displayNamesCorrected,
    rematerialized,
    survivedRematerialize,
    gateCounts,
    servedBefore: before,
    servedAfter: after,
    servedRowsStillAssertingALabName: stillServingAnUnbackedLabName,
  };
}

async function main(): Promise<void> {
  const options = parseRepairUnbackedLabNameArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: !options.dryRun,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (!options.dryRun && !options.confirmed) {
    throw new Error(`${SCRIPT_NAME} apply requires ${CONFIRM_FLAG}`);
  }

  await initializeConnections();
  const report = await repairUnbackedLabNames({ dryRun: options.dryRun });
  console.log(JSON.stringify(report, null, 2));
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, JSON.stringify(report, null, 2));
    console.log(`Saved ${SCRIPT_NAME} report to ${options.output}`);
  }
  await mongoose.disconnect();
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error instanceof Error ? error.message : error));
    process.exit(1);
  });
}
