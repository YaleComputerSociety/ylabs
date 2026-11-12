import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ScrapeRun } from '../models/scrapeRun';
import { serializedDocumentId } from '../utils/idSerialization';
import type { UserKeyResearcherJoins } from './entityMaterializer';
import { retireObservations } from './observationStore';
import { runWithBoundedConcurrency } from './utils/boundedConcurrency';
import {
  PLANNED_VALUE_FIELDS,
  REKEYED_PERSON_KEY_RETIREMENT_REASON,
  departmentKey,
  personKeyRecordsFromObservations,
  personNameKey,
  personPageIdentityKey,
  planRekeyedPersonKeyRetirements,
  rekeyPlanCounts,
  type DirectoryIdentityIndex,
  type GoverningListingRead,
  type LanePersonObservation,
  type PersonKeyRecord,
  type RekeyPair,
  type RekeyPlan,
  type RekeyPlanCounts,
} from './rekeyedPersonKeyPlan';
import { sanitizeLogValue } from '../utils/logSanitizer';
import type { ObservationInput, ScraperContext } from './types';
import { mongooseConnectionWasOpened } from '../utils/mongooseConnectionWasOpened';

const DIRECTORY_RECORD_SOURCES = ['yale-directory', 'yale-directory-csv'];
const DIRECTORY_RECORD_FIELDS = ['fname', 'lname', 'primaryDepartment', 'secondaryDepartments'];
const GOVERNING_RUN_STATUS = 'success';

// Loaded on first use so a lane module does not pull the whole engine into every graph
// that imports it.
const engine = () => import('./entityMaterializer');

async function liveScope(): Promise<Record<string, unknown>> {
  const { materializationReadScopeFilter } = await engine();
  return { ...materializationReadScopeFilter(), 'rollback.rolledBackAt': { $exists: false } };
}

function databaseReady(): boolean {
  return mongooseConnectionWasOpened();
}

export async function loadLanePersonObservations(lane: string): Promise<LanePersonObservation[]> {
  if (!databaseReady()) return [];
  const filter: Record<string, unknown> = {
    sourceName: lane,
    entityType: 'user',
    entityKey: { $exists: true, $ne: '' },
    ...(await liveScope()),
  };
  const [rows, valued] = await Promise.all([
    Observation.find(filter, {
      entityKey: 1,
      field: 1,
      sourceUrl: 1,
      scrapeRunId: 1,
      observedAt: 1,
    }).lean<Array<Record<string, unknown>>>(),
    Observation.find({ ...filter, field: { $in: [...PLANNED_VALUE_FIELDS] } }, { value: 1 }).lean<
      Array<Record<string, unknown>>
    >(),
  ]);
  const valueById = new Map(valued.map((row) => [serializedDocumentId(row._id) ?? '', row.value]));
  return rows.map((row) => {
    const id = serializedDocumentId(row._id) ?? '';
    return {
      id,
      entityKey: String(row.entityKey ?? ''),
      field: String(row.field ?? ''),
      ...(valueById.has(id) ? { value: valueById.get(id) } : {}),
      sourceUrl: typeof row.sourceUrl === 'string' ? row.sourceUrl : undefined,
      scrapeRunId: serializedDocumentId(row.scrapeRunId),
      observedAt: row.observedAt,
    };
  });
}

function directoryNetidOf(entityKey: unknown): string {
  const netid = String(entityKey ?? '')
    .trim()
    .toLowerCase()
    .replace(/^netid:/, '');
  return /^[a-z0-9]+$/.test(netid) ? netid : '';
}

export function directoryIdentityIndexFrom(
  rows: ReadonlyArray<{ entityKey?: unknown; field?: unknown; value?: unknown }>,
): DirectoryIdentityIndex {
  const parts = new Map<
    string,
    { first: Set<string>; last: Set<string>; departments: Set<string> }
  >();
  for (const row of rows) {
    const netid = directoryNetidOf(row.entityKey);
    if (!netid) continue;
    const entry = parts.get(netid) ?? { first: new Set(), last: new Set(), departments: new Set() };
    const values = Array.isArray(row.value) ? row.value : [row.value];
    for (const value of values) {
      if (typeof value !== 'string' || !value.trim()) continue;
      if (row.field === 'fname') entry.first.add(value);
      else if (row.field === 'lname') entry.last.add(value);
      else {
        const key = departmentKey(value);
        if (key) entry.departments.add(key);
      }
    }
    parts.set(netid, entry);
  }
  const records = new Map<string, { nameKeys: Set<string>; departmentKeys: Set<string> }>();
  const netidsByName = new Map<string, Set<string>>();
  for (const [netid, entry] of parts) {
    const nameKeys = new Set<string>();
    for (const first of entry.first) {
      for (const last of entry.last) {
        const nameKey = personNameKey(first, last);
        if (nameKey) nameKeys.add(nameKey);
      }
    }
    records.set(netid, { nameKeys, departmentKeys: entry.departments });
    for (const nameKey of nameKeys) {
      netidsByName.set(nameKey, (netidsByName.get(nameKey) ?? new Set()).add(netid));
    }
  }
  return {
    recordOf: (netid) => records.get(netid.trim().toLowerCase()),
    netidsNamed: (nameKey) => netidsByName.get(nameKey) ?? new Set(),
  };
}

