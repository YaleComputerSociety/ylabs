import { describe, expect, it } from 'vitest';
import {
  BBS_TRACKS,
  BbsResearchTrackScraper,
  bbsGraftObservations,
  bbsMintObservations,
  bbsProfileSlugFromUrl,
  bbsTrackResearchAreaLabel,
  buildBbsMatchIndex,
  normalizeMatchUrl,
  parseBbsProfileLinks,
  parseBbsTrackFaculty,
  resolveBbsResearchHome,
  type BbsCandidateEntity,
  type BbsProfileLinks,
} from '../sources/bbsResearchTrackScraper';
import type { ObservationInput, ScraperContext } from '../types';

const IMMUNOLOGY_URL = 'https://medicine.yale.edu/bbs/people/immunology/';

function trackListingHtml(rows: Array<{ slug: string; label: string }>, extraLinks = ''): string {
  const items = rows
    .map(
      (row) =>
        `<li class="link-items-list__item" data-columns="4"><div>` +
        `<a href="/bbs/profile/${row.slug}/" tabindex="0" class="hyperlink">${row.label}</a>` +
        `</div></li>`,
    )
    .join('');
  return `<html><body><ul class="link-items-list">${items}</ul>${extraLinks}</body></html>`;
}

function bbsProfileHtml(options: { canonicalSlug: string; labUrls?: string[] }): string {
  const labLinks = (options.labUrls || []).map((url) => `<a href="${url}">Lab</a>`).join('');
  return (
    `<html><head>` +
    `<link rel="canonical" href="https://medicine.yale.edu/profile/${options.canonicalSlug}/">` +
    `</head><body>${labLinks}</body></html>`
  );
}

function makeContext(options: Partial<ScraperContext['options']> = {}): {
  ctx: ScraperContext;
  emitted: ObservationInput[];
  logs: string[];
} {
  const emitted: ObservationInput[] = [];
  const logs: string[] = [];
  return {
    emitted,
    logs,
    ctx: {
      scrapeRunId: 'test-run',
      sourceId: 'source-1',
      sourceName: 'bbs-research-track',
      sourceWeight: 0.65,
      options: {
        dryRun: true,
        useCache: false,
        release: false,
        ...options,
      },
      emit: async (obs) => {
        emitted.push(...(Array.isArray(obs) ? obs : [obs]));
      },
      log: (msg) => logs.push(msg),
    },
  };
}

describe('BBS track slug to research-area mapping', () => {
  it('maps all nine track slugs to a concise label', () => {
    expect(BBS_TRACKS).toHaveLength(9);
    for (const track of BBS_TRACKS) {
      expect(bbsTrackResearchAreaLabel(track.slug)).toBe(track.researchArea);
      expect(track.researchArea.length).toBeGreaterThan(0);
    }
    expect(bbsTrackResearchAreaLabel('cbb')).toBe('Computational Biology & Bioinformatics');
    expect(bbsTrackResearchAreaLabel('mcbgd')).toBe(
      'Molecular Cell Biology, Genetics & Development',
    );
  });

  it('is case-insensitive and returns undefined for an unknown slug', () => {
    expect(bbsTrackResearchAreaLabel('IMMUNOLOGY')).toBe('Immunology');
    expect(bbsTrackResearchAreaLabel('not-a-track')).toBeUndefined();
  });
});

describe('parseBbsTrackFaculty', () => {
  it('extracts First Last, dedupes by profile slug, and ignores non-profile links', () => {
    const html = trackListingHtml(
      [
        { slug: 'alex-rivera', label: 'Rivera, Alex B.' },
        { slug: 'morgan-lee', label: 'Lee, Morgan' },
        { slug: 'alex-rivera', label: 'Rivera, Alex B.' },
      ],
      `<ul class="link-items-list"><li class="link-items-list__item"><div>` +
        `<a href="/bbs/about/" class="hyperlink">About BBS</a></div></li></ul>`,
    );
    const faculty = parseBbsTrackFaculty(html, IMMUNOLOGY_URL);
    expect(faculty).toEqual([
      {
        name: 'Alex B. Rivera',
        profileSlug: 'alex-rivera',
        profileUrl: 'https://medicine.yale.edu/bbs/profile/alex-rivera/',
      },
      {
        name: 'Morgan Lee',
        profileSlug: 'morgan-lee',
        profileUrl: 'https://medicine.yale.edu/bbs/profile/morgan-lee/',
      },
    ]);
  });

  it('derives the profile slug from a BBS profile URL', () => {
    expect(bbsProfileSlugFromUrl('/bbs/profile/alex-rivera/')).toBe('alex-rivera');
    expect(bbsProfileSlugFromUrl('https://medicine.yale.edu/bbs/profile/Morgan-Lee-ml9/')).toBe(
      'morgan-lee-ml9',
    );
    expect(bbsProfileSlugFromUrl('https://example.test/other/')).toBe('');
  });
});

