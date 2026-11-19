import { describe, expect, it, vi } from 'vitest';

import {
  holdMergesThatWouldDemote,
  summarizeSameLeadMergeHolds,
  type SameLeadMergePlan,
} from '../mergeSameLeadDuplicateGroupsCore';

const merge = (
  corroboration: SameLeadMergePlan['corroboration'],
  survivorId: string,
): SameLeadMergePlan => ({
  url: `https://fixture.yale.edu/${survivorId}/`,
  corroboration,
  survivorId,
  loserIds: [`${survivorId}-loser`],
  survivorGainsFunding: false,
});

describe('same-lead merges never demote a served row (#6272)', () => {
  it.each(['name-agrees', 'shell-versus-concrete', 'leadless-or-member-led-twin'] as const)(
    'keeps a %s merge whose planned survivor holds the best tier',
    async (corroboration) => {
      const planned = merge(corroboration, 'survivor');
      const resolve = vi.fn().mockResolvedValue({ defer: false, canonicalId: 'survivor' });

      const result = await holdMergesThatWouldDemote([planned], resolve);

      expect(resolve).toHaveBeenCalledWith('survivor', ['survivor-loser']);
      expect(result.kept).toEqual([planned]);
      expect(result.held).toEqual([]);
    },
  );

  it.each(['name-agrees', 'leadless-or-member-led-twin'] as const)(
    'holds a %s merge the never-demote resolver defers',
    async (corroboration) => {
      const planned = merge(corroboration, 'survivor');

      const result = await holdMergesThatWouldDemote([planned], async () => ({
        defer: true,
        canonicalId: 'survivor',
      }));

      expect(result.kept).toEqual([]);
      expect(result.held).toEqual([{ url: planned.url, reason: 'would-demote-a-served-row' }]);
    },
  );

  it.each(['name-agrees', 'leadless-or-member-led-twin'] as const)(
    'holds a %s merge rather than swapping in the survivor the resolver prefers',
    async (corroboration) => {
      const planned = merge(corroboration, 'survivor');

      const result = await holdMergesThatWouldDemote([planned], async () => ({
        defer: false,
        canonicalId: 'survivor-loser',
      }));

      expect(result.kept).toEqual([]);
      expect(result.held).toEqual([{ url: planned.url, reason: 'would-demote-a-served-row' }]);
    },
  );

  it('counts the hold in the report summary', () => {
    expect(
      summarizeSameLeadMergeHolds([{ reason: 'would-demote-a-served-row' }])[
        'would-demote-a-served-row'
      ],
    ).toBe(1);
  });
});
