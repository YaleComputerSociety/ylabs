import { beforeEach, describe, expect, it, vi } from 'vitest';

const researcherFind = vi.hoisted(() => vi.fn());
const researcherFindById = vi.hoisted(() => vi.fn());
const roleAssignmentFindOne = vi.hoisted(() => vi.fn());

vi.mock('../../models/researcher', () => ({
  Researcher: { find: researcherFind, findById: researcherFindById },
}));

vi.mock('../../models/roleAssignment', () => ({
  RoleAssignment: { findOne: roleAssignmentFindOne },
}));

import {
  loadKnownPersonSurnameRoster,
  loadResearchEntityLeadPersonName,
  resetKnownPersonSurnameRosterCache,
} from '../researchHomeNameIdentityRoster';

const selectLean = (value: unknown) => ({ select: () => ({ lean: async () => value }) });

describe('loadKnownPersonSurnameRoster', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetKnownPersonSurnameRosterCache();
  });

  it('builds the surname vocabulary from researcher display names', async () => {
    researcherFind.mockReturnValue(
      selectLean([{ displayName: 'Priya Raman' }, { displayName: 'Avery T. Sloan' }]),
    );
    expect(await loadKnownPersonSurnameRoster()).toEqual(new Set(['raman', 'sloan']));
  });

  // A sweep materializes thousands of records and every one of them asks for the
  // roster, so reading the corpus once per record is the cost this cache exists to
  // avoid (#2369).
  it('reads the corpus once and serves the cached roster after that', async () => {
    researcherFind.mockReturnValue(selectLean([{ displayName: 'Priya Raman' }]));
    await loadKnownPersonSurnameRoster();
    await loadKnownPersonSurnameRoster();
    expect(researcherFind).toHaveBeenCalledTimes(1);
  });

  it('re-reads the corpus after a reset', async () => {
    researcherFind.mockReturnValue(selectLean([{ displayName: 'Priya Raman' }]));
    await loadKnownPersonSurnameRoster();
    resetKnownPersonSurnameRosterCache();
    await loadKnownPersonSurnameRoster();
    expect(researcherFind).toHaveBeenCalledTimes(2);
  });
});

describe('loadResearchEntityLeadPersonName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves the lead display name behind the role edge', async () => {
    roleAssignmentFindOne.mockReturnValue(selectLean({ personId: 'a'.repeat(24) }));
    researcherFindById.mockReturnValue(selectLean({ displayName: 'Priya Raman' }));
    expect(await loadResearchEntityLeadPersonName('b'.repeat(24))).toBe('Priya Raman');
  });

  it('returns nothing when no lead edge exists, so the caller keeps key-only identity', async () => {
    roleAssignmentFindOne.mockReturnValue(selectLean(null));
    expect(await loadResearchEntityLeadPersonName('b'.repeat(24))).toBe('');
  });

  it('never queries for a record with no id', async () => {
    expect(await loadResearchEntityLeadPersonName(undefined)).toBe('');
    expect(roleAssignmentFindOne).not.toHaveBeenCalled();
  });
});
