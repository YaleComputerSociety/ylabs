import { describe, expect, it } from 'vitest';
import {
  deriveAccessArtifactsFromObservations,
  deriveAccessArtifactsForResearchGroup,
  deriveIdentifiedLeadWaysIn,
  normalizeAccessMaterializerObjectId,
  officialNonGrantSourceUrl,
  type AccessObservation,
} from '../accessMaterializer';

const D = new Date('2026-05-07T12:00:00.000Z');

function obs(overrides: Partial<AccessObservation>): AccessObservation {
  return {
    _id: overrides._id || `obs-${overrides.field || 'field'}`,
    entityKey: 'smith-lab',
    field: overrides.field || 'field',
    value: overrides.value,
    sourceName: overrides.sourceName || 'test-source',
    sourceUrl: overrides.sourceUrl || 'https://example.test/source',
    confidence: overrides.confidence ?? 0.8,
    observedAt: overrides.observedAt || D,
  };
}

describe('deriveAccessArtifactsFromObservations', () => {
  it('normalizes access materializer ObjectIds without object-shaped coercion', () => {
    expect(normalizeAccessMaterializerObjectId(' 64f000000000000000000001 ')).toBe(
      '64f000000000000000000001',
    );
    expect(normalizeAccessMaterializerObjectId('abcdefghijkl')).toBeUndefined();
    expect(
      normalizeAccessMaterializerObjectId({
        toString: () => '64f000000000000000000001',
      }),
    ).toBeUndefined();
  });

  it('keeps independent-study evidence as formalization signals when explicit', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({ field: 'offersIndependentStudy', value: true, confidence: 0.7 }),
      obs({
        field: 'independentStudyCourses',
        value: [{ code: 'HIST 491', title: 'Senior Essay' }],
        confidence: 0.7,
      }),
    ]);

    expect(result.accessSignals.map((signal) => signal.type).sort()).toEqual([
      'CREDIT_FORMALIZATION_POSSIBLE',
      'FACULTY_SUPERVISES_STUDENT_PROJECTS',
    ]);
    expect(result.accessSignals.every((signal) => signal.confidenceScore === 0.7)).toBe(true);
  });

  it('does not turn course-specific acceptingUndergrads into generic exploratory outreach', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'offersIndependentStudy',
        value: true,
        sourceName: 'department-research-pathways',
        confidence: 0.7,
      }),
      obs({
        field: 'independentStudyCourses',
        value: [{ code: 'MCDB 471', title: 'Independent Research' }],
        sourceName: 'department-research-pathways',
        confidence: 0.7,
      }),
      obs({
        field: 'acceptingUndergrads',
        value: true,
        sourceName: 'department-research-pathways',
        confidence: 0.7,
      }),
    ]);

    expect(result.accessSignals.map((signal) => signal.type)).toEqual([
      'CREDIT_FORMALIZATION_POSSIBLE',
    ]);
  });

  it('turns listed current undergrads into exploratory outreach evidence', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({ field: 'currentUndergradCount', value: 2, confidence: 0.5 }),
    ]);

    expect(result.accessSignals).toMatchObject([
      {
        type: 'CURRENT_UNDERGRADS',
        confidence: 'MEDIUM',
        confidenceScore: 0.5,
      },
    ]);
  });

  it('turns past undergraduate advisees into exploratory outreach plus fellowship-compatible evidence', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'pastUndergradAdvisees',
        value: [{ year: 2025, programName: 'STARS', count: 2 }],
        sourceName: 'undergrad-fellowships-recipients',
        confidence: 0.8,
      }),
    ]);

    expect(result.accessSignals.map((signal) => signal.type).sort()).toEqual([
      'FELLOWSHIP_COMPATIBLE',
      'PAST_UNDERGRADS',
    ]);
    expect(result.accessSignals.every((signal) => signal.confidence === 'HIGH')).toBe(true);
  });

  it('does not turn fellowship-recipient legacy accepting fields into generic outreach', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'pastUndergradAdvisees',
        value: [{ year: 2025, programName: 'STARS', count: 2 }],
        sourceName: 'undergrad-fellowships-recipients',
        confidence: 0.8,
      }),
      obs({
        field: 'acceptingUndergrads',
        value: true,
        sourceName: 'undergrad-fellowships-recipients',
        confidence: 0.8,
      }),
    ]);

    expect(result.accessSignals.map((signal) => signal.type).sort()).toEqual([
      'FELLOWSHIP_COMPATIBLE',
      'PAST_UNDERGRADS',
    ]);
  });

  it('uses the original observation confidence, not resolved field confidence', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'currentUndergradCount',
        value: 3,
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.32,
      }),
    ]);

    expect(result.accessSignals).toMatchObject([
      {
        type: 'CURRENT_UNDERGRADS',
        confidence: 'LOW',
        confidenceScore: 0.32,
        originalConfidence: 0.32,
        sourceName: 'lab-microsite-undergrad-llm',
      },
    ]);
  });

  it('does not turn YSM/YSE entity-discovery booleans into access evidence', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'acceptingUndergrads',
        value: true,
        sourceName: 'ysm-atoz-index',
        confidence: 0.9,
      }),
      obs({
        field: 'acceptingUndergrads',
        value: true,
        sourceName: 'yse-centers-index',
        confidence: 0.9,
      }),
    ]);

    expect(result.accessSignals).toEqual([]);
  });

  it('does not derive reach-out-plausible from a single bare acceptingUndergrads=true (#696)', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'acceptingUndergrads',
        value: true,
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.6,
      }),
    ]);

    expect(result.accessSignals.map((signal) => signal.type)).not.toContain('REACH_OUT_PLAUSIBLE');
  });

  it('derives reach-out-plausible when a bare accepting boolean carries an undergrad-access quote (#696)', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'acceptingUndergrads',
        value: true,
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.6,
      }),
      obs({
        field: 'undergradEvidenceQuote',
        value: 'Undergraduates are welcome to join the lab.',
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.6,
      }),
    ]);

    expect(result.accessSignals).toMatchObject([
      {
        type: 'REACH_OUT_PLAUSIBLE',
        excerpt: 'Undergraduates are welcome to join the lab.',
      },
    ]);
  });

  it('derives reach-out-plausible when a second independent source corroborates accepting (#696)', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'acceptingUndergrads',
        value: true,
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.6,
      }),
      obs({
        field: 'acceptingUndergrads',
        value: true,
        sourceName: 'department-faculty-roster',
        confidence: 0.6,
      }),
    ]);

    expect(result.accessSignals.map((signal) => signal.type)).toContain('REACH_OUT_PLAUSIBLE');
  });

  it('does not corroborate accepting from repeated observations of the same source (#696)', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        _id: 'accepting-a',
        field: 'acceptingUndergrads',
        value: true,
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.6,
      }),
      obs({
        _id: 'accepting-b',
        field: 'acceptingUndergrads',
        value: true,
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.6,
      }),
    ]);

    expect(result.accessSignals.map((signal) => signal.type)).not.toContain('REACH_OUT_PLAUSIBLE');
  });

  it('stores explicit negative availability as a signal without creating a pathway', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'acceptingUndergrads',
        value: false,
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.5,
      }),
      obs({
        field: 'undergradEvidenceQuote',
        value: 'We are not taking undergraduate researchers this year.',
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.5,
      }),
    ]);

    expect(result.accessSignals).toMatchObject([
      {
        type: 'NOT_CURRENTLY_AVAILABLE',
        confidence: 'MEDIUM',
        excerpt: 'We are not taking undergraduate researchers this year.',
      },
    ]);
  });

  it('derives official application routes from lab-microsite join-page evidence', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'undergradAccessEvidence',
        value: {
          openToUndergrads: 'yes',
          evidenceSource: 'explicit_text',
          evidenceQuote: 'We invite undergraduates to apply.',
        },
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.5,
      }),
      obs({
        field: 'joinPageUrl',
        value: 'https://lab.example.edu/join',
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.5,
      }),
      obs({
        field: 'contactInstructionsQuote',
        value: 'Apply using the form on this page.',
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.5,
      }),
    ]);

    expect(result.accessSignals.map((signal) => signal.type).sort()).toEqual([
      'APPLICATION_FORM_EXISTS',
      'CONTACT_INSTRUCTIONS_EXIST',
      'REACH_OUT_PLAUSIBLE',
    ]);
  });

  it('treats department undergraduate research pages as access evidence, not posted openings', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'undergradAccessEvidence',
        value: {
          openToUndergrads: 'yes',
          evidenceSource: 'department_undergrad_research_page',
        },
        sourceName: 'department-undergrad-research',
        sourceUrl: 'https://chem.yale.edu/undergraduate-research',
        confidence: 0.8,
      }),
      obs({
        field: 'undergradEvidenceQuote',
        value:
          'Students interested in research should contact the faculty member directly to explore opportunities.',
        sourceName: 'department-undergrad-research',
        sourceUrl: 'https://chem.yale.edu/undergraduate-research',
        confidence: 0.8,
      }),
      obs({
        field: 'acceptingUndergrads',
        value: true,
        sourceName: 'department-undergrad-research',
        sourceUrl: 'https://chem.yale.edu/undergraduate-research',
        confidence: 0.75,
      }),
    ]);

    expect(result.accessSignals).toMatchObject([
      {
        type: 'REACH_OUT_PLAUSIBLE',
        excerpt:
          'Students interested in research should contact the faculty member directly to explore opportunities.',
      },
    ]);
    expect(result.accessSignals.map((signal) => signal.type)).not.toContain('POSTED_OPENING');
  });

  it('derives department structured application pages as guarded official routes', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'undergradAccessEvidence',
        value: {
          openToUndergrads: 'yes',
          evidenceSource: 'department_undergrad_research_page',
        },
        sourceName: 'department-undergrad-research',
        sourceUrl: 'https://mcdb.yale.edu/undergraduate/undergraduate-research-opportunities',
        confidence: 0.8,
      }),
      obs({
        field: 'joinPageUrl',
        value: 'https://yalesurvey.ca1.qualtrics.com/jfe/form/SV_fixture',
        sourceName: 'department-undergrad-research',
        sourceUrl: 'https://mcdb.yale.edu/undergraduate/undergraduate-research-opportunities',
        confidence: 0.8,
      }),
    ]);

    expect(result.accessSignals.map((signal) => signal.type).sort()).toEqual([
      'APPLICATION_FORM_EXISTS',
      'REACH_OUT_PLAUSIBLE',
    ]);
  });

  it('does not derive official application artifacts from a bare join page without undergraduate access evidence', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'joinPageUrl',
        value: 'https://lab.example.edu/join',
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.6,
      }),
    ]);

    expect(result.accessSignals).toEqual([]);
  });

  it('drops marker-only contact quotes from derived signal excerpts (#1112)', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'undergradAccessEvidence',
        value: {
          openToUndergrads: 'yes',
          evidenceSource: 'explicit_text',
          evidenceQuote: 'Email ada@yale.edu to apply.',
        },
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.5,
      }),
      obs({
        field: 'undergradEvidenceQuote',
        value: 'Email ada@yale.edu to apply.',
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.5,
      }),
      obs({
        field: 'contactInstructionsQuote',
        value: 'Call 203-432-1234 or email ada@yale.edu.',
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.5,
      }),
    ]);

    expect(result.accessSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'REACH_OUT_PLAUSIBLE', excerpt: undefined }),
        expect.objectContaining({ type: 'CONTACT_INSTRUCTIONS_EXIST', excerpt: undefined }),
      ]),
    );
    const serialized = JSON.stringify(result.accessSignals);
    expect(serialized).not.toContain('ada@yale.edu');
    expect(serialized).not.toContain('203-432-1234');
    expect(serialized).not.toMatch(/redacted/i);
  });

  it('keeps substantive quote prose while dropping the marker sentence in a stored excerpt (#1112)', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'undergradAccessEvidence',
        value: {
          openToUndergrads: 'yes',
          evidenceSource: 'explicit_text',
          evidenceQuote: 'We welcome undergraduate researchers each term.',
        },
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.5,
      }),
      obs({
        field: 'undergradEvidenceQuote',
        value: 'We welcome undergraduate researchers each term. Email ada@yale.edu to apply.',
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.5,
      }),
    ]);

    const reachOut = result.accessSignals.find((signal) => signal.type === 'REACH_OUT_PLAUSIBLE');
    expect(reachOut?.excerpt).toBe('We welcome undergraduate researchers each term.');
    expect(reachOut?.excerpt ?? '').not.toMatch(/\[(?:email|phone) redacted\]/i);
  });

  it('keeps a substantive contact quote while dropping its marker sentence (#1112)', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'contactInstructionsQuote',
        value:
          'Prospective students should review current projects before writing. Email ada@yale.edu with a short note.',
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.5,
      }),
    ]);

    const contactSignal = result.accessSignals.find(
      (signal) => signal.type === 'CONTACT_INSTRUCTIONS_EXIST',
    );
    expect(contactSignal?.excerpt).toMatch(/Prospective students should review current projects/i);
    expect(contactSignal?.excerpt ?? '').not.toContain('ada@yale.edu');
    expect(contactSignal?.excerpt ?? '').not.toMatch(/redacted/i);
  });

  it('derives contact-instruction signals from contact observations', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({ field: 'contactName', value: 'Ada Manager' }),
      obs({ field: 'contactEmail', value: 'Ada.Manager@Yale.edu' }),
      obs({ field: 'contactRole', value: 'Lab Manager' }),
    ]);

    expect(result.accessSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'CONTACT_INSTRUCTIONS_EXIST',
          excerpt: 'Official contact listed: Ada Manager, Lab Manager.',
        }),
      ]),
    );
  });

  it('deduplicates repeated evidence by derivation key', () => {
    const first = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({ _id: 'course-a', field: 'offersIndependentStudy', value: true, confidence: 0.7 }),
      obs({ _id: 'course-b', field: 'offersIndependentStudy', value: true, confidence: 0.7 }),
    ]);
    const second = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({ _id: 'course-a', field: 'offersIndependentStudy', value: true, confidence: 0.7 }),
      obs({ _id: 'course-b', field: 'offersIndependentStudy', value: true, confidence: 0.7 }),
    ]);

    expect(first.accessSignals).toHaveLength(1);
    expect(first.accessSignals.map((signal) => signal.derivationKey)).toEqual(
      second.accessSignals.map((signal) => signal.derivationKey),
    );
  });
});

