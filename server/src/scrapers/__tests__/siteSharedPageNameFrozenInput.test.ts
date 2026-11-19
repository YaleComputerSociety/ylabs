import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../models/observation', () => ({
  Observation: {
    find: () => ({ select: () => ({ lean: async () => [] }) }),
  },
}));

vi.mock('../../models/researchEntity', () => ({
  ResearchEntity: {
    find: () => ({ select: () => ({ lean: async () => [] }) }),
  },
}));

import { FrozenMaterializationInput } from '../frozenMaterializationInput';
import {
  resetSiteSharedPageNameCache,
  withoutSiteSharedPageNames,
  type PageStatedNameObservation,
} from '../siteSharedPageName';

const SITE = 'https://orrery.example.edu';

const observation = (
  sourceUrl: string,
  sourceName = 'lab-site-research-read',
): PageStatedNameObservation => ({
  field: 'name',
  value: 'Orrery Institute for Regional Studies',
  sourceName,
  sourceUrl,
  entityKey: 'orrery-north',
});

const ROW = { slug: 'orrery-north' };

describe('withoutSiteSharedPageNames under a frozen benchmark input', () => {
  beforeEach(() => {
    resetSiteSharedPageNameCache();
  });

  it('counts the cross-row peer read as unfrozen when the row has a sub-path page-stated name', async () => {
    const frozen = new FrozenMaterializationInput('researchEntity', []);

    await withoutSiteSharedPageNames([observation(`${SITE}/north`)], ROW, frozen);

    expect(frozen.recordedMisses().map((miss) => miss.read)).toEqual(['pageStatedNamePeers']);
  });

  it('makes no peer read for a row without a sub-path page-stated name', async () => {
    const frozen = new FrozenMaterializationInput('researchEntity', []);

    await withoutSiteSharedPageNames(
      [observation(SITE), observation(`${SITE}/north`, 'centers-institutes-index')],
      ROW,
      frozen,
    );

    expect(frozen.recordedMisses()).toEqual([]);
  });
});
