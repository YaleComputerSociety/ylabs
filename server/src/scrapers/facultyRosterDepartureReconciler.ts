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
  if (snapshot.complete !== true || !Array.isArray(snapshot.discoveredEntityKeys)) return false;
  const provenance = rosterHealthReadProvenance(snapshot);
  return provenance === 'fetched' || provenance === 'cache-permitted';
}

export function snapshotDiscoveredEntityKeys(snapshot: DepartmentRosterHealthSnapshot): string[] {
  return Array.isArray(snapshot.discoveredEntityKeys)
    ? snapshot.discoveredEntityKeys.filter((value): value is string => typeof value === 'string')
    : [];
}

/**
 * `governedCount <= 0` passes rather than freezes, and that is safe only because
 * the caller resolves the department to the canonical name `departments[]`
 * actually stores. A genuine zero means the subsequent `governed` query returns
 * no entity for that department, so the suppression loop cannot act on it and
 * there is nothing for a guard to protect. It was *not* safe while the caller
 * joined on the raw roster-config spelling: a lookup miss produced a zero
 * denominator that read as healthy, so the guard was structurally incapable of
 * firing for 14 departments (#2410). The fix belongs in the join, not here -
 * hardening this branch would add an inert guard rather than remove one.
 */
export function passesRosterDropGuard(
  discoveredCount: number,
  governedCount: number,
  minFraction: number = ROSTER_DROP_GUARD_MIN_FRACTION,
): boolean {
  if (governedCount <= 0) return true;
  return discoveredCount >= minFraction * governedCount;
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
}): RunPresenceSignal {
  const { coveredDeptNames, healthyDiscoveredByDept, entitySlug } = params;
  if (coveredDeptNames.length === 0) return 'inconclusive';
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
    if (!isEntityAuthoritativeSnapshot(snapshot)) continue;

    const governedCount = await ResearchEntity.countDocuments({
      departments: deptName,
      entityType: { $in: FACULTY_DEPARTURE_ENTITY_TYPES },
      archived: { $ne: true },
    });
    const discovered = snapshotDiscoveredEntityKeys(snapshot);
    if (!passesRosterDropGuard(discovered.length, governedCount)) {
      frozenDepartments += 1;
      console.warn(
        `[faculty-departure] frozen department ${sanitizeLogValue(deptName)}: discovered ${discovered.length} of ${governedCount} governed entities (below drop guard)`,
      );
      continue;
    }
    healthyDiscoveredByDept.set(deptName, new Set(discovered));
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
    unresolvedDepartments,
    governedDepartments: Array.from(healthyDiscoveredByDept.keys()),
  };
  if (healthyDiscoveredByDept.size === 0 && frozenDepartments === 0) {
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
