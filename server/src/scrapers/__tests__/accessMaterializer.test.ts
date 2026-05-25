import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessSignal } from '../../models/accessSignal';
import { ContactRoute } from '../../models/contactRoute';
import { EntryPathway } from '../../models/entryPathway';
import {
  bestMaterializerObservation,
  buildMergedEntryPathwayData,
  deriveAccessArtifactsFromObservations,
  materializerStringValue,
  publicAccessExcerpt,
  mergeLegacyExploratoryContactPathwaysForEntity,
  type AccessObservation,
} from '../accessMaterializer';

const D = new Date('2026-05-07T12:00:00.000Z');

afterEach(() => {
  vi.restoreAllMocks();
});

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
  it('normalizes public excerpt strings and picks strongest observations through shared helpers', () => {
    const olderHigh = obs({
      field: 'undergradEvidenceQuote',
      value: 'older',
      confidence: 0.9,
      observedAt: new Date('2026-05-06T12:00:00.000Z'),
    });
    const newerLow = obs({
      field: 'undergradEvidenceQuote',
      value: 'newer',
      confidence: 0.4,
      observedAt: new Date('2026-05-08T12:00:00.000Z'),
    });

    expect(materializerStringValue('  Email fixture.contact@yale.edu.  ')).toBe(
      'Email fixture.contact@yale.edu.',
    );
    expect(publicAccessExcerpt('  Email fixture.contact@yale.edu or call 203-432-1234.  ')).toBe(
      'Email [email redacted] or call [phone redacted].',
    );
    expect(bestMaterializerObservation([newerLow, olderHigh])).toBe(olderHigh);
  });

  it('merges duplicate pathway source data without repeating existing evidence', () => {
    const result = buildMergedEntryPathwayData([
      {
        sourceEvidenceIds: ['64f000000000000000000010', '64f000000000000000000011'],
        sourceUrls: ['https://example.test/source-a'],
        confidence: 0.5,
        lastObservedAt: new Date('2026-05-01T00:00:00.000Z'),
      },
      {
        sourceEvidenceIds: ['64f000000000000000000011', '64f000000000000000000012'],
        sourceUrls: ['https://example.test/source-a', 'https://example.test/source-b'],
        confidence: 0.7,
        lastObservedAt: new Date('2026-05-03T00:00:00.000Z'),
      },
    ]);

    expect(result).toEqual({
      sourceEvidenceIds: [
        '64f000000000000000000010',
        '64f000000000000000000011',
        '64f000000000000000000012',
      ],
      sourceUrls: ['https://example.test/source-a', 'https://example.test/source-b'],
      confidence: 0.7,
      lastObservedAt: new Date('2026-05-03T00:00:00.000Z'),
    });
  });

  it('merges legacy exploratory pathway rows into the canonical row before archiving them', async () => {
    const canonicalPathwayId = '64f0000000000000000000a0';
    const legacyPathwayIds = [
      '64f0000000000000000000b0',
      '64f0000000000000000000b1',
    ];
    const now = new Date('2026-05-10T00:00:00.000Z');
    vi.setSystemTime(now);

    vi.spyOn(EntryPathway, 'find').mockReturnValue({
      select: () => ({
        lean: async () => [
          {
            _id: legacyPathwayIds[0],
            sourceEvidenceIds: ['64f000000000000000000001'],
            sourceUrls: ['https://example.test/legacy-a'],
            confidence: 0.6,
            lastObservedAt: new Date('2026-05-02T00:00:00.000Z'),
            lastMaterializedAt: new Date('2026-05-03T00:00:00.000Z'),
          },
          {
            _id: legacyPathwayIds[1],
            sourceEvidenceIds: [
              '64f000000000000000000001',
              '64f000000000000000000002',
            ],
            sourceUrls: ['https://example.test/legacy-b'],
            confidence: 0.9,
            lastObservedAt: new Date('2026-05-06T00:00:00.000Z'),
            lastMaterializedAt: new Date('2026-05-07T00:00:00.000Z'),
          },
        ],
      }),
    } as any);
    vi.spyOn(EntryPathway, 'findById').mockReturnValue({
      select: () => ({
        lean: async () => ({
          _id: canonicalPathwayId,
          sourceEvidenceIds: ['64f000000000000000000003'],
          sourceUrls: ['https://example.test/canonical'],
          confidence: 0.4,
          lastObservedAt: new Date('2026-05-01T00:00:00.000Z'),
          lastMaterializedAt: new Date('2026-05-01T00:00:00.000Z'),
        }),
      }),
    } as any);
    const updateOne = vi
      .spyOn(EntryPathway, 'updateOne')
      .mockResolvedValue({ modifiedCount: 1 } as any);
    const archiveLegacy = vi
      .spyOn(EntryPathway, 'updateMany')
      .mockResolvedValue({ modifiedCount: 2 } as any);
    const relinkSignals = vi
      .spyOn(AccessSignal, 'updateMany')
      .mockResolvedValue({ modifiedCount: 3 } as any);
    const relinkRoutes = vi
      .spyOn(ContactRoute, 'updateMany')
      .mockResolvedValue({ modifiedCount: 4 } as any);

    const result = await mergeLegacyExploratoryContactPathwaysForEntity(
      '64f000000000000000000099',
      canonicalPathwayId,
    );

    expect(updateOne).toHaveBeenCalledWith(
      { _id: canonicalPathwayId },
      {
        $addToSet: {
          sourceEvidenceIds: {
            $each: [
              '64f000000000000000000003',
              '64f000000000000000000001',
              '64f000000000000000000002',
            ],
          },
          sourceUrls: {
            $each: [
              'https://example.test/canonical',
              'https://example.test/legacy-a',
              'https://example.test/legacy-b',
            ],
          },
        },
        $max: {
          confidence: 0.9,
          lastObservedAt: new Date('2026-05-06T00:00:00.000Z'),
          lastMaterializedAt: new Date('2026-05-07T00:00:00.000Z'),
        },
      },
    );
    expect(relinkSignals).toHaveBeenCalledWith(
      { entryPathwayId: { $in: legacyPathwayIds }, archived: { $ne: true } },
      { $set: { entryPathwayId: canonicalPathwayId, lastMaterializedAt: now } },
    );
    expect(relinkRoutes).toHaveBeenCalledWith(
      { entryPathwayId: { $in: legacyPathwayIds }, archived: { $ne: true } },
      { $set: { entryPathwayId: canonicalPathwayId, lastMaterializedAt: now } },
    );
    expect(archiveLegacy).toHaveBeenCalledWith(
      { _id: { $in: legacyPathwayIds }, archived: { $ne: true } },
      { $set: { archived: true, lastMaterializedAt: now } },
    );
    expect(result).toMatchObject({
      canonicalPathwayId,
      legacyPathwayIds,
      canonicalUpdated: 1,
      relinkedAccessSignals: 3,
      relinkedContactRoutes: 4,
      archivedLegacyPathways: 2,
    });

    vi.useRealTimers();
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

  it('collapses multiple exploratory access signals into one student-facing pathway', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({ field: 'currentUndergradCount', value: 2, confidence: 0.5 }),
      obs({
        field: 'undergradAccessEvidence',
        value: {
          openToUndergrads: 'yes',
          evidenceSource: 'explicit_text',
          evidenceQuote: 'Undergraduates are welcome to participate.',
        },
        sourceName: 'lab-microsite-undergrad-llm',
        sourceUrl: 'https://example.test/join',
        confidence: 0.7,
      }),
      obs({
        field: 'undergradEvidenceQuote',
        value: 'Undergraduates are welcome to participate.',
        sourceName: 'lab-microsite-undergrad-llm',
        sourceUrl: 'https://example.test/join',
        confidence: 0.7,
      }),
    ]);

    expect(result.entryPathways).toHaveLength(1);
    expect(result.entryPathways[0]).toMatchObject({
      pathwayType: 'EXPLORATORY_CONTACT',
      status: 'PLAUSIBLE',
      derivationKey: 'pathway:EXPLORATORY_CONTACT',
      confidence: 0.7,
    });
    expect(result.entryPathways[0].sourceUrls).toEqual([
      'https://example.test/source',
      'https://example.test/join',
    ]);
    expect(result.accessSignals.map((signal) => signal.signalType).sort()).toEqual([
      'CURRENT_UNDERGRADS',
      'REACH_OUT_PLAUSIBLE',
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

  it('treats centers-institutes-index legacy acceptance observations as discovery-only context', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'acceptingUndergrads',
        value: true,
        sourceName: 'centers-institutes-index',
        confidence: 0.9,
      }),
    ]);

    expect(result.entryPathways).toEqual([]);
    expect(result.accessSignals).toEqual([]);
    expect(result.contactRoutes).toEqual([]);
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

  it('does not derive application evidence from a generic opportunities page without undergraduate access evidence', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'joinPageUrl',
        value: 'http://examplelab.yale.edu/opportunities',
        sourceName: 'lab-microsite-undergrad-llm',
        sourceUrl: 'http://examplelab.yale.edu/people/fixture-professor',
        confidence: 0.5,
      }),
    ]);

    expect(result.entryPathways).toEqual([]);
    expect(result.accessSignals).toEqual([]);
    expect(result.contactRoutes).toEqual([]);
  });

  it('derives not-currently-available from a strong constraint quote even when no boolean verdict was emitted', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'undergradEvidenceQuote',
        value: "I regrettably don't have bandwidth to respond to all of them.",
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.5,
      }),
      obs({
        field: 'undergradConstraintQuote',
        value: "I regrettably don't have bandwidth to respond to all of them.",
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.5,
      }),
      obs({
        field: 'contactInstructionsQuote',
        value:
          'For prospective PhD students, you are encouraged to apply through Yale SDS or CS, and mention my name in your application.',
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.5,
      }),
    ]);

    expect(result.entryPathways).toEqual([]);
    expect(result.contactRoutes).toEqual([]);
    expect(result.accessSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          signalType: 'NOT_CURRENTLY_AVAILABLE',
          excerpt: "I regrettably don't have bandwidth to respond to all of them.",
        }),
        expect.objectContaining({
          signalType: 'CONTACT_INSTRUCTIONS_EXIST',
        }),
      ]),
    );
  });

  it('does not derive a public application route from graduate-only join instructions', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'joinPageUrl',
        value: 'https://lab.example.edu/join',
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.5,
      }),
      obs({
        field: 'contactInstructionsQuote',
        value:
          'Prospective PhD students should apply through the Yale CS admissions portal and mention the PI in the application.',
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.5,
      }),
      obs({
        field: 'undergradConstraintQuote',
        value:
          'Prospective PhD students should apply through the Yale CS admissions portal and mention the PI in the application.',
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.5,
      }),
    ]);

    expect(result.contactRoutes).toEqual([]);
    expect(result.accessSignals.map((signal) => signal.signalType)).toEqual([
      'CONTACT_INSTRUCTIONS_EXIST',
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

    expect(result.entryPathways).toMatchObject([
      {
        pathwayType: 'EXPLORATORY_CONTACT',
        status: 'PLAUSIBLE',
        studentFacingLabel: 'Exploratory outreach',
        bestNextStep:
          'Use the evidence to plan targeted outreach rather than treating this as an open posting.',
      },
    ]);
    expect(result.accessSignals).toMatchObject([
      {
        signalType: 'REACH_OUT_PLAUSIBLE',
        excerpt:
          'Students interested in research should contact the faculty member directly to explore opportunities.',
      },
    ]);
    expect(result.contactRoutes).toEqual([]);
    expect(result.entryPathways.map((pathway) => pathway.pathwayType)).not.toContain(
      'POSTED_ROLE',
    );
  });

  it('materializes department contact-role evidence as a restrained public contact route', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'undergradAccessEvidence',
        value: {
          openToUndergrads: 'yes',
          evidenceSource: 'department_undergrad_research_page',
        },
        sourceName: 'department-undergrad-research',
        sourceUrl:
          'https://chem.yale.edu/academics/undergraduate-chemistry-at-yale/undergraduate-research',
        confidence: 0.8,
      }),
      obs({
        field: 'contactRole',
        value: 'Faculty member for undergraduate research',
        sourceName: 'department-undergrad-research',
        sourceUrl:
          'https://chem.yale.edu/academics/undergraduate-chemistry-at-yale/undergraduate-research',
        confidence: 0.8,
      }),
    ]);

    expect(result.entryPathways).toMatchObject([
      {
        pathwayType: 'EXPLORATORY_CONTACT',
        status: 'PLAUSIBLE',
      },
    ]);
    expect(result.contactRoutes).toMatchObject([
      {
        routeType: 'UNKNOWN',
        visibility: 'PUBLIC',
        contactPolicy: 'UNKNOWN',
        role: 'Faculty member for undergraduate research',
        sourceName: 'department-undergrad-research',
      },
    ]);
    expect(result.contactRoutes[0].url).toBeUndefined();
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

    expect(result.entryPathways).toMatchObject([
      {
        pathwayType: 'EXPLORATORY_CONTACT',
        status: 'PLAUSIBLE',
      },
    ]);
    expect(result.accessSignals.map((signal) => signal.signalType).sort()).toEqual([
      'APPLICATION_FORM_EXISTS',
      'REACH_OUT_PLAUSIBLE',
    ]);
    expect(result.contactRoutes).toMatchObject([
      {
        routeType: 'OFFICIAL_APPLICATION',
        visibility: 'PUBLIC',
        contactPolicy: 'APPLICATION_ONLY',
        url: 'https://yalesurvey.ca1.qualtrics.com/jfe/form/SV_fixture',
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
          evidenceQuote: 'Email fixture.contact@yale.edu to apply.',
        },
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.5,
      }),
      obs({
        field: 'undergradEvidenceQuote',
        value: 'Email fixture.contact@yale.edu to apply.',
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.5,
      }),
      obs({
        field: 'contactInstructionsQuote',
        value: 'Call 203-432-1234 or email fixture.contact@yale.edu.',
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
      obs({ field: 'contactName', value: 'Fixture Manager' }),
      obs({ field: 'contactEmail', value: 'fixture.manager@Yale.edu' }),
      obs({ field: 'contactRole', value: 'Lab Manager' }),
    ]);

    expect(result.contactRoutes).toMatchObject([
      {
        routeType: 'LAB_MANAGER',
        email: 'fixture.manager@Yale.edu',
        name: 'Fixture Manager',
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
        value: 'Fixture Instructor',
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
        name: 'Fixture Instructor',
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
