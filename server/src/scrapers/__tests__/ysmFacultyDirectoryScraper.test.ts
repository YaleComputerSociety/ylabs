import { describe, it, expect, vi } from 'vitest';
import {
  YsmFacultyDirectoryScraper,
  parseYsmFacultyDirectory,
  extractProfile,
  facultyToUserObservations,
  facultyToResearchEntityObservations,
  ysmHomeDepartment,
  ysmPrimaryAppointmentSchool,
  REFUSED_PROFILE_RETRY_PAUSE_MS,
  type RawYsmFaculty,
} from '../sources/ysmFacultyDirectoryScraper';
import { NO_SURNAME_ROSTER } from '../../utils/researchHomeNameIdentityAuthority';
import type { ObservationInput, ScraperContext } from '../types';
import { syntheticPersonOrcid } from '../../test/syntheticOrcid';

const SYNTHETIC_ORCID_1 = syntheticPersonOrcid(500);
const SYNTHETIC_ORCID_2 = syntheticPersonOrcid(501);

const DIRECTORY_URL = 'https://medicine.yale.edu/faculty/faculty-directory/facultylist/';

function directoryHtml(
  categories: Array<{
    id: string;
    items: Array<{ url: string; text: string; isExternal?: boolean }>;
  }>,
): string {
  const pageData = {
    mainComponents: [
      {
        key: 'PeopleAzList',
        model: { items: categories.map((c) => ({ id: c.id, category: c.id, items: c.items })) },
      },
    ],
  };
  return `<html><body><script id='page-data' type='application/json'>${JSON.stringify(
    pageData,
  )}</script></body></html>`;
}

function profileHtml(options: {
  fullName: string;
  headerTitles?: string[];
  workdayTitle?: string | null;
  bio?: string;
  email?: string;
  appointments?: Array<{ type: string; organizationName: string }>;
  organizations?: Array<{ name: string }>;
  meshKeywords?: string[];
  researchDescription?: string;
  labWebsite?: { name: string; url: string; description?: string };
  orcid?: string;
  orcids?: string[];
  includeResearchSection?: boolean;
}): string {
  const about: Record<string, unknown> = {
    sectionType: 'about',
    bio: options.bio ? `<p>${options.bio}</p>` : '',
    workdayTitle:
      options.workdayTitle === undefined ? 'Professor of Medicine' : options.workdayTitle,
    appointments: options.appointments ?? [],
    organizations: options.organizations ?? [],
  };
  const sections: Record<string, unknown>[] = [about];
  if (options.includeResearchSection !== false) {
    sections.push({
      sectionType: 'research',
      researchDescription: options.researchDescription
        ? `<p>${options.researchDescription}</p>`
        : '',
      meshKeywords: (options.meshKeywords ?? []).map((name, index) => ({ id: 1000 + index, name })),
      labWebsite: options.labWebsite ?? null,
      orcids: (options.orcids ?? (options.orcid ? [options.orcid] : [])).map((orcid) => ({
        url: `https://orcid.org/${orcid}`,
        text: orcid,
      })),
    });
  }
  sections.push({
    sectionType: 'getInTouch',
    email: options.email ?? '',
  });
  const pageData = {
    mainComponents: [
      {
        key: 'ProfileDetails',
        model: {
          fullName: options.fullName,
          ...(options.headerTitles ? { header: { titles: options.headerTitles } } : {}),
          sections,
        },
      },
    ],
  };
  return `<html><body><script id='page-data' type='application/json'>${JSON.stringify(
    pageData,
  )}</script></body></html>`;
}

const RIVERS: RawYsmFaculty = {
  name: 'Rivers, Jordan',
  profileUrl: 'https://medicine.yale.edu/profile/jordan-rivers/',
  slug: 'jordan-rivers',
};
const SLOAN: RawYsmFaculty = {
  name: 'Sloan, Avery',
  profileUrl: 'https://medicine.yale.edu/profile/avery-sloan/',
  slug: 'avery-sloan',
};

function makeContext(options: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'ysm-faculty-directory',
    sourceWeight: 0.8,
    options: { dryRun: true, useCache: false, release: false, ...options },
    emit: async (obs) => {
      if (Array.isArray(obs)) emitted.push(...obs);
      else emitted.push(obs);
    },
    log: () => {},
  };
  return { ctx, emitted };
}

describe('parseYsmFacultyDirectory', () => {
  it('extracts individual profiles across categories, ignoring external links and duplicates', () => {
    const html = directoryHtml([
      {
        id: 'R',
        items: [
          { url: '/profile/jordan-rivers/', text: 'Rivers, Jordan' },
          { url: '/profile/jordan-rivers/', text: 'Rivers, Jordan (dup)' },
          { url: 'https://external.example.org/rivers', text: 'External Rivers', isExternal: true },
        ],
      },
      { id: 'S', items: [{ url: '/profile/avery-sloan/', text: 'Sloan, Avery' }] },
    ]);
    const roster = parseYsmFacultyDirectory(html);
    expect(roster.map((r) => r.slug)).toEqual(['jordan-rivers', 'avery-sloan']);
    expect(roster.find((r) => r.slug === 'jordan-rivers')?.profileUrl).toBe(RIVERS.profileUrl);
    expect(roster.find((r) => r.slug === 'jordan-rivers')?.name).toBe('Jordan Rivers');
  });

  it('never surfaces the directory root as a faculty entry', () => {
    const html = directoryHtml([
      { id: 'R', items: [{ url: '/profile/jordan-rivers/', text: 'Rivers, Jordan' }] },
    ]);
    const roster = parseYsmFacultyDirectory(html);
    expect(roster.map((r) => r.profileUrl)).not.toContain(DIRECTORY_URL);
  });
});

