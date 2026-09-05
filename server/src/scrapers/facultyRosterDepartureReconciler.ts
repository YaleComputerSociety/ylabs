import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import {
  classifySourceLinkHealth,
  isLikelyUnavailableSourceLink,
  probeSourceLink,
} from '../services/sourceLinkHealth';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { yaleStatusCacheIsWritable } from '../utils/researchEntityYaleStatus';
import { getOrgUnitCanonicalizer } from './orgUnitCanonicalization';

export const DEPARTMENT_ROSTER_HEALTH_FIELD = 'departmentRosterHealth';
export const FACULTY_DEPARTURE_ENTITY_TYPES = ['FACULTY_RESEARCH_AREA', 'LAB'];
export const ROSTER_DROP_GUARD_MIN_FRACTION = 0.5;

export interface DepartmentRosterHealthSnapshot {
  deptName?: unknown;
  status?: unknown;
  complete?: unknown;
  discoveredCount?: unknown;
  discoveredEntityKeys?: unknown;
}

export interface EntityDepartureState {
  yaleStatusReasonCache?: string | null;
  absentFromRosterSinceRunId?: string | null;
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

export function isEntityAuthoritativeSnapshot(snapshot: DepartmentRosterHealthSnapshot): boolean {
  return snapshot.complete === true && Array.isArray(snapshot.discoveredEntityKeys);
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
    if (reason === 'departed') {
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

function entityLinkCandidates(entity: Record<string, unknown>): string[] {
  const urls = [
    entity.websiteUrl,
    entity.website,
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
  ];
  return Array.from(
    new Set(
      urls
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => /^https?:\/\//i.test(value)),
    ),
  );
}

export async function probeEntityLinkDeath(
  entity: Record<string, unknown>,
): Promise<{ probed: number; dead: boolean }> {
  const candidates = entityLinkCandidates(entity);
  if (candidates.length === 0) return { probed: 0, dead: false };
  let anyAlive = false;
  for (const url of candidates) {
    const health = classifySourceLinkHealth(await probeSourceLink(url));
    if (!isLikelyUnavailableSourceLink(health)) anyAlive = true;
  }
  return { probed: candidates.length, dead: !anyAlive };
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
  | 'dry-run'
  | 'invalid-run-id'
  | 'no-roster-health-observations'
  | 'no-authoritative-departments'
  | 'reconciled';

export interface FacultyRosterDepartureResult {
  outcome: FacultyRosterDepartureOutcome;
  suppressed: number;
  cleared: number;
  held: number;
  frozenDepartments: number;
  /** Departments whose governed population was reconciled this run. */
  governedDepartments: string[];
  /** Snapshot department names no `OrgUnit` names, so they govern nothing. */
  unresolvedDepartments: string[];
}

export async function reconcileFacultyRosterDeparturesFromRun(
  scrapeRunId: string,
  options: { dryRun?: boolean } = {},
): Promise<FacultyRosterDepartureResult> {
  const base = {
    suppressed: 0,
    cleared: 0,
    held: 0,
    frozenDepartments: 0,
    governedDepartments: [] as string[],
    unresolvedDepartments: [] as string[],
  };
  if (options.dryRun) return { ...base, outcome: 'dry-run' };
  if (!facultyRosterDepartureDetectionEnabled()) return { ...base, outcome: 'disabled' };
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
  const unresolvedDepartments: string[] = [];
  let frozenDepartments = 0;
  let observedAt = new Date();

  for (const snapshotObservation of snapshots) {
    const snapshot = (snapshotObservation.value || {}) as DepartmentRosterHealthSnapshot;
    const rawDeptName = typeof snapshot.deptName === 'string' ? snapshot.deptName : '';
    if (!rawDeptName) continue;
    if (snapshotObservation.observedAt instanceof Date) observedAt = snapshotObservation.observedAt;

    const deptName = await resolveGovernedDepartmentName(rawDeptName);
    if (!deptName) {
      unresolvedDepartments.push(rawDeptName);
      console.warn(
        `[faculty-departure] unresolved department ${sanitizeLogValue(rawDeptName)}: no OrgUnit names it, so it governs no entity and this run cannot reconcile it`,
      );
      continue;
    }
    scrapedDeptNames.add(deptName);
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

  const reported = {
    ...base,
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
      'slug departments yaleStatusReasonCache absentFromRosterSinceRunId manuallyLockedFields websiteUrl website sourceUrls',
    )
    .lean()) as any[];

  let suppressed = 0;
  let cleared = 0;
  let held = 0;
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
    const decision = decideFacultyRosterDeparture({
      signal,
      currentRunId: scrapeRunId,
      observedAt,
      entity: {
        yaleStatusReasonCache: entity.yaleStatusReasonCache,
        absentFromRosterSinceRunId: entity.absentFromRosterSinceRunId,
      },
    });
    if (decision.action === 'noop') continue;

    if (decision.action === 'suppress_departed') {
      const linkDeath = await probeEntityLinkDeath(entity);
      if (!linkDeath.dead) {
        held += 1;
        continue;
      }
    }

    await ResearchEntity.updateOne({ _id: entity._id }, { $set: decision.set });
    if (decision.action === 'suppress_departed') suppressed += 1;
    if (decision.action === 'clear_departed') cleared += 1;
  }
  return { ...reported, outcome: 'reconciled', suppressed, cleared, held };
}
