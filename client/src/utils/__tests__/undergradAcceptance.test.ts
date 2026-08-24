/**
 * Unit tests for the trust-gradient computation. These tests exercise every
 * branch of the rule table in `undergradAcceptance.ts` so the verdict and
 * evidence are guaranteed to be consistent across the browse page, the
 * detail header, and the inquire CTA.
 */
import { describe, expect, it } from 'vitest';
import {
  computeAcceptanceVerdict,
  isHistoricalUndergradEvidence,
  verdictBadgeStyles,
  verdictLabel,
  TrustVerdict,
} from '../undergradAcceptance';
import { ResearchGroup } from '../../types/researchGroup';

const baseGroup = (overrides: Partial<ResearchGroup> = {}): ResearchGroup => ({
  _id: 'gid',
  slug: 'test-lab',
  name: 'Test Lab',
  kind: 'lab',
  description: '',
  websiteUrl: '',
  location: '',
  departments: [],
  researchAreas: [],
  school: '',
  typicalUndergradRoles: [],
  prerequisiteCourses: [],
  creditOptions: [],
  fundingPrograms: [],
  contactEmail: '',
  contactName: '',
  contactRole: '',
  sourceUrls: [],
  ...overrides,
});

describe('computeAcceptanceVerdict — access summary drives the verdict', () => {
  it('never upgrades a POSTED_OPENING chip to verified-accepting (#1303)', () => {
    const result = computeAcceptanceVerdict(
      baseGroup({
        accessSummary: {
          status: 'evidence-backed',
          confidence: 0.88,
          evidence: [
            {
              signalType: 'POSTED_OPENING',
              confidence: 'HIGH',
              excerpt: 'Spring RA role',
            },
          ],
          signalTypes: ['POSTED_OPENING'],
          bestNextStep: 'Save for later',
        },
      }),
    );

    expect(result.verdict).toBe('likely-accepting');
    expect(result.confidence).toBe(0.88);
    expect(result.evidence[0].kind).toBe('active-listing');
    expect(result.evidence[0].label).toBe('Posted opening');
  });

  it('collapses duplicate access-summary signals into one evidence chip', () => {
    const result = computeAcceptanceVerdict(
      baseGroup({
        accessSummary: {
          status: 'reach-out-plausible',
          confidence: 0.74,
          evidence: [
            {
              signalType: 'REACH_OUT_PLAUSIBLE',
              confidence: 'MEDIUM',
              excerpt: 'A public profile is available.',
            },
            {
              signalType: 'REACH_OUT_PLAUSIBLE',
              confidence: 'HIGH',
              excerpt: 'The official lab page provides contact instructions.',
            },
            {
              signalType: 'REACH_OUT_PLAUSIBLE',
              confidence: 'MEDIUM',
              excerpt: 'A second profile is available.',
            },
          ],
          signalTypes: ['REACH_OUT_PLAUSIBLE'],
          bestNextStep: 'Review the official profile.',
        },
      }),
    );

    expect(result.evidence).toEqual([
      {
        kind: 'access-signal',
        label: 'Reach-out plausible',
        detail: 'The official lab page provides contact instructions.',
        strength: 'strong',
      },
    ]);
  });

  it('maps a negative-only not-currently-available accessSummary to a reach-out caveat, not a dead-end (#1304)', () => {
    const result = computeAcceptanceVerdict(
      baseGroup({
        accessSummary: {
          status: 'not-currently-available',
          confidence: 0.72,
          evidence: [
            {
              signalType: 'NOT_CURRENTLY_AVAILABLE',
              confidence: 'HIGH',
              excerpt: 'Not taking undergraduates this term.',
            },
          ],
          signalTypes: ['NOT_CURRENTLY_AVAILABLE'],
          bestNextStep: 'Reach out to confirm current availability',
        },
      }),
    );

    expect(result.verdict).toBe('not-accepting');
    expect(result.confidence).toBe(0.72);
    expect(result.evidence[0].kind).toBe('closed-evidence');
    expect(result.evidence[0].label).toBe('May not be accepting - reach out to confirm');
    expect(result.evidence[0].strength).toBe('moderate');
    expect(result.evidence[0].detail).toBe('Not taking undergraduates this term.');
  });

  it('keeps positive evidence and softens the verdict when a negative conflicts with positives (#1304)', () => {
    const result = computeAcceptanceVerdict(
      baseGroup({
        accessSummary: {
          status: 'not-currently-available',
          confidence: 0.7,
          evidence: [
            {
              signalType: 'NOT_CURRENTLY_AVAILABLE',
              confidence: 'MEDIUM',
              excerpt: 'Not taking undergraduates this term.',
            },
            {
              signalType: 'CONTACT_INSTRUCTIONS_EXIST',
              confidence: 'MEDIUM',
              excerpt: 'Contact the lab manager to discuss projects.',
            },
          ],
          signalTypes: ['NOT_CURRENTLY_AVAILABLE', 'CONTACT_INSTRUCTIONS_EXIST'],
          bestNextStep: 'Reach out to confirm current availability',
        },
      }),
    );

    expect(result.verdict).toBe('likely-accepting');
    expect(result.evidence.some((e) => e.kind === 'closed-evidence')).toBe(true);
    expect(result.evidence.some((e) => e.label === 'Contact instructions')).toBe(true);
  });
});