describe('extractProfile', () => {
  describe('the title the page displays (#5578)', () => {
    it('reads the header title over a recruiting-placeholder Workday title', () => {
      const html = profileHtml({
        fullName: 'Jordan Rivers',
        headerTitles: ['Director, Fixture Epilepsy Program, Pediatric Neurology'],
        workdayTitle: 'Medical School Recruit - Associate Professor',
        email: 'jordan.rivers@yale.edu',
      });
      const profile = extractProfile(html, RIVERS)!;

      expect(profile.title).toBe('Director, Fixture Epilepsy Program, Pediatric Neurology');
      expect(
        facultyToUserObservations(profile).observations.find(
          (observation) => observation.field === 'title',
        )?.value,
      ).toBe('Director, Fixture Epilepsy Program, Pediatric Neurology');
    });

    it('reads the leading header title when the header lists more than one', () => {
      const html = profileHtml({
        fullName: 'Jordan Rivers',
        headerTitles: ['Associate Professor of Fixture Science', 'Director of Fixture Admissions'],
        workdayTitle: 'Teleradiologist - Fixture',
      });

      expect(extractProfile(html, RIVERS)?.title).toBe('Associate Professor of Fixture Science');
    });

    it('reads the header title when the page carries no Workday title', () => {
      const html = profileHtml({
        fullName: 'Jordan Rivers',
        headerTitles: ['Assistant Clinical Professor'],
        workdayTitle: null,
      });

      expect(extractProfile(html, RIVERS)?.title).toBe('Assistant Clinical Professor');
    });

    it('screens nothing from the header when the page carries no Workday title', () => {
      const html = profileHtml({
        fullName: 'Jordan Rivers',
        headerTitles: ['Professor of Fixture Medicine'],
        workdayTitle: null,
      });
      const profile = extractProfile(html, RIVERS)!;

      expect(profile.title).toBe('Professor of Fixture Medicine');
      expect(profile.screeningTitle).toBeUndefined();
      expect(
        facultyToUserObservations(profile).observations.find(
          (observation) => observation.field === 'userType',
        )?.value,
      ).toBe('faculty');
    });

    it('falls back to the Workday title only when the header states none', () => {
      for (const headerTitles of [undefined, [], ['  ']]) {
        const html = profileHtml({
          fullName: 'Jordan Rivers',
          headerTitles,
          workdayTitle: 'Professor of Fixture Medicine',
        });
        expect(extractProfile(html, RIVERS)?.title).toBe('Professor of Fixture Medicine');
      }
    });
  });

  it('extracts identity, title, email, departments, research areas, description, orcid, and lab site', () => {
    const html = profileHtml({
      fullName: 'Jordan Rivers',
      workdayTitle: 'Professor of Medicine (Cardiology)',
      email: 'jordan.rivers@yale.edu',
      appointments: [{ type: 'Primary', organizationName: 'Cardiology' }],
      organizations: [{ name: 'Rivers Lab' }],
      meshKeywords: ['Heart Failure', 'Cardiomyopathy'],
      researchDescription: 'Research on heart failure and cardiac remodeling mechanisms.',
      bio: 'Dr. Rivers received an MD from Yale School of Medicine.',
      labWebsite: { name: 'Rivers Lab', url: 'https://riverslab.example.org' },
      orcid: SYNTHETIC_ORCID_1,
    });
    const profile = extractProfile(html, RIVERS);
    expect(profile?.name).toBe('Jordan Rivers');
    expect(profile?.title).toBe('Professor of Medicine (Cardiology)');
    expect(profile?.email).toBe('jordan.rivers@yale.edu');
    expect(profile?.departments).toEqual(['Cardiology', 'Rivers Lab']);
    expect(profile?.researchAreas).toEqual(['Heart Failure', 'Cardiomyopathy']);
    expect(profile?.description).toContain('cardiac remodeling');
    expect(profile?.bio).toContain('Yale School of Medicine');
    expect(profile?.labUrl).toBe('https://riverslab.example.org');
    expect(profile?.orcid).toBe(SYNTHETIC_ORCID_1);
  });

  it("takes no ORCID from a profile list holding several, since it does not say which is the subject's (#5932)", () => {
    const several = extractProfile(
      profileHtml({
        fullName: 'Jordan Rivers',
        orcids: [SYNTHETIC_ORCID_1, SYNTHETIC_ORCID_2],
      }),
      RIVERS,
    );
    expect(several?.orcid).toBeUndefined();
    const repeated = extractProfile(
      profileHtml({
        fullName: 'Jordan Rivers',
        orcids: [SYNTHETIC_ORCID_1, SYNTHETIC_ORCID_1],
      }),
      RIVERS,
    );
    expect(repeated?.orcid).toBe(SYNTHETIC_ORCID_1);
  });

  it('drops MeSH geographic descriptors, which tag a study site rather than a topic', () => {
    const html = profileHtml({
      fullName: 'Jordan Rivers',
      meshKeywords: ['Heart Failure', 'Uganda', 'Global Health', 'Africa, Eastern'],
    });
    expect(extractProfile(html, RIVERS)?.researchAreas).toEqual(['Heart Failure', 'Global Health']);
  });

  it('inserts a block-boundary separator between glued bio/research HTML blocks (#1481)', () => {
    const html = profileHtml({
      fullName: 'Jordan Rivers',
      bio: '<div>Titles</div><div>Assistant Professor of Medicine (Cardiology)</div>',
      researchDescription:
        '<div>Overview</div><div>Studies heart failure and cardiac remodeling mechanisms in mouse models.</div>',
    });
    const profile = extractProfile(html, RIVERS);
    expect(profile?.bio).not.toMatch(/TitlesAssistant/);
    expect(profile?.description).not.toMatch(/OverviewStudies/);
  });

  it('ignores a departmental admin email and keeps no email when none is person-specific', () => {
    const html = profileHtml({ fullName: 'Jordan Rivers', email: 'contact@yale.edu' });
    const profile = extractProfile(html, RIVERS);
    expect(profile?.email).toBeUndefined();
  });

  it('returns null when the page has no ProfileDetails component', () => {
    const html = `<html><body><script id='page-data' type='application/json'>${JSON.stringify({
      mainComponents: [{ key: 'SomethingElse', model: {} }],
    })}</script></body></html>`;
    expect(extractProfile(html, RIVERS)).toBeNull();
  });

  it('rejects a non-http labWebsite url', () => {
    const html = profileHtml({
      fullName: 'Jordan Rivers',
      labWebsite: { name: 'Bad', url: 'javascript:alert(1)' },
    });
    const profile = extractProfile(html, RIVERS);
    expect(profile?.labUrl).toBeUndefined();
  });
});

describe('the websiteUrl absence the research-entity mint asserts (#2647)', () => {
  const absenceAssertions = (labWebsite?: { name: string; url: string }) => {
    const profile = extractProfile(
      profileHtml({ fullName: 'Jordan Rivers', meshKeywords: ['Heart Failure'], labWebsite }),
      RIVERS,
    )!;
    return facultyToResearchEntityObservations(profile, 'ysm:jordan-rivers', NO_SURNAME_ROSTER)
      .filter((observation) => observation.assertsNoValueFor)
      .map((observation) => observation.assertsNoValueFor);
  };

  it('asserts the absence when the profile carries no lab link at all', () => {
    expect(absenceAssertions()).toEqual([['websiteUrl']]);
    expect(absenceAssertions({ name: 'Rivers Lab', url: '  ' })).toEqual([['websiteUrl']]);
  });

  it('asserts nothing when the profile carries a scheme-less lab link it cannot adopt', () => {
    expect(absenceAssertions({ name: 'Rivers Lab', url: 'www.riverslab.example.org' })).toEqual([]);
  });

  it('asserts nothing when the profile carries a non-http lab link', () => {
    expect(absenceAssertions({ name: 'Bad', url: 'javascript:alert(1)' })).toEqual([]);
  });
});

