import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  invalidateResearchEntitySearchFilterableAttributesCache,
  readResearchEntitySearchFilterableAttributes,
} from '../researchEntitySearchIndexService';
import { withoutUnfilterableToggles } from '../researchGroupService';

describe('a search index that has not been rebuilt for a new filterable attribute', () => {
  beforeEach(() => invalidateResearchEntitySearchFilterableAttributesCache());

  it('reads the live filterable attributes once per cache window', async () => {
    const index = {
      getFilterableAttributes: vi
        .fn()
        .mockResolvedValue(['archived', 'hasUndergradHostingEvidence']),
    };

    const first = await readResearchEntitySearchFilterableAttributes(index);
    const second = await readResearchEntitySearchFilterableAttributes(index);

    expect([...(first ?? [])]).toEqual(['archived', 'hasUndergradHostingEvidence']);
    expect(second).toBe(first);
    expect(index.getFilterableAttributes).toHaveBeenCalledTimes(1);
  });

  it('answers unknown rather than failing when the attributes cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const index = { getFilterableAttributes: vi.fn().mockRejectedValue(new Error('down')) };

    expect(await readResearchEntitySearchFilterableAttributes(index)).toBeNull();
  });

  it('drops only a requested toggle the index cannot filter, and reports it', () => {
    const isFilterable = (field: string) => field !== 'welcomesUndergrads';

    expect(
      withoutUnfilterableToggles(
        { departments: ['Genetics'], hostsUndergrads: true, welcomesUndergrads: true },
        isFilterable,
      ),
    ).toEqual({
      filters: { departments: ['Genetics'], hostsUndergrads: true, welcomesUndergrads: undefined },
      dropped: { welcomesUndergrads: false },
    });
    expect(withoutUnfilterableToggles({ hostsUndergrads: true }, isFilterable)).toEqual({
      filters: { hostsUndergrads: true },
    });
    expect(withoutUnfilterableToggles({ welcomesUndergrads: true }, () => true)).toEqual({
      filters: { welcomesUndergrads: true },
    });
  });
});