describe('parseBbsProfileLinks', () => {
  it('reads the canonical YSM profile URL and YSM lab links', () => {
    const html = bbsProfileHtml({
      canonicalSlug: 'alex-rivera',
      labUrls: ['https://medicine.yale.edu/lab/rivera/', 'https://twitter.com/nope'],
    });
    const links = parseBbsProfileLinks(html, 'https://medicine.yale.edu/bbs/profile/alex-rivera/');
    expect(links.canonicalProfileUrl).toBe('https://medicine.yale.edu/profile/alex-rivera/');
    expect(links.labUrls).toEqual(['https://medicine.yale.edu/lab/rivera/']);
  });

  it('normalizes match URLs to a comparable form', () => {
    expect(normalizeMatchUrl('https://Medicine.Yale.edu/profile/alex-rivera/?x=1#top')).toBe(
      'https://medicine.yale.edu/profile/alex-rivera',
    );
    expect(normalizeMatchUrl('not-a-url')).toBe('');
  });
});

function candidate(overrides: Partial<BbsCandidateEntity>): BbsCandidateEntity {
  return {
    _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    slug: 'ysm-faculty-alex-rivera',
    name: 'Alex Rivera',
    matchUrls: [],
    nameKey: 'alex-rivera',
    ...overrides,
  };
}

const NO_LINKS: BbsProfileLinks = { canonicalProfileUrl: '', labUrls: [] };

describe('resolveBbsResearchHome', () => {
  it('matches an existing home by the canonical YSM profile URL', () => {
    const index = buildBbsMatchIndex([
      candidate({
        _id: '111111111111111111111111',
        matchUrls: ['https://medicine.yale.edu/profile/alex-rivera/'],
        slug: 'rivera-lab',
        nameKey: 'zzz',
      }),
    ]);
    const links: BbsProfileLinks = {
      canonicalProfileUrl: 'https://medicine.yale.edu/profile/alex-rivera/',
      labUrls: [],
    };
    expect(resolveBbsResearchHome(links, 'alex-rivera', index)).toEqual({
      status: 'matched',
      entityId: '111111111111111111111111',
    });
  });

  it('matches by the ysm-faculty-<slug> entity key derived from the profile', () => {
    const index = buildBbsMatchIndex([
      candidate({ _id: '222222222222222222222222', slug: 'ysm-faculty-alex-rivera', nameKey: 'x' }),
    ]);
    const links: BbsProfileLinks = {
      canonicalProfileUrl: 'https://medicine.yale.edu/profile/alex-rivera/',
      labUrls: [],
    };
    expect(resolveBbsResearchHome(links, 'someone-else', index)).toEqual({
      status: 'matched',
      entityId: '222222222222222222222222',
    });
  });

  it('falls back to a unique name-key match when no URL or slug matches', () => {
    const index = buildBbsMatchIndex([
      candidate({ _id: '333333333333333333333333', slug: 'unrelated', nameKey: 'alex-rivera' }),
    ]);
    expect(resolveBbsResearchHome(NO_LINKS, 'alex-rivera', index)).toEqual({
      status: 'matched',
      entityId: '333333333333333333333333',
    });
  });

  it('holds (ambiguous) when the name key maps to more than one home', () => {
    const index = buildBbsMatchIndex([
      candidate({ _id: '444444444444444444444444', slug: 'a', nameKey: 'alex-rivera' }),
      candidate({ _id: '555555555555555555555555', slug: 'b', nameKey: 'alex-rivera' }),
    ]);
    expect(resolveBbsResearchHome(NO_LINKS, 'alex-rivera', index)).toEqual({ status: 'ambiguous' });
  });

  it('is unmatched when nothing resolves', () => {
    const index = buildBbsMatchIndex([
      candidate({ _id: '666666666666666666666666', slug: 'c', nameKey: 'other-person' }),
    ]);
    expect(resolveBbsResearchHome(NO_LINKS, 'nobody-here', index)).toEqual({ status: 'unmatched' });
  });
});

