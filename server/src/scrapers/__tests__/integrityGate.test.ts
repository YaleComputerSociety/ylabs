import { describe, expect, it, vi } from 'vitest';

const modelMocks = vi.hoisted(() => ({
  aggregate: vi.fn(async (_pipeline?: any[]): Promise<any[]> => []),
}));

vi.mock('../../models/signal', () => ({
  Signal: { aggregate: modelMocks.aggregate },
}));

vi.mock('../../models/contactRoute', () => ({
  ContactRoute: { aggregate: modelMocks.aggregate },
}));

vi.mock('../../models/entryPathway', () => ({
  EntryPathway: { aggregate: modelMocks.aggregate },
}));

vi.mock('../../models/postedOpportunity', () => ({
  PostedOpportunity: { aggregate: modelMocks.aggregate },
}));

vi.mock('../../models/researchEntity', () => ({
  ResearchEntity: { aggregate: modelMocks.aggregate },
}));

vi.mock('../../models/roleAssignment', () => ({
  RoleAssignment: { aggregate: modelMocks.aggregate },
}));

vi.mock('../../models/account', () => ({
  Account: { aggregate: modelMocks.aggregate },
}));

vi.mock('../../models/researcher', () => ({
  Researcher: { aggregate: modelMocks.aggregate },
}));

import { runPostMaterializationIntegrityGate } from '../integrityGate';

describe('runPostMaterializationIntegrityGate', () => {
  it('rejects unsafe sample limits before querying integrity collections', async () => {
    modelMocks.aggregate.mockClear();

    await expect(
      runPostMaterializationIntegrityGate({
        includeSamples: true,
        limit: 9007199254740992,
      }),
    ).rejects.toThrow('--limit must be a safe positive integer');

    expect(modelMocks.aggregate).not.toHaveBeenCalled();
  });

  it('counts the whole archived-entity population even when samples are capped at one row', async () => {
    modelMocks.aggregate.mockReset();
    modelMocks.aggregate.mockImplementation(async (pipeline: any[] = []) => {
      const last = pipeline[pipeline.length - 1] || {};
      const archivedLookup = pipeline.some(
        (stage) => stage?.$match?.['entity.archived'] === true,
      );
      if (!archivedLookup) return [];
      if (last.$count) {
        const roleEdgePipeline = pipeline.some((stage) => stage?.$match?.['target.kind']);
        return [{ total: roleEdgePipeline ? 1391 : 707 }];
      }
      return [{ memberId: 'member-1', artifactId: 'signal-1', researchEntityId: 'archived-1' }];
    });

    const summary = await runPostMaterializationIntegrityGate({});

    expect(summary.counts.currentMembersOnArchivedEntities).toBe(1391);
    expect(summary.counts.activeArtifactsOnArchivedEntities).toBe(707);
    expect(summary.countIsLowerBound.currentMembersOnArchivedEntities).toBe(false);
    expect(summary.countIsLowerBound.activeArtifactsOnArchivedEntities).toBe(false);
    expect(summary.countCap).toBe(1);
  });
});
