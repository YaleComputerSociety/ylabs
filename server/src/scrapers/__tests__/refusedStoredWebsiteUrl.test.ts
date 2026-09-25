import { describe, expect, it } from 'vitest';
import { planRefusedStoredWebsiteUrlClear } from '../refusedStoredWebsiteUrl';

const personScoped = { entityType: 'LAB', kind: 'lab', name: 'Synthetic Example Lab' };

const plan = (
  overrides: Partial<Parameters<typeof planRefusedStoredWebsiteUrlClear>[0]> = {},
): ReturnType<typeof planRefusedStoredWebsiteUrlClear> =>
  planRefusedStoredWebsiteUrlClear({
    stored: {},
    identity: personScoped,
    lockedFields: [],
    ...overrides,
  });

describe('planRefusedStoredWebsiteUrlClear', () => {
  it('clears a stored value the write gate refuses', () => {
    const result = plan({ stored: { websiteUrl: 'https://example.edu/profile/someone/' } });
    expect(result.clear).toBe(true);
    expect(result.refusal).toBe('cms-profile-path');
  });

  it('leaves an admissible stored value alone', () => {
    const result = plan({ stored: { websiteUrl: 'https://fixturelab.org/' } });
    expect(result).toEqual({ clear: false, refusal: null, skipped: null });
  });

  it('plans nothing when no value is stored', () => {
    expect(plan({ stored: { websiteUrl: '' } }).clear).toBe(false);
    expect(plan({ stored: {} }).clear).toBe(false);
    expect(plan({ stored: null }).clear).toBe(false);
  });

  it('reports a refused value on a locked field instead of clearing it', () => {
    const result = plan({
      stored: { websiteUrl: 'https://example.edu/profile/someone/' },
      lockedFields: ['websiteUrl'],
    });
    expect(result).toEqual({
      clear: false,
      refusal: 'cms-profile-path',
      skipped: 'field-is-locked',
    });
  });

  it('reads the staged value over the stored one, so an admissible staged value wins', () => {
    const result = plan({
      stored: { websiteUrl: 'https://example.edu/profile/someone/' },
      staged: { websiteUrl: 'https://fixturelab.org/' },
    });
    expect(result.clear).toBe(false);
  });

  it('reads the staged value over the stored one, so a refused staged value is cleared', () => {
    const result = plan({
      stored: { websiteUrl: 'https://fixturelab.org/' },
      staged: { websiteUrl: 'https://example.edu/profile/someone/' },
    });
    expect(result.clear).toBe(true);
  });

  it('uses the identity, so an arm scoped by the citer can fire', () => {
    const researchGroupHostRoot = 'https://het.yale.edu/';
    expect(plan({ stored: { websiteUrl: researchGroupHostRoot } }).refusal).toBe(
      'umbrella-page-cited-by-person',
    );
    expect(
      plan({
        stored: { websiteUrl: researchGroupHostRoot },
        identity: { entityType: 'CENTER', kind: 'center', name: 'Synthetic Center' },
      }).clear,
    ).toBe(false);
  });

  it('is idempotent: a second pass over its own output plans nothing', () => {
    const stored: Record<string, unknown> = {
      websiteUrl: 'https://example.edu/profile/someone/',
    };
    expect(plan({ stored }).clear).toBe(true);
    expect(plan({ stored: { ...stored, websiteUrl: '' } }).clear).toBe(false);
  });
});
