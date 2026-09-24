import mongoose from 'mongoose';
import { Researcher } from '../models/researcher';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { RoleAssignment } from '../models/roleAssignment';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  hasRecordedClosureEvidence,
  yaleStatusCacheIsWritable,
} from '../utils/researchEntityYaleStatus';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { getOrgUnitCanonicalizer } from './orgUnitCanonicalization';
import { fetchPageWithPolicy } from './utils/httpFetch';
import {
  isYaleProfileUrl,
  probeYaleProfileDepartureEvidence,
  type YaleProfileDepartureEvidence,
  type YaleProfilePage,
} from './yaleProfileDepartureEvidence';

export const DEPARTMENT_ROSTER_HEALTH_FIELD = 'departmentRosterHealth';
export const FACULTY_DEPARTURE_ENTITY_TYPES = ['FACULTY_RESEARCH_AREA', 'LAB'];
export const ROSTER_DROP_GUARD_MIN_FRACTION = 0.5;

export interface DepartmentRosterHealthSnapshotRead {
  pagesRead?: unknown;
  readMode?: unknown;
  cacheAllowed?: unknown;
  readAt?: unknown;
}

export interface DepartmentRosterHealthSnapshot {
  deptName?: unknown;
  status?: unknown;
  complete?: unknown;
  discoveredCount?: unknown;
  discoveredEntityKeys?: unknown;
  read?: DepartmentRosterHealthSnapshotRead;
}

export type RosterHealthReadProvenance = 'fetched' | 'cache-permitted' | 'not-read' | 'unrecorded';

/**
 * Why a roster-health snapshot may or may not govern departures, as one named verdict.
 *
 * Three states were collapsing into "authoritative", and only the first of them is
 * evidence about anybody (#3302):
 *
 *   - `read-discovered-people`: the page was read and it listed people. Evidence.
 *   - `read-discovered-nobody`: the page was read, declared itself `complete`, and listed
 *     nobody. NOT evidence. An empty discovery and a department with no faculty are
 *     opposite facts that this snapshot cannot tell apart, and admitting it asserts
 *     absence for every person the department governs. Measured on Development, 2 live
 *     snapshots were admitted in this state over 25 governed rows, and 3 of those rows
 *     already carry a first-absence marker, so they were one repeat run from suppression.
 *   - `not-read`, `unrecorded`: no read happened, or the run cannot say. NOT evidence,
 *     which is the distinction #3251 already drew.
 *   - `incomplete`: the read happened and reported itself unfinished. NOT evidence.
 *
 * This is the omission-versus-assertion rule the corpus already applies elsewhere
 * (#2542): silence is not a claim, and a failed read is silence.
 */
export type RosterHealthAdmissibility =
  | 'read-discovered-people'
  | 'read-discovered-nobody'
  | 'incomplete'
  | 'not-read'
  | 'unrecorded';

export function rosterHealthAdmissibility(
  snapshot: DepartmentRosterHealthSnapshot,
): RosterHealthAdmissibility {
  if (!Array.isArray(snapshot.discoveredEntityKeys)) return 'unrecorded';
  const provenance = rosterHealthReadProvenance(snapshot);
  if (provenance === 'not-read' || provenance === 'unrecorded') return provenance;
  if (snapshot.complete !== true) return 'incomplete';
  return snapshotDiscoveredEntityKeys(snapshot).length > 0
    ? 'read-discovered-people'
    : 'read-discovered-nobody';
}

/**
 * What the run behind a snapshot recorded about reading the department's page.
 *
 * `unrecorded` is the pre-#3251 shape: those snapshots carry no `read` block at
 * all, so nothing in them can distinguish a page read over the wire from one that
 * was never requested. They are not deleted, because each is still the only record
 * of what a department listed at that moment and deleting them would erase the
 * lane's entire history; they are simply not authoritative, and the next roster run
 * supersedes each one with a snapshot that does record its read.
 */
export function rosterHealthReadProvenance(
  snapshot: DepartmentRosterHealthSnapshot,
): RosterHealthReadProvenance {
  const read = snapshot.read;
  if (!read || typeof read !== 'object') return 'unrecorded';
  const pagesRead = typeof read.pagesRead === 'number' ? read.pagesRead : 0;
  if (pagesRead <= 0 || read.readMode === 'none') return 'not-read';
  return read.cacheAllowed === true ? 'cache-permitted' : 'fetched';
}

