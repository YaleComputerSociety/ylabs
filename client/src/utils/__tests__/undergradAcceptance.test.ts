/**
 * Unit tests for the trust-gradient computation. These tests exercise every
 * branch of the rule table in `undergradAcceptance.ts` so the verdict and
 * evidence are guaranteed to be consistent across the browse page, the
 * detail header, and the inquire CTA.
 */
import { describe, expect, it } from 'vitest';
import {
  computeAcceptanceVerdict,
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
  openness: 'open',
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

describe('computeAcceptanceVerdict — manual lock takes priority', () => {
  it('PI manual lock + acceptingUndergrads=true → verified-accepting with pi-claim chip', () => {
    const result = computeAcceptanceVerdict(
      baseGroup({
        manuallyLockedFields: ['acceptingUndergrads'],
        acceptingUndergrads: true,
        // Even with extra signals, the PI claim is the only chip when locked.
        pastUndergradAdvisees: [{ year: 2024, count: 3 }],
        currentUndergradCount: 5,
      }),
    );
    expect(result.verdict).toBe('verified-accepting');
    expect(result.confidence).toBe(1.0);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].kind).toBe('pi-claim');
  });

  it('PI manual lock + acceptingUndergrads=false → not-accepting with closed-toggle chip', () => {
    const result = computeAcceptanceVerdict(
      baseGroup({
        manuallyLockedFields: ['acceptingUndergrads'],
        acceptingUndergrads: false,
      }),
    );
    expect(result.verdict).toBe('not-accepting');
    expect(result.confidence).toBe(1.0);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].kind).toBe('closed-toggle');
  });
});

describe('computeAcceptanceVerdict — closed by non-locked source', () => {
  it('acceptingUndergrads=false (no lock) → not-accepting with closed-evidence chip', () => {
    const result = computeAcceptanceVerdict(
      baseGroup({
        acceptingUndergrads: false,
        undergradEvidenceQuote: 'Lab is at capacity for the spring.',
        confidenceByField: { acceptingUndergrads: 0.6 },
      }),
    );
    expect(result.verdict).toBe('not-accepting');
    expect(result.evidence[0].kind).toBe('closed-evidence');
    expect(result.evidence[0].detail).toBe('Lab is at capacity for the spring.');
    // Confidence comes from the materializer when present.
    expect(result.confidence).toBe(0.6);
  });
});

describe('computeAcceptanceVerdict — access summary compatibility', () => {
  it('uses posted-opening accessSummary before legacy scalar fallback', () => {
    const result = computeAcceptanceVerdict(
      baseGroup({
        acceptingUndergrads: false,
        undergradEvidenceQuote: 'Legacy field says closed.',
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

  it('LLM evidence with confidence in [0.5, 1) → moderate signal, likely-accepting', () => {
    const result = computeAcceptanceVerdict(
      baseGroup({
        acceptingUndergrads: true,
        undergradEvidenceQuote: 'We welcome motivated undergraduate researchers.',
        confidenceByField: { acceptingUndergrads: 0.65 },
      }),
    );
    expect(result.verdict).toBe('likely-accepting');
    expect(result.evidence[0].kind).toBe('llm-evidence');
    expect(result.evidence[0].detail).toBe('We welcome motivated undergraduate researchers.');
    // Confidence floor floor — when LLM score exists, prefer it over derived.
    expect(result.confidence).toBe(0.65);
  });

  it('LLM confidence = 1.0 does NOT add an llm-evidence chip (treated as a hard claim)', () => {
    // confidence === 1.0 means it has been fully confirmed (e.g., another
    // strong signal already wrote it). The chip would be redundant.
    const result = computeAcceptanceVerdict(
      baseGroup({
        acceptingUndergrads: true,
        confidenceByField: { acceptingUndergrads: 1.0 },
      }),
    );
    expect(result.evidence.find((e) => e.kind === 'llm-evidence')).toBeUndefined();
    expect(result.verdict).toBe('unknown');
  });

  it('no positive signals + acceptingUndergrads undefined → unknown', () => {
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

  it('LLM evidence is ignored when its confidence is below 0.5', () => {
    const result = computeAcceptanceVerdict(
      baseGroup({
        acceptingUndergrads: true,
        confidenceByField: { acceptingUndergrads: 0.3 },
      }),
    );
    expect(result.evidence.find((e) => e.kind === 'llm-evidence')).toBeUndefined();
  });

  it('past advisee count of 0 entries is handled (label uses fallback)', () => {
    const result = computeAcceptanceVerdict(
      baseGroup({ pastUndergradAdvisees: [{ year: 2020, count: 1 }] }),
    );
    expect(result.evidence[0].label).toBe('1 past advisee');
    expect(result.evidence[0].detail).toBe('(2020)');
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
