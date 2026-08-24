import { beforeEach, describe, expect, it, vi } from 'vitest';

const persistenceMocks = vi.hoisted(() => ({
  observationFind: vi.fn(),
  claimUpdateOne: vi.fn(),
  claimUpdateMany: vi.fn(),
}));

vi.mock('../../models/observation', () => ({
  Observation: { find: persistenceMocks.observationFind },
}));

vi.mock('../../models/signal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../models/signal')>();
  return {
    ...actual,
    Signal: {
      updateOne: persistenceMocks.claimUpdateOne,
      updateMany: persistenceMocks.claimUpdateMany,
    },
  };
});

import {
  currentUndergradAvailabilityFromSignals,
  materializeUndergraduateLogisticsForResearchEntity,
  quoteExplicitlyDeclinesUndergraduates,
  resolveUndergraduateLogisticsClaims,
  validateUndergraduateLogisticsObservation,
} from '../undergraduateLogisticsMaterializer';

const NOW = new Date('2026-07-14T12:00:00.000Z');

const observation = (
  field: string,
  claimType: string,
  value: Record<string, unknown>,
  evidenceQuote: string,
  overrides: Record<string, unknown> = {},
) => ({
  _id: '64b000000000000000000001',
  field,
  value: {
    schemaVersion: 1,
    claimType,
    value,
    evidenceQuote,
    quoteVerified: true,
  },
  sourceName: 'lab-microsite-undergrad-llm',
  sourceUrl: 'https://example.yale.edu/join',
  observedAt: NOW,
  superseded: false,
  ...overrides,
});

beforeEach(() => {
  persistenceMocks.observationFind.mockReset();
  persistenceMocks.claimUpdateOne.mockReset();
  persistenceMocks.claimUpdateMany.mockReset();
  persistenceMocks.observationFind.mockReturnValue({ lean: async () => [] });
  persistenceMocks.claimUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  persistenceMocks.claimUpdateMany.mockResolvedValue({ modifiedCount: 0 });
});

