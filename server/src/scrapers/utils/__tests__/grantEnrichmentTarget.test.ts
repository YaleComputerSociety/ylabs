import { describe, expect, it, vi } from 'vitest';
import {
  countGrantAttach,
  emptyGrantAttachTally,
  grantAttachSummary,
  resolveGrantEnrichmentTarget,
} from '../grantEnrichmentTarget';

describe('resolveGrantEnrichmentTarget', () => {
  it('targets the one existing row the canonical resolver names', async () => {
    const resolver = vi.fn().mockResolvedValue({ status: 'canonical', slug: 'existing-row' });
    await expect(
      resolveGrantEnrichmentTarget({ status: 'matched', userId: 'researcher-1' }, resolver),
    ).resolves.toEqual({ status: 'enrich', researcherId: 'researcher-1', slug: 'existing-row' });
    expect(resolver).toHaveBeenCalledWith('researcher-1');
  });

  it.each([
    ['safe-shell', 'noExistingRow'],
    ['ineligible', 'ineligibleRow'],
    ['ambiguous', 'ambiguousRow'],
  ] as const)('refuses a %s row as %s', async (rowStatus, reason) => {
    await expect(
      resolveGrantEnrichmentTarget(
        { status: 'matched', userId: 'researcher-1' },
        vi.fn().mockResolvedValue({ status: rowStatus }),
      ),
    ).resolves.toEqual({ status: 'refused', reason });
  });

  it.each([
    ['absent', 'unresolved'],
    ['ambiguous', 'ambiguousPerson'],
  ] as const)('refuses an %s person without resolving a row', async (personStatus, reason) => {
    const resolver = vi.fn();
    await expect(resolveGrantEnrichmentTarget({ status: personStatus }, resolver)).resolves.toEqual(
      { status: 'refused', reason },
    );
    expect(resolver).not.toHaveBeenCalled();
  });
});

describe('grantAttachSummary', () => {
  it('reports every outcome by reason', () => {
    const tally = emptyGrantAttachTally();
    countGrantAttach(tally, { status: 'enrich', researcherId: 'r', slug: 's' });
    countGrantAttach(tally, { status: 'refused', reason: 'noExistingRow' });
    countGrantAttach(tally, { status: 'refused', reason: 'noExistingRow' });
    countGrantAttach(tally, { status: 'refused', reason: 'ambiguousRow' });
    expect(grantAttachSummary(tally)).toBe(
      'rows enriched: 1; not attached: 0 resolved to no researcher, 0 resolved to several researchers, ' +
        '2 have no existing research row (grants never mint one, #3145), 0 ineligible row, 1 ambiguous row',
    );
  });
});
