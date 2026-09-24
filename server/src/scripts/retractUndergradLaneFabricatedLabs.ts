import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { materializeEntity } from '../scrapers/entityMaterializer';
import {
  runStudentVisibilityGate,
  type StudentVisibilityGateReport,
} from '../services/studentVisibilityGateService';
import { getResearchGroupDetail } from '../services/researchGroupService';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  UNDERGRAD_RESEARCH_LANE,
  entityKeysWithOtherSourceLabEvidence,
  planUndergradLaneLabRetraction,
  summarizeUndergradLaneLabRefusals,
  type UndergradLaneLabPlan,
  type UndergradLaneObservation,
  type UndergradLaneRow,
} from './retractUndergradLaneFabricatedLabsCore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:retract-undergrad-lane-fabricated-labs';
export const CONFIRM_FLAG = '--confirm-retract-undergrad-lane-fabricated-labs';
const LAB_NAME_VALUE_RE = '\\s(?:Lab|Laboratory)$';

interface Options {
  dryRun: boolean;
  confirmed: boolean;
  output?: string;
}

export function parseRetractUndergradLaneLabArgs(argv: string[]): Options {
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
  resolved: boolean;
  nameAssertsALab: boolean;
  entityType: string;
  kind: string;
  hasWebsiteUrl: boolean;
  hasShortDescription: boolean;
  hasDepartment: boolean;
  tier: string;
}

async function readServedSurface(slugs: readonly string[]): Promise<ServedReading[]> {
  const tiers = new Map<string, string>();
  const tierDocs = (await ResearchEntity.find({ slug: { $in: [...slugs] } })
    .select('slug studentVisibilityTier')
    .lean()) as unknown as Array<Record<string, unknown>>;
  for (const doc of tierDocs) {
    tiers.set(String(doc.slug), String(doc.studentVisibilityTier ?? ''));
  }

  const readings: ServedReading[] = [];
  for (const slug of slugs) {
    let detail: Awaited<ReturnType<typeof getResearchGroupDetail>> | null = null;
    try {
      detail = await getResearchGroupDetail(slug);
    } catch {
      detail = null;
    }
    const entity = (detail?.researchEntity ?? {}) as Record<string, unknown>;
    readings.push({
      slug,
      resolved: Boolean(detail),
      nameAssertsALab: /\s+(?:Lab|Laboratory)$/i.test(String(entity.name ?? '').trim()),
      entityType: String(entity.entityType ?? ''),
      kind: String(entity.kind ?? ''),
      hasWebsiteUrl: Boolean(String(entity.websiteUrl ?? '').trim()),
      hasShortDescription: Boolean(String(entity.shortDescription ?? '').trim()),
      hasDepartment: Array.isArray(entity.departments) && entity.departments.length > 0,
      tier: tiers.get(slug) ?? '',
    });
  }
  return readings;
}

async function correctLaneObservations(plan: UndergradLaneLabPlan): Promise<{
  names: number;
  kinds: number;
  entityTypes: number;
}> {
  // Rewrite the value in place under the same source and sourceUrl, because the fixed
  // lane now emits exactly this value from exactly that page. Superseding instead would
  // leave the row with no lane name at all, and refusing a graft that way drops the only
  // edge some rows have (#2385).
  const nameResult = await Observation.updateMany(
    {
      entityType: 'researchEntity',
      entityKey: plan.slug,
      field: { $in: ['name', 'displayName'] },
      sourceName: UNDERGRAD_RESEARCH_LANE,
      superseded: { $ne: true },
      value: { $regex: LAB_NAME_VALUE_RE, $options: 'i' },
    },
    { $set: { value: plan.correctedName } },
  );
  const kindResult = await Observation.updateMany(
    {
      entityType: 'researchEntity',
      entityKey: plan.slug,
      field: 'kind',
      sourceName: UNDERGRAD_RESEARCH_LANE,
      superseded: { $ne: true },
      value: 'lab',
    },
    { $set: { value: plan.correctedKind } },
  );
  const entityTypeResult = await Observation.updateMany(
    {
      entityType: 'researchEntity',
      entityKey: plan.slug,
      field: 'entityType',
      sourceName: UNDERGRAD_RESEARCH_LANE,
      superseded: { $ne: true },
      value: 'LAB',
    },
    { $set: { value: plan.correctedEntityType } },
  );
  return {
    names: nameResult.modifiedCount || 0,
    kinds: kindResult.modifiedCount || 0,
    entityTypes: entityTypeResult.modifiedCount || 0,
  };
}