describe('undergraduate logistics materialization', () => {
  it('keeps missing evidence unknown instead of materializing a negative answer', () => {
    const resolution = resolveUndergraduateLogisticsClaims([], NOW);

    expect(resolution.patches).toEqual([]);
    expect(resolution.missingClaimTypes).toEqual([
      'STUDENT_LEVEL',
      'COMPENSATION',
      'TIME_COMMITMENT',
      'MODALITY',
      'CURRENT_AVAILABILITY',
    ]);
  });

  it('materializes independent exact claims without filling adjacent fields', () => {
    const resolution = resolveUndergraduateLogisticsClaims(
      [
        observation(
          'undergraduateLogisticsCompensation',
          'COMPENSATION',
          { modes: ['PAID'] },
          'Undergraduate research assistants are paid $18 per hour.',
        ),
      ],
      NOW,
    );

    expect(resolution.patches).toHaveLength(1);
    expect(resolution.patches[0]).toMatchObject({
      claimType: 'COMPENSATION',
      status: 'KNOWN',
      value: { modes: ['PAID'] },
    });
    expect(resolution.missingClaimTypes).toContain('CURRENT_AVAILABILITY');
    expect(resolution.missingClaimTypes).toContain('TIME_COMMITMENT');
  });

  it('sanitizes the stored evidence excerpt, dropping a contact-marker sentence (#1112)', () => {
    const resolution = resolveUndergraduateLogisticsClaims(
      [
        observation(
          'undergraduateLogisticsCompensation',
          'COMPENSATION',
          { modes: ['PAID'] },
          'Undergraduate research assistants are paid $18 per hour. Email ada@yale.edu to apply.',
        ),
      ],
      NOW,
    );

    expect(resolution.patches).toHaveLength(1);
    const excerpt = resolution.patches[0].evidenceExcerpt;
    expect(excerpt).toMatch(/Undergraduate research assistants are paid \$18 per hour/i);
    expect(excerpt).not.toContain('ada@yale.edu');
    expect(excerpt).not.toMatch(/redacted/i);
  });

  it.each([
    ['PAID', 'Undergraduate research assistants receive hourly pay.'],
    ['STIPEND', 'Undergraduate students receive a stipend for their research role.'],
    ['COURSE_CREDIT', 'Undergraduate students earn course credit for research participation.'],
    ['FELLOWSHIP', 'Undergraduate students are offered a fellowship for the research program.'],
    ['VOLUNTEER', 'Undergraduate students may volunteer in this research program.'],
  ])('accepts %s only when undergraduates receive the compensation', (mode, evidenceQuote) => {
    const result = validateUndergraduateLogisticsObservation(
      observation(
        'undergraduateLogisticsCompensation',
        'COMPENSATION',
        { modes: [mode] },
        evidenceQuote,
      ),
    );

    expect(result.accepted?.value).toEqual({ modes: [mode] });
  });

  it.each([
    ['PAID', 'Undergraduates provide hourly pay to researchers.'],
    ['STIPEND', 'Undergraduates provide a stipend to researchers.'],
    ['COURSE_CREDIT', 'Undergraduates offer course credit to researchers.'],
    ['FELLOWSHIP', 'Undergraduates offer a fellowship to researchers.'],
  ])(
    'rejects %s when undergraduates provide compensation to someone else',
    (mode, evidenceQuote) => {
      const result = validateUndergraduateLogisticsObservation(
        observation(
          'undergraduateLogisticsCompensation',
          'COMPENSATION',
          { modes: [mode] },
          evidenceQuote,
        ),
      );

      expect(result).toEqual({ rejectedReason: 'evidence_does_not_support_exact_claim' });
    },
  );

  it('requires work-study compensation to benefit undergraduate students', () => {
    const provider = validateUndergraduateLogisticsObservation(
      observation(
        'undergraduateLogisticsCompensation',
        'COMPENSATION',
        { modes: ['WORK_STUDY'] },
        'Undergraduates offer work-study positions to graduate students.',
      ),
    );
    const beneficiary = validateUndergraduateLogisticsObservation(
      observation(
        'undergraduateLogisticsCompensation',
        'COMPENSATION',
        { modes: ['WORK_STUDY'] },
        'Undergraduate students qualify for work-study positions in this research program.',
      ),
    );

    expect(provider).toEqual({ rejectedReason: 'evidence_does_not_support_exact_claim' });
    expect(beneficiary.accepted?.value).toEqual({ modes: ['WORK_STUDY'] });
  });

  it.each([
    ['STIPEND', 'Undergraduate students receive a stipend for conference travel.'],
    ['WORK_STUDY', 'Undergraduate students qualify for work-study positions in campus dining.'],
    ['COURSE_CREDIT', 'Undergraduate students earn course credit for language study.'],
    ['FELLOWSHIP', 'Undergraduate students receive a fellowship for public service.'],
    ['PAID', 'Undergraduate students receive hourly pay for tutoring.'],
    ['VOLUNTEER', 'Undergraduate students may volunteer at the campus food pantry.'],
  ])('rejects unrelated %s benefits', (mode, evidenceQuote) => {
    const result = validateUndergraduateLogisticsObservation(
      observation(
        'undergraduateLogisticsCompensation',
        'COMPENSATION',
        { modes: [mode] },
        evidenceQuote,
      ),
    );

    expect(result).toEqual({ rejectedReason: 'evidence_does_not_support_exact_claim' });
  });

  it('rejects modality attached to another population object', () => {
    const result = validateUndergraduateLogisticsObservation(
      observation(
        'undergraduateLogisticsModality',
        'MODALITY',
        { modes: ['REMOTE'] },
        'Undergraduates work to support employees in remote positions.',
      ),
    );

    expect(result).toEqual({ rejectedReason: 'evidence_does_not_support_exact_claim' });
  });

  it.each([
    [
      'undergraduateLogisticsTimeCommitment',
      'TIME_COMMITMENT',
      { minHours: 10, maxHours: 10, period: 'WEEK' },
      'Undergraduate students work 10 hours per week at campus dining.',
    ],
    [
      'undergraduateLogisticsModality',
      'MODALITY',
      { modes: ['REMOTE'] },
      'Undergraduate students work remotely for admissions.',
    ],
    [
      'undergraduateLogisticsCurrentAvailability',
      'CURRENT_AVAILABILITY',
      { status: 'OPEN' },
      'Undergraduate applications for travel grants are open.',
    ],
  ])(
    'rejects %s evidence unrelated to research participation',
    (field, claimType, value, quote) => {
      const result = validateUndergraduateLogisticsObservation(
        observation(field, claimType, value, quote),
      );

      expect(result).toEqual({ rejectedReason: 'evidence_does_not_support_exact_claim' });
    },
  );

  it.each([
    ['The Navon Lab is currently looking for driven students from the undergraduate student body.'],
    [
      'The Yale Section of Pediatric Emergency Medicine is recruiting students to join the Undergraduate Research Associate Program.',
    ],
  ])('accepts explicit present-tense undergraduate recruiting language: %s', (evidenceQuote) => {
    const result = validateUndergraduateLogisticsObservation(
      observation(
        'undergraduateLogisticsCurrentAvailability',
        'CURRENT_AVAILABILITY',
        { status: 'OPEN' },
        evidenceQuote,
      ),
    );

    expect(result.accepted?.value).toEqual({ status: 'OPEN' });
  });

  it.each([
    ['The Lake Lab is recruiting!'],
    ['The Yale Section is recruiting graduate students to join the research program.'],
  ])('rejects recruiting language without an undergraduate subject: %s', (evidenceQuote) => {
    const result = validateUndergraduateLogisticsObservation(
      observation(
        'undergraduateLogisticsCurrentAvailability',
        'CURRENT_AVAILABILITY',
        { status: 'OPEN' },
        evidenceQuote,
      ),
    );

    expect(result).toEqual({ rejectedReason: 'evidence_does_not_support_exact_claim' });
  });

  it.each([
    [
      'undergraduateLogisticsTimeCommitment',
      'TIME_COMMITMENT',
      { minHours: 10, maxHours: 10, period: 'WEEK' },
      'Undergraduate research assistants work 10 hours per week.',
    ],
    [
      'undergraduateLogisticsModality',
      'MODALITY',
      { modes: ['REMOTE'] },
      'Undergraduate students perform this research role remotely.',
    ],
    [
      'undergraduateLogisticsCurrentAvailability',
      'CURRENT_AVAILABILITY',
      { status: 'OPEN' },
      'Undergraduate research positions are open.',
    ],
  ])('accepts %s evidence tied to research participation', (field, claimType, value, quote) => {
    const result = validateUndergraduateLogisticsObservation(
      observation(field, claimType, value, quote),
    );

    expect(result.accepted?.value).toEqual(value);
  });

  it.each([
    [
      'undergraduateLogisticsStudentLevel',
      'STUDENT_LEVEL',
      { levels: ['FIRST_YEAR'] },
      'This lab welcomes first-year undergraduate students.',
    ],
    [
      'undergraduateLogisticsCompensation',
      'COMPENSATION',
      { modes: ['STIPEND'] },
      'Undergraduate students in our lab receive a stipend.',
    ],
    [
      'undergraduateLogisticsTimeCommitment',
      'TIME_COMMITMENT',
      { minHours: 10, maxHours: 10, period: 'WEEK' },
      'Undergraduate students in our lab work 10 hours per week.',
    ],
    [
      'undergraduateLogisticsModality',
      'MODALITY',
      { modes: ['REMOTE'] },
      'Undergraduate students in this lab work remotely.',
    ],
    [
      'undergraduateLogisticsCurrentAvailability',
      'CURRENT_AVAILABILITY',
      { status: 'OPEN' },
      'Our lab is currently accepting undergraduate students.',
    ],
  ])(
    'accepts %s direct research-home language from an attributable official page',
    (field, claimType, value, quote) => {
      const result = validateUndergraduateLogisticsObservation(
        observation(field, claimType, value, quote),
      );

      expect(result.accepted?.value).toEqual(value);
    },
  );

  it.each([
    [
      'undergraduateLogisticsTimeCommitment',
      'TIME_COMMITMENT',
      { minHours: 10, maxHours: 10, period: 'WEEK' },
      'Undergraduate students work 10 hours per week at our summer camp.',
    ],
    [
      'undergraduateLogisticsCompensation',
      'COMPENSATION',
      { modes: ['STIPEND'] },
      'Undergraduate students receive a stipend for activities hosted by our lab.',
    ],
    [
      'undergraduateLogisticsCurrentAvailability',
      'CURRENT_AVAILABILITY',
      { status: 'OPEN' },
      'It is currently accepting undergraduate students.',
    ],
  ])(
    'rejects %s when lab language belongs to another activity or an ambiguous pronoun',
    (field, claimType, value, quote) => {
      const result = validateUndergraduateLogisticsObservation(
        observation(field, claimType, value, quote),
      );

      expect(result).toEqual({ rejectedReason: 'evidence_does_not_support_exact_claim' });
    },
  );

  it('withholds fresh conflicting values instead of selecting a confidence winner', () => {
    const resolution = resolveUndergraduateLogisticsClaims(
      [
        observation(
          'undergraduateLogisticsModality',
          'MODALITY',
          { modes: ['REMOTE'] },
          'Undergraduate students may perform this research role fully remote.',
        ),
        observation(
          'undergraduateLogisticsModality',
          'MODALITY',
          { modes: ['IN_PERSON'] },
          'Undergraduate students perform this research role in person in the lab.',
          { _id: '64b000000000000000000002', sourceName: 'manual-admin-edit' },
        ),
      ],
      NOW,
    );

    expect(resolution.patches[0]).toMatchObject({
      claimType: 'MODALITY',
      status: 'CONFLICTING_WITHHELD',
    });
    expect(resolution.patches[0]).not.toHaveProperty('value');
  });

  it('marks evidence stale using the claim-specific freshness window', () => {
    const resolution = resolveUndergraduateLogisticsClaims(
      [
        observation(
          'undergraduateLogisticsCurrentAvailability',
          'CURRENT_AVAILABILITY',
          { status: 'OPEN' },
          'Undergraduate research applications are open.',
          { observedAt: new Date('2026-04-01T00:00:00.000Z') },
        ),
      ],
      NOW,
    );

    expect(resolution.patches[0].status).toBe('STALE_UNDER_REVIEW');
    expect(resolution.patches[0]).not.toHaveProperty('value');
  });

  it('rejects generic join text as current availability evidence', () => {
    const result = validateUndergraduateLogisticsObservation(
      observation(
        'undergraduateLogisticsCurrentAvailability',
        'CURRENT_AVAILABILITY',
        { status: 'OPEN' },
        'Students interested in research may read about our lab.',
      ),
    );

    expect(result).toEqual({ rejectedReason: 'evidence_does_not_support_exact_claim' });
  });

  it('rejects negated language for open availability', () => {
    const result = validateUndergraduateLogisticsObservation(
      observation(
        'undergraduateLogisticsCurrentAvailability',
        'CURRENT_AVAILABILITY',
        { status: 'OPEN' },
        'Undergraduate research applications are not open.',
      ),
    );

    expect(result).toEqual({ rejectedReason: 'evidence_does_not_support_exact_claim' });
  });

  it.each([
    [
      'undergraduateLogisticsStudentLevel',
      'STUDENT_LEVEL',
      { levels: ['FIRST_YEAR'] },
      'First-year students are not eligible for these positions.',
    ],
    [
      'undergraduateLogisticsCompensation',
      'COMPENSATION',
      { modes: ['PAID'] },
      'These positions are not paid.',
    ],
    [
      'undergraduateLogisticsModality',
      'MODALITY',
      { modes: ['REMOTE'] },
      'Remote work is not available.',
    ],
    [
      'undergraduateLogisticsCurrentAvailability',
      'CURRENT_AVAILABILITY',
      { status: 'ROLLING' },
      'Applications are not rolling.',
    ],
  ])('rejects negated evidence for %s', (field, claimType, value, evidenceQuote) => {
    const result = validateUndergraduateLogisticsObservation(
      observation(field, claimType, value, evidenceQuote),
    );

    expect(result).toEqual({ rejectedReason: 'evidence_does_not_support_exact_claim' });
  });

  it.each([
    [
      'undergraduateLogisticsStudentLevel',
      'STUDENT_LEVEL',
      { levels: ['FIRST_YEAR'] },
      'First-year students are ineligible for these positions.',
    ],
    [
      'undergraduateLogisticsCompensation',
      'COMPENSATION',
      { modes: ['PAID'] },
      'No pay is available for undergraduate students.',
    ],
    [
      'undergraduateLogisticsModality',
      'MODALITY',
      { modes: ['REMOTE'] },
      'Remote work is unavailable for undergraduate students.',
    ],
    [
      'undergraduateLogisticsCurrentAvailability',
      'CURRENT_AVAILABILITY',
      { status: 'ROLLING' },
      'Undergraduate student applications are no longer rolling.',
    ],
  ])('rejects opposite evidence variants for %s', (field, claimType, value, evidenceQuote) => {
    const result = validateUndergraduateLogisticsObservation(
      observation(field, claimType, value, evidenceQuote),
    );

    expect(result).toEqual({ rejectedReason: 'evidence_does_not_support_exact_claim' });
  });

  it.each([
    [
      'undergraduateLogisticsStudentLevel',
      'STUDENT_LEVEL',
      { levels: ['FIRST_YEAR'] },
      'First-year undergraduate students are not welcome to apply.',
    ],
    [
      'undergraduateLogisticsStudentLevel',
      'STUDENT_LEVEL',
      { levels: ['SOPHOMORE'] },
      'Sophomore undergraduate students are not admitted to the program.',
    ],
    [
      'undergraduateLogisticsStudentLevel',
      'STUDENT_LEVEL',
      { levels: ['JUNIOR'] },
      'Junior undergraduate students may not participate.',
    ],
    [
      'undergraduateLogisticsCompensation',
      'COMPENSATION',
      { modes: ['PAID'] },
      'Undergraduate students cannot be paid for this work.',
    ],
    [
      'undergraduateLogisticsCompensation',
      'COMPENSATION',
      { modes: ['PAID'] },
      'Undergraduate students may not be compensated for this work.',
    ],
    [
      'undergraduateLogisticsModality',
      'MODALITY',
      { modes: ['REMOTE'] },
      'Undergraduate students cannot work remotely.',
    ],
    [
      'undergraduateLogisticsModality',
      'MODALITY',
      { modes: ['REMOTE'] },
      'Undergraduate students may not work virtually.',
    ],
  ])('rejects modal negation evidence for %s', (field, claimType, value, evidenceQuote) => {
    const result = validateUndergraduateLogisticsObservation(
      observation(field, claimType, value, evidenceQuote),
    );

    expect(result).toEqual({ rejectedReason: 'evidence_does_not_support_exact_claim' });
  });

  it.each([
    [
      'undergraduateLogisticsStudentLevel',
      'STUDENT_LEVEL',
      { levels: ['FIRST_YEAR'] },
      'Undergraduate students asked whether first-year students may apply.',
    ],
    [
      'undergraduateLogisticsCompensation',
      'COMPENSATION',
      { modes: ['PAID'] },
      'Graduate assistants are paid for this work.',
    ],
    [
      'undergraduateLogisticsModality',
      'MODALITY',
      { modes: ['REMOTE'] },
      'Staff may work remotely.',
    ],
    [
      'undergraduateLogisticsCurrentAvailability',
      'CURRENT_AVAILABILITY',
      { status: 'OPEN' },
      'We are currently accepting postdoctoral fellows.',
    ],
  ])(
    'rejects evidence scoped to another population for %s',
    (field, claimType, value, evidenceQuote) => {
      const result = validateUndergraduateLogisticsObservation(
        observation(field, claimType, value, evidenceQuote),
      );

      expect(result).toEqual({ rejectedReason: 'evidence_does_not_support_exact_claim' });
    },
  );

  it('retains explicit negative current availability evidence', () => {
    const result = validateUndergraduateLogisticsObservation(
      observation(
        'undergraduateLogisticsCurrentAvailability',
        'CURRENT_AVAILABILITY',
        { status: 'NOT_CURRENTLY_AVAILABLE' },
        'Undergraduate research positions are filled.',
      ),
    );

    expect(result.accepted?.value).toEqual({ status: 'NOT_CURRENTLY_AVAILABLE' });
  });

  it.each([
    ['OPEN', 'Undergraduate students receive guidance while graduate applications are open.'],
    [
      'ROLLING',
      'Undergraduate students receive updates when graduate applications are reviewed on a rolling basis.',
    ],
    [
      'NOT_CURRENTLY_AVAILABLE',
      'Undergraduate students are notified when graduate positions are filled.',
    ],
  ])(
    'rejects %s when the availability subject belongs to another population',
    (status, evidenceQuote) => {
      const result = validateUndergraduateLogisticsObservation(
        observation(
          'undergraduateLogisticsCurrentAvailability',
          'CURRENT_AVAILABILITY',
          { status },
          evidenceQuote,
        ),
      );

      expect(result).toEqual({ rejectedReason: 'evidence_does_not_support_exact_claim' });
    },
  );

  it.each([
    ['OPEN', 'Undergraduate research applications are open.'],
    ['ROLLING', 'Undergraduate research applications are reviewed on a rolling basis.'],
    ['NOT_CURRENTLY_AVAILABLE', 'Undergraduate research positions are filled.'],
  ])('accepts %s directly scoped to undergraduate opportunities', (status, evidenceQuote) => {
    const result = validateUndergraduateLogisticsObservation(
      observation(
        'undergraduateLogisticsCurrentAvailability',
        'CURRENT_AVAILABILITY',
        { status },
        evidenceQuote,
      ),
    );

    expect(result.accepted?.value).toEqual({ status });
  });

  it.each([
    [
      'undergraduateLogisticsCompensation',
      'COMPENSATION',
      { modes: ['PAID'] },
      'Graduate assistants are paid; undergraduate students may volunteer.',
    ],
    [
      'undergraduateLogisticsTimeCommitment',
      'TIME_COMMITMENT',
      { minHours: 10, maxHours: 10, period: 'WEEK' },
      'Graduate assistants work 10 hours per week. Undergraduate students may volunteer.',
    ],
    [
      'undergraduateLogisticsModality',
      'MODALITY',
      { modes: ['REMOTE'] },
      'Staff may work remotely, while undergraduate students work in person.',
    ],
    [
      'undergraduateLogisticsCurrentAvailability',
      'CURRENT_AVAILABILITY',
      { status: 'OPEN' },
      'Postdoctoral applications are open; undergraduate students may volunteer.',
    ],
  ])(
    'rejects %s evidence whose population and predicate occur in different clauses',
    (field, claimType, value, evidenceQuote) => {
      const result = validateUndergraduateLogisticsObservation(
        observation(field, claimType, value, evidenceQuote),
      );

      expect(result).toEqual({ rejectedReason: 'evidence_does_not_support_exact_claim' });
    },
  );

  it('rejects a predicate from a coordinated clause about another population', () => {
    const result = validateUndergraduateLogisticsObservation(
      observation(
        'undergraduateLogisticsCompensation',
        'COMPENSATION',
        { modes: ['PAID'] },
        'Graduate assistants are paid, and undergraduate students may volunteer.',
      ),
    );

    expect(result).toEqual({ rejectedReason: 'evidence_does_not_support_exact_claim' });
  });

  it.each([
    [
      'undergraduateLogisticsCompensation',
      'COMPENSATION',
      { modes: ['PAID'] },
      'Undergraduate students receive mentoring from graduate fellows who are paid.',
    ],
    [
      'undergraduateLogisticsStudentLevel',
      'STUDENT_LEVEL',
      { levels: ['FIRST_YEAR'] },
      'First-year undergraduates work with graduate students who are eligible.',
    ],
    [
      'undergraduateLogisticsTimeCommitment',
      'TIME_COMMITMENT',
      { minHours: 10, maxHours: 20, period: 'WEEK' },
      'Undergraduates work with assistants who commit 10-20 hours per week.',
    ],
    [
      'undergraduateLogisticsStudentLevel',
      'STUDENT_LEVEL',
      { levels: ['FIRST_YEAR'] },
      'First-year undergraduates mentor graduate fellows who are eligible.',
    ],
    [
      'undergraduateLogisticsModality',
      'MODALITY',
      { modes: ['REMOTE'] },
      'Undergraduates supervise assistants who work remotely.',
    ],
    [
      'undergraduateLogisticsTimeCommitment',
      'TIME_COMMITMENT',
      { minHours: 10, maxHours: 20, period: 'WEEK' },
      'Undergraduates supervise assistants who commit 10-20 hours per week.',
    ],
    [
      'undergraduateLogisticsStudentLevel',
      'STUDENT_LEVEL',
      { levels: ['FIRST_YEAR'] },
      'First-year undergraduates mentor researchers who are eligible.',
    ],
    [
      'undergraduateLogisticsCompensation',
      'COMPENSATION',
      { modes: ['PAID'] },
      'Undergraduates receive mentoring from graduate fellows who receive hourly pay.',
    ],
    [
      'undergraduateLogisticsCompensation',
      'COMPENSATION',
      { modes: ['PAID'] },
      'Undergraduates collaborate with faculty who are paid.',
    ],
    [
      'undergraduateLogisticsModality',
      'MODALITY',
      { modes: ['REMOTE'] },
      'Undergraduates support employees who work remotely.',
    ],
    [
      'undergraduateLogisticsCurrentAvailability',
      'CURRENT_AVAILABILITY',
      { status: 'OPEN' },
      'Undergraduate positions support researchers whose applications are open.',
    ],
    [
      'undergraduateLogisticsTimeCommitment',
      'TIME_COMMITMENT',
      { minHours: 10, maxHours: 20, period: 'WEEK' },
      'Undergraduates mentor researchers who commit 10-20 hours per week.',
    ],
    [
      'undergraduateLogisticsCompensation',
      'COMPENSATION',
      { modes: ['STIPEND'] },
      'Undergraduates mentor researchers offered a stipend.',
    ],
    [
      'undergraduateLogisticsStudentLevel',
      'STUDENT_LEVEL',
      { levels: ['FIRST_YEAR'] },
      'First-year undergraduates mentor researchers considered eligible.',
    ],
    [
      'undergraduateLogisticsModality',
      'MODALITY',
      { modes: ['REMOTE'] },
      'Undergraduates supervise employees working remotely.',
    ],
    [
      'undergraduateLogisticsCurrentAvailability',
      'CURRENT_AVAILABILITY',
      { status: 'ROLLING' },
      'Undergraduate opportunities support researchers accepting rolling applications.',
    ],
    [
      'undergraduateLogisticsTimeCommitment',
      'TIME_COMMITMENT',
      { minHours: 10, maxHours: 20, period: 'WEEK' },
      'Undergraduates mentor researchers committing 10-20 hours per week.',
    ],
  ])(
    'rejects %s predicates scoped to a subordinate population',
    (field, claimType, value, evidenceQuote) => {
      const result = validateUndergraduateLogisticsObservation(
        observation(field, claimType, value, evidenceQuote),
      );

      expect(result).toEqual({ rejectedReason: 'evidence_does_not_support_exact_claim' });
    },
  );

  it('requires student levels to be stated as an eligibility policy', () => {
    const historical = validateUndergraduateLogisticsObservation(
      observation(
        'undergraduateLogisticsStudentLevel',
        'STUDENT_LEVEL',
        { levels: ['FIRST_YEAR'] },
        'First-year undergraduate students presented their research.',
      ),
    );
    const eligible = validateUndergraduateLogisticsObservation(
      observation(
        'undergraduateLogisticsStudentLevel',
        'STUDENT_LEVEL',
        { levels: ['FIRST_YEAR'] },
        'First-year undergraduate students are eligible for research positions.',
      ),
    );
    const policyForAnotherLevel = validateUndergraduateLogisticsObservation(
      observation(
        'undergraduateLogisticsStudentLevel',
        'STUDENT_LEVEL',
        { levels: ['FIRST_YEAR'] },
        'First-year undergraduates presented their research, and juniors may apply.',
      ),
    );

    expect(historical).toEqual({ rejectedReason: 'evidence_does_not_support_exact_claim' });
    expect(policyForAnotherLevel).toEqual({
      rejectedReason: 'evidence_does_not_support_exact_claim',
    });
    expect(eligible.accepted?.value).toEqual({ levels: ['FIRST_YEAR'] });
  });

  it('rejects student-level eligibility for an unrelated benefit', () => {
    const result = validateUndergraduateLogisticsObservation(
      observation(
        'undergraduateLogisticsStudentLevel',
        'STUDENT_LEVEL',
        { levels: ['FIRST_YEAR'] },
        'First-year undergraduate students are eligible for travel grants.',
      ),
    );

    expect(result).toEqual({ rejectedReason: 'evidence_does_not_support_exact_claim' });
  });

  it('does not infer first-year standing from a graduation year', () => {
    const result = validateUndergraduateLogisticsObservation(
      observation(
        'undergraduateLogisticsStudentLevel',
        'STUDENT_LEVEL',
        { levels: ['FIRST_YEAR'] },
        'Undergraduate students in the class of 2027 are eligible.',
      ),
    );

    expect(result).toEqual({ rejectedReason: 'evidence_does_not_support_exact_claim' });
  });

  it('matches complete numeric hour tokens including decimals', () => {
    const unsupported = validateUndergraduateLogisticsObservation(
      observation(
        'undergraduateLogisticsTimeCommitment',
        'TIME_COMMITMENT',
        { minHours: 5, maxHours: 5, period: 'WEEK' },
        'Students work 15 hours per week.',
      ),
    );
    const supported = validateUndergraduateLogisticsObservation(
      observation(
        'undergraduateLogisticsTimeCommitment',
        'TIME_COMMITMENT',
        { minHours: 7.5, maxHours: 7.5, period: 'WEEK' },
        'Undergraduate research assistants work 7.50 hours per week.',
      ),
    );

    expect(unsupported).toEqual({ rejectedReason: 'evidence_does_not_support_exact_claim' });
    expect(supported.accepted?.value).toEqual({ minHours: 7.5, maxHours: 7.5, period: 'WEEK' });
  });

  it.each([
    [
      'undergraduateLogisticsStudentLevel',
      'STUDENT_LEVEL',
      { levels: ['SENIOR'] },
      'First-year undergraduate students are eligible, except seniors.',
    ],
    [
      'undergraduateLogisticsCompensation',
      'COMPENSATION',
      { modes: ['PAID'] },
      'Undergraduate students are not eligible for paid positions.',
    ],
    [
      'undergraduateLogisticsCurrentAvailability',
      'CURRENT_AVAILABILITY',
      { status: 'ROLLING' },
      'Undergraduate students may apply for rolling admission only if they are graduate students.',
    ],
  ])('rejects excluded or conditional values for %s', (field, claimType, value, evidenceQuote) => {
    const result = validateUndergraduateLogisticsObservation(
      observation(field, claimType, value, evidenceQuote),
    );

    expect(result).toEqual({ rejectedReason: 'evidence_does_not_support_exact_claim' });
  });

  it('requires one affirmative expression for a weekly hour range', () => {
    const contradicted = validateUndergraduateLogisticsObservation(
      observation(
        'undergraduateLogisticsTimeCommitment',
        'TIME_COMMITMENT',
        { minHours: 10, maxHours: 20, period: 'WEEK' },
        'Undergraduate students work 10 hours per week, not 20 hours per week.',
      ),
    );
    const supported = validateUndergraduateLogisticsObservation(
      observation(
        'undergraduateLogisticsTimeCommitment',
        'TIME_COMMITMENT',
        { minHours: 10, maxHours: 20, period: 'WEEK' },
        'Undergraduate research assistants work 10 to 20 hours per week.',
      ),
    );

    expect(contradicted).toEqual({ rejectedReason: 'evidence_does_not_support_exact_claim' });
    expect(supported.accepted?.value).toEqual({
      minHours: 10,
      maxHours: 20,
      period: 'WEEK',
    });
  });

  it.each([
    ['Undergraduate students asked whether 10 to 20 hours per week would be possible.'],
    ['Undergraduate students discussed a proposed 10 to 20 hours per week commitment.'],
    ['Undergraduate students would prefer to work 10 to 20 hours per week.'],
  ])('rejects non-declarative weekly-hours evidence: %s', (evidenceQuote) => {
    const result = validateUndergraduateLogisticsObservation(
      observation(
        'undergraduateLogisticsTimeCommitment',
        'TIME_COMMITMENT',
        { minHours: 10, maxHours: 20, period: 'WEEK' },
        evidenceQuote,
      ),
    );

    expect(result).toEqual({ rejectedReason: 'evidence_does_not_support_exact_claim' });
  });

  it.each([
    [
      'undergraduateLogisticsCompensation',
      'COMPENSATION',
      { modes: ['PAID'] },
      'Undergraduate students asked whether paid positions are available.',
    ],
    [
      'undergraduateLogisticsCompensation',
      'COMPENSATION',
      { modes: ['PAID'] },
      'Are undergraduate students paid for this work?',
    ],
    [
      'undergraduateLogisticsModality',
      'MODALITY',
      { modes: ['REMOTE'] },
      'Undergraduate students discussed whether remote work might be possible.',
    ],
    [
      'undergraduateLogisticsCurrentAvailability',
      'CURRENT_AVAILABILITY',
      { status: 'ROLLING' },
      'Undergraduate students would prefer rolling applications.',
    ],
    [
      'undergraduateLogisticsCurrentAvailability',
      'CURRENT_AVAILABILITY',
      { status: 'OPEN' },
      'Undergraduate students asked whether applications are open.',
    ],
  ])('rejects non-declarative enum evidence for %s', (field, claimType, value, evidenceQuote) => {
    const result = validateUndergraduateLogisticsObservation(
      observation(field, claimType, value, evidenceQuote),
    );

    expect(result).toEqual({ rejectedReason: 'evidence_does_not_support_exact_claim' });
  });

  it.each([
    'Undergraduate students submit non-rolling applications.',
    'Undergraduate students submit non‑rolling applications.',
    'Undergraduate students submit non rolling applications.',
  ])('rejects explicitly non-rolling availability: %s', (evidenceQuote) => {
    const result = validateUndergraduateLogisticsObservation(
      observation(
        'undergraduateLogisticsCurrentAvailability',
        'CURRENT_AVAILABILITY',
        { status: 'ROLLING' },
        evidenceQuote,
      ),
    );

    expect(result).toEqual({ rejectedReason: 'evidence_does_not_support_exact_claim' });
  });

  it('rejects claims without a safe source or verified quote', () => {
    const unsafe = validateUndergraduateLogisticsObservation(
      observation(
        'undergraduateLogisticsStudentLevel',
        'STUDENT_LEVEL',
        { levels: ['JUNIOR'] },
        'Applicants must be juniors.',
        { sourceUrl: 'javascript:alert(1)' },
      ),
    );
    const unverified = validateUndergraduateLogisticsObservation({
      ...observation(
        'undergraduateLogisticsStudentLevel',
        'STUDENT_LEVEL',
        { levels: ['JUNIOR'] },
        'Applicants must be juniors.',
      ),
      value: {
        schemaVersion: 1,
        claimType: 'STUDENT_LEVEL',
        value: { levels: ['JUNIOR'] },
        evidenceQuote: 'Applicants must be juniors.',
        quoteVerified: false,
      },
    });

    expect(unsafe.rejectedReason).toBe('missing_safe_public_source_url');
    expect(unverified.rejectedReason).toBe('quote_not_verified');
  });

  it('treats date-only validity as inclusive while preserving timestamp precision', () => {
    const base = observation(
      'undergraduateLogisticsCompensation',
      'COMPENSATION',
      { modes: ['PAID'] },
      'Undergraduate research assistants are paid.',
    );
    const dateOnly = validateUndergraduateLogisticsObservation({
      ...base,
      value: { ...base.value, validThrough: '2026-07-15' },
    });
    const timestamp = validateUndergraduateLogisticsObservation({
      ...base,
      value: { ...base.value, validThrough: '2026-07-15T09:30:00.000Z' },
    });

    expect(dateOnly.accepted?.expiresAt.toISOString()).toBe('2026-07-15T23:59:59.999Z');
    expect(timestamp.accepted?.expiresAt.toISOString()).toBe('2026-07-15T09:30:00.000Z');
  });

  it('keeps dry-run write-free and uses the same unique upsert key on repeated materialization', async () => {
    const paidObservation = observation(
      'undergraduateLogisticsCompensation',
      'COMPENSATION',
      { modes: ['PAID'] },
      'Undergraduate research assistants are paid $18 per hour.',
    );
    persistenceMocks.observationFind.mockReturnValue({ lean: async () => [paidObservation] });
    const input = {
      researchEntityId: '64b000000000000000000010',
      entityKey: 'sample-lab',
      now: NOW,
    };

    await materializeUndergraduateLogisticsForResearchEntity({ ...input, dryRun: true });
    expect(persistenceMocks.claimUpdateOne).not.toHaveBeenCalled();
    expect(persistenceMocks.claimUpdateMany).not.toHaveBeenCalled();

    await materializeUndergraduateLogisticsForResearchEntity(input);
    await materializeUndergraduateLogisticsForResearchEntity(input);

    expect(persistenceMocks.claimUpdateOne).toHaveBeenCalledTimes(2);
    expect(persistenceMocks.claimUpdateOne.mock.calls.map(([filter]) => filter)).toEqual([
      {
        researchEntityId: input.researchEntityId,
        type: 'COMPENSATION',
        derivationKey: 'logistics:COMPENSATION',
      },
      {
        researchEntityId: input.researchEntityId,
        type: 'COMPENSATION',
        derivationKey: 'logistics:COMPENSATION',
      },
    ]);
    expect(
      persistenceMocks.claimUpdateOne.mock.calls.every(([, , options]) => options.upsert === true),
    ).toBe(true);
  });
});

