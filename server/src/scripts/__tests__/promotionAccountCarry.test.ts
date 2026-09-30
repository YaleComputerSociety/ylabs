import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { planAccountCarry } from '../promotionAccountCarry';

const promotedId = new ObjectId('68f0000000000000000000a1');
const productionTwinId = new ObjectId('68f0000000000000000000a2');
const loginOnlyId = new ObjectId('68f0000000000000000000a3');
const planOwnerId = new ObjectId('68f0000000000000000000a4');
const staleId = new ObjectId('68f0000000000000000000a5');
const lastLoginAt = new Date('2026-09-20T12:00:00Z');

const promotedAccounts = [
  { _id: promotedId, netid: 'rs111', email: 'rs111@yale.edu', status: 'ACTIVE' },
];

describe('planAccountCarry', () => {
  it('carries only accounts with Production login evidence', () => {
    const plan = planAccountCarry({
      productionAccounts: [
        { _id: loginOnlyId, netid: 'st222', lastLoginAt },
        { _id: planOwnerId, netid: 'st333' },
        { _id: staleId, netid: 'st444' },
      ],
      promotedAccounts,
      planOwnerIds: new Set([String(planOwnerId)]),
    });

    expect(plan.inserts.map((row) => row._id)).toEqual([loginOnlyId, planOwnerId]);
    expect(plan.rekeys).toEqual([]);
    expect(plan.refreshes).toEqual([]);
  });

  it('keeps the Production _id when Beta holds the same netid under another _id', () => {
    const plan = planAccountCarry({
      productionAccounts: [{ _id: productionTwinId, netid: 'rs111', lastLoginAt }],
      promotedAccounts,
      planOwnerIds: new Set(),
    });

    expect(plan.inserts).toEqual([]);
    expect(plan.rekeys).toEqual([
      {
        fromId: promotedId,
        document: { ...promotedAccounts[0], _id: productionTwinId, lastLoginAt },
      },
    ]);
  });

  it('refreshes login fields onto a promoted row that shares the Production _id', () => {
    const profile = { userType: 'undergraduate' };
    const plan = planAccountCarry({
      productionAccounts: [{ _id: promotedId, netid: 'rs111', lastLoginAt, profile }],
      promotedAccounts,
      planOwnerIds: new Set(),
    });

    expect(plan.refreshes).toEqual([{ _id: promotedId, set: { lastLoginAt, profile } }]);
    expect(plan.inserts).toEqual([]);
    expect(plan.rekeys).toEqual([]);
  });
});
