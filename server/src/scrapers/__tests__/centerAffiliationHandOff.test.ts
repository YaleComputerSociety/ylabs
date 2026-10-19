import { describe, expect, it } from 'vitest';
import {
  planCenterAffiliationHandOff,
  samePersonInEitherOrder,
  type CenterAffiliationCodeRead,
  type CenterAffiliationLlmClaim,
} from '../centerAffiliationHandOff';
import {
  centerRosterReadAdmissibility,
  type CenterRosterHealthSnapshot,
} from '../centerRosterRetirement';
import {
  preferredRelationshipObservations,
  rowServingListedLabWebsite,
} from '../entityMaterializer';
import { centerAffiliationRosterObservations } from '../sources/centerAffiliationRosterScraper';

const CENTER = 'center-fixture';
const at = (minute: number) => new Date(Date.UTC(2026, 9, 19, 12, minute));
const fra = (slug: string) => `faculty-research-area-${slug}`;
const key = (target: string) => `${CENTER}:${target}:MEMBER_RESEARCH_AREA`;

const claim = (target: string, overrides: Partial<CenterAffiliationLlmClaim> = {}) => ({
  relationshipKey: key(target),
  targetEntityKey: target,
  targetId: null,
  observedAt: at(0),
  observationIds: ['obs'],
  ...overrides,
});

const read = (
  targets: string[],
  targetIds: string[] = [],
  minute = 10,
): CenterAffiliationCodeRead => ({
  observedAt: at(minute),
  relationshipKeys: new Set(targets.map(key)),
  targetIds: new Set(targetIds),
});

describe('planCenterAffiliationHandOff', () => {
  it('re-attributes a claim the read lists under the same key or the same target', () => {
    const plan = planCenterAffiliationHandOff({
      reads: [read([fra('ada-fixture')], ['row-b'])],
      llmClaims: [claim(fra('ada-fixture')), claim(fra('bob-q-fixture'), { targetId: 'row-b' })],
    });
    expect(plan.reattributed).toHaveLength(2);
    expect(plan.handedOff).toHaveLength(0);
  });

  it('re-attributes a surname-first or credentialed claim of a listed person', () => {
    const plan = planCenterAffiliationHandOff({
      reads: [read([fra('ada-fixture')])],
      llmClaims: [claim(fra('fixture-ada')), claim(fra('ada-fixture-md-phd'))],
    });
    expect(plan.reattributed).toHaveLength(2);
  });

  it('keeps a claim of a listed person that resolved to a row the read does not reach', () => {
    const plan = planCenterAffiliationHandOff({
      reads: [read([fra('ada-fixture')])],
      llmClaims: [claim(fra('fixture-ada'), { targetId: 'row-a' })],
    });
    expect(plan.supportedKept).toBe(1);
    expect(plan.reattributed).toHaveLength(0);
    expect(plan.handedOff).toHaveLength(0);
  });

  it('hands off a claim the latest later read does not list', () => {
    const plan = planCenterAffiliationHandOff({
      reads: [read([fra('bob-fixture')], [], 5), read([fra('ada-fixture')], [], 20)],
      llmClaims: [claim(fra('bob-fixture'), { targetId: 'row-b' })],
    });
    expect(plan.handedOff.map((entry) => entry.targetEntityKey)).toEqual([fra('bob-fixture')]);
  });

  it('waits for a code-lane read made after the claim', () => {
    const plan = planCenterAffiliationHandOff({
      reads: [read([fra('ada-fixture')], [], 5)],
      llmClaims: [claim(fra('bob-fixture'), { observedAt: at(30) })],
    });
    expect(plan.awaitingRead).toBe(1);
    expect(plan.handedOff).toHaveLength(0);
  });
});

describe('samePersonInEitherOrder', () => {
  it('matches first and last tokens in either order and never a lone token', () => {
    expect(samePersonInEitherOrder(fra('ada-q-fixture'), fra('fixture-ada'))).toBe(true);
    expect(samePersonInEitherOrder(fra('ada-fixture'), fra('ada-other'))).toBe(false);
    expect(samePersonInEitherOrder(fra('fixture'), fra('fixture'))).toBe(false);
    expect(samePersonInEitherOrder('listed-lab-prism-lab', 'listed-lab-prism-lab')).toBe(false);
  });
});