describe('officialNonGrantSourceUrl', () => {
  it('prefers an official non-grant page over NIH/NSF/ORCID grant URLs', () => {
    expect(
      officialNonGrantSourceUrl({
        sourceUrls: [
          'https://reporter.nih.gov/project-details/123',
          'https://medicine.yale.edu/profile/jane-smith/',
        ],
      }),
    ).toBe('https://medicine.yale.edu/profile/jane-smith/');
  });

  it('returns empty when only grant/orcid sources exist', () => {
    expect(
      officialNonGrantSourceUrl({
        sourceUrls: ['https://reporter.nih.gov/project-details/1', 'https://orcid.org/0000-0002'],
      }),
    ).toBe('');
  });
});

describe('deriveAccessArtifactsForResearchGroup', () => {
  it('returns the same current evidence bundle without writing canonical artifacts', async () => {
    const result = await deriveAccessArtifactsForResearchGroup(
      { researchEntityId: '64f000000000000000000001' },
      [obs({ _id: '64f000000000000000000099', field: 'currentUndergradCount', value: 2 })],
    );

    expect(result.researchEntityId).toBe('64f000000000000000000001');
    expect(result.artifacts.accessSignals[0]).toMatchObject({
      type: 'CURRENT_UNDERGRADS',
      sourceEvidenceId: '64f000000000000000000099',
    });
  });
});

