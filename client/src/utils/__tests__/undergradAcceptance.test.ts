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
  REACH_OUT_PLAUSIBLE_LABEL,
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
  it('uses posted-opening accessSummary as the primary access source', () => {
    const result = computeAcceptanceVerdict(
      baseGroup({
        accessSummary: {
          status: 'posted-opening',
          confidence: 0.88,
          evidence: [
            {
              signalType: 'POSTED_OPENING',
              confidence: 'HIGH',
              excerpt: 'Spring RA role',
            },
          ],
          signalTypes: ['POSTED_OPENING'],
          bestNextStep: 'Apply',
        },
      }),
    );

    expect(result.verdict).toBe('verified-accepting');
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

  it('maps not-currently-available accessSummary to the closed verdict', () => {
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
          bestNextStep: 'Check back later',
        },
      }),
    );

    expect(result.verdict).toBe('not-accepting');
    expect(result.confidence).toBe(0.72);
    expect(result.evidence[0].kind).toBe('closed-evidence');
    expect(result.evidence[0].label).toBe('Not currently available');
    expect(result.evidence[0].detail).toBe('Not taking undergraduates this term.');
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

describe('isHistoricalUndergradEvidence — recency classifier (#1209)', () => {
  const NOW = 2026;

  it('flags "former" / alumni roster prose', () => {
    expect(
      isHistoricalUndergradEvidence(
        'Former undergraduate researchers: Megan Sullivan (OSU), Lisa Miller (OSU)',
        NOW,
      ),
    ).toBe(true);
  });

  it('flags "now <role>" transitioned-away alumni', () => {
    expect(
      isHistoricalUndergradEvidence(
        'Amber Anders 2009 Undergraduate student, now Senior Director Commercial BizOps, Illumina',
        NOW,
      ),
    ).toBe(true);
    expect(
      isHistoricalUndergradEvidence(
        'Grant Senyei, Yale Undergraduate student (2008-2010), now a medical student at Northwestern',
        NOW,
      ),
    ).toBe(true);
  });

  it('flags a quote whose only years are several years stale', () => {
    expect(
      isHistoricalUndergradEvidence(
        'Dustin Morado, Georgia Tech, Visiting Undergraduate in Research 2010, 2011',
        NOW,
      ),
    ).toBe(true);
  });

  it('does not flag current rosters, recency cues, or empty quotes', () => {
    expect(isHistoricalUndergradEvidence(undefined, NOW)).toBe(false);
    expect(isHistoricalUndergradEvidence('', NOW)).toBe(false);
    expect(
      isHistoricalUndergradEvidence('Current undergraduate researchers: Jane Doe, John Smith', NOW),
    ).toBe(false);
    expect(
      isHistoricalUndergradEvidence('Undergraduate researcher on the team since 2022', NOW),
    ).toBe(false);
  });
});

describe('computeAcceptanceVerdict — historical undergrad rosters do not count as current', () => {
  it('suppresses the current-undergrad chip when the evidence quote is historical', () => {
    const result = computeAcceptanceVerdict(
      baseGroup({
        currentUndergradCount: 10,
        undergradEvidenceQuote:
          'Amber Anders 2009 Undergraduate student, now Senior Director Commercial BizOps, Illumina',
      }),
    );
    expect(result.evidence.some((e) => e.kind === 'lab-lists-undergrads')).toBe(false);
    expect(result.verdict).toBe('unknown');
  });

  it('still counts current undergrads when the evidence quote is not historical', () => {
    const result = computeAcceptanceVerdict(
      baseGroup({
        currentUndergradCount: 3,
        undergradEvidenceQuote: 'Current undergraduate researchers on the team.',
      }),
    );
    expect(result.evidence.some((e) => e.kind === 'lab-lists-undergrads')).toBe(true);
    expect(result.verdict).toBe('likely-accepting');
  });

  it('drops the CURRENT_UNDERGRADS access-summary chip when its quote is historical', () => {
    const result = computeAcceptanceVerdict(
      baseGroup({
        undergradEvidenceQuote: 'Former undergraduate researchers who have since graduated.',
        accessSummary: {
          status: 'reach-out-plausible',
          confidence: 0.6,
          evidence: [
            {
              signalType: 'CURRENT_UNDERGRADS',
              confidence: 'MEDIUM',
              excerpt: '10 current undergraduate(s) listed',
            },
            {
              signalType: 'REACH_OUT_PLAUSIBLE',
              confidence: 'HIGH',
              excerpt: 'The official lab page provides contact instructions.',
            },
          ],
          signalTypes: ['CURRENT_UNDERGRADS', 'REACH_OUT_PLAUSIBLE'],
          bestNextStep: 'Review the official profile.',
        },
      }),
    );
    expect(result.evidence.some((e) => e.label === 'Current undergrads')).toBe(false);
    expect(result.evidence.some((e) => e.label === REACH_OUT_PLAUSIBLE_LABEL)).toBe(true);
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
