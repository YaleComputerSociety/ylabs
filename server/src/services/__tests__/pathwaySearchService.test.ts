import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntryPathway } from '../../models/entryPathway';
import {
  computePathwayQuality,
  getBestNextStepCategory,
  pathwayBestNextStepCategories,
  searchPathways,
} from '../pathwaySearchService';

describe('pathwaySearchService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the public best-next-step categories stable', () => {
    expect(pathwayBestNextStepCategories).toEqual([
      'apply',
      'find-funding',
      'plan-outreach',
      'contact-program',
      'save-for-later',
      'check-back-later',
    ]);
  });

  it('maps active opportunities and evidence-backed application routes to apply', () => {
    expect(getBestNextStepCategory({ pathwayType: 'POSTED_ROLE' })).toBe('save-for-later');
    expect(
      getBestNextStepCategory({
        pathwayType: 'EXPLORATORY_CONTACT',
        activePostedOpportunity: { _id: 'opportunity-1' },
      }),
    ).toBe('apply');
    expect(
      getBestNextStepCategory({
        pathwayType: 'EXPLORATORY_CONTACT',
        contactRoute: { routeType: 'OFFICIAL_APPLICATION' },
        evidence: [{ signalType: 'APPLICATION_FORM_EXISTS' }],
      }),
    ).toBe('apply');
  });

  it('does not label official routes as apply without application, opening, or program evidence', () => {
    expect(
      getBestNextStepCategory({
        pathwayType: 'EXPLORATORY_CONTACT',
        contactRoute: { routeType: 'OFFICIAL_APPLICATION' },
        evidence: [{ signalType: 'REACH_OUT_PLAUSIBLE' }],
      }),
    ).toBe('contact-program');
  });

  it('leaves formalization-only pathway values non-actionable', () => {
    expect(getBestNextStepCategory({ pathwayType: 'COURSE_CREDIT' })).toBe(
      'save-for-later',
    );
    expect(getBestNextStepCategory({ pathwayType: 'SENIOR_THESIS' })).toBe(
      'save-for-later',
    );
    expect(getBestNextStepCategory({ pathwayType: 'FELLOWSHIP_FUNDED_PROJECT' })).toBe(
      'save-for-later',
    );
  });

  it('maps program-like public contact routes before generic outreach', () => {
    expect(
      getBestNextStepCategory({
        pathwayType: 'UNKNOWN',
        contactRoute: { routeType: 'PROGRAM_MANAGER' },
      }),
    ).toBe('contact-program');
  });

  it('maps exploratory routes without a posted opportunity to plan outreach', () => {
    expect(getBestNextStepCategory({ pathwayType: 'EXPLORATORY_CONTACT' })).toBe(
      'plan-outreach',
    );
    expect(getBestNextStepCategory({ pathwayType: 'VOLUNTEER_OUTREACH' })).toBe(
      'plan-outreach',
    );
    expect(getBestNextStepCategory({ pathwayType: 'FACULTY_SUPERVISION' })).toBe(
      'plan-outreach',
    );
  });

  it('keeps unavailable or thin-evidence pathways out of action-oriented CTAs', () => {
    expect(getBestNextStepCategory({ status: 'NOT_CURRENTLY_AVAILABLE' })).toBe(
      'check-back-later',
    );
    expect(getBestNextStepCategory({ status: 'NO_EVIDENCE' })).toBe('save-for-later');
    expect(getBestNextStepCategory({ status: 'HISTORICAL' })).toBe('save-for-later');
  });

  it('includes research entity descriptions in Mongo text search and results', async () => {
    const aggregate = vi.spyOn(EntryPathway, 'aggregate').mockReturnValue({
      exec: async () => [{ hits: [], total: [] }],
    } as any);

    await searchPathways({ q: 'visual cortex circuits', page: 1, pageSize: 5 });

    const pipeline = aggregate.mock.calls[0]?.[0] as any[];
    const textMatch = pipeline.find((stage) => stage.$match?.$or);
    const descriptionCondition = textMatch?.$match.$or.find(
      (condition: Record<string, unknown>) =>
        condition['researchEntity.description'] instanceof RegExp,
    );
    const shortDescriptionCondition = textMatch?.$match.$or.find(
      (condition: Record<string, unknown>) =>
        condition['researchEntity.shortDescription'] instanceof RegExp,
    );
    const fullDescriptionCondition = textMatch?.$match.$or.find(
      (condition: Record<string, unknown>) =>
        condition['researchEntity.fullDescription'] instanceof RegExp,
    );
    const project = pipeline
      .find((stage) => stage.$facet)
      ?.$facet.hits.find((stage: Record<string, unknown>) => '$project' in stage)
      ?.$project;

    expect(descriptionCondition?.['researchEntity.description']).toEqual(expect.any(RegExp));
    expect(
      (descriptionCondition?.['researchEntity.description'] as RegExp).test(
        'Studies visual cortex circuits in awake animals.',
      ),
    ).toBe(true);
    expect(shortDescriptionCondition?.['researchEntity.shortDescription']).toEqual(
      expect.any(RegExp),
    );
    expect(fullDescriptionCondition?.['researchEntity.fullDescription']).toEqual(
      expect.any(RegExp),
    );
    expect(project?.researchEntity.shortDescription).toBe(
      '$researchEntity.shortDescription',
    );
    expect(project?.researchEntity.description).toBe('$researchEntity.description');
    expect(project?.researchEntity.fullDescription).toBe(
      '$researchEntity.fullDescription',
    );
  });

  it('redacts direct contact text from public Mongo pathway payloads', async () => {
    vi.spyOn(EntryPathway, 'aggregate').mockReturnValue({
      exec: async () => [
        {
          hits: [
            {
              _id: 'pathway-1',
              pathwayType: 'EXPLORATORY_CONTACT',
              status: 'PLAUSIBLE',
              evidenceStrength: 'MODERATE',
              studentFacingLabel: 'Contact hidden-contact@example.edu',
              explanation: 'Questions can go to hidden-contact@example.edu.',
              bestNextStep: 'Call 203-555-1212 before emailing.',
              bestNextStepCategory: 'plan-outreach',
              sourceUrls: ['https://example.edu/pathway'],
              researchEntity: {
                _id: 'entity-1',
                slug: 'example-lab',
                name: 'Example Lab',
                departments: [],
                researchAreas: [],
              },
              evidence: [
                {
                  signalType: 'CONTACT_INSTRUCTIONS_EXIST',
                  confidence: 'HIGH',
                  excerpt: 'Email hidden-contact@example.edu or call 203-555-1212.',
                  sourceUrl: 'https://example.edu/evidence',
                },
              ],
              contactRoute: {
                routeType: 'PROGRAM_MANAGER',
                label: 'Manager hidden-contact@example.edu',
                visibility: 'PUBLIC',
                contactPolicy: 'DIRECT_CONTACT_OK',
                rationale: 'Call 203-555-1212 for details.',
              },
            },
          ],
          total: [{ count: 1 }],
        },
      ],
    } as any);

    const result = await searchPathways({ q: 'example', page: 1, pageSize: 5 });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('hidden-contact@example.edu');
    expect(serialized).not.toContain('203-555-1212');
    expect(result.hits[0].studentFacingLabel).toContain('[email redacted]');
    expect(result.hits[0].bestNextStep).toContain('[phone redacted]');
    expect(result.hits[0].evidence[0].excerpt).toContain('[email redacted]');
    expect(result.hits[0].contactRoute?.label).toContain('[email redacted]');
    expect(result.hits[0].contactRoute?.rationale).toContain('[phone redacted]');
  });

  it('filters synthetic profile-publication chrome from research entity fields in pathway results', async () => {
    vi.spyOn(EntryPathway, 'aggregate').mockReturnValue({
      exec: async () => [
        {
          hits: [
            {
              _id: 'pathway-1',
              pathwayType: 'EXPLORATORY_CONTACT',
              status: 'PLAUSIBLE',
              evidenceStrength: 'MODERATE',
              studentFacingLabel: 'Exploratory outreach',
              bestNextStepCategory: 'plan-outreach',
              sourceUrls: [],
              evidence: [],
              researchEntity: {
                _id: 'entity-1',
                slug: 'fixture-profile-lab',
                name: 'Example Lab',
                shortDescription:
                  'Fixture Publications TimelineA big-picture view of synthetic output.',
                researchAreas: [
                  'Synthetic ORCID profile token',
                  'Synthetic Inflammation40 ResearchersView 5 Related Publications',
                  'SyntheticChrome View 5 Related Publications',
                  'Synthetic Inflammation',
                ],
              },
            },
          ],
          total: [{ count: 1 }],
        },
      ],
    } as any);

    const result = await searchPathways({ page: 1, pageSize: 5 });

    expect(result.hits[0].researchEntity.shortDescription).toBe('');
    expect(result.hits[0].researchEntity.researchAreas).toEqual([
      'Synthetic Inflammation',
    ]);
  });

  it('excludes legacy listing-derived pathways from public Mongo search', async () => {
    const aggregate = vi.spyOn(EntryPathway, 'aggregate').mockReturnValue({
      exec: async () => [{ hits: [], total: [] }],
    } as any);

    await searchPathways({ page: 1, pageSize: 5 });

    const pipeline = aggregate.mock.calls[0]?.[0] as any[];
    const firstMatch = pipeline[0]?.$match;
    const legacyListingGuard = firstMatch?.$nor?.find(
      (condition: Record<string, unknown>) => condition.derivationKey instanceof RegExp,
    );

    expect(legacyListingGuard?.derivationKey).toEqual(/^listing:/);
  });

  it('adds an action-ready gate to public pathway search results', async () => {
    const aggregate = vi.spyOn(EntryPathway, 'aggregate').mockReturnValue({
      exec: async () => [{ hits: [], total: [] }],
    } as any);

    await searchPathways({ page: 1, pageSize: 5 });

    const pipeline = aggregate.mock.calls[0]?.[0] as any[];
    const actionabilityMatch = pipeline.find(
      (stage) => stage.$match?.actionability === 'ACTION_READY',
    );
    const project = pipeline
      .find((stage) => stage.$facet)
      ?.$facet.hits.find((stage: Record<string, unknown>) => '$project' in stage)
      ?.$project;

    expect(actionabilityMatch).toBeTruthy();
    expect(project?.actionability).toBe(1);
  });

  it('scores richer microsite and fellowship evidence above roster-only profile fallbacks', () => {
    const fallback = computePathwayQuality({
      pathwayType: 'EXPLORATORY_CONTACT',
      status: 'PLAUSIBLE',
      evidenceStrength: 'WEAK',
      confidence: 0.75,
      derivationKey: 'pathway:EXPLORATORY_CONTACT:OFFICIAL_PROFILE:user-1',
      evidence: [{ signalType: 'REACH_OUT_PLAUSIBLE', sourceName: 'dept-faculty-roster' }],
      contactRoute: { routeType: 'FACULTY_PI' },
    });
    const richer = computePathwayQuality({
      pathwayType: 'EXPLORATORY_CONTACT',
      status: 'PLAUSIBLE',
      evidenceStrength: 'STRONG',
      confidence: 0.7,
      derivationKey: 'pathway:EXPLORATORY_CONTACT:PAST_UNDERGRADS',
      evidence: [
        {
          signalType: 'PAST_UNDERGRADS',
          sourceName: 'lab-microsite-undergrad-llm',
          derivationKey: 'signal:PAST_UNDERGRADS',
        },
        { signalType: 'FELLOWSHIP_COMPATIBLE', sourceName: 'fellowship-recipients' },
      ],
      contactRoute: { routeType: 'LAB_MANAGER' },
    });

    expect(richer.qualityScore).toBeGreaterThan(fallback.qualityScore);
    expect(richer.hasMicrositeEvidence).toBe(true);
    expect(richer.hasFellowshipEvidence).toBe(true);
    expect(fallback.isProfileFallback).toBe(true);
  });

  it('scores active posted opportunities above exploratory fallbacks', () => {
    const posted = computePathwayQuality({
      pathwayType: 'POSTED_ROLE',
      status: 'ACTIVE',
      evidenceStrength: 'DIRECT',
      confidence: 0.65,
      activePostedOpportunity: { _id: 'opportunity-1' },
      evidence: [{ signalType: 'POSTED_OPENING' }],
      contactRoute: { routeType: 'OFFICIAL_APPLICATION' },
    });
    const fallback = computePathwayQuality({
      pathwayType: 'EXPLORATORY_CONTACT',
      status: 'PLAUSIBLE',
      evidenceStrength: 'MODERATE',
      confidence: 0.9,
      derivationKey: 'pathway:EXPLORATORY_CONTACT:OFFICIAL_PROFILE:user-1',
      evidence: [{ signalType: 'REACH_OUT_PLAUSIBLE' }],
    });

    expect(posted.qualityScore).toBeGreaterThan(fallback.qualityScore);
  });

  it('uses quality-first default Mongo relevance ordering while allowing explicit query matches through', async () => {
    const aggregate = vi.spyOn(EntryPathway, 'aggregate').mockReturnValue({
      exec: async () => [{ hits: [], total: [] }],
    } as any);

    await searchPathways({ page: 1, pageSize: 5 });
    await searchPathways({ q: 'example researcher', page: 1, pageSize: 5 });

    const defaultPipeline = aggregate.mock.calls[0]?.[0] as any[];
    const queryPipeline = aggregate.mock.calls[1]?.[0] as any[];
    const defaultSort = defaultPipeline
      .find((stage) => stage.$facet)
      ?.$facet.hits.find((stage: Record<string, unknown>) => '$sort' in stage)
      ?.$sort;
    const queryTextMatch = queryPipeline.find((stage) =>
      stage.$match?.$or?.some((condition: Record<string, unknown>) =>
        Object.prototype.hasOwnProperty.call(condition, 'researchEntity.name'),
      ),
    );

    expect(defaultSort).toMatchObject({
      qualityScore: -1,
      evidenceCount: -1,
      confidence: -1,
    });
    expect(queryTextMatch).toBeTruthy();
  });
});