describe('the refused lab link the research-entity mint states (#3926)', () => {
  const LAB_URL = 'https://riverslab.example.org';
  const refusalsFor = (options: {
    labWebsite?: { name: string; url: string };
    unusable: boolean;
  }) => {
    const profile = extractProfile(
      profileHtml({
        fullName: 'Jordan Rivers',
        meshKeywords: ['Heart Failure'],
        labWebsite: options.labWebsite,
      }),
      RIVERS,
    )!;
    const observations = facultyToResearchEntityObservations(
      profile,
      'ysm:jordan-rivers',
      NO_SURNAME_ROSTER,
      () => options.unusable,
    );
    return {
      refused: observations
        .filter((observation) => observation.field === 'refusedWebsiteUrl')
        .map((observation) => observation.value),
      websiteUrl: observations.find((observation) => observation.field === 'websiteUrl')?.value,
    };
  };

  it('states the link it refused when the slot carries one it will not adopt', () => {
    expect(
      refusalsFor({ labWebsite: { name: 'Rivers Lab', url: LAB_URL }, unusable: true }),
    ).toEqual({ refused: [LAB_URL], websiteUrl: undefined });
  });

  it('states no refusal for a link it adopts or for an empty slot', () => {
    expect(
      refusalsFor({ labWebsite: { name: 'Rivers Lab', url: LAB_URL }, unusable: false }),
    ).toEqual({ refused: [], websiteUrl: LAB_URL });
    expect(refusalsFor({ unusable: true })).toEqual({ refused: [], websiteUrl: undefined });
  });
});

describe('facultyToUserObservations', () => {
  it('keys on netid derived from a person-specific email and sources the profile page', () => {
    const profile = extractProfile(
      profileHtml({
        fullName: 'Jordan Rivers',
        email: 'jordan.rivers@yale.edu',
        meshKeywords: ['Heart Failure'],
      }),
      RIVERS,
    )!;
    const { observations, entityKey } = facultyToUserObservations(profile);
    expect(entityKey).toBe('netid:jordan.rivers');
    expect(observations.every((o) => o.sourceUrl === RIVERS.profileUrl)).toBe(true);
    expect(observations.some((o) => o.field === 'netid')).toBe(false);
    expect(observations.find((o) => o.field === 'userType')?.value).toBe('professor');
  });

  it('falls back to a synthetic ysm: key when no person email is available', () => {
    const profile = extractProfile(profileHtml({ fullName: 'Jordan Rivers' }), RIVERS)!;
    const { entityKey } = facultyToUserObservations(profile);
    expect(entityKey).toBe('ysm:jordan-rivers');
  });
});