export async function loadDirectoryIdentityIndex(): Promise<DirectoryIdentityIndex> {
  if (!databaseReady()) return directoryIdentityIndexFrom([]);
  const rows = await Observation.find(
    {
      sourceName: { $in: DIRECTORY_RECORD_SOURCES },
      entityType: 'user',
      field: { $in: DIRECTORY_RECORD_FIELDS },
      superseded: { $ne: true },
      'rollback.rolledBackAt': { $exists: false },
    },
    { entityKey: 1, field: 1, value: 1 },
  ).lean<Array<Record<string, unknown>>>();
  return directoryIdentityIndexFrom(rows);
}

export interface StoredRunRecord {
  id: string;
  status?: string;
  startedAt?: unknown;
  options?: { limit?: unknown; offset?: unknown };
}

function runReadsWholeListings(run: StoredRunRecord): boolean {
  const limit = run.options?.limit;
  const offset = run.options?.offset;
  return (
    run.status === GOVERNING_RUN_STATUS &&
    (limit === undefined || limit === null) &&
    (offset === undefined || offset === null || offset === 0)
  );
}

function timeOf(value: unknown): number {
  const time = value instanceof Date ? value.getTime() : new Date(value as string).getTime();
  return Number.isFinite(time) ? time : 0;
}

// An older complete run cannot speak for a page a newer partial run has rewritten.
export function governingReadsFromStoredRuns(
  records: Iterable<PersonKeyRecord>,
  runs: ReadonlyMap<string, StoredRunRecord>,
): GoverningListingRead[] {
  const runIdsByPage = new Map<string, Set<string>>();
  for (const record of records) {
    for (const [page, presence] of record.listingPages) {
      const ids = runIdsByPage.get(page) ?? new Set<string>();
      for (const runId of presence.runIds) ids.add(runId);
      runIdsByPage.set(page, ids);
    }
  }
  const reads: GoverningListingRead[] = [];
  for (const [pageKey, runIds] of runIdsByPage) {
    const newest = [...runIds]
      .map((runId) => runs.get(runId))
      .filter((run): run is StoredRunRecord => Boolean(run))
      .sort((left, right) => timeOf(right.startedAt) - timeOf(left.startedAt))[0];
    if (!newest || !runReadsWholeListings(newest)) continue;
    reads.push({ pageKey, runId: newest.id, readAt: timeOf(newest.startedAt) });
  }
  return reads.sort((left, right) => left.pageKey.localeCompare(right.pageKey));
}

export async function loadStoredRuns(
  runIds: Iterable<string>,
): Promise<Map<string, StoredRunRecord>> {
  const ids = [...new Set(runIds)].filter((id) => mongoose.Types.ObjectId.isValid(id));
  const runs = new Map<string, StoredRunRecord>();
  if (ids.length === 0 || !databaseReady()) return runs;
  const docs = await ScrapeRun.find(
    { _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } },
    { status: 1, startedAt: 1, 'options.limit': 1, 'options.offset': 1 },
  ).lean<Array<Record<string, any>>>();
  for (const doc of docs) {
    const id = serializedDocumentId(doc._id) ?? '';
    runs.set(id, { id, status: doc.status, startedAt: doc.startedAt, options: doc.options });
  }
  return runs;
}

export type TwinJoinHoldReason =
  | 'old-key-reaches-several-researchers'
  | 'twin-reaches-another-researcher'
  | 'twin-not-named-by-researcher';

export type TwinJoinVerdict =
  | { retire: true; basis: 'same-researcher' | 'old-key-reaches-no-researcher' }
  | { retire: false; reason: TwinJoinHoldReason };

export type UserKeyJoinReader = (entityKey: string) => Promise<UserKeyResearcherJoins>;

