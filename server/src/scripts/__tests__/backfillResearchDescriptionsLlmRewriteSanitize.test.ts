import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  updateOne: vi.fn(),
  getSourceByName: vi.fn(),
  appendObservations: vi.fn(),
}));

vi.mock('../../models/researchEntity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../models/researchEntity')>()),
  ResearchEntity: {
    find: mocks.find,
    updateOne: mocks.updateOne,
  },
}));

vi.mock('../../scrapers/observationStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../scrapers/observationStore')>()),
  getSourceByName: mocks.getSourceByName,
  appendObservations: mocks.appendObservations,
}));

import { runResearchDescriptionBackfill } from '../backfillResearchDescriptions';

const groundedSource =
  'The laboratory investigates quantum materials, superconductivity, and topological phases in ' +
  'electron lattice systems, developing spectroscopy methods to probe emergent correlated states ' +
  'across novel materials. The laboratory director studies these questions with students.';

const rawFull =
  'The laboratory investigates quantum materials, superconductivity, and topological phases in ' +
  'electron lattice systems, developing spectroscopy methods to probe emergent correlated states ' +
  'across novel materials. Email director@example.edu.';

const rawShort =
  'Quantum materials and topological superconductivity research in electron lattice systems. ' +
  'Email director@example.edu.';

const stubFind = (entities: unknown[]) => {
  mocks.find.mockReturnValue({ lean: () => Promise.resolve(entities) });
};

describe('runResearchDescriptionBackfill llm-rewrite immediate write hygiene (#1260)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('sanitizes the convenience $set so raw LLM output never lands on the entity', async () => {
    stubFind([
      {
        _id: 'entity-1',
        slug: 'quantum-lab',
        name: 'Quantum Lab',
        displayName: 'Quantum Lab',
        fullDescription: groundedSource,
        websiteUrl: 'https://example.edu/quantum-lab',
        sourceUrls: ['https://example.edu/quantum-lab'],
      },
    ]);
    mocks.getSourceByName.mockResolvedValue({ _id: 'source-1' });
    mocks.appendObservations.mockResolvedValue(undefined);
    mocks.updateOne.mockResolvedValue({ acknowledged: true });

    const result = await runResearchDescriptionBackfill({
      dryRun: false,
      rewriter: async () => ({ fullDescription: rawFull, shortDescription: rawShort }),
    });

    expect(result.rewritten).toBe(1);
    expect(mocks.updateOne).toHaveBeenCalledTimes(1);

    const [, update] = mocks.updateOne.mock.calls[0];
    const writtenFull = update.$set.fullDescription as string;
    const writtenShort = update.$set.shortDescription as string;

    expect(rawFull).toContain('director@example.edu');
    expect(rawShort).toContain('director@example.edu');

    expect(writtenFull).not.toContain('director@example.edu');
    expect(writtenShort).not.toContain('director@example.edu');
    expect(writtenShort).toContain('[email redacted]');
  });
});
