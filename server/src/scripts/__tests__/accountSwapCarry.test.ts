import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { planAccountCarry } from '../accountSwapCarry';

const promotedId = new ObjectId('68f0000000000000000000a1');
const productionTwinId = new ObjectId('68f0000000000000000000a2');
const loginOnlyId = new ObjectId('68f0000000000000000000a3');
const planOwnerId = new ObjectId('68f0000000000000000000a4');
const staleId = new ObjectId('68f0000000000000000000a5');
const lastLoginAt = new Date('2026-09-20T12:00:00Z');

const promotedAccounts = [
  {
    _id: promotedId,
    netid: 'fixture-researcher',
    email: 'fixture-researcher@yale.edu',
    status: 'ACTIVE',
  },
];

describe('planAccountCarry', () => {
  it('carries only accounts with Production login evidence', () => {
    const plan = planAccountCarry({
      productionAccounts: [
        { _id: loginOnlyId, netid: 'fixture-login-holder', lastLoginAt },
        { _id: planOwnerId, netid: 'fixture-plan-owner' },
        { _id: staleId, netid: 'fixture-no-evidence' },
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
      productionAccounts: [{ _id: productionTwinId, netid: 'fixture-researcher', lastLoginAt }],
      promotedAccounts,
      planOwnerIds: new Set(),
    });

    expect(plan.inserts).toEqual([]);
    expect(plan.rekeys).toEqual([
      {
        fromId: promotedId,
        document: { ...promotedAccounts[0], _id: productionTwinId, lastLoginAt },
        replacesPseudonym: false,
      },
    ]);
  });

  it('refreshes login fields onto a promoted row that shares the Production _id', () => {
    const profile = { userType: 'undergraduate' };
    const plan = planAccountCarry({
      productionAccounts: [{ _id: promotedId, netid: 'fixture-researcher', lastLoginAt, profile }],
      promotedAccounts,
      planOwnerIds: new Set(),
    });

    expect(plan.refreshes).toEqual([{ _id: promotedId, set: { lastLoginAt, profile } }]);
    expect(plan.inserts).toEqual([]);
    expect(plan.rekeys).toEqual([]);
  });

  it('restores the target row over a pseudonym the mirror minted under the same _id', () => {
    const targetLogin = {
      _id: promotedId,
      netid: 'fixture-login-holder',
      email: 'fixture-login-holder@yale.edu',
      lastLoginAt,
    };
    const plan = planAccountCarry({
      productionAccounts: [targetLogin],
      promotedAccounts: [
        {
          _id: promotedId,
          netid: `mirrored-${promotedId.toHexString()}`,
          email: `mirrored-${promotedId.toHexString()}@example.invalid`,
        },
      ],
      planOwnerIds: new Set(),
    });

    expect(plan.restores).toEqual([targetLogin]);
    expect(plan.refreshes).toEqual([]);
    expect(plan.rekeys).toEqual([]);
    expect(plan.inserts).toEqual([]);
  });

  it('re-keys a same-netid source row onto a target login the source holds as a pseudonym', () => {
    const targetLogin = { _id: productionTwinId, netid: 'fixture-researcher', lastLoginAt };
    const plan = planAccountCarry({
      productionAccounts: [targetLogin],
      promotedAccounts: [
        ...promotedAccounts,
        {
          _id: productionTwinId,
          netid: `mirrored-${productionTwinId.toHexString()}`,
          email: `mirrored-${productionTwinId.toHexString()}@example.invalid`,
        },
      ],
      planOwnerIds: new Set(),
    });

    expect(plan.rekeys).toEqual([
      {
        fromId: promotedId,
        document: { ...promotedAccounts[0], _id: productionTwinId, lastLoginAt },
        replacesPseudonym: true,
      },
    ]);
    expect(plan.restores).toEqual([]);
    expect(plan.inserts).toEqual([]);
  });

  it('keeps the Production sessionVersion when refreshing a promoted row that shares its _id', () => {
    const plan = planAccountCarry({
      productionAccounts: [
        { _id: promotedId, netid: 'fixture-researcher', lastLoginAt, sessionVersion: 3 },
      ],
      promotedAccounts,
      planOwnerIds: new Set(),
    });

    expect(plan.refreshes).toEqual([{ _id: promotedId, set: { lastLoginAt, sessionVersion: 3 } }]);
  });

  it('keeps the Production sessionVersion when re-keying a same-netid promoted row', () => {
    const plan = planAccountCarry({
      productionAccounts: [
        { _id: productionTwinId, netid: 'fixture-researcher', lastLoginAt, sessionVersion: 2 },
      ],
      promotedAccounts,
      planOwnerIds: new Set(),
    });

    expect(plan.rekeys.map((rekey) => rekey.document.sessionVersion)).toEqual([2]);
  });
});