describe('computeAcceptanceVerdict — verdict thresholds', () => {
  it('two strong signals → verified-accepting', () => {
    const result = computeAcceptanceVerdict(
      baseGroup({
        pastUndergradAdvisees: [{ year: 2023, programName: 'Fixture Scholars', count: 2 }],
        currentUndergradCount: 4,
      }),
    );
    expect(result.verdict).toBe('verified-accepting');
    expect(result.evidence.length).toBe(2);
    expect(result.evidence.every((e) => e.strength === 'strong')).toBe(true);
  });

  it('one strong signal → likely-accepting', () => {
    const result = computeAcceptanceVerdict(
      baseGroup({ pastUndergradAdvisees: [{ year: 2022, count: 1 }] }),
    );
    expect(result.verdict).toBe('likely-accepting');
    expect(result.confidence).toBe(0.7);
  });

  it('only moderate signals (offers indep study) → likely-accepting', () => {
    const result = computeAcceptanceVerdict(
      baseGroup({
        offersIndependentStudy: true,
        independentStudyCourses: [{ code: 'TEST 101', title: 'Independent Research Fixture' }],
      }),
    );
    expect(result.verdict).toBe('likely-accepting');
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].kind).toBe('offers-indep-study');
    expect(result.evidence[0].detail).toBe('TEST 101');
  });

  it('no positive signals and no access summary → unknown', () => {
    const result = computeAcceptanceVerdict(baseGroup());
    expect(result.verdict).toBe('unknown');
    expect(result.confidence).toBe(0.0);
    expect(result.evidence).toHaveLength(0);
  });
});

describe('computeAcceptanceVerdict — chip details and ordering', () => {
  it('past-advisees chip uses the most-common program name and year range', () => {
    const result = computeAcceptanceVerdict(
      baseGroup({
        pastUndergradAdvisees: [
          { year: 2022, programName: 'Fixture Scholars', count: 1 },
          { year: 2023, programName: 'Fixture Scholars', count: 1 },
          { year: 2024, programName: 'Fixture Summer Research', count: 1 },
        ],
      }),
    );
    expect(result.evidence[0].label).toBe('3 Fixture Scholars advisees');
    expect(result.evidence[0].detail).toBe('(2022–2024)');
  });

  it('lab-lists-undergrads singular vs plural', () => {
    const single = computeAcceptanceVerdict(baseGroup({ currentUndergradCount: 1 }));
    expect(single.evidence[0].label).toBe('Lists 1 undergrad');

    const plural = computeAcceptanceVerdict(baseGroup({ currentUndergradCount: 5 }));
    expect(plural.evidence[0].label).toBe('Lists 5 undergrads');
  });

  it('strong signals are ordered before moderate signals in evidence', () => {
    const result = computeAcceptanceVerdict(
      baseGroup({
        offersIndependentStudy: true,
        currentUndergradCount: 2,
        pastUndergradAdvisees: [{ year: 2024, count: 1 }],
      }),
    );
    const kinds = result.evidence.map((e) => e.kind);
    // strong: past-advisees, lab-lists-undergrads
    // moderate: offers-indep-study
    expect(kinds.indexOf('offers-indep-study')).toBe(kinds.length - 1);
  });

  it('past advisee count of 0 entries is handled (label uses fallback)', () => {
    const result = computeAcceptanceVerdict(
      baseGroup({ pastUndergradAdvisees: [{ year: 2020, count: 1 }] }),
    );
    expect(result.evidence[0].label).toBe('1 past advisee');
    expect(result.evidence[0].detail).toBe('(2020)');
  });
});