describe('observation shaping', () => {
  it('grafts research areas onto an existing home keyed by entity id', () => {
    const obs = bbsGraftObservations(
      '777777777777777777777777',
      ['Immunology', 'Immunology', 'Microbiology'],
      'https://medicine.yale.edu/profile/alex-rivera/',
    );
    expect(obs).toEqual([
      {
        entityType: 'researchEntity',
        entityId: '777777777777777777777777',
        sourceUrl: 'https://medicine.yale.edu/profile/alex-rivera/',
        field: 'researchAreas',
        value: ['Immunology', 'Microbiology'],
        confidenceOverride: 0.7,
      },
    ]);
  });

  it('mints a FACULTY_RESEARCH_AREA home on the ysm-faculty namespace with track areas', () => {
    const obs = bbsMintObservations(
      {
        name: 'Alex B. Rivera',
        profileSlug: 'alex-rivera-bbs',
        profileUrl: 'https://medicine.yale.edu/bbs/profile/alex-rivera-bbs/',
        researchAreas: ['Immunology'],
      },
      {
        canonicalProfileUrl: 'https://medicine.yale.edu/profile/alex-rivera/',
        labUrls: [],
      },
    );
    const entityObs = obs.filter((o) => o.entityType === 'researchEntity');
    const bySlug = entityObs.find((o) => o.field === 'slug');
    expect(bySlug?.entityKey).toBe('ysm-faculty-alex-rivera');
    expect(bySlug?.value).toBe('ysm-faculty-alex-rivera');
    expect(entityObs.find((o) => o.field === 'entityType')?.value).toBe('FACULTY_RESEARCH_AREA');
    expect(entityObs.find((o) => o.field === 'school')?.value).toBe('Yale School of Medicine');
    expect(entityObs.find((o) => o.field === 'researchAreas')?.value).toEqual(['Immunology']);
    const userObs = obs.filter((o) => o.entityType === 'user');
    expect(userObs.find((o) => o.field === 'lname')?.value).toBe('Rivera');
    expect(userObs.every((o) => o.entityKey === 'bbs:alex-rivera')).toBe(true);
  });

  it('keys a mint by the BBS slug when the profile exposes no canonical YSM URL', () => {
    const obs = bbsMintObservations(
      {
        name: 'Morgan Lee',
        profileSlug: 'morgan-lee',
        profileUrl: 'https://medicine.yale.edu/bbs/profile/morgan-lee/',
        researchAreas: ['Neuroscience'],
      },
      NO_LINKS,
    );
    expect(obs.find((o) => o.field === 'slug')?.value).toBe('bbs-morgan-lee');
  });
});

describe('BbsResearchTrackScraper.run', () => {
  it('grafts onto an existing home, mints a net-new one, and holds an ambiguous PI', async () => {
    const pages: Record<string, string> = {
      'https://medicine.yale.edu/bbs/people/immunology/': trackListingHtml([
        { slug: 'alex-rivera', label: 'Rivera, Alex' },
        { slug: 'morgan-lee', label: 'Lee, Morgan' },
        { slug: 'sam-carter', label: 'Carter, Sam' },
      ]),
      'https://medicine.yale.edu/bbs/profile/alex-rivera/': bbsProfileHtml({
        canonicalSlug: 'alex-rivera',
      }),
      'https://medicine.yale.edu/bbs/profile/morgan-lee/': bbsProfileHtml({
        canonicalSlug: 'morgan-lee',
      }),
      'https://medicine.yale.edu/bbs/profile/sam-carter/': bbsProfileHtml({
        canonicalSlug: 'sam-carter',
      }),
    };
    const scraper = new BbsResearchTrackScraper({
      fetchPage: async (url) => pages[url] ?? '',
      entityFinder: async () => [
        candidate({
          _id: '111111111111111111111111',
          slug: 'rivera-lab',
          matchUrls: ['https://medicine.yale.edu/profile/alex-rivera/'],
          nameKey: 'alex-rivera',
        }),
        candidate({ _id: 'aaaaaaaaaaaaaaaaaaaaaaa1', slug: 'sam-a', nameKey: 'sam-carter' }),
        candidate({ _id: 'aaaaaaaaaaaaaaaaaaaaaaa2', slug: 'sam-b', nameKey: 'sam-carter' }),
      ],
    });

    const { ctx, emitted } = makeContext({ only: ['immunology'] });
    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(2);

    const graft = emitted.find(
      (o) => o.entityId === '111111111111111111111111' && o.field === 'researchAreas',
    );
    expect(graft?.value).toEqual(['Immunology']);

    const mintedSlug = emitted.find((o) => o.entityType === 'researchEntity' && o.field === 'slug');
    expect(mintedSlug?.value).toBe('ysm-faculty-morgan-lee');

    expect(emitted.some((o) => o.entityId?.startsWith('aaaaaaaaaaaaaaaaaaaaaaa'))).toBe(false);
    expect(result.notes).toMatch(/1 PIs held/);
  });

  it('unions track areas for a PI listed under more than one track', async () => {
    const pages: Record<string, string> = {
      'https://medicine.yale.edu/bbs/people/immunology/': trackListingHtml([
        { slug: 'alex-rivera', label: 'Rivera, Alex' },
      ]),
      'https://medicine.yale.edu/bbs/people/microbiology/': trackListingHtml([
        { slug: 'alex-rivera', label: 'Rivera, Alex' },
      ]),
      'https://medicine.yale.edu/bbs/profile/alex-rivera/': bbsProfileHtml({
        canonicalSlug: 'alex-rivera',
      }),
    };
    const scraper = new BbsResearchTrackScraper({
      fetchPage: async (url) => pages[url] ?? '',
      entityFinder: async () => [
        candidate({
          _id: '111111111111111111111111',
          slug: 'rivera-lab',
          matchUrls: ['https://medicine.yale.edu/profile/alex-rivera/'],
          nameKey: 'alex-rivera',
        }),
      ],
    });
    const { ctx, emitted } = makeContext({ only: ['immunology', 'microbiology'] });
    await scraper.run(ctx);
    const graft = emitted.find((o) => o.field === 'researchAreas');
    expect(graft?.value).toEqual(['Immunology', 'Microbiology']);
  });
});
