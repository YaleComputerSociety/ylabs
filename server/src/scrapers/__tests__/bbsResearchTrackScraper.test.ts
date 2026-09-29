import { describe, expect, it } from 'vitest';
import {
  BBS_TRACKS,
  BbsResearchTrackScraper,
  bbsGraftObservations,
  bbsProfileSlugFromUrl,
  bbsTrackResearchAreaLabels,
  buildBbsMatchIndex,
  normalizeMatchUrl,
  parseBbsProfileLinks,
  parseBbsTrackFaculty,
  resolveBbsResearchHome,
  type BbsCandidateEntity,
  type BbsProfileLinks,
} from '../sources/bbsResearchTrackScraper';
import { centerRosterReadAdmissibility, CENTER_ROSTER_HEALTH_FIELD } from '../centerRosterRetirement';
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

/**
 * The other shape the CMS serves: a plain two-column table, with no `link-items-list` wrapper,
 * no `hyperlink` class, and the name as "First Last" rather than "Last, First". Read off the live
 * `plantmolbio` page, which parsed to zero faculty for three runs under the list-only selector
 * (#3833).
 */
function trackTableListingHtml(rows: Array<{ slug: string; label: string }>): string {
  const body = rows
    .map(
      (row) =>
        `<tr><td><a href="https://medicine.yale.edu/bbs/profile/${row.slug}/">${row.label}</a></td>` +
        `<td>Professor</td></tr>`,
    )
    .join('');
  return (
    `<html><body><nav><a href="/bbs/profile/navigation_only/">Nav link</a></nav>` +
    `<table><tr><th>Name</th><th>Title</th></tr>${body}</table></body></html>`
  );
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
  it('maps all nine track slugs to at least one chip', () => {
    expect(BBS_TRACKS).toHaveLength(9);
    for (const track of BBS_TRACKS) {
      expect(bbsTrackResearchAreaLabels(track.slug)).toEqual(track.researchAreas);
      expect(track.researchAreas.length).toBeGreaterThan(0);
    }
  });

  it('is case-insensitive and returns nothing for an unknown slug', () => {
    expect(bbsTrackResearchAreaLabels('IMMUNOLOGY')).toEqual(['Immunology']);
    expect(bbsTrackResearchAreaLabels('not-a-track')).toEqual([]);
  });

  /**
   * A programme name is not a topic. For 38 served rows one of these three was the whole of
   * "Best fit for", so a student read "a fit for one of these four fields" without being told
   * which (#3806). Each now names fields a student can read, which asserts no more than the
   * single-field tracks already do on the same evidence.
   */
  it('names the several fields a multi-field track spans, never the programme', () => {
    expect(bbsTrackResearchAreaLabels('m2p2')).toEqual([
      'Molecular Medicine',
      'Pharmacology',
      'Physiology',
    ]);
    expect(bbsTrackResearchAreaLabels('mcbgd')).toEqual([
      'Molecular Cell Biology',
      'Genetics',
      'Developmental Biology',
    ]);
    expect(bbsTrackResearchAreaLabels('bbsb')).toEqual([
      'Biochemistry',
      'Quantitative Biology',
      'Biophysics',
      'Structural Biology',
    ]);
  });

  /**
   * The shape rule behind the three above, pinned so a tenth track cannot reintroduce it: a
   * chip that lists several fields with a comma or an ampersand is a programme name.
   * "Computational Biology & Bioinformatics" is the one allowed conjunction, because it names
   * one field under two conventional names rather than two fields.
   */
  it('grafts no chip that reads as a programme name', () => {
    const conjoined = BBS_TRACKS.flatMap((track) => track.researchAreas).filter(
      (chip) => /,/.test(chip) || /\s&\s/.test(chip),
    );

    expect(conjoined).toEqual(['Computational Biology & Bioinformatics']);
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

  it('extracts faculty from a table listing, which is the other shape the CMS serves (#3833)', () => {
    const faculty = parseBbsTrackFaculty(
      trackTableListingHtml([
        { slug: 'gary_brudvig', label: 'Gary Brudvig' },
        { slug: 'vivian_irish', label: 'Vivian Irish' },
      ]),
      'https://medicine.yale.edu/bbs/people/plantmolbio/',
    );
    expect(faculty.map((entry) => entry.profileSlug)).toEqual(['gary_brudvig', 'vivian_irish']);
    // "First Last" needs no second name rule, since the comma form falls through unchanged.
    expect(faculty[0].name).toBe('Gary Brudvig');
  });

  // The selector matches roster containers rather than every profile link on the page, because a
  // track page also links profiles from navigation and related-content blocks.
  it('ignores a profile link that is in neither a roster list item nor a table row', () => {
    const faculty = parseBbsTrackFaculty(
      trackTableListingHtml([{ slug: 'gary_brudvig', label: 'Gary Brudvig' }]),
      'https://medicine.yale.edu/bbs/people/plantmolbio/',
    );
    expect(faculty.map((entry) => entry.profileSlug)).toEqual(['gary_brudvig']);
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
});

describe('BbsResearchTrackScraper.run', () => {
  it('grafts onto an existing row and mints nothing for an absent or ambiguous one', async () => {
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

    expect(result.entitiesObserved).toBe(1);

    const graft = emitted.find(
      (o) => o.entityId === '111111111111111111111111' && o.field === 'researchAreas',
    );
    expect(graft?.value).toEqual(['Immunology']);

    // Counted by field rather than in total, because the lane also emits one roster-health
    // snapshot per track it read (#3852). The claim under test is the graft.
    expect(emitted.filter((o) => o.entityType === 'researchEntity')).toHaveLength(1);
    expect(emitted.filter((o) => o.field === CENTER_ROSTER_HEALTH_FIELD)).toHaveLength(1);
    expect(emitted.some((o) => o.entityType === 'user')).toBe(false);
    expect(emitted.some((o) => o.field === 'slug')).toBe(false);
    expect(emitted.some((o) => o.entityId?.startsWith('aaaaaaaaaaaaaaaaaaaaaaa'))).toBe(false);
    expect(result.notes).toMatch(/rows enriched: 1 of 3 track PIs/);
    expect(result.notes).toMatch(/1 have no existing research row/);
    expect(result.notes).toMatch(/1 ambiguous row/);
  });

  it('counts a row reached only through a lab URL naming someone else apart from an absent row', async () => {
    const labUrl = 'https://medicine.yale.edu/lab/quokka/';
    const pages: Record<string, string> = {
      'https://medicine.yale.edu/bbs/people/immunology/': trackListingHtml([
        { slug: 'alex-rivera', label: 'Rivera, Alex' },
      ]),
      'https://medicine.yale.edu/bbs/profile/alex-rivera/': bbsProfileHtml({
        canonicalSlug: 'alex-rivera',
        labUrls: [labUrl],
      }),
    };
    const scraper = new BbsResearchTrackScraper({
      fetchPage: async (url) => pages[url] ?? '',
      entityFinder: async () => [
        candidate({
          _id: '222222222222222222222222',
          slug: 'ysm-faculty-kaya-lindgren',
          name: 'Kaya Lindgren Faculty Research',
          matchUrls: [labUrl],
          nameKey: 'kaya-lindgren',
        }),
      ],
    });

    const { ctx, emitted } = makeContext({ only: ['immunology'] });
    const result = await scraper.run(ctx);

    expect(emitted.filter((o) => o.entityType === 'researchEntity')).toHaveLength(0);
    expect(emitted.filter((o) => o.field === CENTER_ROSTER_HEALTH_FIELD)).toHaveLength(1);
    expect(result.notes).toMatch(/0 have no existing research row/);
    expect(result.notes).toMatch(/1 cite a lab URL only on a row naming someone else/);
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

/**
 * The lane's URL index is built from `websiteUrl` plus every entry of `sourceUrls`,
 * and its key set includes the PI's `/lab/` sites. Neither identifies a person, so a
 * single row citing one of them was taken as the PI and the track landed on somebody
 * else's row (#3342). The ambiguity fence cannot catch it: that refuses when SEVERAL
 * rows are implicated, and this is the one-wrong-row case.
 */
describe('resolveBbsResearchHome on a borrowed URL (#3342)', () => {
  const LAB_URL = 'https://medicine.yale.edu/lab/quokka/';
  const linksWithLab = (profileSlug: string): BbsProfileLinks => ({
    canonicalProfileUrl: `https://medicine.yale.edu/profile/${profileSlug}/`,
    labUrls: [LAB_URL],
  });

  it('refuses a lab URL match on a row whose identity names somebody else', () => {
    const index = buildBbsMatchIndex([
      candidate({
        _id: '222222222222222222222222',
        slug: 'ysm-faculty-kaya-lindgren',
        name: 'Kaya Lindgren Faculty Research',
        matchUrls: [LAB_URL],
        nameKey: 'kaya-lindgren',
      }),
    ]);

    expect(resolveBbsResearchHome(linksWithLab('alex-rivera'), '', index).status).toBe('refused');
  });

  it('keeps a lab URL match when the row names the same person', () => {
    const index = buildBbsMatchIndex([
      candidate({
        _id: '333333333333333333333333',
        slug: 'dept-psych-alex-rivera',
        name: 'Alex Rivera Faculty Research',
        matchUrls: [LAB_URL],
        nameKey: 'zzz',
      }),
    ]);

    expect(resolveBbsResearchHome(linksWithLab('alex-rivera'), '', index)).toEqual({
      status: 'matched',
      entityId: '333333333333333333333333',
    });
  });

  // Two rows can share a surname and be different people, and then the netid is the
  // only thing that separates them.
  it('refuses a shared surname whose netid differs', () => {
    const index = buildBbsMatchIndex([
      candidate({
        _id: '444444444444444444444444',
        slug: 'rivera-ar288',
        name: 'Rivera Lab',
        matchUrls: [LAB_URL],
        nameKey: 'zzz',
      }),
    ]);

    expect(resolveBbsResearchHome(linksWithLab('alex-rivera-ar447'), '', index).status).toBe(
      'unmatched',
    );
  });

  it('matches on a netid that agrees', () => {
    const index = buildBbsMatchIndex([
      candidate({
        _id: '555555555555555555555555',
        slug: 'rivera-ar447',
        name: 'Rivera Lab',
        matchUrls: [LAB_URL],
        nameKey: 'zzz',
      }),
    ]);

    expect(resolveBbsResearchHome(linksWithLab('alex-rivera-ar447'), '', index)).toEqual({
      status: 'matched',
      entityId: '555555555555555555555555',
    });
  });

  // The name fallback runs on the same PI's name, so letting a declined row reach it
  // would re-admit exactly what the URL arm just refused.
  it('does not let the name fallback re-admit a row the borrowed-URL arm declined', () => {
    const index = buildBbsMatchIndex([
      candidate({
        _id: '666666666666666666666666',
        slug: 'ysm-faculty-kaya-lindgren',
        name: 'Kaya Lindgren Faculty Research',
        matchUrls: [LAB_URL],
        nameKey: 'alex-rivera',
      }),
    ]);

    expect(resolveBbsResearchHome(linksWithLab('alex-rivera'), 'alex-rivera', index).status).toBe(
      'refused',
    );
  });

  it('still prefers the PI own profile URL over any corroboration question', () => {
    const index = buildBbsMatchIndex([
      candidate({
        _id: '777777777777777777777777',
        slug: 'quokka-cognition-lab',
        name: 'Quokka Cognition Lab',
        matchUrls: ['https://medicine.yale.edu/profile/alex-rivera/'],
        nameKey: 'zzz',
      }),
    ]);

    expect(resolveBbsResearchHome(linksWithLab('alex-rivera'), '', index)).toEqual({
      status: 'matched',
      entityId: '777777777777777777777777',
    });
  });
});

// A row can cite another person's profile page among its `sourceUrls`, and there the
// lane's strongest key points at the wrong person while the surnames agree.
describe('resolveBbsResearchHome netid conflict on the profile arm (#3342)', () => {
  it('refuses a profile-URL match whose netid names a different person', () => {
    const index = buildBbsMatchIndex([
      candidate({
        _id: '888888888888888888888888',
        slug: 'rivera-ar288',
        name: 'Rivera Lab',
        matchUrls: ['https://medicine.yale.edu/profile/alex-rivera-ar447/'],
        nameKey: 'zzz',
      }),
    ]);
    const links: BbsProfileLinks = {
      canonicalProfileUrl: 'https://medicine.yale.edu/profile/alex-rivera-ar447/',
      labUrls: [],
    };

    expect(resolveBbsResearchHome(links, '', index).status).toBe('unmatched');
  });

  it('is silent when the row carries no netid, so it only ever refuses on disagreement', () => {
    const index = buildBbsMatchIndex([
      candidate({
        _id: '999999999999999999999999',
        slug: 'rivera-lab',
        name: 'Rivera Lab',
        matchUrls: ['https://medicine.yale.edu/profile/alex-rivera-ar447/'],
        nameKey: 'zzz',
      }),
    ]);
    const links: BbsProfileLinks = {
      canonicalProfileUrl: 'https://medicine.yale.edu/profile/alex-rivera-ar447/',
      labUrls: [],
    };

    expect(resolveBbsResearchHome(links, '', index)).toEqual({
      status: 'matched',
      entityId: '999999999999999999999999',
    });
  });
});

/**
 * #3833's loudness contract, agreed with the manager: every empty track warns, and a track that
 * has listed PIs before also fails this lane's stage, naming the track. The failure travels as a
 * `partialFailures` entry, which the orchestrator turns into a run error and the CLI turns into a
 * non-zero exit for this source's own subprocess, so the rest of the sweep still runs.
 */
describe('an empty track listing', () => {
  const emptyPages = {
    'https://medicine.yale.edu/bbs/people/immunology/': '<html><body><ul></ul></body></html>',
  } as Record<string, string>;

  it('warns but does not fail the stage when the track has never listed anybody', async () => {
    const scraper = new BbsResearchTrackScraper({
      fetchPage: async (url) => emptyPages[url] ?? '',
      entityFinder: async () => [],
      trackEverListedPis: async () => false,
    });
    const { ctx, logs } = makeContext({ only: ['immunology'] });
    const result = await scraper.run(ctx);
    expect(logs.some((line) => /WARNING: this track listed no faculty/.test(line))).toBe(true);
    expect(result.partialFailures ?? []).toEqual([]);
  });

  it('fails the stage and names the track when it has listed PIs before', async () => {
    const scraper = new BbsResearchTrackScraper({
      fetchPage: async (url) => emptyPages[url] ?? '',
      entityFinder: async () => [],
      trackEverListedPis: async () => true,
    });
    const { ctx, logs } = makeContext({ only: ['immunology'] });
    const result = await scraper.run(ctx);
    expect(logs.some((line) => /WARNING: this track listed no faculty/.test(line))).toBe(true);
    expect(result.partialFailures).toHaveLength(1);
    expect(result.partialFailures?.[0]).toContain('immunology');
    expect(result.partialFailures?.[0]).toMatch(/listed no faculty but has listed PIs before/);
  });

  it('reports nothing when the track lists faculty', async () => {
    const scraper = new BbsResearchTrackScraper({
      fetchPage: async (url) =>
        url.endsWith('/people/immunology/')
          ? trackListingHtml([{ slug: 'alex-rivera', label: 'Rivera, Alex' }])
          : bbsProfileHtml({ canonicalSlug: 'alex-rivera' }),
      entityFinder: async () => [],
      trackEverListedPis: async () => true,
    });
    const { ctx, logs } = makeContext({ only: ['immunology'] });
    const result = await scraper.run(ctx);
    expect(logs.some((line) => /WARNING: this track listed no faculty/.test(line))).toBe(false);
    expect(result.partialFailures ?? []).toEqual([]);
  });
});

/**
 * #3852 step one. The retirement mechanism from #3781 is driven by a health snapshot, and this
 * lane emitted none, so an omission could never be told from a page nobody read. These pin the
 * admissibility contract at this lane's boundary: only a complete, off-the-wire read that listed
 * at least one PI may ever retire anybody.
 */
describe('per-track roster-health snapshot', () => {
  const snapshotFor = (emitted: ObservationInput[], trackSlug: string) =>
    emitted.find((o) => o.field === CENTER_ROSTER_HEALTH_FIELD && o.entityKey === trackSlug);

  const runTrack = async (options: {
    html: string | null;
    useCache?: boolean;
  }): Promise<ObservationInput[]> => {
    const scraper = new BbsResearchTrackScraper({
      fetchPage: async (url) =>
        url.endsWith('/people/immunology/')
          ? options.html
          : bbsProfileHtml({ canonicalSlug: 'alex-rivera' }),
      entityFinder: async () => [],
      trackEverListedPis: async () => false,
    });
    const { ctx, emitted } = makeContext({
      only: ['immunology'],
      ...(options.useCache === undefined ? {} : { useCache: options.useCache }),
    });
    await scraper.run(ctx);
    return emitted;
  };

  it('is admissible for a complete off-the-wire read that listed a PI', async () => {
    const emitted = await runTrack({
      html: trackListingHtml([{ slug: 'alex-rivera', label: 'Rivera, Alex' }]),
    });
    const snapshot = snapshotFor(emitted, 'immunology');
    expect(snapshot).toBeDefined();
    expect(centerRosterReadAdmissibility(snapshot?.value as never)).toBe('read-listed-members');
  });

  // The plantmolbio protection: a zero-PI parse must retire nobody.
  it('is inadmissible when the read listed nobody, so an empty track retires no one', async () => {
    const emitted = await runTrack({ html: '<html><body><ul></ul></body></html>' });
    const snapshot = snapshotFor(emitted, 'immunology');
    expect(snapshot).toBeDefined();
    expect(centerRosterReadAdmissibility(snapshot?.value as never)).toBe('read-listed-nobody');
  });

  it('is inadmissible when the page could not be read at all', async () => {
    const emitted = await runTrack({ html: null });
    const snapshot = snapshotFor(emitted, 'immunology');
    expect(snapshot).toBeDefined();
    expect(centerRosterReadAdmissibility(snapshot?.value as never)).toBe('not-read');
  });

  // Two runs inside the snapshot cache's lifetime replay one fetch, so a cache-permitted read
  // must never satisfy the two-read rule on its own.
  it('is inadmissible when the run permitted the cache', async () => {
    const emitted = await runTrack({
      html: trackListingHtml([{ slug: 'alex-rivera', label: 'Rivera, Alex' }]),
      useCache: true,
    });
    const snapshot = snapshotFor(emitted, 'immunology');
    expect(centerRosterReadAdmissibility(snapshot?.value as never)).toBe('cache-permitted');
  });

  it('names every PI it listed, which is what a later absence is measured against', async () => {
    const emitted = await runTrack({
      html: trackListingHtml([
        { slug: 'alex-rivera', label: 'Rivera, Alex' },
        { slug: 'morgan-lee', label: 'Lee, Morgan' },
      ]),
    });
    const value = snapshotFor(emitted, 'immunology')?.value as {
      members?: Array<{ memberKey: string }>;
    };
    expect((value.members ?? []).map((m) => m.memberKey)).toEqual(['alex-rivera', 'morgan-lee']);
  });
});
