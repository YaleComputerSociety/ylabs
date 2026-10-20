/**
 * The record each `center-director` read leaves, on the centres `centerRosterHealth` contract.
 *
 * Kept apart from the lane and from `centerDirectorRetirement.ts` because both read it and
 * the retirement module must not import a module in `sources/`, which imports it back.
 *
 * `members` lists every person the read pages state as a director of the unit at any rank,
 * including the people a tie refused, and `settledDirector` is the one the lane named, or
 * null. A read that fetched no page leaves no record, so a fetch failure is never evidence.
 */
import {
  buildCenterRosterHealthSnapshot,
  CENTER_ROSTER_HEALTH_ENTITY_TYPE,
  CENTER_ROSTER_HEALTH_FIELD,
  snapshotMembers,
  type CenterRosterHealthSnapshot,
} from './centerRosterRetirement';
import type { ObservationInput } from './types';

export const CENTER_DIRECTOR_SOURCE_NAME = 'center-director';

export type DirectorReadRole = 'director' | 'co-director';

export interface NamedDirector {
  name: string;
  role: DirectorReadRole;
}

export interface CenterDirectorReadSnapshot extends CenterRosterHealthSnapshot {
  settledDirector?: unknown;
}

export interface CodeLaneDirectorRead {
  scrapeRunId: string;
  observedAt: Date;
  settled: NamedDirector | null;
  stated: NamedDirector[];
}

const textOf = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const roleOf = (value: unknown): DirectorReadRole =>
  value === 'co-director' ? 'co-director' : 'director';

export function centerDirectorReadSnapshotObservation(input: {
  centerEntityKey: string;
  sourceUrl: string;
  stated: readonly NamedDirector[];
  settled: NamedDirector | null;
  pagesRead: number;
  cacheAllowed: boolean;
  readAt: Date;
}): ObservationInput {
  const value: CenterDirectorReadSnapshot = {
    ...buildCenterRosterHealthSnapshot({
      centerKey: input.centerEntityKey,
      entityKey: input.centerEntityKey,
      members: input.stated.map((person) => ({ memberKey: person.name, role: person.role })),
      pagesRead: input.pagesRead,
      readMode: 'html',
      stopReason: 'not-paginated',
      cacheAllowed: input.cacheAllowed,
      readAt: input.readAt,
    }),
    settledDirector: input.settled ? { name: input.settled.name, role: input.settled.role } : null,
  };
  return {
    entityType: CENTER_ROSTER_HEALTH_ENTITY_TYPE,
    entityKey: input.centerEntityKey,
    field: CENTER_ROSTER_HEALTH_FIELD,
    value,
    sourceUrl: input.sourceUrl,
  };
}

/**
 * A read counts when it fetched at least one page outside the snapshot cache. Unlike a
 * roster read, a read that states nobody is admitted: the code lane is deterministic, so
 * a page that states no director is evidence that the page supports none.
 */
export function codeLaneDirectorReadFromSnapshot(
  snapshot: CenterDirectorReadSnapshot,
  scrapeRunId: string,
  observedAt: Date,
): CodeLaneDirectorRead | null {
  const read = snapshot.read;
  if (!read || typeof read !== 'object') return null;
  if (typeof read.pagesRead !== 'number' || read.pagesRead <= 0) return null;
  if (read.cacheAllowed !== false || !Array.isArray(snapshot.members)) return null;
  const settledValue = snapshot.settledDirector as { name?: unknown; role?: unknown } | null;
  const settledName = textOf(settledValue?.name);
  return {
    scrapeRunId,
    observedAt,
    settled: settledName ? { name: settledName, role: roleOf(settledValue?.role) } : null,
    stated: snapshotMembers(snapshot).map((member) => ({
      name: member.memberKey,
      role: roleOf(member.role),
    })),
  };
}