describe('lab-as-subject non-acceptance availability (symmetric to direct recruiting)', () => {
  it.each([
    'not accepting undergraduates',
    'We are not currently accepting undergraduate researchers.',
    'We are currently not accepting undergraduate students.',
    'We are not currently accepting undergraduate students for research positions.',
    'We are currently not accepting undergraduate students for research opportunities.',
  ])('accepts NOT_CURRENTLY_AVAILABLE for lab-as-subject non-acceptance: %s', (evidenceQuote) => {
    const result = validateUndergraduateLogisticsObservation(
      observation(
        'undergraduateLogisticsCurrentAvailability',
        'CURRENT_AVAILABILITY',
        { status: 'NOT_CURRENTLY_AVAILABLE' },
        evidenceQuote,
      ),
    );

    expect(result).toMatchObject({
      accepted: { claimType: 'CURRENT_AVAILABILITY', value: { status: 'NOT_CURRENTLY_AVAILABLE' } },
    });
  });

  it.each([
    'I do not have bandwidth to respond to inquiries about undergraduate research opportunities.',
    'Please do not email about openings.',
    'We are now accepting undergraduate applications.',
    'We are not accepting late applications.',
    'Graduate students are not accepted for this position.',
    'We are recruiting undergraduate students to join our lab.',
  ])('rejects NOT_CURRENTLY_AVAILABLE for non-availability or positive phrasing: %s', (evidenceQuote) => {
    const result = validateUndergraduateLogisticsObservation(
      observation(
        'undergraduateLogisticsCurrentAvailability',
        'CURRENT_AVAILABILITY',
        { status: 'NOT_CURRENTLY_AVAILABLE' },
        evidenceQuote,
      ),
    );

    expect(result).toEqual({ rejectedReason: 'evidence_does_not_support_exact_claim' });
  });

  it('exposes quoteExplicitlyDeclinesUndergraduates for scraper-side derivation', () => {
    expect(quoteExplicitlyDeclinesUndergraduates('not accepting undergraduates')).toBe(true);
    expect(
      quoteExplicitlyDeclinesUndergraduates(
        'We are not currently accepting undergraduate researchers.',
      ),
    ).toBe(true);
    expect(
      quoteExplicitlyDeclinesUndergraduates(
        'I do not have bandwidth to respond to inquiries about undergraduate research opportunities.',
      ),
    ).toBe(false);
    expect(
      quoteExplicitlyDeclinesUndergraduates('We are now accepting undergraduate applications.'),
    ).toBe(false);
  });
});

