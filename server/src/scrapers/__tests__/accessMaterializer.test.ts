import { describe, expect, it } from 'vitest';
import {
  deriveAccessArtifactsFromObservations,
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
  it('keeps independent-study evidence as formalization signals when explicit', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({ field: 'offersIndependentStudy', value: true, confidence: 0.7 }),
      obs({
        field: 'independentStudyCourses',
        value: [{ code: 'HIST 491', title: 'Senior Essay' }],
        confidence: 0.7,
      }),
    ]);

    expect(result.entryPathways).toEqual([]);
    expect(result.accessSignals.map((signal) => signal.signalType).sort()).toEqual([
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

    expect(result.entryPathways).toEqual([]);
    expect(result.accessSignals.map((signal) => signal.signalType)).toEqual([
      'CREDIT_FORMALIZATION_POSSIBLE',
    ]);
  });

  it('turns listed current undergrads into exploratory outreach evidence', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({ field: 'currentUndergradCount', value: 2, confidence: 0.5 }),
    ]);

    expect(result.entryPathways).toMatchObject([
      {
        pathwayType: 'EXPLORATORY_CONTACT',
        status: 'PLAUSIBLE',
      },
    ]);
    expect(result.accessSignals).toMatchObject([
      {
        signalType: 'CURRENT_UNDERGRADS',
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

    expect(result.entryPathways).toMatchObject([
      {
        pathwayType: 'EXPLORATORY_CONTACT',
        status: 'PLAUSIBLE',
        compensation: 'UNKNOWN',
        bestNextStep: 'Plan outreach and ask how student projects are usually formalized.',
      },
    ]);
    expect(result.accessSignals.map((signal) => signal.signalType).sort()).toEqual([
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

    expect(result.entryPathways).toHaveLength(1);
    expect(result.entryPathways[0]).toMatchObject({
      pathwayType: 'EXPLORATORY_CONTACT',
      status: 'PLAUSIBLE',
      compensation: 'UNKNOWN',
    });
    expect(result.accessSignals.map((signal) => signal.signalType).sort()).toEqual([
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
        signalType: 'CURRENT_UNDERGRADS',
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

    expect(result.entryPathways).toEqual([]);
    expect(result.accessSignals).toEqual([]);
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

    expect(result.entryPathways).toEqual([]);
    expect(result.accessSignals).toMatchObject([
      {
        signalType: 'NOT_CURRENTLY_AVAILABLE',
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

    expect(result.entryPathways).toMatchObject([
      {
        pathwayType: 'EXPLORATORY_CONTACT',
        status: 'PLAUSIBLE',
      },
    ]);
    expect(result.accessSignals.map((signal) => signal.signalType).sort()).toEqual([
      'APPLICATION_FORM_EXISTS',
      'CONTACT_INSTRUCTIONS_EXIST',
      'REACH_OUT_PLAUSIBLE',
    ]);
    expect(result.contactRoutes).toMatchObject([
      {
        routeType: 'OFFICIAL_APPLICATION',
        visibility: 'PUBLIC',
        contactPolicy: 'APPLICATION_ONLY',
        url: 'https://lab.example.edu/join',
      },
    ]);
  });

  it('redacts direct contact details from public signal excerpts', () => {
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
        expect.objectContaining({
          signalType: 'REACH_OUT_PLAUSIBLE',
          excerpt: 'Email [email redacted] to apply.',
        }),
        expect.objectContaining({
          signalType: 'CONTACT_INSTRUCTIONS_EXIST',
          excerpt: 'Call [phone redacted] or email [email redacted].',
        }),
      ]),
    );
  });

  it('derives guarded contact routes from contact observations', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({ field: 'contactName', value: 'Ada Manager' }),
      obs({ field: 'contactEmail', value: 'Ada.Manager@Yale.edu' }),
      obs({ field: 'contactRole', value: 'Lab Manager' }),
    ]);

    expect(result.contactRoutes).toMatchObject([
      {
        routeType: 'LAB_MANAGER',
        email: 'Ada.Manager@Yale.edu',
        name: 'Ada Manager',
        role: 'Lab Manager',
        visibility: 'AUTHENTICATED',
        contactPolicy: 'DIRECT_CONTACT_OK',
      },
    ]);
  });

  it('derives public course-instructor routes from explicit non-CourseTable contact evidence', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'contactName',
        value: 'Beverly Gage',
        sourceName: 'department-research-pathways',
        confidence: 0.7,
      }),
      obs({
        field: 'contactRole',
        value: 'Course instructor for independent-study research',
        sourceName: 'department-research-pathways',
        confidence: 0.7,
      }),
    ]);

    expect(result.contactRoutes).toMatchObject([
      {
        routeType: 'COURSE_INSTRUCTOR',
        name: 'Beverly Gage',
        role: 'Course instructor for independent-study research',
        visibility: 'PUBLIC',
        contactPolicy: 'OFFICIAL_ROUTE_PREFERRED',
        rationale: 'Derived from explicit course instructor evidence.',
      },
    ]);
    expect(result.contactRoutes[0].email).toBeUndefined();
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

    expect(first.entryPathways).toHaveLength(0);
    expect(first.accessSignals).toHaveLength(1);
    expect(first.entryPathways.map((pathway) => pathway.derivationKey)).toEqual(
      second.entryPathways.map((pathway) => pathway.derivationKey),
    );
    expect(first.accessSignals.map((signal) => signal.derivationKey)).toEqual(
      second.accessSignals.map((signal) => signal.derivationKey),
    );
  });
});