export async function twinJoinVerdict(
  pair: Pick<RekeyPair, 'oldKey' | 'newKey'>,
  readJoins: UserKeyJoinReader = async (entityKey) =>
    (await engine()).userKeyResearcherJoins(entityKey),
): Promise<TwinJoinVerdict> {
  const old = await readJoins(pair.oldKey);
  const reached = new Set([
    ...old.namingResearcherIds,
    ...(old.joinedResearcherId ? [old.joinedResearcherId] : []),
  ]);
  if (reached.size === 0) return { retire: true, basis: 'old-key-reaches-no-researcher' };
  if (reached.size > 1) return { retire: false, reason: 'old-key-reaches-several-researchers' };
  const [researcherId] = reached;
  const twin = await readJoins(pair.newKey);
  if (twin.joinedResearcherId !== researcherId) {
    return { retire: false, reason: 'twin-reaches-another-researcher' };
  }
  if (!twin.namingResearcherIds.includes(researcherId)) {
    return { retire: false, reason: 'twin-not-named-by-researcher' };
  }
  return { retire: true, basis: 'same-researcher' };
}

export interface JoinCheckedPlan {
  plan: RekeyPlan;
  retire: Array<RekeyPair & { basis: string }>;
  held: Array<RekeyPair & { reason: TwinJoinHoldReason }>;
}

export const TWIN_JOIN_CONCURRENCY = 8;

export async function checkTwinJoins(
  plan: RekeyPlan,
  readJoins?: UserKeyJoinReader,
  onProgress?: (done: number, total: number) => void,
): Promise<JoinCheckedPlan> {
  const verdicts = new Map<RekeyPair, TwinJoinVerdict>();
  await runWithBoundedConcurrency(plan.admitted, TWIN_JOIN_CONCURRENCY, async (pair) => {
    verdicts.set(pair, await twinJoinVerdict(pair, readJoins));
    onProgress?.(verdicts.size, plan.admitted.length);
  });
  const retire: JoinCheckedPlan['retire'] = [];
  const held: JoinCheckedPlan['held'] = [];
  for (const pair of plan.admitted) {
    const verdict = verdicts.get(pair)!;
    if (verdict.retire) retire.push({ ...pair, basis: verdict.basis });
    else held.push({ ...pair, reason: verdict.reason });
  }
  return { plan, retire, held };
}

export async function retireRekeyedPersonKeyPairs(
  lane: string,
  pairs: ReadonlyArray<Pick<RekeyPair, 'oldKey' | 'observationIds'>>,
): Promise<number> {
  const ids = pairs
    .flatMap((pair) => pair.observationIds)
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (ids.length === 0) return 0;
  const { retired } = await retireObservations(
    {
      _id: { $in: ids },
      sourceName: lane,
      entityType: 'user',
      entityKey: { $in: [...new Set(pairs.map((pair) => pair.oldKey))] },
    },
    REKEYED_PERSON_KEY_RETIREMENT_REASON,
  );
  return retired;
}

export interface RekeyedPersonKeyRunSummary extends RekeyPlanCounts {
  held: Record<string, number>;
  retiredKeys: number;
  retiredObservations: number;
  dryRun: boolean;
}

export function joinCheckedSummary(
  checked: JoinCheckedPlan,
  retiredObservations: number,
  dryRun: boolean,
): RekeyedPersonKeyRunSummary {
  const counts = rekeyPlanCounts(checked.plan);
  const held: Record<string, number> = {};
  for (const pair of checked.held) held[pair.reason] = (held[pair.reason] ?? 0) + 1;
  return {
    ...counts,
    held,
    retiredKeys: dryRun ? 0 : checked.retire.length,
    retiredObservations,
    dryRun,
  };
}

const total = (counts: Record<string, number>) =>
  Object.values(counts).reduce((sum, count) => sum + count, 0);

export function rekeyedPersonKeyNote(summary: RekeyedPersonKeyRunSummary): string {
  const refusals = Object.entries(summary.refusalReasons)
    .map(([reason, count]) => `${reason}=${count}`)
    .join(', ');
  return (
    `re-keyed person keys: ${total(summary.admitted)} admitted, ` +
    `${summary.retiredKeys} retired (${summary.retiredObservations} observations), ` +
    `${total(summary.held)} held by the twin join, ` +
    `${total(summary.refused)} refused${refusals ? ` (${refusals})` : ''}, ` +
    `${total(summary.leftAlone)} left alone`
  );
}

