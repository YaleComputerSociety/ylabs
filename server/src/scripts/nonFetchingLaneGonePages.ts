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
  LANE_PAGE_HEALTH_FIELD,
  LanePageReads,
  PAGE_BORROWING_SOURCE_NAMES,
  RETIRED_PAGE_CITING_SOURCE_NAMES,
  confirmGoneLanePage,
  emitLanePageHealthForCitedPages,
  type LanePageHealthVerdict,
  type LanePageProbe,
} from '../scrapers/lanePageHealth';
import { appendObservations, getSourceByName } from '../scrapers/observationStore';
import type { ObservationInput } from '../scrapers/types';
import { checkSourceLinkHealth, sourceLinkHealthKey } from '../services/sourceLinkHealth';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  RETIRED_LANE_GONE_PAGE_ROLLBACK_REASON,
  confirmedGoneVerdictObservations,
  planRetiredLaneGonePageRetirement,
  retiredLaneCitedPages,
  type RowObservation,
} from './nonFetchingLaneGonePagesCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const SCRIPT_NAME = 'observations:nonfetching-lane-gone-pages';
export const CONFIRM_FLAG = '--confirm-nonfetching-lane-gone-pages';

export interface NonFetchingLaneGonePagesOptions {
  apply: boolean;
  confirmed: boolean;
  only: string[];
  output?: string;
}

export function parseNonFetchingLaneGonePagesArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): NonFetchingLaneGonePagesOptions {
  const options: NonFetchingLaneGonePagesOptions = { apply: false, confirmed: false, only: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === CONFIRM_FLAG) options.confirmed = true;
    else if (arg === '--only') {
      options.only.push(
        ...String(argv[i + 1] ?? '')
          .split(',')
          .filter(Boolean),
      );
      i += 1;
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  if (options.apply && !options.confirmed) {
    throw new Error(`${SCRIPT_NAME} --apply requires ${CONFIRM_FLAG}`);
  }
  if (options.apply && env.ALLOW_NON_PROD_SCRAPER_WRITES !== 'true') {
    throw new Error(`${SCRIPT_NAME} --apply requires ALLOW_NON_PROD_SCRAPER_WRITES=true`);
  }
  return options;
}

type CitingRow = {
  _id: unknown;
  slug?: string;
  sourceLinkHealth?: unknown;
};

const rowSelection = (only: readonly string[]) =>
  only.length > 0 ? { slug: { $in: [...only] } } : { archived: { $ne: true } };

async function citingRows(only: readonly string[]): Promise<CitingRow[]> {
  const lanes = [...RETIRED_PAGE_CITING_SOURCE_NAMES, ...PAGE_BORROWING_SOURCE_NAMES];
  const rows = await ResearchEntity.find(rowSelection(only))
    .select('_id slug sourceLinkHealth')
    .lean<CitingRow[]>();
  const byIdentity = new Map<string, CitingRow>();
  for (const row of rows) {
    byIdentity.set(String(row._id), row);
    if (row.slug) byIdentity.set(row.slug, row);
  }
  const citers = await Observation.find({
    entityType: 'researchEntity',
    sourceName: { $in: lanes },
    superseded: false,
    sourceUrl: { $type: 'string', $ne: '' },
  })
    .select('entityKey entityId')
    .lean<Array<{ entityKey?: unknown; entityId?: unknown }>>();
  const cited = new Map<string, CitingRow>();
  for (const citer of citers) {
    const row =
      byIdentity.get(String(citer.entityId ?? '')) ?? byIdentity.get(String(citer.entityKey ?? ''));
    if (row) cited.set(String(row._id), row);
  }
  return [...cited.values()];
}

async function rowObservations(row: CitingRow): Promise<RowObservation[]> {
  return Observation.find({
    entityType: 'researchEntity',
    superseded: false,
    $or: [
      { entityId: new mongoose.Types.ObjectId(String(row._id)) },
      ...(row.slug ? [{ entityKey: row.slug }] : []),
    ],
  })
    .select('_id sourceName field value sourceUrl observedAt entityKey entityId')
    .lean<RowObservation[]>();
}

async function retireRetiredLaneObservations(
  rows: readonly CitingRow[],
  probe: LanePageProbe,
  apply: boolean,
) {
  const report = {
    rowsScanned: rows.length,
    retiredByLane: {} as Record<string, number>,
    fieldsLeftWithoutEvidence: {} as Record<string, number>,
    rowsRetiredFrom: [] as string[],
  };
  for (const row of rows) {
    const observations = await rowObservations(row);
    const rowIdentities = new Set([String(row._id), row.slug ?? ''].filter(Boolean));
    const confirmations: LanePageHealthVerdict[] = [];
    const recordedGone = planRetiredLaneGonePageRetirement({ observations, rowIdentities });
    const recordedGonePages = new Set(
      recordedGone.retire.map((observation) => sourceLinkHealthKey(observation.sourceUrl)),
    );
    for (const url of retiredLaneCitedPages(observations)) {
      if (recordedGonePages.has(sourceLinkHealthKey(url))) continue;
      const verdict = await confirmGoneLanePage(url, { storedHealth: row.sourceLinkHealth }, probe);
      if (verdict) confirmations.push(verdict);
    }
    const plan = planRetiredLaneGonePageRetirement({
      observations,
      rowIdentities,
      confirmedGone: confirmedGoneVerdictObservations(
        { entityId: String(row._id), ...(row.slug ? { entityKey: row.slug } : {}) },
        confirmations,
        new Date(),
      ),
    });
    if (plan.retire.length === 0) continue;
    report.rowsRetiredFrom.push(String(row._id));
    for (const observation of plan.retire) {
      const lane = String(observation.sourceName);
      report.retiredByLane[lane] = (report.retiredByLane[lane] ?? 0) + 1;
    }
    for (const field of plan.fieldsLeftWithoutEvidence) {
      report.fieldsLeftWithoutEvidence[field] = (report.fieldsLeftWithoutEvidence[field] ?? 0) + 1;
    }
    if (!apply) continue;
    await Observation.updateMany(
      {
        _id: { $in: plan.retire.map((observation) => observation._id) },
        superseded: false,
      },
      {
        $set: {
          superseded: true,
          rollback: { rolledBackAt: new Date(), reason: RETIRED_LANE_GONE_PAGE_ROLLBACK_REASON },
        },
      },
    );
  }
  return report;
}

async function recordBorrowingLaneVerdicts(
  rows: readonly CitingRow[],
  probe: LanePageProbe,
  apply: boolean,
  log: (message: string) => void,
) {
  const entityKeys = rows.map((row) => row.slug).filter((slug): slug is string => Boolean(slug));
  const verdictsByLane: Record<string, number> = {};
  const rowsWithVerdicts = new Set<string>();
  for (const lane of PAGE_BORROWING_SOURCE_NAMES) {
    const source = apply ? await getSourceByName(lane) : null;
    if (apply && !source) throw new Error(`${SCRIPT_NAME} apply requires the '${lane}' source`);
    const scrapeRunId = new mongoose.Types.ObjectId().toString();
    const emit = async (observations: ObservationInput | ObservationInput[]) => {
      const inputs = Array.isArray(observations) ? observations : [observations];
      for (const input of inputs) {
        if (input.field === LANE_PAGE_HEALTH_FIELD && input.entityKey) {
          rowsWithVerdicts.add(input.entityKey);
        }
      }
      if (!apply || !source) return;
      await appendObservations(inputs, {
        scrapeRunId,
        sourceId: source._id,
        sourceName: lane,
        sourceWeight: source.defaultWeight,
        dryRun: false,
      });
    };
    const result = await emitLanePageHealthForCitedPages(
      { sourceName: lane, scrapeRunId, emit, log },
      new LanePageReads(),
      probe,
      { entityKeys },
    );
    verdictsByLane[lane] = result.gone;
  }
  return { verdictsByLane, rowsWithVerdicts };
}

async function main(): Promise<void> {
  const options = parseNonFetchingLaneGonePagesArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();
  const probe: LanePageProbe = (() => {
    const answers = new Map<string, ReturnType<LanePageProbe>>();
    return (url) => {
      const key = sourceLinkHealthKey(url) ?? url;
      const answer = answers.get(key) ?? checkSourceLinkHealth(url);
      answers.set(key, answer);
      return answer;
    };
  })();
  const rows = await citingRows(options.only);
  const retirement = await retireRetiredLaneObservations(rows, probe, options.apply);
  const borrowing = await recordBorrowingLaneVerdicts(rows, probe, options.apply, (message) =>
    console.log(sanitizeLogValue(message)),
  );
  const toMaterialize = new Map<string, { entityId?: string; entityKey?: string }>();
  for (const id of retirement.rowsRetiredFrom) toMaterialize.set(id, { entityId: id });
  for (const row of rows) {
    if (row.slug && borrowing.rowsWithVerdicts.has(row.slug)) {
      toMaterialize.set(String(row._id), { entityId: String(row._id) });
    }
  }
  let rematerialized = 0;
  if (options.apply) {
    for (const identifier of toMaterialize.values()) {
      await materializeEntity('researchEntity', identifier);
      rematerialized += 1;
    }
  }
  const report = {
    script: SCRIPT_NAME,
    mode: options.apply ? 'apply' : 'dry-run',
    rowsScanned: retirement.rowsScanned,
    retiredByLane: retirement.retiredByLane,
    fieldsLeftWithoutEvidence: retirement.fieldsLeftWithoutEvidence,
    goneVerdictsRecordedByLane: borrowing.verdictsByLane,
    rowsToRematerialize: toMaterialize.size,
    rematerialized,
  };
  console.log(JSON.stringify(report, null, 2));
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, JSON.stringify(report, null, 2));
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
