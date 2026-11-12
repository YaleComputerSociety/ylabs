import { describe, expect, it } from 'vitest';
import {
  buildLabSiteLeadVerification,
  perLeadVerdicts,
  unreachableLabSiteVerification,
  type LabSiteLeadCandidate,
} from '../../scrapers/utils/labSiteLeadVerification';
import {
  LEAD_VERIFICATION_UNMEASURED,
  benchmarkDescendsFrom,
  scoreLeadVerificationPerLead,
  scoresLeadVerification,
  type OwnerLeadLabel,
  type PlannedObservation,
} from '../laneScorecardCore';

const observedAt = new Date('2026-10-05T00:00:00Z');

const lead = (personId: string, displayName: string): LabSiteLeadCandidate => ({
  personId,
  role: 'PI',
  displayName,
  officialProfileUrls: [],
});

const observation = (entityKey: string, value: unknown): PlannedObservation => ({
  entityType: 'researchEntity',
  entityKey,
  field: 'leadVerification',
  value,
});

const site = (html: string, website = 'https://lab.example.org/') => ({
  website,
  visitedUrls: [website],
  html,
});

function syntheticReplay(): PlannedObservation[] {
  return [
    observation(
      'row-confirmed',
      buildLabSiteLeadVerification(
        [lead('p-1', 'Avery Quill')],
        site('<p>The Quill group is led by Avery Quill.</p>'),
        observedAt,
      ),
    ),
    observation(
      'row-contradicted',
      buildLabSiteLeadVerification(
        [lead('p-2', 'Blake Fenwick')],
        site(
          '<p>Welcome to the lab of Morgan Fenwick.</p><a href="/lab/fenwick/profile/morgan-fenwick/">Morgan</a>',
          'https://medicine.example.org/lab/fenwick/',
        ),
        observedAt,
      ),
    ),
    observation(
      'row-unstated',
      buildLabSiteLeadVerification(
        [lead('p-3', 'Casey Orrin'), lead('p-4', 'Drew Paxley')],
        site('<p>We study tide pools.</p>'),
        observedAt,
      ),
    ),
    observation(
      'row-unreachable',
      unreachableLabSiteVerification('https://gone.example.org/', observedAt, 404),
    ),
    {
      entityType: 'researchEntity',
      entityKey: 'row-confirmed',
      field: 'sourceUrls',
      value: ['x'],
    },
  ];
}

describe('perLeadVerdicts', () => {
  it('yields one row per judged lead and none for an unreachable site', () => {
    const [confirmed, , unstated, unreachable] = syntheticReplay();
    expect(perLeadVerdicts('row-confirmed', confirmed.value)).toEqual([
      {
        entityKey: 'row-confirmed',
        personId: 'p-1',
        role: 'PI',
        verdict: 'CONFIRMED',
        matchedBy: 'NAMED_ON_PAGE',
        rowState: 'verified',
      },
    ]);
    expect(perLeadVerdicts('row-unstated', unstated.value).map((row) => row.verdict)).toEqual([
      'UNSTATED',
      'UNSTATED',
    ]);
    expect(perLeadVerdicts('row-unreachable', unreachable.value)).toEqual([]);
  });

  it('ignores a malformed value rather than guessing a verdict', () => {
    expect(perLeadVerdicts('row', { state: 'bogus', leads: [] })).toEqual([]);
    expect(perLeadVerdicts('row', { state: 'unstated', leads: [{ verdict: 'UNSTATED' }] })).toEqual(
      [],
    );
    expect(perLeadVerdicts('', { state: 'unstated', leads: [] })).toEqual([]);
  });
});

