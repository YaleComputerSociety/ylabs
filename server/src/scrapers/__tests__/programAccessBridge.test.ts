import { describe, expect, it, vi } from 'vitest';
import { buildProgramAccessBridgeInputs, materializeProgramAccessBridge } from '../programAccessBridge';

describe('programAccessBridge', () => {
  it('does not promote funding-only fellowships', () => {
    expect(
      buildProgramAccessBridgeInputs({
        _id: '665000000000000000000001',
        title: 'Dean Research Fellowship',
        sourceUrl: 'https://science.yalecollege.yale.edu/fellowship',
        programAccessRole: 'FUNDING_ONLY',
        programCategory: 'FELLOWSHIP',
      } as any),
    ).toEqual({ skipped: 'funding-only' });
  });

  it('builds pathway, signal, contact route, and posted opportunity inputs for mentor matching programs', () => {
    const inputs = buildProgramAccessBridgeInputs({
      _id: '665000000000000000000001',
      title: 'Wu Tsai Undergraduate Fellowship',
      summary: 'Students are matched with faculty mentors.',
      sourceUrl: 'https://wti.yale.edu/initiatives/undergraduate',
      applicationLink: 'https://wti.yale.edu/apply',
      deadline: new Date('2026-02-09T23:59:59.999Z'),
      isAcceptingApplications: true,
      programCategory: 'SUMMER_RESEARCH_PROGRAM',
      programAccessRole: 'MENTOR_MATCHING',
      hostedByResearchEntityName: 'Wu Tsai Institute',
      hostedByResearchEntityUrl: 'https://wti.yale.edu',
    } as any);

    expect(inputs).toMatchObject({
      researchEntity: {
        name: 'Wu Tsai Institute',
        entityType: 'INSTITUTE',
        websiteUrl: 'https://wti.yale.edu',
      },
      entryPathway: {
        pathwayType: 'RECURRING_PROGRAM',
        status: 'ACTIVE',
        studentFacingLabel: 'Structured research program',
        compensation: 'FELLOWSHIP',
      },
      accessSignal: {
        signalType: 'APPLICATION_FORM_EXISTS',
      },
      contactRoute: {
        routeType: 'OFFICIAL_APPLICATION',
        contactPolicy: 'APPLICATION_ONLY',
      },
      postedOpportunity: {
        title: 'Wu Tsai Undergraduate Fellowship',
        status: 'OPEN',
        applicationUrl: 'https://wti.yale.edu/apply',
      },
    });
  });

  it('upserts bridge artifacts through injected services', async () => {
    const researchEntityModel = {
      findOneAndUpdate: vi.fn().mockResolvedValue({ _id: '665000000000000000000010' }),
    };
    const entryPathwayService = vi.fn().mockResolvedValue({ pathwayId: '665000000000000000000020' });
    const accessSignalService = vi.fn().mockResolvedValue({ signalId: '665000000000000000000030' });
    const contactRouteService = vi.fn().mockResolvedValue({ contactRouteId: '665000000000000000000040' });
    const postedOpportunityModel = {
      updateOne: vi.fn().mockResolvedValue({ upsertedCount: 1 }),
    };

    const result = await materializeProgramAccessBridge(
      {
        _id: '665000000000000000000001',
        title: 'Wu Tsai Undergraduate Fellowship',
        sourceUrl: 'https://wti.yale.edu/initiatives/undergraduate',
        applicationLink: 'https://wti.yale.edu/apply',
        isAcceptingApplications: true,
        programCategory: 'SUMMER_RESEARCH_PROGRAM',
        programAccessRole: 'MENTOR_MATCHING',
        hostedByResearchEntityName: 'Wu Tsai Institute',
        hostedByResearchEntityUrl: 'https://wti.yale.edu',
      } as any,
      {
        researchEntityModel: researchEntityModel as any,
        upsertEntryPathway: entryPathwayService as any,
        upsertAccessSignal: accessSignalService as any,
        upsertContactRoute: contactRouteService as any,
        postedOpportunityModel: postedOpportunityModel as any,
      },
    );

    expect(result).toEqual({
      skipped: undefined,
      researchEntities: 1,
      entryPathways: 1,
      accessSignals: 1,
      contactRoutes: 1,
      postedOpportunities: 1,
    });
    expect(researchEntityModel.findOneAndUpdate).toHaveBeenCalled();
    expect(entryPathwayService).toHaveBeenCalled();
    expect(postedOpportunityModel.updateOne).toHaveBeenCalled();
  });

  it('preserves review-locked posted opportunity fields while updating source fields', async () => {
    const researchEntityModel = {
      findOneAndUpdate: vi.fn().mockResolvedValue({ _id: '665000000000000000000010' }),
    };
    const entryPathwayService = vi.fn().mockResolvedValue({ pathwayId: '665000000000000000000020' });
    const accessSignalService = vi.fn().mockResolvedValue({ signalId: '665000000000000000000030' });
    const contactRouteService = vi.fn().mockResolvedValue({ contactRouteId: '665000000000000000000040' });
    const findOneLean = vi.fn().mockResolvedValue({
      review: {
        lockedFields: ['status', 'deadline', 'applicationUrl'],
        status: 'archived_by_review',
      },
    });
    const postedOpportunityModel = {
      findOne: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: findOneLean,
        }),
      }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    };

    await materializeProgramAccessBridge(
      {
        _id: '665000000000000000000001',
        title: 'Wu Tsai Undergraduate Fellowship',
        sourceUrl: 'https://wti.yale.edu/initiatives/undergraduate',
        applicationLink: 'https://wti.yale.edu/apply',
        deadline: new Date('2026-02-09T23:59:59.999Z'),
        isAcceptingApplications: true,
        programAccessRole: 'MENTOR_MATCHING',
        hostedByResearchEntityName: 'Wu Tsai Institute',
        hostedByResearchEntityUrl: 'https://wti.yale.edu',
      } as any,
      {
        researchEntityModel: researchEntityModel as any,
        upsertEntryPathway: entryPathwayService as any,
        upsertAccessSignal: accessSignalService as any,
        upsertContactRoute: contactRouteService as any,
        postedOpportunityModel: postedOpportunityModel as any,
      },
    );

    const update = postedOpportunityModel.updateOne.mock.calls[0][1] as {
      $set: Record<string, unknown>;
      $addToSet: Record<string, { $each: string[] }>;
    };
    expect(postedOpportunityModel.findOne).toHaveBeenCalledWith({
      entryPathwayId: '665000000000000000000020',
      derivationKey: 'program:665000000000000000000001:opportunity',
    });
    expect(update.$set).not.toHaveProperty('status');
    expect(update.$set).not.toHaveProperty('deadline');
    expect(update.$set).not.toHaveProperty('applicationUrl');
    expect(update.$set).not.toHaveProperty('archived');
    expect(update.$addToSet.sourceUrls.$each).toEqual([
      'https://wti.yale.edu/apply',
      'https://wti.yale.edu/initiatives/undergraduate',
      'https://wti.yale.edu',
    ]);
  });
});