async function main(): Promise<void> {
  const options = parseRetractUndergradLaneLabArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: !options.dryRun,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (!options.dryRun && !options.confirmed) {
    throw new Error(`${SCRIPT_NAME} apply requires ${CONFIRM_FLAG}`);
  }
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${
      options.dryRun ? 'dry-run' : 'apply'
    }`,
  );

  await initializeConnections();

  const laneLabAssertions = (await Observation.find({
    entityType: 'researchEntity',
    sourceName: UNDERGRAD_RESEARCH_LANE,
    superseded: { $ne: true },
    $or: [
      {
        field: { $in: ['name', 'displayName'] },
        value: { $regex: LAB_NAME_VALUE_RE, $options: 'i' },
      },
      { field: 'kind', value: 'lab' },
      { field: 'entityType', value: 'LAB' },
    ],
  })
    .select('entityKey')
    .lean()) as unknown as Array<Record<string, unknown>>;
  const candidateKeys = [...new Set(laneLabAssertions.map((doc) => String(doc.entityKey)))];

  const entityDocs = (await ResearchEntity.find({
    archived: { $ne: true },
    slug: { $in: candidateKeys },
  })
    .select('_id slug name kind entityType websiteUrl website manuallyLockedFields')
    .lean()) as unknown as Array<Record<string, unknown>>;
  const rows: UndergradLaneRow[] = entityDocs.flatMap((doc) => {
    const id = serializedDocumentId(doc._id);
    return id ? [{ id, ...doc } as UndergradLaneRow] : [];
  });

  const observations = (await Observation.find({
    entityType: 'researchEntity',
    entityKey: { $in: rows.map((row) => String(row.slug)) },
    superseded: { $ne: true },
  })
    .select('entityKey field value sourceName sourceUrl')
    .lean()) as unknown as UndergradLaneObservation[];

  const outcome = planUndergradLaneLabRetraction(
    rows,
    observations,
    entityKeysWithOtherSourceLabEvidence(observations),
  );

  const plannedSlugs = outcome.plans.map((plan) => plan.slug);
  const before = await readServedSurface(plannedSlugs);

  let nameObservationsCorrected = 0;
  let kindObservationsCorrected = 0;
  let entityTypeObservationsCorrected = 0;
  let rowsRetyped = 0;
  let rematerialized = 0;
  let gateCounts: StudentVisibilityGateReport['counts'] | null = null;
  let after: ServedReading[] = [];

  if (!options.dryRun && outcome.plans.length > 0) {
    for (const plan of outcome.plans) {
      const corrected = await correctLaneObservations(plan);
      nameObservationsCorrected += corrected.names;
      kindObservationsCorrected += corrected.kinds;
      entityTypeObservationsCorrected += corrected.entityTypes;
    }

    // The stored `entityType` is the authority the materializer's kind derivation reads
    // when no live observation outranks it, so leaving a stored `LAB` behind would let
    // the row keep serving a lab pill after its own evidence stopped asserting one.
    const retypeResult = await ResearchEntity.updateMany(
      {
        _id: {
          $in: outcome.plans
            .map((plan) => plan.id)
            .filter((id) => mongoose.isValidObjectId(id))
            .map((id) => new mongoose.Types.ObjectId(id)),
        },
      },
      { $set: { entityType: 'FACULTY_RESEARCH_AREA', kind: 'individual' } },
    );
    rowsRetyped = retypeResult.modifiedCount || 0;

    for (const plan of outcome.plans) {
      await materializeEntity('researchEntity', { entityKey: plan.slug }, {});
      rematerialized += 1;
    }

    const gateReport = await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });
    gateCounts = gateReport.counts;

    after = await readServedSurface(plannedSlugs);
  }

  const report = {
    script: SCRIPT_NAME,
    mode: options.dryRun ? 'dry-run' : 'apply',
    laneLabAssertionKeys: candidateKeys.length,
    liveRowsScanned: rows.length,
    plannedForRetraction: outcome.plans.length,
    plannedRename: outcome.plans.filter((plan) => plan.laneNameAssertsALab).length,
    plannedRetype: outcome.plans.filter((plan) => plan.laneTypeAssertsALab).length,
    refusedByReason: summarizeUndergradLaneLabRefusals(outcome.refused),
    nameObservationsCorrected,
    kindObservationsCorrected,
    entityTypeObservationsCorrected,
    rowsRetyped,
    rematerialized,
    gateCounts,
    servedBefore: before,
    servedAfter: after,
    servedStillAssertingALab: after.filter(
      (reading) => reading.nameAssertsALab || reading.entityType === 'LAB',
    ).length,
  };
  console.log(JSON.stringify(report, null, 2));

  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, JSON.stringify(report, null, 2));
    console.log(`Saved ${SCRIPT_NAME} report to ${options.output}`);
  }
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
