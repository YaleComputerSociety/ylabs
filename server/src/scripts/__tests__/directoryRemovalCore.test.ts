import { describe, expect, it } from 'vitest';
import {
  countDirectoryRemovalReach,
  digestForRemoval,
  parseDirectoryRemovalArgs,
} from '../directoryRemovalCore';

const KEY = 'synthetic-directory-removal-key-0123456789';

describe('parseDirectoryRemovalArgs', () => {
  it('is a dry run unless --apply is given', () => {
    expect(parseDirectoryRemovalArgs(['--kind=netid'])).toEqual({
      kind: 'netid',
      apply: false,
      withdrawReason: undefined,
    });
    expect(parseDirectoryRemovalArgs(['--kind=name', '--apply']).apply).toBe(true);
  });

  it('refuses an identifier on the command line', () => {
    expect(() => parseDirectoryRemovalArgs(['--kind=netid', '--value=zz9001'])).toThrow(
      /standard input/,
    );
  });

  it('requires a known kind and a known withdrawal reason', () => {
    expect(() => parseDirectoryRemovalArgs([])).toThrow(/--kind is required/);
    expect(() => parseDirectoryRemovalArgs(['--kind=slug'])).toThrow(/--kind must be one of/);
    expect(() => parseDirectoryRemovalArgs(['--kind=netid', '--withdraw=because'])).toThrow(
      /--withdraw must name a reason/,
    );
    expect(
      parseDirectoryRemovalArgs(['--kind=netid', '--withdraw=requester_withdrew']).withdrawReason,
    ).toBe('requester_withdrew');
  });
});

describe('countDirectoryRemovalReach', () => {
  it('counts the matched person, their live edges by role, and rosters naming a removed name', () => {
    const reach = countDirectoryRemovalReach({
      key: KEY,
      digest: digestForRemoval(KEY, 'netid', 'zz9001'),
      researchers: [
        { _id: 'r1', identifiers: { netid: 'zz9001' } },
        { _id: 'r2', identifiers: { netid: 'zz9002' } },
      ],
      liveRoleEdges: [
        { personId: 'r1', role: 'PRINCIPAL_INVESTIGATOR' },
        { personId: 'r1', role: 'CORE_FACULTY' },
        { personId: 'r2', role: 'PRINCIPAL_INVESTIGATOR' },
      ],
      undergraduateRosters: [{ names: ['Synthetic Student'] }],
    });
    expect(reach).toEqual({
      liveResearchersMatched: 1,
      liveRoleEdgesByRole: { PRINCIPAL_INVESTIGATOR: 1, CORE_FACULTY: 1 },
      rowsNamingUndergraduate: 0,
    });

    const nameReach = countDirectoryRemovalReach({
      key: KEY,
      digest: digestForRemoval(KEY, 'name', 'Synthetic Student'),
      researchers: [],
      liveRoleEdges: [],
      undergraduateRosters: [
        { names: ['synthetic student', 'Synthetic Peer'] },
        { names: ['Synthetic Peer'] },
      ],
    });
    expect(nameReach.rowsNamingUndergraduate).toBe(1);
  });

  it('refuses a value that normalizes to nothing', () => {
    expect(() => digestForRemoval(KEY, 'profile_url', 'not a url')).toThrow(
      /normalizes to nothing/,
    );
  });
});
