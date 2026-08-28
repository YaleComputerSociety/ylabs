import { describe, expect, it } from 'vitest';
import { planUnattachedResearcherPrune } from '../pruneUnattachedResearchersCore';

describe('planUnattachedResearcherPrune', () => {
  it('deletes no-role researchers and their dead accounts, keeping attached and dedupe-involved ones', () => {
    const plan = planUnattachedResearcherPrune({
      researchers: [
        { id: 'attached', accountId: 'accA', displayName: 'Attached PI', hasDedupedInto: false },
        { id: 'norole1', accountId: 'accB', displayName: 'Dangling One', hasDedupedInto: false },
        { id: 'norole2', accountId: 'accC', displayName: 'Dangling Two', hasDedupedInto: false },
        { id: 'target', accountId: 'accD', displayName: 'Dedupe Target', hasDedupedInto: false },
        { id: 'tombstone', accountId: 'accE', displayName: 'Merged Away', hasDedupedInto: true },
      ],
      rolePersonIds: ['attached'],
      dedupeTargetIds: ['target'],
      accountsWithLogin: [],
    });

    expect(plan.researcherIdsToDelete.sort()).toEqual(['norole1', 'norole2']);
    expect(plan.accountIdsToDelete.sort()).toEqual(['accB', 'accC']);
    expect(plan.attached).toBe(1);
    expect(plan.dedupeInvolved).toBe(2);
  });

  it('retains an account with a real login even when its researcher is unattached', () => {
    const plan = planUnattachedResearcherPrune({
      researchers: [
        { id: 'noroleLoggedIn', accountId: 'accLogin', hasDedupedInto: false },
      ],
      rolePersonIds: [],
      dedupeTargetIds: [],
      accountsWithLogin: ['accLogin'],
    });

    expect(plan.researcherIdsToDelete).toEqual(['noroleLoggedIn']);
    expect(plan.accountIdsToDelete).toEqual([]);
    expect(plan.accountsRetainedForLogin).toBe(1);
  });

  it('never deletes an account still shared by a surviving researcher', () => {
    const plan = planUnattachedResearcherPrune({
      researchers: [
        { id: 'attached', accountId: 'shared', hasDedupedInto: false },
        { id: 'norole', accountId: 'shared', hasDedupedInto: false },
      ],
      rolePersonIds: ['attached'],
      dedupeTargetIds: [],
      accountsWithLogin: [],
    });

    expect(plan.researcherIdsToDelete).toEqual(['norole']);
    expect(plan.accountIdsToDelete).toEqual([]);
  });
});