describe('currentUndergradAvailabilityFromSignals', () => {
  const freshExpiry = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
  const staleExpiry = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);

  it('returns the status from a fresh KNOWN CURRENT_AVAILABILITY signal', () => {
    expect(
      currentUndergradAvailabilityFromSignals(
        [{ type: 'CURRENT_AVAILABILITY', status: 'KNOWN', value: { status: 'OPEN' }, expiresAt: freshExpiry }],
        NOW,
      ),
    ).toBe('OPEN');
    expect(
      currentUndergradAvailabilityFromSignals(
        [
          {
            type: 'CURRENT_AVAILABILITY',
            status: 'KNOWN',
            value: { status: 'ROLLING' },
            expiresAt: freshExpiry,
          },
        ],
        NOW,
      ),
    ).toBe('ROLLING');
  });

  it('fails closed to UNKNOWN when the signal has expired, even if status is still KNOWN', () => {
    expect(
      currentUndergradAvailabilityFromSignals(
        [{ type: 'CURRENT_AVAILABILITY', status: 'KNOWN', value: { status: 'OPEN' }, expiresAt: staleExpiry }],
        NOW,
      ),
    ).toBe('UNKNOWN');
  });

  it('fails closed to UNKNOWN when the signal is STALE_UNDER_REVIEW or CONFLICTING_WITHHELD', () => {
    expect(
      currentUndergradAvailabilityFromSignals(
        [
          {
            type: 'CURRENT_AVAILABILITY',
            status: 'STALE_UNDER_REVIEW',
            expiresAt: freshExpiry,
          },
        ],
        NOW,
      ),
    ).toBe('UNKNOWN');
    expect(
      currentUndergradAvailabilityFromSignals(
        [
          {
            type: 'CURRENT_AVAILABILITY',
            status: 'CONFLICTING_WITHHELD',
            expiresAt: freshExpiry,
          },
        ],
        NOW,
      ),
    ).toBe('UNKNOWN');
  });

  it('fails closed to UNKNOWN when no CURRENT_AVAILABILITY signal is present', () => {
    expect(currentUndergradAvailabilityFromSignals([], NOW)).toBe('UNKNOWN');
    expect(
      currentUndergradAvailabilityFromSignals(
        [{ type: 'PAST_UNDERGRADS', status: 'KNOWN', expiresAt: freshExpiry }],
        NOW,
      ),
    ).toBe('UNKNOWN');
  });

  it('surfaces NOT_CURRENTLY_AVAILABLE distinctly from UNKNOWN', () => {
    expect(
      currentUndergradAvailabilityFromSignals(
        [
          {
            type: 'CURRENT_AVAILABILITY',
            status: 'KNOWN',
            value: { status: 'NOT_CURRENTLY_AVAILABLE' },
            expiresAt: freshExpiry,
          },
        ],
        NOW,
      ),
    ).toBe('NOT_CURRENTLY_AVAILABLE');
  });
});
