import { describe, expect, it } from 'vitest';
import {
  fieldValueRefusalKey,
  liveFieldValueRefusals,
  planOwnFieldValueRefusalWithdrawal,
  valueIsRefused,
} from '../../utils/researchEntityFieldValueRefusals';
import {
  isSharedRosterStageRefusal,
  planSharedRosterWebsiteRetirement,
  SHARED_ROSTER_WEBSITE_LANE,
  SHARED_ROSTER_WEBSITE_REFUSAL_NOTE,
  SHARED_ROSTER_WEBSITE_SCRIPT,
  SHARED_ROSTER_WEBSITE_STAGE,
  SHARED_ROSTER_WEBSITE_WITHDRAWAL_REASONS,
} from '../retireSharedRosterWebsitesCore';

const group = 'https://group.example.org/';
const claim = (id: string, entityKey: string, value: string, day = 1) => ({
  observationId: id,
  entityKey,
  value,
  observedAt: new Date(2026, 0, day),
});
const row = (
  slug: string,
  websiteUrl?: string,
  fieldValueRefusals?: unknown,
  manuallyLockedFields?: string[],
) => ({
  entityId: `id-${slug}`,
  slug,
  websiteUrl,
  fieldValueRefusals,
  manuallyLockedFields,
});

describe('planSharedRosterWebsiteRetirement', () => {
  const rowsBySlug = new Map([
    ['a', row('a', group)],
    ['b', row('b')],
    ['c', row('c', 'https://own.example.org/')],
  ]);

  it('retires a website the lane gave to two different people, and refuses it where nothing else supports it', () => {
    const outcome = planSharedRosterWebsiteRetirement({
      claims: [
        claim('o1', 'a', group),
        claim('o2', 'b', group),
        claim('o3', 'c', 'https://own.example.org/'),
      ],
      personKeyByEntityKey: new Map([
        ['a', 'p1'],
        ['b', 'p2'],
        ['c', 'p3'],
      ]),
      otherLaneSupport: new Set(),
      rowsBySlug,
    });
    expect(outcome.sharedUrls).toBe(1);
    expect(outcome.plans.map((plan) => [plan.slug, plan.refuse, plan.clearStored])).toEqual([
      ['a', true, true],
      ['b', true, false],
    ]);
  });

  it('keeps a shared website on a row another lane independently supports', () => {
    const outcome = planSharedRosterWebsiteRetirement({
      claims: [claim('o1', 'a', group), claim('o2', 'b', group)],
      personKeyByEntityKey: new Map([
        ['a', 'p1'],
        ['b', 'p2'],
      ]),
      otherLaneSupport: new Set([`a|${fieldValueRefusalKey('websiteUrl', group)}`]),
      rowsBySlug,
    });
    const a = outcome.plans.find((plan) => plan.slug === 'a')!;
    expect(a).toMatchObject({ refuse: false, clearStored: false, supersedeObservationIds: ['o1'] });
    expect(outcome.keptByOtherEvidence).toBe(1);
  });

  it('leaves one person listed twice alone', () => {
    const outcome = planSharedRosterWebsiteRetirement({
      claims: [claim('o1', 'a', group), claim('o2', 'b', group)],
      personKeyByEntityKey: new Map([
        ['a', 'p1'],
        ['b', 'p1'],
      ]),
      otherLaneSupport: new Set(),
      rowsBySlug,
    });
    expect(outcome.plans).toEqual([]);
  });

  it('judges every live claim, so retiring one shared URL cannot expose another', () => {
    const second = 'https://second-group.example.org/';
    const outcome = planSharedRosterWebsiteRetirement({
      claims: [
        claim('a-old', 'a', second, 1),
        claim('a-new', 'a', group, 2),
        claim('b1', 'b', group),
        claim('c1', 'c', second),
      ],
      personKeyByEntityKey: new Map([
        ['a', 'p1'],
        ['b', 'p2'],
        ['c', 'p3'],
      ]),
      otherLaneSupport: new Set(),
      rowsBySlug,
    });
    expect(outcome.sharedUrls).toBe(2);
    expect(outcome.plans.map((plan) => [plan.slug, plan.url]).sort()).toEqual(
      [
        ['a', group],
        ['a', second],
        ['b', group],
        ['c', second],
      ].sort(),
    );
    expect(outcome.plans.flatMap((plan) => plan.supersedeObservationIds).sort()).toEqual(
      ['a-new', 'a-old', 'b1', 'c1'].sort(),
    );
  });

  it('does not record a second refusal for a value already refused', () => {
    const refused = {
      websiteUrl: [{ valueKey: fieldValueRefusalKey('websiteUrl', group), rule: 'wrong_owner' }],
    };
    const outcome = planSharedRosterWebsiteRetirement({
      claims: [claim('o1', 'a', group), claim('o2', 'b', group)],
      personKeyByEntityKey: new Map([
        ['a', 'p1'],
        ['b', 'p2'],
      ]),
      otherLaneSupport: new Set(),
      rowsBySlug: new Map([
        ['a', row('a', undefined, refused)],
        ['b', row('b')],
      ]),
    });
    expect(outcome.plans.map((plan) => [plan.slug, plan.refuse])).toEqual([
      ['a', false],
      ['b', true],
    ]);
  });

  it('neither refuses nor clears a website an operator has locked, but still retires the lane claim', () => {
    const outcome = planSharedRosterWebsiteRetirement({
      claims: [claim('o1', 'a', group), claim('o2', 'b', group)],
      personKeyByEntityKey: new Map([
        ['a', 'p1'],
        ['b', 'p2'],
      ]),
      otherLaneSupport: new Set(),
      rowsBySlug: new Map([
        ['a', row('a', group, undefined, ['websiteUrl'])],
        ['b', row('b')],
      ]),
    });
    expect(
      outcome.plans.map((plan) => [
        plan.slug,
        plan.refuse,
        plan.clearStored,
        plan.supersedeObservationIds,
      ]),
    ).toEqual([
      ['a', false, false, ['o1']],
      ['b', true, false, ['o2']],
    ]);
  });
});

