import { describe, expect, it } from 'vitest';
import { screenDescriptionsOnSharedPages } from '../descriptionOwnershipResolverScreen';

const DIRECTORY = 'https://ysph.yale.edu/school-of-public-health-faculty/directory-name';
const OWN_LAB = 'https://proberlab.yale.edu/research';

const obs = (over: Record<string, unknown> = {}) => ({
  entityType: 'researchEntity',
  field: 'fullDescription',
  value: 'Studies protein folding.',
  sourceUrl: DIRECTORY,
  ...over,
});

const citers = (map: Record<string, string[]>) =>
  new Map(Object.entries(map).map(([url, keys]) => [url, new Set(keys)]));

describe('screenDescriptionsOnSharedPages', () => {
  it('drops a description whose page two other rows already cite', () => {
    const result = screenDescriptionsOnSharedPages(
      [obs()],
      citers({ [DIRECTORY]: ['other-a', 'other-b'] }),
      new Set(['me']),
    );
    expect(result.kept).toHaveLength(0);
    expect(result.dropped).toEqual([
      { field: 'fullDescription', citedUrl: DIRECTORY, foreignCiters: 2 },
    ]);
  });

  it('keeps a page one other row cites, which is usually one subject stored twice', () => {
    const result = screenDescriptionsOnSharedPages(
      [obs()],
      citers({ [DIRECTORY]: ['other-a'] }),
      new Set(['me']),
    );
    expect(result.kept).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
  });

  it('never counts the row being materialized as a foreign citer', () => {
    const result = screenDescriptionsOnSharedPages(
      [obs({ sourceUrl: OWN_LAB })],
      citers({ [OWN_LAB]: ['me', 'me-by-id', 'me-by-slug'] }),
      new Set(['me', 'me-by-id', 'me-by-slug']),
    );
    expect(result.kept).toHaveLength(1);
  });

  it('drops the field, never the row: other candidates survive the screen', () => {
    const result = screenDescriptionsOnSharedPages(
      [
        obs(),
        obs({ sourceUrl: OWN_LAB, value: 'The Prober Lab studies folding.' }),
        obs({ field: 'websiteUrl', value: OWN_LAB }),
      ],
      citers({ [DIRECTORY]: ['a', 'b'], [OWN_LAB]: [] }),
      new Set(['me']),
    );
    expect(result.kept.map((o) => o.value)).toEqual(['The Prober Lab studies folding.', OWN_LAB]);
    expect(result.dropped).toHaveLength(1);
  });

  it('leaves a non-description field and a non-research entity untouched', () => {
    const result = screenDescriptionsOnSharedPages(
      [obs({ field: 'title' }), obs({ entityType: 'user' })],
      citers({ [DIRECTORY]: ['a', 'b', 'c'] }),
      new Set(['me']),
    );
    expect(result.kept).toHaveLength(2);
    expect(result.dropped).toHaveLength(0);
  });

  it('matches a stored URL to its normalized citer key rather than to itself', () => {
    // `normalizeEvidenceUrl` drops the trailing slash, so a screen that looked the raw
    // value up in the citer map would read zero citers for a page many rows cite.
    const result = screenDescriptionsOnSharedPages(
      [obs({ sourceUrl: `${DIRECTORY}/?tab=2#x` })],
      citers({ [DIRECTORY]: ['a', 'b'] }),
      new Set(['me']),
    );
    expect(result.dropped).toHaveLength(1);
  });
});