describe('centerAffiliationRosterObservations', () => {
  const page = (body: string) => ({
    url: 'https://fixture.example.edu/people/',
    html: `<html><body><main>${body}</main></body></html>`,
  });

  it('emits relationships and an admitted snapshot for a listed read', () => {
    const { outcome, observations } = centerAffiliationRosterObservations({
      centerEntityKey: CENTER,
      readAt: at(0),
      page: page(`<h2>Faculty</h2><ul><li>Ada Fixture, Professor of Synthetic Studies</li></ul>
        <div class="custom-card-collection"><h2 class="custom-card-collection__heading">Labs</h2>
        <ul><li class="custom-card"><h3 class="custom-card__heading"><a class="custom-card__heading-link"
          href="https://fixture.example.edu/prism-lab/">Prism Lab</a></h3></li></ul></div>`),
    });
    expect(outcome).toBe('listed');
    const snapshot = observations.find((row) => row.entityType === 'centerRosterHealth');
    expect(centerRosterReadAdmissibility(snapshot?.value as CenterRosterHealthSnapshot)).toBe(
      'read-listed-members',
    );
    const targets = observations
      .filter((row) => row.field === 'targetEntityKey')
      .map((row) => row.value);
    expect(targets).toEqual([fra('ada-fixture'), 'listed-lab-prism-lab']);
    expect(
      observations.find(
        (row) => row.entityKey?.includes('listed-lab-') && row.field === 'targetWebsiteUrl',
      )?.value,
    ).toBe('https://fixture.example.edu/prism-lab/');
  });

  it('emits nothing, not even a snapshot, for a read that is not listed', () => {
    const { outcome, observations } = centerAffiliationRosterObservations({
      centerEntityKey: CENTER,
      readAt: at(0),
      page: page(`<p>${'The fixture center studies lattices across many fields. '.repeat(6)}</p>`),
    });
    expect(outcome).toBe('prose-only');
    expect(observations).toEqual([]);
  });
});

describe('rowServingListedLabWebsite', () => {
  const model = (rows: Array<{ _id: string; entityType: string }>) =>
    ({
      find: (filter: any) => ({
        limit: () => ({
          lean: async () =>
            rows.filter((row) => !filter.entityType.$nin.includes(row.entityType)).slice(0, 2),
        }),
      }),
    }) as any;
  const identity = {
    targetEntityKey: 'listed-lab-prism-lab',
    targetWebsiteUrl: 'https://fixture.example.edu/prism-lab/',
  };

  it('takes the one non-organization row serving the site', async () => {
    const resolved = await rowServingListedLabWebsite(
      model([{ _id: 'lab', entityType: 'LAB' }]),
      identity,
    );
    expect(resolved?._id).toBe('lab');
  });

  it('refuses two rows at the site, an organization row, and a missing site', async () => {
    expect(
      await rowServingListedLabWebsite(
        model([
          { _id: 'one', entityType: 'LAB' },
          { _id: 'two', entityType: 'FACULTY_RESEARCH_AREA' },
        ]),
        identity,
      ),
    ).toBeNull();
    expect(
      await rowServingListedLabWebsite(model([{ _id: 'org', entityType: 'CENTER' }]), identity),
    ).toBeNull();
    expect(
      await rowServingListedLabWebsite(model([{ _id: 'lab', entityType: 'LAB' }]), {
        targetEntityKey: identity.targetEntityKey,
      }),
    ).toBeNull();
  });
});

describe('preferredRelationshipObservations', () => {
  it('lets the code lane alone decide a relationship it observes', () => {
    const rows = [
      { sourceName: 'center-affiliation-llm', field: 'targetEntityKey' },
      { sourceName: 'center-affiliation-roster', field: 'targetEntityKey' },
    ];
    expect(preferredRelationshipObservations(rows)).toEqual([rows[1]]);
    expect(preferredRelationshipObservations([rows[0]])).toEqual([rows[0]]);
  });
});
