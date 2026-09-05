/**
 * observations:retire-dead-program-lanes - retire enrichment-only observation lanes
 * whose recorded entityId points at a deleted research entity with no merge
 * redirect, where the subject survives as a live fellowship (#2406).
 *
 *   yarn --cwd server observations:retire-dead-program-lanes
 *   yarn --cwd server observations:retire-dead-program-lanes --apply \
 *     --confirm-retire-dead-program-lanes --output "$TMPDIR/retire-dead-program-lanes.json"
 *
 * Dry-run by default. Uses `retireObservations`, never a delete, so provenance is
 * preserved and the retirement is recorded on each observation.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Fellowship } from '../models/fellowship';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchEntityRedirect } from '../models/researchEntityRedirect';
import {
  healedEntityTypeForRetiredProgramObservations,
  materializationReadScopeFilter,
} from '../scrapers/entityMaterializer';
import { retireObservations } from '../scrapers/observationStore';
import {
  OBSERVATION_REFERENCE_SPECS,
  buildObservationReferencePipeline,
} from '../scrapers/observationRetention';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  FellowshipSubject,
  RETIRE_DEAD_PROGRAM_LANES_KEY_PREFIX,
  RETIRE_DEAD_PROGRAM_LANES_ROLLBACK_REASON,
  RETIRE_DEAD_PROGRAM_LANES_SCRIPT_NAME,
  RetireLaneVerdict,
  matchFellowshipSubject,
  parseRetireDeadProgramLanesArgs,
  retireLaneVerdict,
} from './retireDeadProgramObservationLanesCore';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface DeadProgramLaneRow {
  entityKey: string;
  verdict: RetireLaneVerdict;
  liveObservationCount: number;
  observedFields: string[];
  sourceNames: string[];
  recordedEntityIds: string[];
  fellowshipTitle: string | null;
  fellowshipArchived: boolean | null;
  fellowshipMatchedBy: string | null;
  observationIds: string[];
}

async function loadReferencedObservationIds(): Promise<Set<string>> {
  const referenced = new Set<string>();
  for (const spec of OBSERVATION_REFERENCE_SPECS) {
    const rows = await Observation.db
      .collection(spec.collection)
      .aggregate(buildObservationReferencePipeline(spec), { allowDiskUse: true })
      .toArray();
    for (const row of rows) {
      if (row?._id) referenced.add(String(row._id));
    }
  }
  return referenced;
}

export async function loadDeadProgramLanes(): Promise<DeadProgramLaneRow[]> {
  const entityKeys: string[] = await Observation.distinct('entityKey', {
    entityKey: { $regex: `^${RETIRE_DEAD_PROGRAM_LANES_KEY_PREFIX}` },
    ...materializationReadScopeFilter(),
  });

  const fellowships: FellowshipSubject[] = (
    (await Fellowship.find({}, { title: 1, sourceUrl: 1, archived: 1 }).lean()) as any[]
  ).map((doc) => ({
    title: String(doc.title ?? ''),
    sourceUrl: String(doc.sourceUrl ?? ''),
    archived: doc.archived === true,
  }));

  const referencedObservationIds = await loadReferencedObservationIds();
  const rows: DeadProgramLaneRow[] = [];

  for (const entityKey of entityKeys.sort()) {
    const live = (await Observation.find({
      entityKey,
      ...materializationReadScopeFilter(),
    }).lean()) as any[];
    if (live.length === 0) continue;

    const recordedEntityIds = Array.from(
      new Set(live.map((obs) => (obs.entityId ? String(obs.entityId) : '')).filter(Boolean)),
    );
    const validEntityIds = recordedEntityIds.filter((id) => mongoose.isValidObjectId(id));

    const entityBySlug = await ResearchEntity.findOne({ slug: entityKey }, { _id: 1 }).lean();
    const entityById =
      validEntityIds.length > 0
        ? await ResearchEntity.findOne({ _id: { $in: validEntityIds } }, { _id: 1 }).lean()
        : null;
    const redirect = await ResearchEntityRedirect.findOne(
      { mergedSlug: entityKey },
      { _id: 1 },
    ).lean();

    const observationSourceUrls = Array.from(
      new Set(
        live.flatMap((obs) => [obs.sourceUrl, obs.url].filter(Boolean).map((url) => String(url))),
      ),
    );
    const fellowshipMatch = matchFellowshipSubject({
      entityKey,
      observationSourceUrls,
      fellowships,
    });

    const observedFields = Array.from(new Set(live.map((obs) => String(obs.field)))).sort();
    const observationIds = live.map((obs) => String(obs._id));

    const verdict = retireLaneVerdict({
      entityKey,
      observedFields,
      hasRecordedEntityId: recordedEntityIds.length > 0,
      entityExists: Boolean(entityBySlug || entityById),
      redirectCoversKey: Boolean(redirect),
      wouldMaterialize: Boolean(healedEntityTypeForRetiredProgramObservations(live as any)),
      referencedByDurableRecord: observationIds.some((id) => referencedObservationIds.has(id)),
      fellowshipMatch,
    });

    rows.push({
      entityKey,
      verdict,
      liveObservationCount: live.length,
      observedFields,
      sourceNames: Array.from(new Set(live.map((obs) => String(obs.sourceName)))).sort(),
      recordedEntityIds,
      fellowshipTitle: fellowshipMatch?.title ?? null,
      fellowshipArchived: fellowshipMatch ? fellowshipMatch.archived : null,
      fellowshipMatchedBy: fellowshipMatch?.matchedBy ?? null,
      observationIds,
    });
  }

  return rows;
}

export async function applyRetirement(rows: DeadProgramLaneRow[]): Promise<{ retired: number }> {
  let retired = 0;
  for (const row of rows) {
    const ids = row.observationIds
      .filter((id) => mongoose.isValidObjectId(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    if (ids.length === 0) continue;
    const result = await retireObservations(
      { _id: { $in: ids } },
      RETIRE_DEAD_PROGRAM_LANES_ROLLBACK_REASON,
    );
    retired += result.retired;
  }
  return { retired };
}

async function main() {
  const args = parseRetireDeadProgramLanesArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: RETIRE_DEAD_PROGRAM_LANES_SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const rows = await loadDeadProgramLanes();
  const retirable = rows.filter((row) => row.verdict === 'retire');
  const plannedObservations = retirable.reduce((sum, row) => sum + row.liveObservationCount, 0);

  if (args.apply) {
    if (!args.confirm) {
      throw new Error('--confirm-retire-dead-program-lanes is required when --apply is set.');
    }
    if (plannedObservations > args.maxApply) {
      throw new Error(
        `Apply would retire ${plannedObservations} observations, above --max-apply=${args.maxApply}.`,
      );
    }
  }

  const applied = args.apply ? await applyRetirement(retirable) : { retired: 0 };

  const byVerdict: Record<string, number> = {};
  for (const row of rows) byVerdict[row.verdict] = (byVerdict[row.verdict] || 0) + 1;

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    programKeysExamined: rows.length,
    retirableKeys: retirable.length,
    plannedObservations,
    retiredObservations: applied.retired,
    byVerdict,
    deferredArchivedFellowshipSubjects: rows
      .filter((row) => row.verdict === 'skip-fellowship-subject-archived')
      .map((row) => ({ entityKey: row.entityKey, fellowshipTitle: row.fellowshipTitle })),
    rows,
  };

  if (args.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(args.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(JSON.stringify({ ...report, rows: rows.slice(0, 10) }, null, 2));
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
