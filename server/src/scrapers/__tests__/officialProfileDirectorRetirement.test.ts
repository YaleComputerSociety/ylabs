import { describe, expect, it } from 'vitest';

import {
  buildCenterRosterHealthSnapshot,
  centerRosterReadAdmissibility,
  centerRosterReadFromSnapshot,
} from '../centerRosterRetirement';
import {
  governedEdgeProfileKey,
  judgeOfficialProfileDirectorEdges,
  officialProfileDirectorPassFrozen,
  officialProfileDirectorReadFromSnapshot,
  type OfficialProfileDirectorRead,
} from '../officialProfileDirectorRetirement';

const PROFILE_KEY = 'official-profile:https://medicine.yale.edu/profile/rowan-fixturedirector/';
const OTHER_KEY = 'official-profile:https://medicine.yale.edu/profile/quill-fixturecolleague/';

const snapshot = (overrides: { subjectKeys?: string[]; cacheAllowed?: boolean } = {}) =>
  buildCenterRosterHealthSnapshot({
    centerKey: 'fixture-row',
    entityKey: 'fixture-row',
    members: [],
    pagesRead: 1,
    readMode: 'html',
    stopReason: 'not-paginated',
    cacheAllowed: overrides.cacheAllowed ?? false,
    readAt: new Date('2026-10-18T00:00:00Z'),
    ...(overrides.subjectKeys ? { subjectKeys: overrides.subjectKeys } : {}),
  });

describe('the single-subject absence admitted on the centres snapshot contract (#5091)', () => {
  it('still refuses a roster read that lists nobody', () => {
    expect(centerRosterReadAdmissibility(snapshot())).toBe('read-listed-nobody');
  });

  it('admits a read whose subject parsed and stated nothing, for the single-subject lane only', () => {
    const read = snapshot({ subjectKeys: [PROFILE_KEY] });

    expect(centerRosterReadAdmissibility(read)).toBe('read-subject-stated-nothing');
    expect(centerRosterReadFromSnapshot(read, 'run-1', new Date())).toBeNull();
    expect(officialProfileDirectorReadFromSnapshot(read, 'run-1', new Date())).not.toBeNull();
  });

  it('refuses a cache-permitted single-subject read', () => {
    expect(
      centerRosterReadAdmissibility(snapshot({ subjectKeys: [PROFILE_KEY], cacheAllowed: true })),
    ).toBe('cache-permitted');
  });
});

describe('judgeOfficialProfileDirectorEdges', () => {
  const edge = {
    edgeId: 'edge-1',
    personId: 'person-1',
    role: 'DIRECTOR',
    profileKey: PROFILE_KEY,
    observedAt: new Date('2026-10-17T00:00:00Z'),
  };
  const read = (
    runId: string,
    hour: number,
    subject: string,
    stated: boolean,
  ): OfficialProfileDirectorRead => ({
    scrapeRunId: runId,
    observedAt: new Date(Date.UTC(2026, 9, 17, hour)),
    subjectKeys: new Set([subject]),
    statedProfileKeys: new Set(stated ? [subject] : []),
  });

  it('protects an edge another source still asserts', () => {
    expect(
      judgeOfficialProfileDirectorEdges({
        reads: [read('a', 1, PROFILE_KEY, false), read('b', 2, PROFILE_KEY, false)],
        edges: [edge],
        protectedPersonRoles: new Set(['person-1|DIRECTOR']),
      }),
    ).toEqual([{ edgeId: 'edge-1', verdict: 'protected' }]);
  });

  it('does not count two absent reads inside one run as two', () => {
    expect(
      judgeOfficialProfileDirectorEdges({
        reads: [read('a', 1, PROFILE_KEY, false), read('a', 2, PROFILE_KEY, false)],
        edges: [edge],
      }),
    ).toEqual([{ edgeId: 'edge-1', verdict: 'awaiting-second-read' }]);
  });

  it('leaves an edge no read of its own profile judged', () => {
    expect(
      judgeOfficialProfileDirectorEdges({
        reads: [read('a', 1, OTHER_KEY, false), read('b', 2, OTHER_KEY, false)],
        edges: [edge],
      }),
    ).toEqual([{ edgeId: 'edge-1', verdict: 'not-read' }]);
  });

  it('reads the edge profile from its membership key, falling back to its profile URL', () => {
    expect(governedEdgeProfileKey({ membershipKey: `${PROFILE_KEY}|director` })).toBe(PROFILE_KEY);
    expect(
      governedEdgeProfileKey({
        profileUrl: 'https://medicine.yale.edu/profile/rowan-fixturedirector/',
      }),
    ).toBe(PROFILE_KEY);
  });
});

describe('officialProfileDirectorPassFrozen', () => {
  it('never freezes a single retirement', () => {
    expect(officialProfileDirectorPassFrozen(1, 1)).toBe(false);
  });

  it('freezes a pass that would end most of the edges it judged', () => {
    expect(officialProfileDirectorPassFrozen(3, 4)).toBe(true);
    expect(officialProfileDirectorPassFrozen(2, 4)).toBe(false);
  });
});
