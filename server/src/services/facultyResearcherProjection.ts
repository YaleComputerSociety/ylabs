import { User } from '../models/user';
import {
  identityIsOrganizationalMailbox,
  resolveCanonicalResearcherId,
  resolveOrCreateResearcherIdForIdentity,
  type CanonicalMemberIdentity,
} from '../scrapers/canonicalMembershipMaterializer';
import { sanitizeLogValue } from '../utils/logSanitizer';

export const ACTIVE_FACULTY_PROJECTION_FILTER = {
  userType: { $in: ['professor', 'faculty'] },
  archived: { $ne: true },
  dedupedIntoUserId: { $exists: false },
} as const;

export interface FacultyUserIdentityInput {
  netid?: unknown;
  email?: unknown;
  orcid?: unknown;
  fname?: unknown;
  lname?: unknown;
}

export interface FacultyProjectionSummary {
  mode: 'dry-run' | 'apply';
  scanned: number;
  created: number;
  alreadyLinked: number;
  skippedOrganizationalMailbox: number;
  skippedUnresolvable: number;
  errors: number;
}

export interface FacultyProjectionDeps {
  isOrganizationalMailbox: (identity: CanonicalMemberIdentity) => boolean;
  resolveExisting: (identity: CanonicalMemberIdentity) => Promise<unknown>;
  resolveOrCreate: (identity: CanonicalMemberIdentity) => Promise<unknown>;
}

const trimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function buildFacultyMemberIdentity(
  user: FacultyUserIdentityInput,
): CanonicalMemberIdentity {
  const displayName = [trimmedString(user.fname), trimmedString(user.lname)]
    .filter(Boolean)
    .join(' ');
  return {
    netid: user.netid,
    email: user.email,
    orcid: user.orcid,
    displayName: displayName || undefined,
  };
}

export function emptyFacultyProjectionSummary(dryRun: boolean): FacultyProjectionSummary {
  return {
    mode: dryRun ? 'dry-run' : 'apply',
    scanned: 0,
    created: 0,
    alreadyLinked: 0,
    skippedOrganizationalMailbox: 0,
    skippedUnresolvable: 0,
    errors: 0,
  };
}

export async function projectSingleFacultyIdentity(
  identity: CanonicalMemberIdentity,
  summary: FacultyProjectionSummary,
  deps: FacultyProjectionDeps,
): Promise<void> {
  if (deps.isOrganizationalMailbox(identity)) {
    summary.skippedOrganizationalMailbox += 1;
    return;
  }
  const existing = await deps.resolveExisting(identity);
  if (summary.mode === 'dry-run') {
    if (existing) summary.alreadyLinked += 1;
    else summary.created += 1;
    return;
  }
  const resolved = await deps.resolveOrCreate(identity);
  if (!resolved) {
    summary.skippedUnresolvable += 1;
    return;
  }
  if (existing) summary.alreadyLinked += 1;
  else summary.created += 1;
}

const defaultProjectionDeps: FacultyProjectionDeps = {
  isOrganizationalMailbox: identityIsOrganizationalMailbox,
  resolveExisting: resolveCanonicalResearcherId,
  resolveOrCreate: resolveOrCreateResearcherIdForIdentity,
};

export const DEFAULT_PROJECTION_CONCURRENCY = 10;
export const MAX_PROJECTION_CONCURRENCY = 32;

export function clampProjectionConcurrency(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return DEFAULT_PROJECTION_CONCURRENCY;
  }
  return Math.min(Math.floor(value), MAX_PROJECTION_CONCURRENCY);
}

export async function forEachWithConcurrency<T>(
  source: AsyncIterable<T>,
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const inFlight = new Set<Promise<void>>();
  for await (const item of source) {
    const task = worker(item).finally(() => {
      inFlight.delete(task);
    });
    inFlight.add(task);
    if (inFlight.size >= limit) {
      await Promise.race(inFlight);
    }
  }
  await Promise.all(inFlight);
}

export async function projectActiveFacultyToResearchModel(
  options: { dryRun: boolean; limit?: number; concurrency?: number },
  deps: FacultyProjectionDeps = defaultProjectionDeps,
): Promise<FacultyProjectionSummary> {
  const summary = emptyFacultyProjectionSummary(options.dryRun);
  const concurrency = clampProjectionConcurrency(options.concurrency);
  const query = User.find(ACTIVE_FACULTY_PROJECTION_FILTER, {
    netid: 1,
    email: 1,
    orcid: 1,
    fname: 1,
    lname: 1,
  }).sort({ _id: 1 });
  if (options.limit) query.limit(options.limit);

  const cursor = query.lean().cursor();
  await forEachWithConcurrency(cursor, concurrency, async (user) => {
    summary.scanned += 1;
    const identity = buildFacultyMemberIdentity(user as FacultyUserIdentityInput);
    try {
      await projectSingleFacultyIdentity(identity, summary, deps);
    } catch (error) {
      summary.errors += 1;
      console.error('faculty new-model projection failed:', sanitizeLogValue(error));
    }
  });
  return summary;
}