describe('re-deriving the refusals this stage wrote (#5838)', () => {
  const groupKey = fieldValueRefusalKey('websiteUrl', group);
  const operatorUrl = 'https://not-theirs.example.org/';
  const refusedAt = new Date(2026, 0, 5);
  const stageRefusal = {
    valueKey: groupKey,
    rule: 'wrong_owner',
    sourceName: SHARED_ROSTER_WEBSITE_LANE,
    refusedBy: SHARED_ROSTER_WEBSITE_SCRIPT,
    derivedBy: SHARED_ROSTER_WEBSITE_STAGE,
    refusedAt,
    note: SHARED_ROSTER_WEBSITE_REFUSAL_NOTE,
  };
  const legacyStageRefusal = { ...stageRefusal, derivedBy: undefined };
  const operatorRefusal = (url: string) => ({
    valueKey: fieldValueRefusalKey('websiteUrl', url),
    rule: 'wrong_owner',
    refusedBy: 'research-entity:refuse-field-value',
    refusedAt,
    note: 'an operator read the page and it belongs to someone else',
  });
  const people = new Map([
    ['a', 'p1'],
    ['b', 'p2'],
  ]);
  const plan = (rows: Array<ReturnType<typeof row>>, claims: ReturnType<typeof claim>[]) =>
    planSharedRosterWebsiteRetirement({
      claims,
      personKeyByEntityKey: people,
      otherLaneSupport: new Set(),
      rowsBySlug: new Map(rows.map((entry) => [entry.slug, entry])),
    });
  const applyWithdrawals = (
    rows: Array<ReturnType<typeof row>>,
    outcome: ReturnType<typeof planSharedRosterWebsiteRetirement>,
  ) =>
    rows.map((entry) => {
      let refusals = entry.fieldValueRefusals as Record<string, unknown> | undefined;
      for (const withdrawal of outcome.withdrawals.filter((w) => w.slug === entry.slug)) {
        const write = planOwnFieldValueRefusalWithdrawal(
          refusals,
          'websiteUrl',
          withdrawal.valueKey,
          isSharedRosterStageRefusal,
          SHARED_ROSTER_WEBSITE_WITHDRAWAL_REASONS[withdrawal.cause],
          new Date(2026, 0, 20),
        );
        refusals = { ...refusals, websiteUrl: write['fieldValueRefusals.websiteUrl'] };
      }
      return { ...entry, fieldValueRefusals: refusals };
    });

  it('clears its refusal when a newer lane read re-asserts the site and nobody shares it, while an operator refusal on the same field survives', () => {
    const rows = [
      row('a', undefined, { websiteUrl: [stageRefusal, operatorRefusal(operatorUrl)] }),
      row('b', undefined, { websiteUrl: [stageRefusal] }),
    ];
    const outcome = plan(rows, [claim('a-new', 'a', group, 10)]);
    expect(outcome.plans).toEqual([]);
    expect(outcome.withdrawals).toEqual([
      { entityId: 'id-a', slug: 'a', valueKey: groupKey, cause: 'lane_readmitted' },
    ]);
    expect(outcome.standingStageRefusals).toBe(1);

    const [a] = applyWithdrawals(rows, outcome);
    const refusals = (a.fieldValueRefusals as { websiteUrl: Array<Record<string, unknown>> })
      .websiteUrl;
    expect(refusals.find((r) => r.valueKey === groupKey)?.withdrawnAt).toEqual(
      new Date(2026, 0, 20),
    );
    expect(liveFieldValueRefusals(a.fieldValueRefusals, 'websiteUrl')).toEqual([
      operatorRefusal(operatorUrl),
    ]);
    expect(valueIsRefused(a.fieldValueRefusals, 'websiteUrl', group)).toBe(false);
    expect(valueIsRefused(a.fieldValueRefusals, 'websiteUrl', operatorUrl)).toBe(true);
  });

  it('never withdraws an operator refusal of the same value as its own', () => {
    const rows = [row('a', undefined, { websiteUrl: [stageRefusal, operatorRefusal(group)] })];
    const outcome = plan(rows, [claim('a-new', 'a', group, 10)]);
    expect(outcome.withdrawals.map((w) => w.slug)).toEqual(['a']);
    const [a] = applyWithdrawals(rows, outcome);
    expect(liveFieldValueRefusals(a.fieldValueRefusals, 'websiteUrl')).toEqual([
      operatorRefusal(group),
    ]);
    expect(valueIsRefused(a.fieldValueRefusals, 'websiteUrl', group)).toBe(true);
  });

  it('is a no-op on a second run', () => {
    const rows = [
      row('a', undefined, { websiteUrl: [stageRefusal, operatorRefusal(operatorUrl)] }),
      row('b', undefined, { websiteUrl: [stageRefusal] }),
    ];
    const claims = [claim('a-new', 'a', group, 10)];
    const first = plan(rows, claims);
    const second = plan(applyWithdrawals(rows, first), claims);
    expect(first.withdrawals).toHaveLength(1);
    expect(second.withdrawals).toEqual([]);
    expect(second.plans).toEqual([]);
    expect(second.standingStageRefusals).toBe(1);
  });

  it('keeps its refusal while the lane has not re-read the row since, because its own retirement is why no claim is live', () => {
    const rows = [row('a', undefined, { websiteUrl: [stageRefusal] })];
    expect(plan(rows, []).withdrawals).toEqual([]);
    expect(plan(rows, [claim('a-old', 'a', group, 1)]).withdrawals).toEqual([]);
    expect(plan(rows, []).standingStageRefusals).toBe(1);
  });

  it('keeps its refusal while the newer read still gives the site to two people', () => {
    const rows = [
      row('a', undefined, { websiteUrl: [stageRefusal] }),
      row('b', undefined, { websiteUrl: [stageRefusal] }),
    ];
    const outcome = plan(rows, [claim('a-new', 'a', group, 10), claim('b-new', 'b', group, 10)]);
    expect(outcome.withdrawals).toEqual([]);
    expect(outcome.plans.map((p) => [p.slug, p.refuse])).toEqual([
      ['a', false],
      ['b', false],
    ]);
  });

  it('clears its refusal when another lane now asserts the site for the row', () => {
    const outcome = planSharedRosterWebsiteRetirement({
      claims: [],
      personKeyByEntityKey: people,
      otherLaneSupport: new Set([`a|${groupKey}`]),
      rowsBySlug: new Map([['a', row('a', undefined, { websiteUrl: [stageRefusal] })]]),
    });
    expect(outcome.withdrawals.map((w) => [w.slug, w.cause])).toEqual([
      ['a', 'other_lane_support'],
    ]);
  });

  it('treats an unmarked refusal as its own only when every recorded field proves it', () => {
    const readmitted = [claim('a-new', 'a', group, 10)];
    expect(
      plan([row('a', undefined, { websiteUrl: [legacyStageRefusal] })], readmitted).withdrawals,
    ).toHaveLength(1);
    for (const notProven of [
      { ...legacyStageRefusal, note: 'an operator note' },
      { ...legacyStageRefusal, refusedBy: 'research-entity:refuse-field-value' },
      { ...legacyStageRefusal, sourceName: undefined },
      { ...legacyStageRefusal, rule: 'operator_judgement' },
      { ...stageRefusal, derivedBy: 'some-other-stage' },
    ]) {
      const outcome = plan([row('a', undefined, { websiteUrl: [notProven] })], readmitted);
      expect(outcome.withdrawals).toEqual([]);
      expect(outcome.standingStageRefusals).toBe(0);
    }
  });

  it('fails closed on a refusal with no recorded time, and leaves a locked row to the operator', () => {
    const readmitted = [claim('a-new', 'a', group, 10)];
    const untimed = { ...stageRefusal, refusedAt: undefined };
    expect(plan([row('a', undefined, { websiteUrl: [untimed] })], readmitted).withdrawals).toEqual(
      [],
    );
    expect(
      plan([row('a', undefined, { websiteUrl: [stageRefusal] }, ['websiteUrl'])], readmitted)
        .withdrawals,
    ).toEqual([]);
  });
});
