import { describe, expect, it, vi } from 'vitest';
import {
  YsmFacultyDirectoryScraper,
  extractProfile,
  facultyToUserObservations,
  screenedProfileTitleObservations,
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

const TRAINEE: RawYsmFaculty = {
  name: 'Wren, Harper',
  profileUrl: 'https://medicine.yale.edu/profile/harper-wren/',
  slug: 'harper-wren',
};

const screenedPages = {
  'subordinate rank': profileHtml({
    fullName: 'Harper Wren',
    headerTitles: ['Postdoctoral Associate'],
    workdayTitle: 'Postdoctoral Associate',
    email: 'fixture.trainee@example.org',
    meshKeywords: ['Fixture Biology'],
  }),
  'non-research title': profileHtml({
    fullName: 'Harper Wren',
    headerTitles: ['Administrative Assistant'],
    workdayTitle: 'Administrative Assistant',
    email: 'fixture.trainee@example.org',
    meshKeywords: ['Fixture Biology'],
  }),
  'no research section': profileHtml({
    fullName: 'Harper Wren',
    headerTitles: ['Associate Professor of Fixture Medicine'],
    workdayTitle: 'Associate Professor of Fixture Medicine',
    email: 'fixture.trainee@example.org',
    includeResearchSection: false,
  }),
} as const;
type ScreenedPath = keyof typeof screenedPages;
const traineePage = screenedPages['subordinate rank'];

const keyOf = (page: string): string => {
  const profile = extractProfile(page, TRAINEE);
  if (!profile) throw new Error('fixture profile did not parse');
  return facultyToUserObservations(profile).entityKey;
};
const traineeKey = (): string => keyOf(traineePage);

async function runWith(
  titledKeys: ReadonlySet<string>,
  page: string = traineePage,
): Promise<ObservationInput[]> {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'ysm-faculty-directory',
    sourceWeight: 0.8,
    options: { dryRun: true, useCache: false, release: false },
    emit: async (obs) => {
      if (Array.isArray(obs)) emitted.push(...obs);
      else emitted.push(obs);
    },
    log: () => {},
  };
  const fetcher = vi.fn(async (url: string) => {
    if (url === DIRECTORY_URL) {
      return directoryHtml([
        { id: 'W', items: [{ url: '/profile/harper-wren/', text: TRAINEE.name }] },
      ]);
    }
    if (url === TRAINEE.profileUrl) return page;
    throw new Error(`unexpected url ${url}`);
  });
  await new YsmFacultyDirectoryScraper(
    fetcher,
    async () => new Map(),
    async () => {},
    undefined,
    undefined,
    async () => titledKeys,
  ).run(ctx);
  return emitted;
}

describe('a screened profile keeps its first-hand title fresh (#5801)', () => {
  it.each(Object.keys(screenedPages) as ScreenedPath[])(
    'on the %s path, emits exactly one title observation from the person own profile',
    async (path) => {
      const page = screenedPages[path];
      const key = keyOf(page);
      const emitted = await runWith(new Set([key]), page);
      const title = extractProfile(page, TRAINEE)?.title;
      expect(emitted).toEqual([
        {
          entityType: 'user',
          entityKey: key,
          sourceUrl: TRAINEE.profileUrl,
          field: 'title',
          value: title,
        },
      ]);
    },
  );

  it('re-emits only the title of a screened person this lane has titled before', async () => {
    const key = traineeKey();
    const userObservations = (await runWith(new Set([key]))).filter(
      (observation) => observation.entityType === 'user',
    );
    expect(userObservations).toEqual([
      expect.objectContaining({
        entityKey: key,
        field: 'title',
        value: 'Postdoctoral Associate',
        sourceUrl: TRAINEE.profileUrl,
      }),
    ]);
  });

  it('emits nothing about a screened person this lane never titled', async () => {
    const emitted = await runWith(new Set());
    expect(emitted.filter((observation) => observation.entityType === 'user')).toEqual([]);
  });

  it('never mints a research row for the screened person', async () => {
    const emitted = await runWith(new Set([traineeKey()]));
    expect(
      emitted.filter(
        (observation) =>
          observation.entityType === 'researchEntity' && observation.field === 'slug',
      ),
    ).toEqual([]);
  });

  it('refreshes nothing when the screened profile states no title', () => {
    const profile = extractProfile(
      profileHtml({
        fullName: 'Harper Wren',
        workdayTitle: null,
        email: 'fixture.trainee@example.org',
      }),
      TRAINEE,
    );
    expect(profile).not.toBeNull();
    expect(
      screenedProfileTitleObservations({ ...profile!, title: undefined }, new Set([traineeKey()])),
    ).toEqual([]);
  });
});