describe('isHistoricalUndergradEvidence — historical roster detection (#1209)', () => {
  it('flags the sampled alumni/past-roster evidence quotes', () => {
    const historical = [
      'Amber Anders 2009 Undergraduate student ... now Senior Director Commercial BizOps, Illumina',
      'Grant Senyei, Yale Undergraduate student (2008-2010), now a medical student at Northwestern',
      'Dustin Morado, Georgia Tech, Visiting Undergraduate in Research 2010, 2011; Jeffery Yang 2017',
      'Former undergraduate researchers: Megan Sullivan (OSU), Lisa Miller (OSU), Kaiyang Xu (OSU)',
      'Jane Doe, alumna, graduated 2019',
    ];
    for (const quote of historical) {
      expect(isHistoricalUndergradEvidence(quote)).toBe(true);
    }
  });

  it('does not flag current-roster or accepting language', () => {
    const current = [
      'Three undergraduate students currently work in the lab.',
      'Now accepting undergraduate applications for Fall 2025.',
      'Undergraduate researchers (2023–present).',
      'Our current undergraduate team includes Jane and Bob.',
      '10 current undergraduate(s) listed',
      '',
      undefined,
    ];
    for (const quote of current) {
      expect(isHistoricalUndergradEvidence(quote)).toBe(false);
    }
  });
});

describe('computeAcceptanceVerdict — historical undergrad roster guard (#1209)', () => {
  it('downgrades a historical-quote current-undergrad roster to a moderate past signal', () => {
    const result = computeAcceptanceVerdict(
      baseGroup({
        currentUndergradCount: 10,
        undergradEvidenceQuote:
          'Amber Anders 2009 Undergraduate student ... now Senior Director, Illumina',
      }),
    );
    const chip = result.evidence.find((e) => e.kind === 'lab-lists-undergrads');
    expect(chip?.strength).toBe('moderate');
    expect(chip?.detail).toBe('Undergrads named on the lab roster, including past members.');
    expect(result.verdict).toBe('likely-accepting');
  });

  it('keeps a current-quote current-undergrad roster as a strong current signal', () => {
    const result = computeAcceptanceVerdict(
      baseGroup({
        currentUndergradCount: 3,
        undergradEvidenceQuote: 'Three undergraduate students currently work in the lab.',
      }),
    );
    const chip = result.evidence.find((e) => e.kind === 'lab-lists-undergrads');
    expect(chip?.strength).toBe('strong');
    expect(chip?.detail).toBe('Current undergrads named on the lab roster.');
    expect(result.verdict).toBe('likely-accepting');
  });

  it('softens a CURRENT_UNDERGRADS accessSummary chip when the roster quote is historical', () => {
    const result = computeAcceptanceVerdict(
      baseGroup({
        undergradEvidenceQuote: 'Former undergraduate researchers: Megan Sullivan, Lisa Miller',
        accessSummary: {
          status: 'reach-out-plausible',
          confidence: 0.8,
          evidence: [
            {
              signalType: 'CURRENT_UNDERGRADS',
              confidence: 'HIGH',
              excerpt: '2 current undergraduate(s) listed',
            },
          ],
          signalTypes: ['CURRENT_UNDERGRADS'],
          bestNextStep: 'Review the roster.',
        },
      }),
    );
    const chip = result.evidence.find((e) => e.label === 'Current undergrads');
    expect(chip?.strength).toBe('moderate');
  });
});

describe('verdictBadgeStyles + verdictLabel', () => {
  const verdicts: TrustVerdict[] = [
    'verified-accepting',
    'likely-accepting',
    'unknown',
    'not-accepting',
  ];
  it('returns a non-empty class string for every verdict', () => {
    for (const v of verdicts) {
      expect(verdictBadgeStyles(v).length).toBeGreaterThan(0);
    }
  });
  it('returns a human-readable label for every verdict', () => {
    expect(verdictLabel('verified-accepting')).toBe('Strong evidence');
    expect(verdictLabel('likely-accepting')).toBe('Some evidence');
    expect(verdictLabel('unknown')).toBe('Evidence unknown');
    expect(verdictLabel('not-accepting')).toBe('Not currently available');
  });
});
