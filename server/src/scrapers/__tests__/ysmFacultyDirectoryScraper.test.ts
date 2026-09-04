import { describe, it, expect, vi } from 'vitest';
import {
  YsmFacultyDirectoryScraper,
  parseYsmFacultyDirectory,
  extractProfile,
  facultyToUserObservations,
  facultyToResearchEntityObservations,
  type RawYsmFaculty,
} from '../sources/ysmFacultyDirectoryScraper';
import type { ObservationInput, ScraperContext } from '../types';

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
  workdayTitle?: string;
  bio?: string;
  email?: string;
  appointments?: Array<{ type: string; organizationName: string }>;
  organizations?: Array<{ name: string }>;
  meshKeywords?: string[];
  researchDescription?: string;
  labWebsite?: { name: string; url: string; description?: string };
  orcid?: string;
  includeResearchSection?: boolean;
}): string {
  const about: Record<string, unknown> = {
    sectionType: 'about',
    bio: options.bio ? `<p>${options.bio}</p>` : '',
    workdayTitle: options.workdayTitle ?? 'Professor of Medicine',
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
      orcids: options.orcid
        ? [{ url: `https://orcid.org/${options.orcid}`, text: options.orcid }]
        : [],
    });
  }
  sections.push({
    sectionType: 'getInTouch',
    email: options.email ?? '',
  });
  const pageData = {
    mainComponents: [{ key: 'ProfileDetails', model: { fullName: options.fullName, sections } }],
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
      orcid: '0000-0002-1234-5677',
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
    expect(profile?.orcid).toBe('0000-0002-1234-5677');
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
    expect(observations.find((o) => o.field === 'netid')?.value).toBe('jordan.rivers');
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
    const obs = facultyToResearchEntityObservations(profile, 'netid:jordan.rivers');
    const byField = Object.fromEntries(obs.map((o) => [o.field, o.value]));
    expect(byField.entityType).toBe('LAB');
    expect(byField.kind).toBe('lab');
    expect(byField.websiteUrl).toBe('https://riverslab.example.org');
    expect(byField.sourceUrls).toEqual([RIVERS.profileUrl, 'https://riverslab.example.org']);
    expect(byField.slug).toBe('ysm-faculty-jordan-rivers');
    expect(byField.researchAreas).toEqual(['Heart Failure']);
    expect(obs.find((o) => o.field === 'inferredPiUserKey')?.value).toBe('jordan.rivers@yale.edu');
  });

  it('falls back to the synthetic user key for the lead PI when no email was found', () => {
    const profile = extractProfile(
      profileHtml({ fullName: 'Jordan Rivers', meshKeywords: ['Heart Failure'] }),
      RIVERS,
    )!;
    const obs = facultyToResearchEntityObservations(profile, 'ysm:jordan-rivers');
    expect(obs.find((o) => o.field === 'inferredPiUserKey')?.value).toBe('ysm:jordan-rivers');
  });

  it('seeds a FACULTY_RESEARCH_AREA home from the profile page with no websiteUrl', () => {
    const profile = extractProfile(
      profileHtml({ fullName: 'Avery Sloan', meshKeywords: ['Climate Policy'] }),
      SLOAN,
    )!;
    const obs = facultyToResearchEntityObservations(profile, 'ysm:avery-sloan');
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
    const obs = facultyToResearchEntityObservations(profile, 'ysm:avery-sloan');
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
    const obs = facultyToResearchEntityObservations(profile, 'ysm:avery-sloan');
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
    const obs = facultyToResearchEntityObservations(profile, 'ysm:jordan-rivers');
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
    const obs = facultyToResearchEntityObservations(profile, `ysm:${faculty.slug}`);
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

  it('still adopts an organization name that carries the person’s own name', () => {
    const byField = entityFields(RIVERS, {
      name: 'Rivers Center for Cardiac Outcomes',
      url: 'https://medicine.yale.edu/rivers-center/',
    });
    expect(byField.name).toBe('Rivers Center for Cardiac Outcomes');
    expect(byField.entityType).toBe('LAB');
  });
});

describe('facultyToResearchEntityObservations foreign-lab and affiliation evidence (#2361)', () => {
  function entityFields(
    faculty: RawYsmFaculty,
    labWebsite: { name: string; url: string; description?: string },
    roster?: ReadonlySet<string>,
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
