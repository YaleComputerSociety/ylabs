import { describe, expect, it } from 'vitest';
import { selectMergedInLeadProfileSourceUrls } from '../entityMaterializer';

const verifiedPrimary = (url: string) => ({
  kind: 'YALE_OFFICIAL',
  purpose: 'PRIMARY_IDENTITY',
  url,
  verifiedAt: new Date('2026-09-01T00:00:00Z'),
});

describe('selectMergedInLeadProfileSourceUrls (#4695)', () => {
  it("keeps a merged-in citation that is the lead's verified primary profile", () => {
    expect(
      selectMergedInLeadProfileSourceUrls(
        ['https://example.yale.edu/profile/wren-ortolan/', 'https://example.yale.edu/people/'],
        [{ profileLinks: [verifiedPrimary('https://example.yale.edu/profile/wren-ortolan')] }],
      ),
    ).toEqual(['https://example.yale.edu/profile/wren-ortolan/']);
  });

  it('drops a merged-in profile that is not the lead verified primary one', () => {
    expect(
      selectMergedInLeadProfileSourceUrls(
        ['https://example.yale.edu/profile/someone-else/'],
        [{ profileLinks: [verifiedPrimary('https://example.yale.edu/profile/wren-ortolan')] }],
      ),
    ).toEqual([]);
  });

  it('drops a match against an unverified or secondary profile link', () => {
    const url = 'https://example.yale.edu/profile/wren-ortolan';
    expect(
      selectMergedInLeadProfileSourceUrls(
        [url],
        [
          {
            profileLinks: [
              { kind: 'YALE_OFFICIAL', purpose: 'PRIMARY_IDENTITY', url },
              { ...verifiedPrimary(url), purpose: 'SECONDARY' },
            ],
          },
        ],
      ),
    ).toEqual([]);
  });
});