/** When the snapshot's own run says it read the page, if it recorded that at all. */
export function rosterHealthReadAt(snapshot: DepartmentRosterHealthSnapshot): Date | null {
  const raw = snapshot.read?.readAt;
  if (typeof raw !== 'string' && !(raw instanceof Date)) return null;
  const parsed = raw instanceof Date ? raw : new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export interface EntityDepartureState {
  yaleStatusReasonCache?: string | null;
  absentFromRosterSinceRunId?: string | null;
  /**
   * The entity carries a human-recorded `permanently_closed` marker. Since #2414
   * a recorded closure derives the same `reason: 'departed'` this reconciler
   * writes from roster absence, so without this flag a roster-present run would
   * read the human marker as its own past output and clear it.
   */
  hasRecordedClosure?: boolean;
}

export type RunPresenceSignal = 'present' | 'absent' | 'inconclusive';

export type FacultyRosterDepartureAction =
  | 'noop'
  | 'refresh_present'
  | 'record_first_absence'
  | 'suppress_departed'
  | 'clear_departed';

export interface FacultyRosterDepartureDecision {
  action: FacultyRosterDepartureAction;
  set: Record<string, unknown>;
}

const NOOP: FacultyRosterDepartureDecision = { action: 'noop', set: {} };

/**
 * A snapshot may govern departures only when its own run recorded reading the
 * department's page. Roster absence is the lane's only evidence, so a snapshot that
 * cannot say whether anything was read is not evidence of absence (#3251).
 */
export function isEntityAuthoritativeSnapshot(snapshot: DepartmentRosterHealthSnapshot): boolean {
  return rosterHealthAdmissibility(snapshot) === 'read-discovered-people';
}

export function snapshotDiscoveredEntityKeys(snapshot: DepartmentRosterHealthSnapshot): string[] {
  return Array.isArray(snapshot.discoveredEntityKeys)
    ? snapshot.discoveredEntityKeys.filter((value): value is string => typeof value === 'string')
    : [];
}

/**
 * Three outcomes rather than two, because a department that governs nothing is not
 * the same fact as a read the guard trusts.
 *
 * `governedCount <= 0` used to return `true`, on the argument that a genuine zero
 * leaves nothing for a guard to protect. That is true of the suppression loop and
 * false of the signal: "passes" is also what the caller reads to decide a snapshot is
 * healthy enough to speak for its department, so a zero denominator read as a pass is
 * the same shape as #2410, where a join miss made the guard structurally incapable of
 * firing for 14 departments. `governs-nothing` says the one thing that is actually
 * known, and no caller may treat it as a trusted read.
 */
export type RosterDropGuardVerdict = 'pass' | 'freeze' | 'governs-nothing';

export function rosterDropGuardVerdict(
  discoveredCount: number,
  governedCount: number,
  minFraction: number = ROSTER_DROP_GUARD_MIN_FRACTION,
): RosterDropGuardVerdict {
  if (governedCount <= 0) return 'governs-nothing';
  return discoveredCount >= minFraction * governedCount ? 'pass' : 'freeze';
}

/** Only a `pass` is a trusted read. A department governing nothing is not one. */
export function passesRosterDropGuard(
  discoveredCount: number,
  governedCount: number,
  minFraction: number = ROSTER_DROP_GUARD_MIN_FRACTION,
): boolean {
  return rosterDropGuardVerdict(discoveredCount, governedCount, minFraction) === 'pass';
}

/**
 * The share of its own previous discovery a department's read must retain.
 *
 * 0.75 rather than the cross-population 0.5, because this compares like with like. Real
 * turnover in a department's listed faculty between two reads is a few percent; losing a
 * quarter of them at once is a read to distrust, and the cost of distrusting it is a
 * deferred plan rather than a suppressed row.
 */
export const ROSTER_DISCOVERY_RETENTION_MIN_FRACTION = 0.75;

/**
 * Whether this read lost so much of the department's own previous discovery that it
 * cannot be believed, independent of how many rows the department governs.
 *
 * This exists because correcting the drop guard's denominator weakened it. Restricting
 * the denominator to the rows this lane has observed is right - a guard must be measured
 * over the population it protects - but on Development it moved one department's read
 * from 86 of 200 (0.43, frozen) to 86 of 124 (0.69, passing), and that read is exactly
 * the one worth distrusting: the same department's previous authoritative snapshot
 * discovered 153. A 44 percent fall in discovery with the read still reporting
 * `complete: true` is the signal, and no choice of denominator expresses it, because
 * both numbers are on the same side of the comparison.
 *
 * Deliberately no freeze without a prior reading. A first authoritative snapshot has
 * nothing to regress against, and inventing a floor for it would be a guard firing on
 * absence of history rather than on evidence (#3302).
 */
export function rosterDiscoveryRegressed(
  previousDiscoveredCount: number | null,
  discoveredCount: number,
  minRetainedFraction: number = ROSTER_DISCOVERY_RETENTION_MIN_FRACTION,
): boolean {
  if (previousDiscoveredCount === null || previousDiscoveredCount <= 0) return false;
  return discoveredCount < minRetainedFraction * previousDiscoveredCount;
}

/**
 * The canonical department name a roster-health snapshot governs, or null when
 * no `OrgUnit` names it.
 *
 * The snapshot records the raw `DEFAULT_DEPT_CONFIGS` `deptName`, while
 * `research_entities.departments[]` stores the canonical `OrgUnit` name, so the
 * two are joinable only through the catalog. Resolving here means the join is
 * keyed on org-unit identity rather than on two spellings happening to agree,
 * and a config whose spelling drifts from the catalog surfaces as an explicit
 * unresolved department instead of a silent zero governed count.
 *
 * A snapshot whose `deptName` is a school rather than a department (the
 * `divinity`, `nursing`, and `law` configs) also resolves to null, which is
 * correct: no entity carries a school in `departments[]`, so the department
 * governs nothing.
 */
export async function resolveGovernedDepartmentName(deptName: string): Promise<string | null> {
  if (!deptName.trim()) return null;
  try {
    const canonicalizer = await getOrgUnitCanonicalizer();
    const resolved = canonicalizer.canonicalizeDepartments([deptName]).values[0];
    return resolved || null;
  } catch {
    return null;
  }
}

export function classifyEntityRunSignal(params: {
  coveredDeptNames: string[];
  healthyDiscoveredByDept: Map<string, Set<string>>;
  entitySlug: string;
  rosterObservedEntityKeys: ReadonlySet<string>;
}): RunPresenceSignal {
  const { coveredDeptNames, healthyDiscoveredByDept, entitySlug, rosterObservedEntityKeys } =
    params;
  if (coveredDeptNames.length === 0) return 'inconclusive';
  // A row this lane has never observed cannot be found present by it, so comparing it
  // against a discovery set can only ever return `absent`. Measured on Development,
  // 2,689 of the 3,726 rows carrying a snapshot department are in that position and
  // 2,160 of those are served: every discovered key the lane has ever emitted is one
  // it minted itself, so a row minted by the medical-school, grant or eponym lanes is
  // structurally unnameable here. Absence of a mention is not evidence of departure
  // for a row the source could not have mentioned (#3302).
  if (!rosterObservedEntityKeys.has(entitySlug)) return 'inconclusive';
  if (coveredDeptNames.some((deptName) => !healthyDiscoveredByDept.has(deptName))) {
    return 'inconclusive';
  }
  const present = coveredDeptNames.some((deptName) =>
    healthyDiscoveredByDept.get(deptName)?.has(entitySlug),
  );
  return present ? 'present' : 'absent';
}

export function decideFacultyRosterDeparture(params: {
  signal: RunPresenceSignal;
  currentRunId: string;
  observedAt: Date;
  entity: EntityDepartureState;
}): FacultyRosterDepartureDecision {
  const { signal, currentRunId, observedAt, entity } = params;
  if (signal === 'inconclusive' || !currentRunId) return NOOP;

  const reason = entity.yaleStatusReasonCache || '';
  if (reason === 'deceased') return NOOP;

  if (signal === 'present') {
    const set: Record<string, unknown> = {
      lastSeenInCompleteRosterAt: observedAt,
      absentFromRosterSinceRunId: '',
    };
    // A recorded closure outranks roster presence: a relocated professor is by
    // definition still listed on a stale Yale roster, which is the population the
    // marker exists for, so clearing on presence would let this lane overwrite a
    // human judgement with an automated one. The last-seen bookkeeping is still
    // a fact worth recording.
    if (reason === 'departed' && !entity.hasRecordedClosure) {
      set.yaleStatusCache = 'active';
      set.activeAtYaleCache = true;
      set.yaleStatusReasonCache = '';
      return { action: 'clear_departed', set };
    }
    return { action: 'refresh_present', set };
  }

  const absentSinceRunId = entity.absentFromRosterSinceRunId || '';
  if (!absentSinceRunId) {
    return { action: 'record_first_absence', set: { absentFromRosterSinceRunId: currentRunId } };
  }
  if (absentSinceRunId === currentRunId) return NOOP;
  if (reason === 'departed') return NOOP;
  return {
    action: 'suppress_departed',
    set: {
      yaleStatusCache: 'departed',
      activeAtYaleCache: false,
      yaleStatusReasonCache: 'departed',
    },
  };
}

export function facultyRosterDepartureDetectionEnabled(): boolean {
  return process.env.SCRAPER_FACULTY_DEPARTURE_DETECTION === 'true';
}

export const LEAD_ROLES_FOR_DEPARTURE_EVIDENCE = [
  'PI',
  'CO_PI',
  'DIRECTOR',
  'CO_DIRECTOR',
] as const;

/**
 * The Yale profile pages that speak for this entity's subject: the entity's own
 * citations plus the `YALE_OFFICIAL` profile links of the people holding a lead
 * edge on it, resolved through the same `RoleAssignment` -> `Researcher` chain
 * the detail page serves members from.
 *
 * The lead half is not optional. A roster-minted faculty row keeps only the
 * professor's personal website in `sourceUrls`, so reading the entity alone finds
 * no Yale page at all for exactly the population this lane exists to judge.
 */
export async function yaleProfileUrlsForDepartureEvidence(
  entity: Record<string, unknown>,
): Promise<string[]> {
  const own = [
    entity.websiteUrl,
    entity.website,
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
  ].filter(isYaleProfileUrl) as string[];

  const assignments = await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': entity._id,
    role: { $in: LEAD_ROLES_FOR_DEPARTURE_EVIDENCE },
    archived: { $ne: true },
  })
    .select('personId')
    .lean();
  const personIds = assignments
    .map((assignment: any) => assignment.personId)
    .filter((personId: unknown) => Boolean(personId));
  const leads = personIds.length
    ? ((await Researcher.find({ _id: { $in: personIds }, archived: { $ne: true } })
        .select('profileLinks')
        .lean()) as any[])
    : [];
  const leadUrls = leads.flatMap((lead) =>
    (Array.isArray(lead.profileLinks) ? lead.profileLinks : [])
      .filter((link: any) => link?.kind === 'YALE_OFFICIAL')
      .map((link: any) => link?.url)
      .filter(isYaleProfileUrl),
  ) as string[];

  return Array.from(new Set([...own, ...leadUrls].map((url) => url.trim())));
}

