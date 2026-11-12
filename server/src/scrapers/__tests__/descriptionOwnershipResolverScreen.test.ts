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

// Each citer key maps to that row's NAME, because subject identity is decided from
// names rather than from how many citers a page has.
const citers = (map: Record<string, string[]>) =>
  new Map(
    Object.entries(map).map(([url, keys]) => [
      url,
      new Map(keys.map((key) => [key, `${key} Lab`])),
    ]),
  );

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
  describe('a row owns the page that is its own website', () => {
    const LAB_SITE = 'https://tidepool-lab.example.org/';
    const LAB_PAGE = 'https://tidepool-lab.example.org/research/';
    const memberCiters = citers({ 'https://tidepool-lab.example.org/research': ['m-1', 'm-2'] });
    const lab = { websiteUrl: LAB_SITE, entityType: 'LAB', kind: 'lab' };

    it('keeps a lab description citing its own website that two member rows cite', () => {
      const result = screenDescriptionsOnSharedPages(
        [obs({ sourceUrl: LAB_PAGE })],
        memberCiters,
        new Set(['me']),
        undefined,
        lab,
      );
      expect(result.kept).toHaveLength(1);
      expect(result.dropped).toHaveLength(0);
    });

    it('matches the website across scheme, www and trailing slash', () => {
      const result = screenDescriptionsOnSharedPages(
        [obs({ sourceUrl: 'http://www.tidepool-lab.example.org/research/' })],
        citers({ 'http://tidepool-lab.example.org/research': ['m-1', 'm-2'] }),
        new Set(['me']),
        undefined,
        { ...lab, websiteUrl: 'https://tidepool-lab.example.org' },
      );
      expect(result.kept).toHaveLength(1);
    });

    it('still screens a person row whose stored website is its lab site', () => {
      const result = screenDescriptionsOnSharedPages(
        [obs({ sourceUrl: LAB_PAGE })],
        memberCiters,
        new Set(['me']),
        undefined,
        { websiteUrl: LAB_SITE, entityType: 'FACULTY_RESEARCH_AREA', kind: 'individual' },
      );
      expect(result.kept).toHaveLength(0);
    });

    it('still screens a row with no stated type', () => {
      const result = screenDescriptionsOnSharedPages(
        [obs({ sourceUrl: LAB_PAGE })],
        memberCiters,
        new Set(['me']),
        undefined,
        { websiteUrl: LAB_SITE },
      );
      expect(result.kept).toHaveLength(0);
    });

    it('does not own a page outside its website or on a sibling path', () => {
      const result = screenDescriptionsOnSharedPages(
        [
          obs({ sourceUrl: 'https://medicine.yale.edu/lab/tidepoolother/about' }),
          obs({ sourceUrl: DIRECTORY }),
        ],
        citers({
          'https://medicine.yale.edu/lab/tidepoolother/about': ['a', 'b'],
          [DIRECTORY]: ['a', 'b'],
        }),
        new Set(['me']),
        undefined,
        { ...lab, websiteUrl: 'https://medicine.yale.edu/lab/tidepool' },
      );
      expect(result.kept).toHaveLength(0);
    });

    it('never owns a whole school site through a website that is its root', () => {
      const result = screenDescriptionsOnSharedPages(
        [obs({ sourceUrl: 'https://medicine.yale.edu/lab/someone-else' })],
        citers({ 'https://medicine.yale.edu/lab/someone-else': ['a', 'b'] }),
        new Set(['me']),
        undefined,
        { ...lab, websiteUrl: 'https://medicine.yale.edu/' },
      );
      expect(result.kept).toHaveLength(0);
    });
  });
});
