import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateOneMock = vi.fn(async () => ({ acknowledged: true }));
const findLeanMock = vi.fn();
const appendObservationsMock = vi.fn(async () => undefined);
const getSourceByNameMock = vi.fn(async () => ({ _id: 'source-id' }));

vi.mock('../../models/researchEntity', () => ({
  ResearchEntity: {
    find: () => ({ lean: () => findLeanMock() }),
    updateOne: (filter: unknown, update: unknown) => updateOneMock(filter, update),
  },
}));

vi.mock('../../scrapers/observationStore', () => ({
  appendObservations: (observations: unknown, meta: unknown) =>
    appendObservationsMock(observations, meta),
  getSourceByName: (name: string) => getSourceByNameMock(name),
}));

import {
  sanitizeResearchEntityDescription,
  sanitizeResearchEntityShortDescription,
} from '../../utils/descriptionHygiene';
import { runResearchDescriptionBackfill } from '../backfillResearchDescriptions';

const RESEARCH_SOURCE =
  'The Chen laboratory studies immune checkpoint regulation and the tumor ' +
  'microenvironment in cancer immunotherapy, developing antibody therapeutics ' +
  'against inhibitory pathways to restore antitumor responses in solid tumors. ' +
  'To apply for a postdoc contact Lieping.Chen@example.edu.';

const RAW_FULL =
  'The laboratory studies immune checkpoint regulation and the tumor ' +
  'microenvironment in cancer immunotherapy, developing antibody therapeutics ' +
  'against inhibitory pathways to restore antitumor responses in solid tumors. ' +
  'To apply for a postdoc contact Lieping.Chen@example.edu.';

const RAW_SHORT =
  'Studies immune checkpoint regulation and the tumor microenvironment in ' +
  'cancer immunotherapy. Contact Lieping.Chen@example.edu.';

describe('runResearchDescriptionBackfill llm-rewrite sanitizes the direct entity write (#1260)', () => {
  beforeEach(() => {
    updateOneMock.mockClear();
    appendObservationsMock.mockClear();
    getSourceByNameMock.mockClear();
    findLeanMock.mockReset();
    findLeanMock.mockResolvedValue([
      {
        _id: 'entity-1',
        slug: 'chen-lab',
        name: 'Chen Laboratory',
        displayName: 'Chen Laboratory',
        fullDescription: RESEARCH_SOURCE,
        websiteUrl: 'https://medicine.yale.edu/lab/chen/',
      },
    ]);
  });

  it('routes the immediate $set through the read-time sanitizers while observations keep the raw text', async () => {
    const result = await runResearchDescriptionBackfill({
      dryRun: false,
      limit: 1,
      rewriter: async () => ({ fullDescription: RAW_FULL, shortDescription: RAW_SHORT }),
    });

    expect(result.rewritten).toBe(1);
    expect(updateOneMock).toHaveBeenCalledTimes(1);

    const [, update] = updateOneMock.mock.calls[0];
    const set = (update as { $set: { fullDescription: string; shortDescription: string } }).$set;

    expect(set.fullDescription).toBe(sanitizeResearchEntityDescription(RAW_FULL));
    expect(set.shortDescription).toBe(sanitizeResearchEntityShortDescription(RAW_SHORT));
    expect(set.fullDescription).not.toContain('Lieping.Chen@example.edu');
    expect(set.shortDescription).not.toContain('Lieping.Chen@example.edu');

    const [observations] = appendObservationsMock.mock.calls[0];
    const values = (observations as Array<{ field: string; value: string }>).map((o) => o.value);
    expect(values).toContain(RAW_FULL);
    expect(values).toContain(RAW_SHORT);
  });
});