describe('deriveIdentifiedLeadWaysIn', () => {
  const supporting: AccessObservation = {
    _id: 'obs-identity',
    field: 'profileUrl',
    value: 'https://medicine.yale.edu/profile/jane-smith/',
    sourceName: 'dept-faculty-roster',
    sourceUrl: 'https://medicine.yale.edu/profile/jane-smith/',
    confidence: 0.6,
    observedAt: D,
  };

  const baseInput = {
    researchEntityId: '64f000000000000000000010',
    entity: { entityType: 'FACULTY_RESEARCH_AREA', name: 'Jane Smith Research' },
    officialUrl: 'https://medicine.yale.edu/profile/jane-smith/',
    leadName: 'Jane Smith',
    supportingObservations: [supporting],
  };

  it('derives a reach-out-plausible ways-in signal for an identified faculty lead', () => {
    const result = deriveIdentifiedLeadWaysIn(baseInput);
    expect(result.accessSignals.map((s) => s.type)).toEqual(['REACH_OUT_PLAUSIBLE']);
    // confidence is intentionally conservative (LOW / WEAK)
    expect(result.accessSignals[0].confidenceScore).toBeLessThanOrEqual(0.4);
  });

  it('skips entities flagged as duplicates by the visibility gate', () => {
    const result = deriveIdentifiedLeadWaysIn({
      ...baseInput,
      entity: { ...baseInput.entity, studentVisibilityReasons: ['exact_url_duplicate_risk'] },
    });
    expect(result.accessSignals).toHaveLength(0);
  });

  it('skips grant-only source URLs and non-home entity types', () => {
    expect(
      deriveIdentifiedLeadWaysIn({
        ...baseInput,
        officialUrl: 'https://reporter.nih.gov/project-details/1',
      }).accessSignals,
    ).toHaveLength(0);
    expect(
      deriveIdentifiedLeadWaysIn({ ...baseInput, entity: { entityType: 'PROGRAM' } }).accessSignals,
    ).toHaveLength(0);
  });

  it('requires supporting source evidence so the claim gate keeps the artifacts', () => {
    const result = deriveIdentifiedLeadWaysIn({ ...baseInput, supportingObservations: [] });
    expect(result.accessSignals).toHaveLength(0);
  });

  it('still requires an official non-grant page to emit REACH_OUT_PLAUSIBLE (creation criteria unchanged, #530)', () => {
    expect(
      deriveIdentifiedLeadWaysIn({ ...baseInput, officialUrl: '' }).accessSignals,
    ).toHaveLength(0);
    expect(
      deriveIdentifiedLeadWaysIn({ ...baseInput, officialUrl: 'ftp://chemistry.yale.edu/lab' })
        .accessSignals,
    ).toHaveLength(0);
  });
});