describe('scoreLeadVerificationPerLead (#4941)', () => {
  it('only scores the lead verification lane', () => {
    expect(scoresLeadVerification('lab-site-lead-verification')).toBe(true);
    expect(scoresLeadVerification('dept-faculty-roster')).toBe(false);
  });

  it('reports every lead and leaves precision unmeasured without owner labels', () => {
    const score = scoreLeadVerificationPerLead(syntheticReplay());
    expect(score.rows).toEqual({
      verified: 1,
      partial: 0,
      contradicted: 1,
      unstated: 1,
      unreachable: 1,
    });
    expect(score.leads).toEqual({ CONFIRMED: 1, CONTRADICTED: 1, UNSTATED: 2 });
    expect(score.perLead.map((row) => `${row.entityKey}:${row.personId}`)).toEqual([
      'row-confirmed:p-1',
      'row-contradicted:p-2',
      'row-unstated:p-3',
      'row-unstated:p-4',
    ]);
    expect(score.precision).toBe(LEAD_VERIFICATION_UNMEASURED);
  });

  it('never reads the lane verdicts themselves as labels', () => {
    const asIfLabelled = scoreLeadVerificationPerLead(syntheticReplay(), []);
    expect(asIfLabelled.precision).toBe('unmeasured: no owner labels');
  });

  it('scores confirmed and contradicted verdicts against the owner, and splits unstated', () => {
    const labels: OwnerLeadLabel[] = [
      { entityKey: 'row-confirmed', personId: 'p-1', ownerVerdict: 'correct_lead' },
      { entityKey: 'row-contradicted', personId: 'p-2', ownerVerdict: 'correct_lead' },
      { entityKey: 'row-unstated', personId: 'p-3', ownerVerdict: 'not_the_lead' },
      { entityKey: 'row-unstated', personId: 'p-4', ownerVerdict: 'cant_tell' },
      { entityKey: 'row-gone', personId: 'p-9', ownerVerdict: 'correct_lead' },
    ];
    const score = scoreLeadVerificationPerLead(syntheticReplay(), labels);
    expect(score.precision).toEqual({
      ownerLabels: 5,
      labelsNotReplayed: 1,
      leadsUnlabelled: 0,
      cantTell: 1,
      confirmed: { judged: 1, agreed: 1, precision: 1 },
      contradicted: { judged: 1, agreed: 0, precision: 0 },
      unstated: { judged: 1, correctLead: 0, notTheLead: 1 },
    });
  });

  it('reports a null precision when no judged lead carries the verdict', () => {
    const score = scoreLeadVerificationPerLead(syntheticReplay(), [
      { entityKey: 'row-unstated', personId: 'p-3', ownerVerdict: 'correct_lead' },
    ]);
    expect(score.precision).toMatchObject({
      leadsUnlabelled: 3,
      confirmed: { judged: 0, agreed: 0, precision: null },
      contradicted: { judged: 0, agreed: 0, precision: null },
      unstated: { judged: 1, correctLead: 1, notTheLead: 0 },
    });
  });

  it('refuses two owner labels for one lead', () => {
    const label: OwnerLeadLabel = {
      entityKey: 'row-confirmed',
      personId: 'p-1',
      ownerVerdict: 'correct_lead',
    };
    expect(() => scoreLeadVerificationPerLead(syntheticReplay(), [label, label])).toThrow(
      /two owner labels/,
    );
  });

  it('resolves an entityId-keyed observation through the slug map', () => {
    const [confirmed] = syntheticReplay();
    const score = scoreLeadVerificationPerLead(
      [{ ...confirmed, entityKey: undefined, entityId: 'id-1' }],
      [],
      new Map([['id-1', 'row-confirmed']]),
    );
    expect(score.perLead.map((row) => row.entityKey)).toEqual(['row-confirmed']);
  });

  it('scores the same replay identically twice', () => {
    const labels: OwnerLeadLabel[] = [
      { entityKey: 'row-contradicted', personId: 'p-2', ownerVerdict: 'not_the_lead' },
    ];
    expect(scoreLeadVerificationPerLead(syntheticReplay(), labels)).toEqual(
      scoreLeadVerificationPerLead([...syntheticReplay()].reverse(), labels),
    );
  });
});

describe('benchmarkDescendsFrom', () => {
  const lineage = new Map<string, string | undefined>([
    ['gold-v1', undefined],
    ['gold-v2', 'gold-v1'],
    ['gold-v3', 'gold-v2'],
    ['other', undefined],
  ]);

  it('applies a ballot to its own benchmark and to every recapture of it', () => {
    expect(benchmarkDescendsFrom('gold-v2', 'gold-v2', lineage)).toBe(true);
    expect(benchmarkDescendsFrom('gold-v3', 'gold-v2', lineage)).toBe(true);
  });

  it('never applies a ballot to an ancestor or an unrelated benchmark', () => {
    expect(benchmarkDescendsFrom('gold-v1', 'gold-v2', lineage)).toBe(false);
    expect(benchmarkDescendsFrom('other', 'gold-v2', lineage)).toBe(false);
  });

  it('stops on a supersedes cycle', () => {
    const cycle = new Map([
      ['a', 'b'],
      ['b', 'a'],
    ]);
    expect(benchmarkDescendsFrom('a', 'c', cycle)).toBe(false);
  });
});
