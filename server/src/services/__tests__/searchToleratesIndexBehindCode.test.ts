import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  invalidateResearchEntitySearchIndexAttributesCache,
  readResearchEntitySearchFilterableAttributes,
} from '../researchEntitySearchIndexService';
import { withHiringRowsFirst, withoutUnfilterableToggles } from '../researchGroupService';

describe('a search index that has not been rebuilt for a new filterable attribute', () => {
  beforeEach(() => invalidateResearchEntitySearchIndexAttributesCache());

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

  it('moves hiring rows ahead and keeps the given order inside each step', () => {
    const hits = [
      { id: 'a', undergradInvitationRank: 1 },
      { id: 'b', undergradInvitationRank: 2 },
      { id: 'c' },
      { id: 'd', undergradInvitationRank: 2 },
      { id: 'e', undergradInvitationRank: 1 },
    ];

    expect(withHiringRowsFirst(hits).map((hit) => hit.id)).toEqual(['b', 'd', 'a', 'e', 'c']);
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