const fetchYaleProfilePage = async (url: string): Promise<YaleProfilePage | null> => {
  const page = await fetchPageWithPolicy(url, {
    headers: {
      'User-Agent': 'ylabs-scraper/1.0 (+https://yalelabs.io)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  return { status: page.status, html: page.html };
};

/**
 * Replaces an all-links-dead probe that could only ever withhold a suppression,
 * and withheld it for precisely the cohort the lane is for. A professor who
 * relocates takes their personal website with them, so that site answers 200
 * while saying in its first paragraph that they are now at another university: the
 * strongest available evidence of departure was being read as proof of presence.
 * The dead-link reading also mislabelled its own findings, since a website that
 * has gone means the site has gone, not that the person left Yale.
 *
 * Nothing is lost by dropping it: the lane has never written a row in any
 * environment, so there is no established behaviour here to preserve.
 */
export async function probeEntityDepartureEvidence(
  entity: Record<string, unknown>,
  fetchPage: (url: string) => Promise<YaleProfilePage | null> = fetchYaleProfilePage,
): Promise<YaleProfileDepartureEvidence> {
  return probeYaleProfileDepartureEvidence(
    await yaleProfileUrlsForDepartureEvidence(entity),
    fetchPage,
  );
}

/**
 * Why a reconciliation pass did nothing. Without this a caller cannot tell an
 * uneventful run from a lane that never executed, which is how three independent
 * dormancy causes went unnoticed at once (#2410): the feature flag is unset in
 * every checked-in config, `departmentRosterHealth` observations were absent from
 * Beta and Production entirely, and the department join matched nothing.
 */
export type FacultyRosterDepartureOutcome =
  | 'disabled'
  | 'planned'
  | 'invalid-run-id'
  | 'no-roster-health-observations'
  | 'no-authoritative-departments'
  | 'reconciled';

export type FacultyRosterDeparturePlan = Record<
  Exclude<FacultyRosterDepartureAction, 'noop'>,
  number
>;

export interface FacultyRosterDepartureResult {
  outcome: FacultyRosterDepartureOutcome;
  /** `plan` reads and decides but writes nothing; `apply` writes its decisions. */
  mode: 'plan' | 'apply';
  suppressed: number;
  cleared: number;
  held: number;
  frozenDepartments: number;
  /** Departments whose authoritative read covers no row this lane has ever observed. */
  departmentsGoverningNothing: number;
  /** Departments whose read lost too much of their own previous discovery to be believed. */
  regressedDepartments: number;
  /**
   * How many snapshots landed in each admissibility state, so a department refused for
   * discovering nobody is legible rather than silently skipped (#3302).
   */
  admissibilityCounts?: Record<string, number>;
  /**
   * Every action the pass decided on, written or not.
   *
   * On a plan `suppress_departed` is the count BEFORE the Yale-profile probe, because a
   * plan does not fetch: the probe only ever withholds a suppression, so the
   * planned figure is an upper bound rather than a prediction. `held` stays 0 on a
   * plan for the same reason.
   */
  planned: FacultyRosterDeparturePlan;
  /**
   * Rows whose stored visibility tier was recomputed after their Yale status
   * changed. Nothing reaches students until this happens: the tier is a stored
   * field and `activeAtYaleCache === false` only decides the tier the next gate
   * pass computes, so a suppression that skips the re-gate leaves the row
   * serving `student_ready` until some unrelated pass happens to re-evaluate it.
   */
  regatedEntities: number;
  /** Departments whose governed population was reconciled this run. */
  governedDepartments: string[];
  /** Snapshot department names no `OrgUnit` names, so they govern nothing. */
  unresolvedDepartments: string[];
  /**
   * One entry per decided row, so an operator can answer "why this row" from the
   * plan alone.
   *
   * A count cannot be read: `auditFacultyDepartureLane` exists so a plan is read
   * before a lane that can only remove rows is enabled, and reporting
   * `suppress_departed: 20` gave nobody a way to see which twenty research homes
   * would leave the directory or on what evidence (#3235). Each entry therefore
   * carries the evidence the decision rests on, not just its outcome.
   */
  plannedRows: FacultyRosterDepartureRowExplanation[];
  /** How far the evidence under this plan is from having been read. */
  evidenceFreshness: FacultyRosterDepartureEvidenceFreshness;
}

export interface FacultyRosterDepartureRowExplanation {
  entityKey: string;
  action: Exclude<FacultyRosterDepartureAction, 'noop'>;
  /** The row's departments this run published a healthy snapshot for. */
  coveredDepartments: string[];
  /**
   * The run whose absence this decision rests on: the row's stored
   * `absentFromRosterSinceRunId` where one exists, otherwise this run, which is
   * what distinguishes a first absence from a standing one.
   */
  absenceRestsOnRunId: string;
  /** When the snapshot for this row's own department was observed. */
  departmentSnapshotObservedAt: string | null;
  /**
   * The date the decision actually wrote. Since #3251 this is the newest read among
   * the row's own departments rather than whichever snapshot the planning loop read
   * last, so it is evidence about this row. It is still reported next to
   * `departmentSnapshotObservedAt` because a snapshot the store skipped as
   * byte-identical keeps its predecessor's `observedAt`, so the two can still
   * disagree and the recorded read is the one to trust.
   */
  decisionObservedAt: string;
}

export interface FacultyRosterDepartureEvidenceFreshness {
  /** Snapshots this plan read, and how many departments they cover. */
  snapshotsRead: number;
  /**
   * Distinct `observedAt` values across those snapshots. A run stamps every
   * snapshot it publishes with one timestamp, so a value of 1 over many
   * departments means the timestamp records when the run happened rather than
   * when any department was read.
   */
  distinctSnapshotObservedAt: number;
  /**
   * Successful fetches the planning run recorded.
   *
   * Read this as a lower bound and never as proof of absence of fetching. Until
   * #3251 the roster lane pushed an attempt on the rendered-browser branch alone,
   * so a run whose 112 HTML lanes each fetched reported zero here, and that zero
   * was read once as "the fetch layer was never entered". Prefer `readProvenance`,
   * which each snapshot carries for its own department.
   */
  planningRunFetchesSucceeded: number;
  /**
   * How many of the run's snapshots recorded reading their department's page, so a
   * reader can tell what the plan rests on rather than inferring it from the
   * run-level fetch metrics (#3251).
   */
  readProvenance: Record<RosterHealthReadProvenance, number>;
}

const EMPTY_READ_PROVENANCE: Record<RosterHealthReadProvenance, number> = {
  fetched: 0,
  'cache-permitted': 0,
  'not-read': 0,
  unrecorded: 0,
};

const EMPTY_DEPARTURE_PLAN: FacultyRosterDeparturePlan = {
  refresh_present: 0,
  record_first_absence: 0,
  suppress_departed: 0,
  clear_departed: 0,
};

/**
 * The newest snapshot date among the row's own covered departments, which is the
 * only date that is evidence about this row. The planning loop's `observedAt` is a
 * single scalar overwritten by each snapshot it reads, so on any run covering more
 * than one department the date the decision writes belongs to whichever department
 * happened to be last.
 */
export function newestSnapshotDateFor(
  coveredDeptNames: readonly string[],
  snapshotObservedAtByDept: ReadonlyMap<string, Date>,
): Date | null {
  let newest: Date | null = null;
  for (const deptName of coveredDeptNames) {
    const observedAt = snapshotObservedAtByDept.get(deptName);
    if (!observedAt) continue;
    if (!newest || observedAt.getTime() > newest.getTime()) newest = observedAt;
  }
  return newest;
}

/**
 * Pages the planning run actually fetched, read off its own `ScrapeRun` record.
 *
 * A roster-health snapshot is stamped with the run's timestamp whether or not the
 * run read the department's page, so the timestamp alone cannot tell a fresh
 * observation from a derived one. This is the number that can: a plan whose run
 * fetched nothing rests entirely on evidence that was not observed.
 */
export async function countPlanningRunFetchSuccesses(
  runObjectId: mongoose.Types.ObjectId,
): Promise<number> {
  try {
    const run = (await mongoose.connection
      .collection('scrape_runs')
      .findOne({ _id: runObjectId })) as Record<string, unknown> | null;
    const found = findFetchSucceeded(run);
    return typeof found === 'number' ? found : 0;
  } catch {
    return 0;
  }
}

function findFetchSucceeded(node: unknown, depth = 0): number | undefined {
  if (depth > 6 || !node || typeof node !== 'object') return undefined;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'succeeded' && typeof value === 'number') return value;
    const nested = findFetchSucceeded(value, depth + 1);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export const ROSTER_LANE_SOURCE_NAME = 'dept-faculty-roster';

/**
 * The entity keys this lane has ever observed, which is the population it may speak
 * about at all.
 *
 * Read from the lane's own observations rather than from slug shape. The two agree
 * exactly on Development, 1,037 rows either way, but the evidence test is the one that
 * stays true if the key convention changes, and a slug prefix would be a second
 * convention for something the ledger already records.
 */
export async function loadRosterObservedEntityKeys(): Promise<ReadonlySet<string>> {
  const keys = (await Observation.distinct('entityKey', {
    sourceName: ROSTER_LANE_SOURCE_NAME,
    entityType: 'researchEntity',
  })) as unknown[];
  return new Set(keys.filter((key): key is string => typeof key === 'string' && key.length > 0));
}

/**
 * The discovery count of each department's newest prior snapshot that found anybody,
 * keyed by canonical department name.
 *
 * Reads superseded observations on purpose. Each roster run supersedes the last, so a
 * department's previous reading exists only there, and a comparison against history is
 * the only way to see a discovery collapse.
 *
 * The baseline deliberately accepts a snapshot this lane would refuse as evidence,
 * including the pre-#3251 `unrecorded` ones. The asymmetry is the point: a snapshot that
 * cannot prove it was read is not evidence that anyone is ABSENT, but its discovery
 * count is still a record of what the department listed, and it is used here only to
 * WITHHOLD a plan. A baseline can only ever prevent a suppression, never cause one, so
 * the weaker evidence bar is the fail-closed direction. Restricting it to authoritative
 * snapshots made this guard abstain on the one department it was written for, whose
 * prior reading of 153 is `unrecorded`.
 */
export async function loadPreviousDiscoveryCounts(
  currentRunObjectId: mongoose.Types.ObjectId,
): Promise<Map<string, number>> {
  const snapshots = (await Observation.find({
    entityType: 'departmentRosterHealth',
    field: DEPARTMENT_ROSTER_HEALTH_FIELD,
    scrapeRunId: { $ne: currentRunObjectId },
  })
    .sort({ observedAt: 1 })
    .select('value observedAt')
    .lean()) as Array<{ value?: unknown }>;

  const byDept = new Map<string, number>();
  const canonicalByRaw = new Map<string, string | null>();
  for (const row of snapshots) {
    const snapshot = (row.value ?? {}) as DepartmentRosterHealthSnapshot;
    if (snapshot.complete !== true) continue;
    if (snapshotDiscoveredEntityKeys(snapshot).length === 0) continue;
    const raw = typeof snapshot.deptName === 'string' ? snapshot.deptName : '';
    if (!raw) continue;
    if (!canonicalByRaw.has(raw)) {
      canonicalByRaw.set(raw, await resolveGovernedDepartmentName(raw));
    }
    const deptName = canonicalByRaw.get(raw);
    if (!deptName) continue;
    byDept.set(deptName, snapshotDiscoveredEntityKeys(snapshot).length);
  }
  return byDept;
}

async function countRosterGovernedEntities(
  deptName: string,
  rosterObservedEntityKeys: ReadonlySet<string>,
): Promise<number> {
  const slugs = (await ResearchEntity.find(
    {
      departments: deptName,
      entityType: { $in: FACULTY_DEPARTURE_ENTITY_TYPES },
      archived: { $ne: true },
    },
    { slug: 1 },
  ).lean()) as Array<{ slug?: unknown }>;
  return slugs.filter(
    (row) => typeof row.slug === 'string' && rosterObservedEntityKeys.has(row.slug),
  ).length;
}

export async function reconcileFacultyRosterDeparturesFromRun(
  scrapeRunId: string,
  options: { dryRun?: boolean } = {},
): Promise<FacultyRosterDepartureResult> {
  // A dry run used to return before reading anything, so the only way to learn
  // what this lane would do was to let it do it. That made its dormancy
  // unmeasurable: three separate gates were shut at once and the silence read the
  // same as "no departures happened" (#2428). A plan therefore runs the whole
  // decision path and writes nothing, which is the contract the field-retraction
  // lane already follows, and the feature flag gates only the writing arm so the
  // plan is readable without enabling a lane that can only remove rows.
  const applying = !options.dryRun;
  const base = {
    mode: (applying ? 'apply' : 'plan') as 'plan' | 'apply',
    suppressed: 0,
    cleared: 0,
    held: 0,
    frozenDepartments: 0,
    departmentsGoverningNothing: 0,
    regressedDepartments: 0,
    planned: { ...EMPTY_DEPARTURE_PLAN },
    regatedEntities: 0,
    governedDepartments: [] as string[],
    unresolvedDepartments: [] as string[],
    plannedRows: [] as FacultyRosterDepartureRowExplanation[],
    evidenceFreshness: {
      snapshotsRead: 0,
      distinctSnapshotObservedAt: 0,
      planningRunFetchesSucceeded: 0,
      readProvenance: { ...EMPTY_READ_PROVENANCE },
    } as FacultyRosterDepartureEvidenceFreshness,
  };
  if (applying && !facultyRosterDepartureDetectionEnabled()) {
    return { ...base, outcome: 'disabled' };
  }
  let runObjectId: mongoose.Types.ObjectId;
  try {
    runObjectId = new mongoose.Types.ObjectId(scrapeRunId);
  } catch {
    return { ...base, outcome: 'invalid-run-id' };
  }

  const snapshots = (await Observation.find({
    scrapeRunId: runObjectId,
    entityType: 'departmentRosterHealth',
    field: DEPARTMENT_ROSTER_HEALTH_FIELD,
  })
    .select('value observedAt')
    .lean()) as any[];
  if (snapshots.length === 0) return { ...base, outcome: 'no-roster-health-observations' };

  const scrapedDeptNames = new Set<string>();
  const healthyDiscoveredByDept = new Map<string, Set<string>>();
  // A run covers many departments read at different moments, so one scalar cannot
  // date them. It used to be overwritten by each snapshot in turn, so every entity
  // was stamped with whichever department happened to be last in the cursor (#3251).
  const snapshotObservedAtByDept = new Map<string, Date>();
  const unresolvedDepartments: string[] = [];
  const readProvenanceCounts: Record<RosterHealthReadProvenance, number> = {
    fetched: 0,
    'cache-permitted': 0,
    'not-read': 0,
    unrecorded: 0,
  };
  let frozenDepartments = 0;
  const admissibilityCounts: Record<string, number> = {};
  let departmentsGoverningNothing = 0;
  const rosterObservedEntityKeys = await loadRosterObservedEntityKeys();
  const previousDiscoveryByDept = await loadPreviousDiscoveryCounts(runObjectId);
  let regressedDepartments = 0;
  let latestObservedAt = new Date();

  for (const snapshotObservation of snapshots) {
    const snapshot = (snapshotObservation.value || {}) as DepartmentRosterHealthSnapshot;
    const rawDeptName = typeof snapshot.deptName === 'string' ? snapshot.deptName : '';
    readProvenanceCounts[rosterHealthReadProvenance(snapshot)] += 1;
    if (!rawDeptName) continue;
    const snapshotObservedAt =
      rosterHealthReadAt(snapshot) ??
      (snapshotObservation.observedAt instanceof Date ? snapshotObservation.observedAt : null);
    if (snapshotObservedAt) latestObservedAt = snapshotObservedAt;

    const deptName = await resolveGovernedDepartmentName(rawDeptName);
    if (!deptName) {
      unresolvedDepartments.push(rawDeptName);
      console.warn(
        `[faculty-departure] unresolved department ${sanitizeLogValue(rawDeptName)}: no OrgUnit names it, so it governs no entity and this run cannot reconcile it`,
      );
      continue;
    }
    scrapedDeptNames.add(deptName);
    if (snapshotObservedAt) {
      const known = snapshotObservedAtByDept.get(deptName);
      if (!known || snapshotObservedAt > known) {
        snapshotObservedAtByDept.set(deptName, snapshotObservedAt);
      }
    }
    const admissibility = rosterHealthAdmissibility(snapshot);
    admissibilityCounts[admissibility] = (admissibilityCounts[admissibility] || 0) + 1;
    if (admissibility === 'read-discovered-nobody') {
      console.warn(
        `[faculty-departure] inadmissible department ${sanitizeLogValue(deptName)}: the read completed and discovered nobody, which is not evidence about who is present`,
      );
    }
    if (admissibility !== 'read-discovered-people') continue;

    const discovered = snapshotDiscoveredEntityKeys(snapshot);
    // The guard is measured over exactly the rows it protects. Counting every row that
    // carries the department inflates the denominator with rows this lane can never
    // name, which decides freeze verdicts on rows outside its reach: on Development one
    // department read 86 of 200 and froze at 0.43, while over the 124 rows the lane has
    // actually observed the same read scores 0.69 and passes (#3302).
    const governedCount = await countRosterGovernedEntities(deptName, rosterObservedEntityKeys);
    const previousDiscovered = previousDiscoveryByDept.get(deptName) ?? null;
    if (rosterDiscoveryRegressed(previousDiscovered, discovered.length)) {
      regressedDepartments += 1;
      console.warn(
        `[faculty-departure] regressed department ${sanitizeLogValue(deptName)}: discovered ${discovered.length} against ${previousDiscovered} on its previous read, so this read does not govern`,
      );
      continue;
    }
    const verdict = rosterDropGuardVerdict(discovered.length, governedCount);
    if (verdict === 'governs-nothing') {
      departmentsGoverningNothing += 1;
      continue;
    }
    if (verdict === 'freeze') {
      frozenDepartments += 1;
      console.warn(
        `[faculty-departure] frozen department ${sanitizeLogValue(deptName)}: discovered ${discovered.length} of ${governedCount} governed entities (below drop guard)`,
      );
      continue;
    }
    // Two roster configs can resolve to one canonical department, and they disagree
    // permanently: measured on Development one department carried a lane reading 19 of 20
    // and a lane reading 0 of 20, both admitted. `Map.set` took whichever was iterated
    // last, so a correct read and an empty read were interchangeable by iteration order
    // (#3302). Union instead: a discovery is positive evidence that a person is present,
    // and absence may only be concluded from every lane failing to find them. The union
    // can only shrink the absent set, never grow it.
    const alreadyDiscovered = healthyDiscoveredByDept.get(deptName);
    if (alreadyDiscovered) {
      for (const key of discovered) alreadyDiscovered.add(key);
    } else {
      healthyDiscoveredByDept.set(deptName, new Set(discovered));
    }
  }

  const evidenceFreshness: FacultyRosterDepartureEvidenceFreshness = {
    snapshotsRead: snapshots.length,
    distinctSnapshotObservedAt: new Set(
      snapshots
        .map((entry) => (entry.observedAt instanceof Date ? entry.observedAt.toISOString() : ''))
        .filter(Boolean),
    ).size,
    planningRunFetchesSucceeded: await countPlanningRunFetchSuccesses(runObjectId),
    readProvenance: readProvenanceCounts,
  };
  const reported = {
    ...base,
    evidenceFreshness,
    frozenDepartments,
    admissibilityCounts,
    departmentsGoverningNothing,
    regressedDepartments,
    unresolvedDepartments,
    governedDepartments: Array.from(healthyDiscoveredByDept.keys()),
  };
  if (healthyDiscoveredByDept.size === 0 && frozenDepartments === 0 && regressedDepartments === 0) {
    return { ...reported, outcome: 'no-authoritative-departments' };
  }

  const governed = (await ResearchEntity.find({
    departments: { $in: Array.from(scrapedDeptNames) },
    entityType: { $in: FACULTY_DEPARTURE_ENTITY_TYPES },
    archived: { $ne: true },
  })
    .select(
      'slug departments yaleStatusReasonCache absentFromRosterSinceRunId manuallyLockedFields studentVisibilitySuppressionReason websiteUrl website sourceUrls',
    )
    .lean()) as any[];

  let suppressed = 0;
  let cleared = 0;
  let held = 0;
  const regateIds: string[] = [];
  const planned: FacultyRosterDeparturePlan = { ...EMPTY_DEPARTURE_PLAN };
  const plannedRows: FacultyRosterDepartureRowExplanation[] = [];
  for (const entity of governed) {
    if (typeof entity.slug !== 'string' || !entity.slug) continue;
    if (!yaleStatusCacheIsWritable(entity)) continue;
    const coveredDeptNames = (Array.isArray(entity.departments) ? entity.departments : []).filter(
      (deptName: unknown): deptName is string =>
        typeof deptName === 'string' && scrapedDeptNames.has(deptName),
    );
    const signal = classifyEntityRunSignal({
      coveredDeptNames,
      healthyDiscoveredByDept,
      entitySlug: entity.slug,
      rosterObservedEntityKeys,
    });
    // Date the row from its own departments' reads, not from whichever snapshot the
    // cursor returned last (#3251).
    const observedAt =
      newestSnapshotDateFor(coveredDeptNames, snapshotObservedAtByDept) ?? latestObservedAt;
    const decision = decideFacultyRosterDeparture({
      signal,
      currentRunId: scrapeRunId,
      observedAt,
      entity: {
        yaleStatusReasonCache: entity.yaleStatusReasonCache,
        absentFromRosterSinceRunId: entity.absentFromRosterSinceRunId,
        hasRecordedClosure: hasRecordedClosureEvidence(entity),
      },
    });
    if (decision.action === 'noop') continue;
    planned[decision.action] += 1;
    plannedRows.push({
      entityKey: entity.slug,
      action: decision.action,
      coveredDepartments: coveredDeptNames,
      absenceRestsOnRunId:
        typeof entity.absentFromRosterSinceRunId === 'string' && entity.absentFromRosterSinceRunId
          ? entity.absentFromRosterSinceRunId
          : scrapeRunId,
      departmentSnapshotObservedAt:
        newestSnapshotDateFor(coveredDeptNames, snapshotObservedAtByDept)?.toISOString() ?? null,
      decisionObservedAt: observedAt.toISOString(),
    });
    if (!applying) continue;

    if (decision.action === 'suppress_departed') {
      const evidence = await probeEntityDepartureEvidence(entity);
      if (!evidence.assertsAbsence) {
        held += 1;
        continue;
      }
    }

    await ResearchEntity.updateOne({ _id: entity._id }, { $set: decision.set });
    if (decision.action === 'suppress_departed') suppressed += 1;
    if (decision.action === 'clear_departed') cleared += 1;
    if (decision.action === 'suppress_departed' || decision.action === 'clear_departed') {
      regateIds.push(String(entity._id));
    }
  }

  // Writing the Yale-status fields is not the same as removing the row from the
  // directory. `studentVisibilityTier` is a stored field and
  // `activeAtYaleCache === false` only decides what the NEXT gate pass computes,
  // so a suppression without this re-gate left the row serving `student_ready`
  // until something unrelated happened to re-evaluate it. Measured on the first
  // enabled run: of two rows written `departed`, one was re-gated by a later pass
  // in the same materialize and left the surface, the other kept serving at HTTP
  // 200 for 40 minutes. Same chokepoint the field-retraction lane uses.
  let regatedEntities = 0;
  const uniqueRegateIds = Array.from(new Set(regateIds));
  if (uniqueRegateIds.length > 0) {
    await applyStudentVisibilityGatePlans(
      await planStudentVisibilityGate({
        collection: 'research',
        mode: 'apply',
        recordIds: uniqueRegateIds,
      }),
    );
    regatedEntities = uniqueRegateIds.length;
  }

  return {
    ...reported,
    outcome: applying ? 'reconciled' : 'planned',
    planned,
    plannedRows,
    suppressed,
    cleared,
    held,
    regatedEntities,
  };
}
