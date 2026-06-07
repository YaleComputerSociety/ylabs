import { describe, expect, it, vi } from 'vitest';

const modelMocks = vi.hoisted(() => ({
  aggregate: vi.fn(async () => []),
}));

vi.mock('../../models/accessSignal', () => ({
  AccessSignal: { aggregate: modelMocks.aggregate },
}));

vi.mock('../../models/contactRoute', () => ({
  ContactRoute: { aggregate: modelMocks.aggregate },
}));

vi.mock('../../models/entryPathway', () => ({
  EntryPathway: { aggregate: modelMocks.aggregate },
}));

vi.mock('../../models/paper', () => ({
  Paper: { aggregate: modelMocks.aggregate },
}));

vi.mock('../../models/postedOpportunity', () => ({
  PostedOpportunity: { aggregate: modelMocks.aggregate },
}));

vi.mock('../../models/researchEntity', () => ({
  ResearchEntity: { aggregate: modelMocks.aggregate },
}));

vi.mock('../../models/researchGroupMember', () => ({
  ResearchGroupMember: { aggregate: modelMocks.aggregate },
}));

vi.mock('../../models/user', () => ({
  User: { aggregate: modelMocks.aggregate },
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
});
