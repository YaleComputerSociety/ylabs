import { describe, expect, it } from 'vitest';
import {
  isGenericPageHeadingName,
  areSiblingPagesOfOneSite,
  siteSharedPageNames,
  sitePage,
  withoutNames,
  type PageStatedNameObservation,
} from '../siteSharedPageName';

const SITE_NAME = 'Orrery Institute for Regional Studies';

const stated = (
  entityKey: string,
  sourceUrl: string,
  value = SITE_NAME,
  sourceName = 'lab-site-research-read',
): PageStatedNameObservation => ({
  field: 'name',
  value,
  sourceName,
  sourceUrl,
  entityKey,
});

describe('sitePage', () => {
  it('reads an index document as the directory it serves', () => {
    expect(sitePage('https://www.orrery.example.edu/index.html')).toEqual({
      host: 'orrery.example.edu',
      segments: [],
    });
  });

  it('refuses a value that is not a URL', () => {
    expect(sitePage('not a url')).toBeNull();
  });
});

describe('areSiblingPagesOfOneSite', () => {
  const page = (url: string) => sitePage(url)!;

  it('pairs two different sub-paths of one host', () => {
    expect(
      areSiblingPagesOfOneSite(
        page('https://orrery.example.edu/north'),
        page('https://orrery.example.edu/south'),
      ),
    ).toBe(true);
  });

  it('never pairs the site root, an ancestor, or another host', () => {
    expect(
      areSiblingPagesOfOneSite(
        page('https://orrery.example.edu/'),
        page('https://orrery.example.edu/south'),
      ),
    ).toBe(false);
    expect(
      areSiblingPagesOfOneSite(
        page('https://orrery.example.edu/south'),
        page('https://orrery.example.edu/south/people'),
      ),
    ).toBe(false);
    expect(
      areSiblingPagesOfOneSite(
        page('https://orrery.example.edu/north'),
        page('https://other.example.edu/south'),
      ),
    ).toBe(false);
  });
});

describe('siteSharedPageNames', () => {
  it('withdraws the site name a sibling council page also states', () => {
    const candidate = stated('council-north', 'https://orrery.example.edu/north');
    const peer = stated('council-south', 'https://orrery.example.edu/south');

    const shared = siteSharedPageNames([candidate], [peer]);

    expect([...shared]).toEqual(['orrery institute for regional studies']);
  });

  it('keeps a name only one page of the site states', () => {
    const candidate = stated('council-north', 'https://orrery.example.edu/north');
    const peer = stated(
      'council-south',
      'https://orrery.example.edu/south',
      'Council on the South',
    );

    expect(siteSharedPageNames([candidate], [peer]).size).toBe(0);
  });

  it('keeps an eponymous lab name its own page path corroborates', () => {
    const candidate = stated(
      'lab-vantongeren',
      'https://med.example.edu/lab/vantongeren/',
      'Vantongeren Lab',
    );
    const peer = stated(
      'lab-ida-vantongeren',
      'https://med.example.edu/lab/ida_vantongeren/',
      'Vantongeren Lab',
    );

    expect(siteSharedPageNames([candidate], [peer]).size).toBe(0);
  });

  it('keeps a name a duplicate row states for the root and its index document', () => {
    const candidate = stated(
      'lab-row-one',
      'https://orrery.example.edu/',
      'Laboratory for Orbital Mechanics',
    );
    const peer = stated(
      'lab-row-two',
      'https://www.orrery.example.edu/index.html',
      'Laboratory for Orbital Mechanics',
    );

    expect(siteSharedPageNames([candidate], [peer]).size).toBe(0);
  });

  it('ignores a name another kind of lane states', () => {
    const candidate = stated('council-north', 'https://orrery.example.edu/north');
    const peer = stated(
      'council-south',
      'https://orrery.example.edu/south',
      SITE_NAME,
      'centers-institutes-index',
    );

    expect(siteSharedPageNames([candidate], [peer]).size).toBe(0);
  });
});

describe('withoutNames', () => {
  it('drops the page-stated name and display name and keeps every other observation', () => {
    const observations = [
      stated('council-north', 'https://orrery.example.edu/north'),
      { ...stated('council-north', 'https://orrery.example.edu/north'), field: 'displayName' },
      stated(
        'council-north',
        'https://orrery.example.edu/north/people',
        SITE_NAME,
        'centers-institutes-index',
      ),
      { ...stated('council-north', 'https://orrery.example.edu/north'), field: 'websiteUrl' },
    ];

    const kept = withoutNames(observations, new Set(['orrery institute for regional studies']));

    expect(kept.map((observation) => [observation.field, observation.sourceName])).toEqual([
      ['name', 'centers-institutes-index'],
      ['websiteUrl', 'lab-site-research-read'],
    ]);
  });
});

describe('isGenericPageHeadingName (#4916)', () => {
  it.each([
    ['Laboratories & Equipment', true],
    ['Our Labs', true],
    ['Research', true],
    ['Fixture Lab', false],
    ['Laboratory for Fixture Studies', false],
    ['', false],
  ])('%j -> %s', (name, expected) => {
    expect(isGenericPageHeadingName(name)).toBe(expected);
  });
});
