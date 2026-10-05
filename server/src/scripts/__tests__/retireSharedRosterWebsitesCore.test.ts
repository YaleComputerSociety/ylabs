import { describe, expect, it } from 'vitest';
import { fieldValueRefusalKey } from '../../utils/researchEntityFieldValueRefusals';
import { planSharedRosterWebsiteRetirement } from '../retireSharedRosterWebsitesCore';

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