// Settled at the end of the run: a `netid:` key is shared across listings, so only the
// whole run can say an old key was written nowhere.
export class RekeyedPersonReads {
  private readonly pages = new Map<
    string,
    { complete: boolean; census: Map<string, Set<string>> }
  >();
  private readonly laneCensus = new Map<string, Set<string>>();
  private readonly emitted: LanePersonObservation[] = [];

  constructor(
    readonly lane: string,
    private readonly startedAt: number = Date.now(),
  ) {}

  recordListingRead(
    pageUrl: string,
    read: { complete: boolean; names?: ReadonlyArray<{ nameKey: string; identity: string }> },
  ): void {
    const pageKey = personPageIdentityKey(pageUrl);
    if (!pageKey) return;
    const page = this.pages.get(pageKey) ?? { complete: true, census: new Map() };
    page.complete = page.complete && read.complete;
    for (const { nameKey, identity } of read.names ?? []) {
      if (!nameKey) continue;
      page.census.set(nameKey, (page.census.get(nameKey) ?? new Set()).add(identity));
    }
    this.pages.set(pageKey, page);
  }

  recordLaneNames(names: ReadonlyArray<{ nameKey: string; identity: string }>): void {
    for (const { nameKey, identity } of names) {
      if (!nameKey) continue;
      this.laneCensus.set(nameKey, (this.laneCensus.get(nameKey) ?? new Set()).add(identity));
    }
  }

  recordPerson(observations: readonly ObservationInput[]): void {
    for (const observation of observations) {
      if (observation.entityType !== 'user' || !observation.entityKey) continue;
      this.emitted.push({
        id: '',
        entityKey: observation.entityKey,
        field: observation.field,
        value: observation.value,
        sourceUrl: observation.sourceUrl,
      });
    }
  }

  governingReads(scrapeRunId: string): GoverningListingRead[] {
    return [...this.pages.entries()]
      .filter(([, page]) => page.complete)
      .map(([pageKey, page]) => ({
        pageKey,
        runId: scrapeRunId,
        readAt: this.startedAt,
        nameCensus: new Map([...page.census].map(([name, people]) => [name, people.size])),
      }));
  }

  async finish(
    ctx: { scrapeRunId: string; dryRun: boolean },
    deps: {
      loadObservations?: (lane: string) => Promise<LanePersonObservation[]>;
      loadDirectory?: () => Promise<DirectoryIdentityIndex>;
      readJoins?: UserKeyJoinReader;
    } = {},
  ): Promise<RekeyedPersonKeyRunSummary | undefined> {
    if (!databaseReady() || this.pages.size === 0) return undefined;
    const stored = await (deps.loadObservations ?? loadLanePersonObservations)(this.lane);
    const now = Date.now();
    const inRun = this.emitted.map((row) => ({
      ...row,
      scrapeRunId: ctx.scrapeRunId,
      observedAt: now,
    }));
    const records = personKeyRecordsFromObservations([...stored, ...inRun]);
    for (const record of records.values()) {
      record.observationIds = record.observationIds.filter(Boolean);
    }
    const plan = planRekeyedPersonKeyRetirements({
      records: records.values(),
      reads: this.governingReads(ctx.scrapeRunId),
      directory: await (deps.loadDirectory ?? loadDirectoryIdentityIndex)(),
      laneNameCensus: new Map([...this.laneCensus].map(([name, people]) => [name, people.size])),
    });
    const checked = await checkTwinJoins(plan, deps.readJoins);
    const retiredObservations = ctx.dryRun
      ? 0
      : await retireRekeyedPersonKeyPairs(this.lane, checked.retire);
    return joinCheckedSummary(checked, retiredObservations, ctx.dryRun);
  }
}

export interface RekeyedPersonReadsOutcome {
  note?: string;
  partialFailure?: string;
}

export async function settleRekeyedPersonReads(
  reads: RekeyedPersonReads,
  ctx: Pick<ScraperContext, 'scrapeRunId' | 'options' | 'log' | 'reportMetrics'>,
): Promise<RekeyedPersonReadsOutcome> {
  try {
    const summary = await reads.finish({
      scrapeRunId: ctx.scrapeRunId,
      dryRun: ctx.options.dryRun,
    });
    if (!summary) return {};
    ctx.reportMetrics?.({ rekeyedPersonKeys: summary });
    const note = rekeyedPersonKeyNote(summary);
    ctx.log(note);
    return { note };
  } catch (error) {
    const partialFailure = `re-keyed person keys not evaluated: ${sanitizeLogValue(error)}`;
    ctx.log(partialFailure);
    return { partialFailure };
  }
}