describe('facultyToResearchEntityObservations', () => {
  it('seeds a LAB home with the lab site as websiteUrl and profile + lab as sources', () => {
    const profile = extractProfile(
      profileHtml({
        fullName: 'Jordan Rivers',
        meshKeywords: ['Heart Failure'],
        labWebsite: { name: 'Rivers Lab', url: 'https://riverslab.example.org' },
        email: 'jordan.rivers@yale.edu',
      }),
      RIVERS,
    )!;
    const obs = facultyToResearchEntityObservations(
      profile,
      'netid:jordan.rivers',
      NO_SURNAME_ROSTER,
    );
    const byField = Object.fromEntries(obs.map((o) => [o.field, o.value]));
    expect(byField.entityType).toBe('LAB');
    expect(byField.kind).toBe('lab');
    expect(byField.websiteUrl).toBe('https://riverslab.example.org');
    expect(byField.sourceUrls).toEqual([RIVERS.profileUrl, 'https://riverslab.example.org']);
    expect(byField.slug).toBe('ysm-faculty-jordan-rivers');
    expect(byField.researchAreas).toEqual(['Heart Failure']);
    expect(obs.find((o) => o.field === 'inferredPiUserKey')?.value).toBe('jordan.rivers@yale.edu');
  });

  it('seeds no LAB from a lab slot that links a support service the person works for (#4916)', () => {
    const profile = extractProfile(
      profileHtml({
        fullName: 'Jordan Rivers',
        meshKeywords: ['Heart Failure'],
        labWebsite: {
          name: 'Bioinformatics Support Hub',
          url: 'https://library.example.edu/research-support/bioinformatics/',
        },
      }),
      RIVERS,
    )!;
    const obs = facultyToResearchEntityObservations(
      profile,
      'ysm:jordan-rivers',
      NO_SURNAME_ROSTER,
    );
    const byField = Object.fromEntries(obs.map((o) => [o.field, o.value]));
    expect(byField.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(byField.name).toBe('Jordan Rivers Faculty Research');
    expect(byField.websiteUrl).toBeUndefined();
  });

  it('falls back to the synthetic user key for the lead PI when no email was found', () => {
    const profile = extractProfile(
      profileHtml({ fullName: 'Jordan Rivers', meshKeywords: ['Heart Failure'] }),
      RIVERS,
    )!;
    const obs = facultyToResearchEntityObservations(
      profile,
      'ysm:jordan-rivers',
      NO_SURNAME_ROSTER,
    );
    expect(obs.find((o) => o.field === 'inferredPiUserKey')?.value).toBe('ysm:jordan-rivers');
  });

  it('seeds a FACULTY_RESEARCH_AREA home from the profile page with no websiteUrl', () => {
    const profile = extractProfile(
      profileHtml({ fullName: 'Avery Sloan', meshKeywords: ['Climate Policy'] }),
      SLOAN,
    )!;
    const obs = facultyToResearchEntityObservations(profile, 'ysm:avery-sloan', NO_SURNAME_ROSTER);
    const byField = Object.fromEntries(obs.map((o) => [o.field, o.value]));
    expect(byField.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(byField.kind).toBe('individual');
    expect(byField.websiteUrl).toBeUndefined();
    expect(byField.sourceUrls).toEqual([SLOAN.profileUrl]);
  });

  it('mints nothing when a faculty has neither a lab site, research areas, nor a research description', () => {
    const profile = extractProfile(
      profileHtml({ fullName: 'Avery Sloan', includeResearchSection: false }),
      SLOAN,
    )!;
    const obs = facultyToResearchEntityObservations(profile, 'ysm:avery-sloan', NO_SURNAME_ROSTER);
    expect(obs).toEqual([]);
  });

  it('mints a FACULTY_RESEARCH_AREA from a research description even without governed areas (#1933)', () => {
    const profile = extractProfile(
      profileHtml({
        fullName: 'Avery Sloan',
        researchDescription:
          'Studies the immunology of chronic viral infection and T-cell exhaustion.',
      }),
      SLOAN,
    )!;
    const obs = facultyToResearchEntityObservations(profile, 'ysm:avery-sloan', NO_SURNAME_ROSTER);
    const byField = Object.fromEntries(obs.map((o) => [o.field, o.value]));
    expect(byField.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(byField.kind).toBe('individual');
    expect(String(byField.name)).toContain('Faculty Research');
    expect(byField.websiteUrl).toBeUndefined();
    expect(byField.researchAreas).toBeUndefined();
    expect(String(byField.fullDescription)).toContain('T-cell exhaustion');
  });

  it('never cites the directory root as a source', () => {
    const profile = extractProfile(
      profileHtml({ fullName: 'Jordan Rivers', meshKeywords: ['Heart Failure'] }),
      RIVERS,
    )!;
    const obs = facultyToResearchEntityObservations(
      profile,
      'ysm:jordan-rivers',
      NO_SURNAME_ROSTER,
    );
    const sourceUrls = obs.flatMap((o) =>
      o.field === 'sourceUrls' && Array.isArray(o.value) ? (o.value as string[]) : [],
    );
    expect(sourceUrls).not.toContain(DIRECTORY_URL);
    expect(obs.every((o) => o.sourceUrl === RIVERS.profileUrl)).toBe(true);
  });
});

describe('YsmFacultyDirectoryScraper.run', () => {
  it('rejects unsafe runtime limits before fetching', async () => {
    const fetcher = vi.fn(async () => directoryHtml([]));
    const scraper = new YsmFacultyDirectoryScraper(fetcher);
    const { ctx } = makeContext({ limit: 9007199254740992 });
    await expect(scraper.run(ctx)).rejects.toThrow(/--limit must be a safe positive integer/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('crawls the directory seed then each profile with research content, citing only profile pages', async () => {
    const html = directoryHtml([
      {
        id: 'A',
        items: [
          { url: '/profile/jordan-rivers/', text: 'Rivers, Jordan' },
          { url: '/profile/avery-sloan/', text: 'Sloan, Avery' },
          { url: '/profile/cole-nobody/', text: 'Nobody, Cole' },
        ],
      },
    ]);
    const riversProfile = profileHtml({
      fullName: 'Jordan Rivers',
      email: 'jordan.rivers@yale.edu',
      meshKeywords: ['Heart Failure'],
      labWebsite: { name: 'Rivers Lab', url: 'https://riverslab.example.org' },
    });
    const sloanProfile = profileHtml({
      fullName: 'Avery Sloan',
      email: 'avery.sloan@yale.edu',
      meshKeywords: ['Climate Policy'],
    });
    const noResearchProfile = profileHtml({
      fullName: 'Cole Nobody',
      workdayTitle: 'Research Associate',
      includeResearchSection: false,
    });
    const fetcher = vi.fn(async (url: string) => {
      if (url === DIRECTORY_URL) return html;
      if (url === RIVERS.profileUrl) return riversProfile;
      if (url === SLOAN.profileUrl) return sloanProfile;
      if (url === 'https://medicine.yale.edu/profile/cole-nobody/') return noResearchProfile;
      throw new Error(`unexpected url ${url}`);
    });
    const scraper = new YsmFacultyDirectoryScraper(fetcher);
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(fetcher).toHaveBeenCalledWith(DIRECTORY_URL, false);
    expect(result.entitiesObserved).toBeGreaterThan(0);

    const entityObs = emitted.filter((o) => o.entityType === 'researchEntity');
    const slugs = entityObs.filter((o) => o.field === 'slug').map((o) => o.value);
    expect(slugs).toEqual(['ysm-faculty-jordan-rivers', 'ysm-faculty-avery-sloan']);

    const everySource = emitted.map((o) => o.sourceUrl).filter(Boolean);
    expect(everySource).not.toContain(DIRECTORY_URL);
    expect(everySource).toContain(RIVERS.profileUrl);
    expect(everySource).toContain(SLOAN.profileUrl);
    expect(everySource).not.toContain('https://medicine.yale.edu/profile/cole-nobody/');
  });
});

describe('YsmFacultyDirectoryScraper.run profile prefetch (#3568)', () => {
  it('fetches profiles concurrently but emits them in roster order, and still skips a failed fetch', async () => {
    const html = directoryHtml([
      {
        id: 'A',
        items: [
          { url: '/profile/jordan-rivers/', text: 'Rivers, Jordan' },
          { url: '/profile/cole-nobody/', text: 'Nobody, Cole' },
          { url: '/profile/avery-sloan/', text: 'Sloan, Avery' },
        ],
      },
    ]);
    const pages: Record<string, string> = {
      [RIVERS.profileUrl]: profileHtml({
        fullName: 'Jordan Rivers',
        email: 'jordan.rivers@yale.edu',
        meshKeywords: ['Heart Failure'],
      }),
      [SLOAN.profileUrl]: profileHtml({
        fullName: 'Avery Sloan',
        email: 'avery.sloan@yale.edu',
        meshKeywords: ['Climate Policy'],
      }),
    };
    let inFlight = 0;
    let maxInFlight = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (url === DIRECTORY_URL) return html;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, url === RIVERS.profileUrl ? 40 : 5));
      inFlight -= 1;
      if (!pages[url]) throw new Error('Request failed with status code 403');
      return pages[url];
    });
    const logs: string[] = [];
    const { ctx, emitted } = makeContext();
    ctx.log = (message) => logs.push(message);

    await new YsmFacultyDirectoryScraper(fetcher).run(ctx);

    expect(maxInFlight).toBe(3);
    const slugs = emitted
      .filter((o) => o.entityType === 'researchEntity' && o.field === 'slug')
      .map((o) => o.value);
    expect(slugs).toEqual(['ysm-faculty-jordan-rivers', 'ysm-faculty-avery-sloan']);
    expect(logs.some((line) => line.includes('[cole-nobody] profile fetch failed'))).toBe(true);
    expect(logs.at(-1)).toContain('of 3 profiles scanned');
  });
});

describe('YsmFacultyDirectoryScraper.run teaching-appointment mint gate (#4916)', () => {
  it('mints no research entity for a lecturer whose own description is about a practice', async () => {
    const html = directoryHtml([
      { id: 'T', items: [{ url: '/profile/teaching-person/', text: 'Person, Teaching' }] },
    ]);
    const profileUrl = 'https://medicine.yale.edu/profile/teaching-person/';
    const page = profileHtml({
      fullName: 'Teaching Person',
      workdayTitle: 'Lecturer in Public Health',
      researchDescription: 'Writes for fixture magazines and consults for public agencies.',
    });
    const fetcher = vi.fn(async (url: string) => {
      if (url === DIRECTORY_URL) return html;
      if (url === profileUrl) return page;
      throw new Error(`unexpected url ${url}`);
    });
    const { ctx, emitted } = makeContext();
    const result = await new YsmFacultyDirectoryScraper(fetcher).run(ctx);

    expect(
      emitted.filter((o) => o.entityType === 'researchEntity' && o.field !== 'refusedWebsiteUrl'),
    ).toEqual([]);
    expect(result.notes).toMatch(/1 teaching appointments skipped/);
  });
});

describe('YsmFacultyDirectoryScraper.run screens the HR title, not the displayed one (#5578)', () => {
  it('mints nothing for a staff affiliate whose page displays a clinical rank', async () => {
    const html = directoryHtml([
      { id: 'A', items: [{ url: '/profile/affiliate-person/', text: 'Person, Affiliate' }] },
    ]);
    const profileUrl = 'https://medicine.yale.edu/profile/affiliate-person/';
    const page = profileHtml({
      fullName: 'Affiliate Person',
      headerTitles: ['Clinical Instructor'],
      workdayTitle: 'Staff Affiliate - Fixture Hospital',
      email: 'affiliate.person@yale.edu',
      bio: 'Affiliate Person studies fixture outcomes in clinical practice.',
      meshKeywords: ['Fixture Outcomes'],
    });
    const fetcher = vi.fn(async (url: string) => {
      if (url === DIRECTORY_URL) return html;
      if (url === profileUrl) return page;
      throw new Error(`unexpected url ${url}`);
    });
    const { ctx, emitted } = makeContext();
    const result = await new YsmFacultyDirectoryScraper(fetcher).run(ctx);

    expect(
      emitted.filter((o) => o.entityType === 'researchEntity' && o.field !== 'refusedWebsiteUrl'),
    ).toEqual([]);
    expect(result.notes).toMatch(/1 subordinate ranks skipped/);
  });

  it('still emits the displayed title for a profile the screens admit', () => {
    const profile = extractProfile(
      profileHtml({
        fullName: 'Jordan Rivers',
        headerTitles: ['Associate Clinical Professor'],
        workdayTitle: 'Medical Services Provider',
      }),
      RIVERS,
    )!;

    expect(profile.title).toBe('Associate Clinical Professor');
    expect(profile.screeningTitle).toBe('Medical Services Provider');
  });
});

describe('YsmFacultyDirectoryScraper.run support-staff mint gate (#3410)', () => {
  // The damaging path, not the predicate: a lab assistant's profile carries the PI's
  // lab link and the PI's MeSH keywords, so every positive mint condition is met and
  // the row was minted with the PI's lab name, website, and later the PI's lab prose.
  it('mints no research entity from a research-support profile that links its PI lab', async () => {
    const html = directoryHtml([
      { id: 'T', items: [{ url: '/profile/support-person/', text: 'Person, Support' }] },
    ]);
    const supportProfile = profileHtml({
      fullName: 'Support Person',
      workdayTitle: 'Laboratory Assistant 3',
      email: 'support.person@yale.edu',
      meshKeywords: ['Microbiome'],
      labWebsite: { name: 'Principal Lab', url: 'https://medicine.yale.edu/lab/principal/' },
    });
    const profileUrl = 'https://medicine.yale.edu/profile/support-person/';
    const fetcher = vi.fn(async (url: string) => {
      if (url === DIRECTORY_URL) return html;
      if (url === profileUrl) return supportProfile;
      throw new Error(`unexpected url ${url}`);
    });
    const scraper = new YsmFacultyDirectoryScraper(fetcher);
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(
      emitted.filter((o) => o.entityType === 'researchEntity' && o.field !== 'refusedWebsiteUrl'),
    ).toEqual([]);
    expect(result.notes).toMatch(/1 research-support staff skipped/);

    // The person is still a person: their own observations keep flowing, which is
    // both the sibling screens' stated contract and the evidence the retirement pass
    // reads to judge the row.
    const userObs = emitted.filter((o) => o.entityType === 'user');
    expect(userObs.length).toBeGreaterThan(0);
    expect(userObs.map((o) => o.field)).toContain('title');
    expect(userObs.every((o) => o.sourceUrl === profileUrl)).toBe(true);
  });

  it('still mints from a faculty profile that states a support role alongside it', async () => {
    const html = directoryHtml([
      { id: 'L', items: [{ url: '/profile/dual-role/', text: 'Role, Dual' }] },
    ]);
    const dualProfile = profileHtml({
      fullName: 'Dual Role',
      workdayTitle: 'Special Collections Librarian, Lecturer in American Religious History',
      email: 'dual.faculty@yale.edu',
      meshKeywords: ['Religion'],
    });
    const profileUrl = 'https://medicine.yale.edu/profile/dual-role/';
    const fetcher = vi.fn(async (url: string) => {
      if (url === DIRECTORY_URL) return html;
      if (url === profileUrl) return dualProfile;
      throw new Error(`unexpected url ${url}`);
    });
    const scraper = new YsmFacultyDirectoryScraper(fetcher);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    expect(emitted.filter((o) => o.field === 'slug').map((o) => o.value)).toEqual([
      'ysm-faculty-dual-role',
    ]);
  });
});

describe('facultyToResearchEntityObservations affiliated-organization guard (#2234)', () => {
  const SHARMA: RawYsmFaculty = {
    name: 'Sharma, Priya',
    profileUrl: 'https://medicine.yale.edu/profile/priya-sharma/',
    slug: 'priya-sharma',
  };

  function entityFields(faculty: RawYsmFaculty, labWebsite: { name: string; url: string }) {
    const profile = extractProfile(
      profileHtml({
        fullName: faculty.name.split(', ').reverse().join(' '),
        meshKeywords: ['Heart Failure'],
        labWebsite,
      }),
      faculty,
    )!;
    const obs = facultyToResearchEntityObservations(
      profile,
      `ysm:${faculty.slug}`,
      NO_SURNAME_ROSTER,
    );
    return Object.fromEntries(obs.map((o) => [o.field, o.value]));
  }

  it.each([
    ['Equity Research and Innovation Center', 'https://medicine.yale.edu/eric/'],
    ['Center for Outcomes Research and Evaluation (CORE)', 'https://medicine.yale.edu/core/'],
    [
      'Yale Measurement Based Care Collaborative',
      'https://medicine.yale.edu/psychiatry/mbccollab/',
    ],
  ])(
    'refuses %s as the person’s own identity and does not type the row as a LAB',
    (labName, labUrl) => {
      const byField = entityFields(RIVERS, { name: labName, url: labUrl });
      expect(byField.name).toBe('Jordan Rivers Faculty Research');
      expect(byField.entityType).toBe('FACULTY_RESEARCH_AREA');
      expect(byField.kind).toBe('individual');
      expect(byField.websiteUrl).toBeUndefined();
      expect(byField.sourceUrls).toEqual([RIVERS.profileUrl]);
    },
  );

  it('refuses another person’s lab when the URL path names whose lab it is', () => {
    const byField = entityFields(SHARMA, {
      name: 'The Liu Lab',
      url: 'https://medicine.yale.edu/lab/jun-liu/',
    });
    expect(byField.name).toBe('Priya Sharma Faculty Research');
    expect(byField.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(byField.websiteUrl).toBeUndefined();
  });

  it('keeps a genuine lab link but replaces a bare CMS link label with a person-derived name', () => {
    const byField = entityFields(RIVERS, {
      name: 'Lab Website',
      url: 'https://medicine.yale.edu/lab/rivers/',
    });
    expect(byField.name).toBe('Jordan Rivers Lab');
    expect(byField.entityType).toBe('LAB');
    expect(byField.websiteUrl).toBe('https://medicine.yale.edu/lab/rivers/');
  });

  it('still adopts a topical research-home name that is not an umbrella organization', () => {
    const byField = entityFields(RIVERS, {
      name: 'The Cardiac Remodeling Lab',
      url: 'https://cardiacremodeling.example.org/',
    });
    expect(byField.name).toBe('The Cardiac Remodeling Lab');
    expect(byField.entityType).toBe('LAB');
  });

  it('keeps the person row for an organization name that carries the person’s own name', () => {
    const byField = entityFields(RIVERS, {
      name: 'Rivers Center for Cardiac Outcomes',
      url: 'https://medicine.yale.edu/rivers-center/',
    });
    expect(byField.name).toBe('Jordan Rivers Faculty Research');
    expect(byField.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(byField.websiteUrl).toBe('https://medicine.yale.edu/rivers-center/');
  });

  it('refuses a shared academic host organization the lab slot links (#2360)', () => {
    // The name clears every name-axis rule: it wears a research-home head noun and is
    // nobody's eponym. The shared host the slot links is what identifies the owner, and
    // refusing it here rather than only in the repair is what stops the next scrape
    // from minting the same graft again.
    const byField = entityFields(RIVERS, {
      name: 'Computer Systems Lab at Yale',
      url: 'https://csl.yale.edu/',
    });
    expect(byField.name).toBe('Jordan Rivers Faculty Research');
    expect(byField.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(byField.websiteUrl).toBeUndefined();
    expect(byField.sourceUrls).toEqual([RIVERS.profileUrl]);
  });

  it('still adopts a member own lab name linked on the same shared host (#2360)', () => {
    const byField = entityFields(RIVERS, {
      name: 'Analog and RF Circuits Lab at Yale',
      url: 'https://csl.yale.edu/~rivers/',
    });
    expect(byField.name).toBe('Analog and RF Circuits Lab at Yale');
    expect(byField.entityType).toBe('LAB');
    expect(byField.websiteUrl).toBe('https://csl.yale.edu/~rivers/');
  });
});

describe('facultyToResearchEntityObservations foreign-lab and affiliation evidence (#2361)', () => {
  function entityFields(
    faculty: RawYsmFaculty,
    labWebsite: { name: string; url: string; description?: string },
    roster: ReadonlySet<string> = NO_SURNAME_ROSTER,
  ) {
    const profile = extractProfile(
      profileHtml({
        fullName: faculty.name.split(', ').reverse().join(' '),
        meshKeywords: ['Heart Failure'],
        labWebsite,
      }),
      faculty,
    )!;
    const obs = facultyToResearchEntityObservations(profile, `ysm:${faculty.slug}`, roster);
    return Object.fromEntries(obs.map((o) => [o.field, o.value]));
  }

  it('refuses another person’s lab whose surname only appears in the host', () => {
    const byField = entityFields(
      SLOAN,
      { name: 'Girgenti Lab', url: 'https://www.girgentilab.example.org/home' },
      new Set(['girgenti', 'sloan']),
    );
    expect(byField.name).toBe('Avery Sloan Faculty Research');
    expect(byField.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(byField.websiteUrl).toBeUndefined();
  });

  it('adopts the same link when the surname is not on the roster', () => {
    const byField = entityFields(
      SLOAN,
      { name: 'Beacon Lab', url: 'https://www.beaconlab.example.org/home' },
      new Set(['girgenti', 'sloan']),
    );
    expect(byField.name).toBe('Beacon Lab');
    expect(byField.entityType).toBe('LAB');
    expect(byField.websiteUrl).toBe('https://www.beaconlab.example.org/home');
  });

  it('refuses a lab slot that describes what it links as a collaborative', () => {
    const byField = entityFields(SLOAN, {
      name: 'APOLLO LAB, Northgate University',
      url: 'https://apollo-lab-northgate.github.io',
      description: 'Applied Learning AI, Robotics AI Northgate Surgery Collaborative',
    });
    expect(byField.name).toBe('Avery Sloan Faculty Research');
    expect(byField.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(byField.websiteUrl).toBeUndefined();
  });

  it('refuses the same collaborative blurb when the CMS delivers it as HTML', () => {
    const byField = entityFields(SLOAN, {
      name: 'APOLLO LAB, Northgate University',
      url: 'https://apollo-lab-northgate.github.io',
      description: '<p>Applied Learning AI, Robotics AI Northgate Surgery Collaborative</p>',
    });
    expect(byField.name).toBe('Avery Sloan Faculty Research');
    expect(byField.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(byField.websiteUrl).toBeUndefined();
  });

  it('keeps a lab whose blurb only mentions where the research happens', () => {
    const byField = entityFields(SLOAN, {
      name: 'HAIR Lab',
      url: 'https://www.hairlab.example.org/',
      description: 'Research in the Department of Psychiatry on adolescent sleep',
    });
    expect(byField.name).toBe('HAIR Lab');
    expect(byField.entityType).toBe('LAB');
    expect(byField.websiteUrl).toBe('https://www.hairlab.example.org/');
  });
});

describe('a lab URL the corpus has already refused (#3452)', () => {
  const REFUSES_RIVERS_LAB = (url: string) => url === 'https://riverslab.example.org';

  it('withdraws the lab identity, not only the websiteUrl', () => {
    // `classifyProfileLabWebsite` reads the page and sees an own research home, so
    // before this the refusal withheld the websiteUrl while the name, kind, and
    // entityType kept asserting the lab.
    const profile = extractProfile(
      profileHtml({
        fullName: 'Jordan Rivers',
        meshKeywords: ['Climate Policy'],
        labWebsite: { name: 'Rivers Lab', url: 'https://riverslab.example.org' },
      }),
      RIVERS,
    )!;
    const obs = facultyToResearchEntityObservations(
      profile,
      'ysm:jordan-rivers',
      NO_SURNAME_ROSTER,
      REFUSES_RIVERS_LAB,
    );
    const byField = Object.fromEntries(obs.map((o) => [o.field, o.value]));
    expect(byField.name).toBe('Jordan Rivers Faculty Research');
    expect(byField.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(byField.kind).toBe('individual');
    expect(byField.websiteUrl).toBeUndefined();
    expect(byField.sourceUrls).toEqual([RIVERS.profileUrl]);
  });

  it('keeps the lab when the refusal names a different URL', () => {
    const profile = extractProfile(
      profileHtml({
        fullName: 'Jordan Rivers',
        meshKeywords: ['Climate Policy'],
        labWebsite: { name: 'Rivers Lab', url: 'https://riverslab.example.org' },
      }),
      RIVERS,
    )!;
    const obs = facultyToResearchEntityObservations(
      profile,
      'ysm:jordan-rivers',
      NO_SURNAME_ROSTER,
      (url) => url === 'https://some-other-site.example/',
    );
    expect(Object.fromEntries(obs.map((o) => [o.field, o.value])).entityType).toBe('LAB');
  });

  it('keeps the lab when nothing is refused, so silence never costs an identity', () => {
    const profile = extractProfile(
      profileHtml({
        fullName: 'Jordan Rivers',
        meshKeywords: ['Climate Policy'],
        labWebsite: { name: 'Rivers Lab', url: 'https://riverslab.example.org' },
      }),
      RIVERS,
    )!;
    const obs = facultyToResearchEntityObservations(
      profile,
      'ysm:jordan-rivers',
      NO_SURNAME_ROSTER,
    );
    expect(Object.fromEntries(obs.map((o) => [o.field, o.value])).entityType).toBe('LAB');
  });
});

describe('YsmFacultyDirectoryScraper.run refused-profile retry (#3599)', () => {
  const refusal = (status: number) =>
    Object.assign(new Error(`Request failed with status code ${status}`), {
      response: { status },
    });
  const roster = directoryHtml([
    {
      id: 'A',
      items: [
        { url: '/profile/jordan-rivers/', text: 'Rivers, Jordan' },
        { url: '/profile/cole-nobody/', text: 'Nobody, Cole' },
        { url: '/profile/avery-sloan/', text: 'Sloan, Avery' },
      ],
    },
  ]);
  const NOBODY_URL = 'https://medicine.yale.edu/profile/cole-nobody/';
  const pages: Record<string, string> = {
    [RIVERS.profileUrl]: profileHtml({
      fullName: 'Jordan Rivers',
      email: 'jordan.rivers@yale.edu',
      meshKeywords: ['Heart Failure'],
    }),
    [SLOAN.profileUrl]: profileHtml({
      fullName: 'Avery Sloan',
      email: 'avery.sloan@yale.edu',
      meshKeywords: ['Climate Policy'],
    }),
  };
  const noLabEvidence = async () => new Map();
  const slugsOf = (emitted: ObservationInput[]) =>
    emitted
      .filter((o) => o.entityType === 'researchEntity' && o.field === 'slug')
      .map((o) => o.value);

  it('retries a 403 once after the pause and emits the recovered profile after the walk', async () => {
    const refusedOnce = new Set<string>();
    const events: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      if (url === DIRECTORY_URL) return roster;
      if (url === RIVERS.profileUrl && !refusedOnce.has(url)) {
        refusedOnce.add(url);
        throw refusal(403);
      }
      if (!pages[url]) throw refusal(404);
      events.push(`fetch ${url}`);
      return pages[url];
    });
    const pause = vi.fn(async (ms: number) => {
      events.push(`pause ${ms}`);
    });
    const logs: string[] = [];
    const { ctx, emitted } = makeContext();
    ctx.log = (message) => logs.push(message);

    const result = await new YsmFacultyDirectoryScraper(fetcher, noLabEvidence, pause).run(ctx);

    expect(pause).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      `fetch ${SLOAN.profileUrl}`,
      `pause ${REFUSED_PROFILE_RETRY_PAUSE_MS}`,
      `fetch ${RIVERS.profileUrl}`,
    ]);
    expect(slugsOf(emitted)).toEqual(['ysm-faculty-avery-sloan', 'ysm-faculty-jordan-rivers']);
    expect(fetcher.mock.calls.filter(([url]) => url === NOBODY_URL)).toHaveLength(1);
    expect(logs.some((line) => line.includes('[cole-nobody] profile fetch failed'))).toBe(true);
    expect(logs.at(-1)).toContain('of 3 profiles scanned');
    expect(logs.at(-1)).toContain('1 refused on the first pass, 1 recovered on the retry, 0 lost');
    expect(result.notes).toContain('1 profiles refused then 1 recovered on a second pass');
  });

  it('emits what a clean walk emits once the refused profile recovers', async () => {
    const clean = makeContext();
    await new YsmFacultyDirectoryScraper(
      async (url) => {
        if (url === DIRECTORY_URL) return roster;
        if (!pages[url]) throw refusal(404);
        return pages[url];
      },
      noLabEvidence,
      async () => undefined,
    ).run(clean.ctx);

    const refusedOnce = new Set<string>();
    const retried = makeContext();
    await new YsmFacultyDirectoryScraper(
      async (url) => {
        if (url === DIRECTORY_URL) return roster;
        if (url === RIVERS.profileUrl && !refusedOnce.has(url)) {
          refusedOnce.add(url);
          throw refusal(429);
        }
        if (!pages[url]) throw refusal(404);
        return pages[url];
      },
      noLabEvidence,
      async () => undefined,
    ).run(retried.ctx);

    const key = (o: ObservationInput) => JSON.stringify(o);
    expect(retried.emitted.map(key).sort()).toEqual(clean.emitted.map(key).sort());
  });

  it('retries only once, and never pauses when nothing was refused', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url === DIRECTORY_URL) return roster;
      if (url === RIVERS.profileUrl) throw refusal(403);
      if (!pages[url]) throw refusal(404);
      return pages[url];
    });
    const pause = vi.fn(async () => undefined);
    const logs: string[] = [];
    const { ctx, emitted } = makeContext();
    ctx.log = (message) => logs.push(message);

    await new YsmFacultyDirectoryScraper(fetcher, noLabEvidence, pause).run(ctx);

    expect(fetcher.mock.calls.filter(([url]) => url === RIVERS.profileUrl)).toHaveLength(2);
    expect(slugsOf(emitted)).toEqual(['ysm-faculty-avery-sloan']);
    expect(logs.some((line) => line.includes('[jordan-rivers] profile fetch failed'))).toBe(true);
    expect(logs.at(-1)).toContain('1 refused on the first pass, 0 recovered on the retry, 1 lost');

    const quiet = vi.fn(async () => undefined);
    await new YsmFacultyDirectoryScraper(
      async (url) => (url === DIRECTORY_URL ? directoryHtml([]) : ''),
      noLabEvidence,
      quiet,
    ).run(makeContext().ctx);
    expect(quiet).not.toHaveBeenCalled();
  });
});

describe('YsmFacultyDirectoryScraper.run title-skip refusal (#4596)', () => {
  async function runOne(workdayTitle: string, labWebsite?: { name: string; url: string }) {
    const html = directoryHtml([
      { id: 'T', items: [{ url: '/profile/skip-person/', text: 'Person, Skip' }] },
    ]);
    const profileUrl = 'https://medicine.yale.edu/profile/skip-person/';
    const profile = profileHtml({
      fullName: 'Skip Person',
      workdayTitle,
      email: 'skip.person@yale.edu',
      meshKeywords: ['Microbiome'],
      ...(labWebsite ? { labWebsite } : {}),
    });
    const fetcher = vi.fn(async (url: string) => {
      if (url === DIRECTORY_URL) return html;
      if (url === profileUrl) return profile;
      throw new Error(`unexpected url ${url}`);
    });
    const { ctx, emitted } = makeContext();
    const result = await new YsmFacultyDirectoryScraper(fetcher).run(ctx);
    return { emitted, result, profileUrl };
  }

  const LAB = { name: 'Principal Lab', url: 'https://medicine.yale.edu/lab/principal/' };

  it.each(['Postdoctoral Associate', 'Laboratory Assistant 3', 'Administrative Assistant'])(
    'states the lab link it skipped as a refusal on the row key for a %s',
    async (title) => {
      const { emitted, result, profileUrl } = await runOne(title, LAB);
      const entityObs = emitted.filter((o) => o.entityType === 'researchEntity');
      expect(entityObs).toEqual([
        {
          entityType: 'researchEntity',
          entityKey: 'ysm-faculty-skip-person',
          sourceUrl: profileUrl,
          field: 'refusedWebsiteUrl',
          value: LAB.url,
        },
      ]);
      expect(result.observationCount).toBe(emitted.length);
    },
  );

  it('states nothing for a skipped profile with no lab link', async () => {
    const { emitted } = await runOne('Postdoctoral Associate');
    expect(emitted.filter((o) => o.entityType === 'researchEntity')).toEqual([]);
  });
});

describe('the YSM home department comes only from a catalog-named appointment', () => {
  const catalog = (name: string) =>
    ['Surgery', 'Internal Medicine'].includes(name) ? name : undefined;
  const html = profileHtml({
    fullName: 'Jordan Rivers',
    email: 'jordan.rivers@yale.edu',
    appointments: [
      { type: 'Primary', organizationName: 'Fixture Research Program' },
      { type: 'Secondary', organizationName: 'Surgery' },
    ],
    organizations: [{ name: 'Fixture Center' }, { name: 'Internal Medicine' }],
    meshKeywords: ['Heart Failure'],
  });

  it('keeps the organizations out of the appointments and in the departments label', () => {
    const profile = extractProfile(html, RIVERS)!;
    expect(profile.appointmentDepartments).toEqual(['Fixture Research Program', 'Surgery']);
    expect(profile.departments).toEqual([
      'Fixture Research Program',
      'Surgery',
      'Fixture Center',
      'Internal Medicine',
    ]);
  });

  it('never promotes a later appointment or an organization over a non-catalog first appointment', () => {
    const profile = extractProfile(html, RIVERS)!;
    const { observations } = facultyToUserObservations(profile, catalog);
    expect(observations.some((o) => o.field === 'primaryDepartment')).toBe(false);
    expect(observations.find((o) => o.field === 'departments')?.value).toEqual(profile.departments);
  });

  it('emits the first appointment when the catalog names it', () => {
    const profile = extractProfile(
      profileHtml({
        fullName: 'Jordan Rivers',
        email: 'jordan.rivers@yale.edu',
        appointments: [
          { type: 'Primary', organizationName: 'Surgery' },
          { type: 'Secondary', organizationName: 'Internal Medicine' },
        ],
        organizations: [{ name: 'Fixture Center' }],
        meshKeywords: ['Heart Failure'],
      }),
      RIVERS,
    )!;
    const { observations } = facultyToUserObservations(profile, catalog);
    expect(observations.filter((o) => o.field === 'primaryDepartment').map((o) => o.value)).toEqual(
      ['Surgery'],
    );
  });

  it('emits no home department when no appointment is a catalog department', () => {
    const profile = extractProfile(
      profileHtml({
        fullName: 'Jordan Rivers',
        email: 'jordan.rivers@yale.edu',
        appointments: [{ type: 'Primary', organizationName: 'Fixture Research Program' }],
        organizations: [{ name: 'Internal Medicine' }],
        meshKeywords: ['Heart Failure'],
      }),
      RIVERS,
    )!;
    const { observations } = facultyToUserObservations(profile, catalog);
    expect(observations.some((o) => o.field === 'primaryDepartment')).toBe(false);
  });

  it('emits no home department when no catalog is available', () => {
    expect(
      ysmHomeDepartment({ appointmentDepartments: ['Fixture Research Program'] }, null),
    ).toBeUndefined();
    expect(ysmHomeDepartment({ appointmentDepartments: ['Surgery'] }, null)).toBeUndefined();
  });
});

describe('the school a profile states through its Primary appointment (#6160)', () => {
  const FIXTURE_SCHOOLS: Record<string, string> = {
    Cardiology: 'School of Medicine',
    'Fixture Epidemiology': 'School of Public Health',
    'Fixture Economics': 'Faculty of Arts and Sciences',
  };
  const schoolForDepartment = (department: string) => FIXTURE_SCHOOLS[department];

  const profileWith = (appointments: Array<{ type: string; organizationName: string }>) =>
    extractProfile(
      profileHtml({
        fullName: 'Jordan Rivers',
        email: 'jordan.rivers@yale.edu',
        meshKeywords: ['Heart Failure'],
        appointments,
      }),
      RIVERS,
    )!;

  it('reads only the units of Primary appointments, never a Secondary one', () => {
    const profile = profileWith([
      { type: 'Secondary', organizationName: 'Cardiology' },
      { type: 'Primary', organizationName: 'Fixture Epidemiology' },
    ]);

    expect(profile.primaryAppointmentUnits).toEqual(['Fixture Epidemiology']);
    expect(ysmPrimaryAppointmentSchool(profile, schoolForDepartment)).toBe(
      'School of Public Health',
    );
  });

  it.each([
    [
      'only Secondary appointments',
      [{ type: 'Secondary', organizationName: 'Fixture Epidemiology' }],
    ],
    [
      'Primary appointments in two schools',
      [
        { type: 'Primary', organizationName: 'Fixture Epidemiology' },
        { type: 'Primary', organizationName: 'Fixture Economics' },
      ],
    ],
    [
      'a Primary unit off the catalog',
      [{ type: 'Primary', organizationName: 'Fixture Unknown Unit' }],
    ],
  ])('states no school for %s', (_label, appointments) => {
    expect(ysmPrimaryAppointmentSchool(profileWith(appointments), schoolForDepartment)).toBe(
      undefined,
    );
  });

  it('states no school without a catalog', () => {
    const profile = profileWith([{ type: 'Primary', organizationName: 'Fixture Epidemiology' }]);
    expect(ysmPrimaryAppointmentSchool(profile, null)).toBeUndefined();
  });

  const schoolObservation = (primaryAppointmentSchool?: string) =>
    facultyToResearchEntityObservations(
      { ...profileWith([]), primaryAppointmentSchool },
      'netid:jordan.rivers',
      NO_SURNAME_ROSTER,
    ).find((observation) => observation.field === 'school');

  it('cites the stated school of another school to the profile page', () => {
    const observation = schoolObservation('School of Public Health');
    expect(observation?.value).toBe('School of Public Health');
    expect(observation?.sourceUrl).toBe(RIVERS.profileUrl);
  });

  it('keeps the lane school when the profile states Medicine or nothing', () => {
    expect(schoolObservation('School of Medicine')?.value).toBe('Yale School of Medicine');
    expect(schoolObservation(undefined)?.value).toBe('Yale School of Medicine');
  });

  it('carries the stated school from the page into the emitted research row', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url === DIRECTORY_URL) {
        return directoryHtml([
          { id: 'R', items: [{ url: '/profile/jordan-rivers/', text: 'Rivers, Jordan' }] },
        ]);
      }
      if (url === RIVERS.profileUrl) {
        return profileHtml({
          fullName: 'Jordan Rivers',
          email: 'jordan.rivers@yale.edu',
          meshKeywords: ['Heart Failure'],
          appointments: [
            { type: 'Primary', organizationName: 'Fixture Epidemiology' },
            { type: 'Secondary', organizationName: 'Cardiology' },
          ],
        });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const scraper = new YsmFacultyDirectoryScraper(
      fetcher,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => schoolForDepartment,
    );
    const { ctx, emitted } = makeContext();

    await scraper.run(ctx);

    const school = emitted.find(
      (observation) =>
        observation.entityType === 'researchEntity' && observation.field === 'school',
    );
    expect(school?.value).toBe('School of Public Health');
    expect(school?.sourceUrl).toBe(RIVERS.profileUrl);
  });
});
