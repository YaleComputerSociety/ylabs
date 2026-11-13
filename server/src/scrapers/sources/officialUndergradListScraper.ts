/**
 * OfficialUndergradListScraper (#5551)
 *
 * Reads official Yale lists that name a faculty member as the adviser or mentor of a
 * specific undergraduate, or as open to advising undergraduates now, and attaches each
 * named professor's list entries to the research row they already lead as
 * `undergradListEvidence`. Mentoring is its own signal, separate from hosting.
 *
 * Deterministic: every source is read by an HTML or CSV parser in
 * `utils/officialUndergradLists.ts`, with no model call. Only the adviser is read; no student
 * name, project title or topic is stored.
 *
 * Identity fails closed. A Yale email, or a Tobin sponsor's profile link, matches the
 * researcher who holds it only when they carry the listed name; a name matches only when
 * exactly one researcher carries it, and, where the list states a department, only when
 * that researcher's own rows agree with it. An adviser who leads no
 * row is counted and skipped: mentoring alone never creates a row (owner, 2026-11-10).
 *
 * Every run rebuilds each row's whole list, so an entry withdraws when its source stops
 * naming the adviser. A source that could not be read completely keeps the entries it
 * contributed before, so a failed fetch never withdraws evidence.
 */
import { Researcher } from '../../models/researcher';
import { ResearchEntity } from '../../models/researchEntity';
import { leadTitlesAreAllEmeritus } from '../../services/emeritusLeadWayIn';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { researcherNetid } from '../../utils/researcherIdentity';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import { departmentsAgree } from '../utils/labScienceAdviserRule';
import {
  givenNamesCouldNameOnePerson,
  surnameFetchRegex,
  surnamesCompatible,
} from '../utils/piNameMatch';
import { splitName } from '../utils/scraperHelpers';
import {
  aggregateListEntries,
  yibsSuresFellowListings,
  politicalScienceEssayPrizeListings,
  germanSeniorEssayListings,
  englishAdvisedByListings,
  csArchiveTermListings,
  csArchiveTermUrls,
  economicsSeniorEssayAdviserListings,
  theaterSeniorProjectIndexListings,
  googleSheetCsvUrl,
  physicsOpenOpportunityListings,
  psychologyResearchSheetListings,
  tobinBoardListings,
  undergradListSources,
  wuTsaiFellowListings,
  UNDERGRAD_LIST_SOURCE_KIND,
  type MentorListing,
  type UndergradListEntry,
  type UndergradListSource,
} from '../utils/officialUndergradLists';
import { fetchPageWithPolicy, HttpStatusError } from '../utils/httpFetch';
import { TOBIN_RA_BOARD_URL } from '../utils/tobinRaBoard';
import {
  parseSeniorEssayAdviserTables,
  parseSeniorThesisAdviserParagraphs,
  type AdviserListPair,
} from '../utils/undergradAdviserLists';
import {
  defaultAdvisorResolution,
  existingLeadRowSlugForOwner,
  leadRowDepartmentsForOwner,
  researcherToUserMatch,
  type UserMatch,
} from './undergradFellowshipRecipientScraper';
import { SCRAPER_USER_AGENT } from '../utils/scraperUserAgent';

export const OFFICIAL_UNDERGRAD_LISTS_SOURCE = 'official-undergrad-lists';
export const UNDERGRAD_LIST_EVIDENCE_FIELD = 'undergradListEvidence';

/** Advising more than this many academic years back is not read, so counts stay recent. */
export const LIST_LOOKBACK_YEARS = 5;

export type MentorRefusal =
  'no-match' | 'ambiguous' | 'department-mismatch' | 'emeritus-on-current-list' | 'no-lead-row';

export type MentorResolution =
  | {
      status: 'matched';
      slug: string;
      researcherId?: string;
      researcherName?: string;
      matchedBy?: 'email' | 'profile' | 'name';
    }
  | { status: 'refused'; reason: MentorRefusal };

export type MentorResolver = (listing: MentorListing) => Promise<MentorResolution>;

/** A page's text, `''` for a page the server says is gone, or `null` when it could not be read. */
export type MentorFetchText = (url: string) => Promise<string | null>;

const GONE_STATUSES = new Set([404, 410]);

export const defaultMentorFetchText: MentorFetchText = async (url) => {
  try {
    const page = await fetchPageWithPolicy(url, {
      headers: { Accept: '*/*' },
      timeoutMs: 30_000,
    });
    return page.html;
  } catch (error) {
    if (error instanceof HttpStatusError && GONE_STATUSES.has(error.status)) return '';
    return null;
  }
};

export type StoredListEvidenceFinder = () => Promise<Map<string, UndergradListEntry[]>>;

interface SourceRead {
  listings: MentorListing[];
  complete: boolean;
}

interface MentorSourceConfig {
  source: UndergradListSource;
  landingUrl: string;
  departmentScope?: readonly string[];
  read: (fetchText: MentorFetchText, now: Date) => Promise<SourceRead>;
}

const latestAcademicYearEnd = (now: Date) => now.getUTCFullYear() + 1;

const isAfterLatestAcademicYearEnd = (year: number | undefined, now: Date) =>
  year !== undefined && year > latestAcademicYearEnd(now);

export const fullYearOfTwoDigitYear = (twoDigitYear: number, now: Date): number =>
  isAfterLatestAcademicYearEnd(2000 + twoDigitYear, now)
    ? 1900 + twoDigitYear
    : 2000 + twoDigitYear;

export const csArchiveTermAcademicYearEnd = (termUrl: string, now: Date): number | undefined => {
  const match = /\/(\d\d)-(\d\d)[ab]\/index\.html$/i.exec(termUrl);
  return match ? fullYearOfTwoDigitYear(Number(match[2]), now) : undefined;
};

const withinLookback = (year: number | undefined, now: Date) =>
  year === undefined || year >= now.getUTCFullYear() - LIST_LOOKBACK_YEARS;

const csArchive =
  (source: UndergradListSource, indexUrl: string): MentorSourceConfig['read'] =>
  async (fetchText, now) => {
    const index = await fetchText(indexUrl);
    if (index === null) return { listings: [], complete: false };
    const terms = csArchiveTermUrls(index, indexUrl).filter((url) =>
      withinLookback(csArchiveTermAcademicYearEnd(url, now), now),
    );
    const listings: MentorListing[] = [];
    let complete = terms.length > 0;
    for (const term of terms) {
      const html = await fetchText(term);
      if (html === null) {
        complete = false;
        continue;
      }
      listings.push(...csArchiveTermListings(html, term, source));
    }
    return { listings, complete };
  };

const singlePage =
  (
    url: string,
    extract: (html: string, url: string) => MentorListing[],
  ): MentorSourceConfig['read'] =>
  async (fetchText) => {
    const html = await fetchText(url);
    return html === null
      ? { listings: [], complete: false }
      : { listings: extract(html, url), complete: true };
  };

const recentOnly =
  (read: MentorSourceConfig['read']): MentorSourceConfig['read'] =>
  async (fetchText, now) => {
    const result = await read(fetchText, now);
    return {
      ...result,
      listings: result.listings.filter((listing) => withinLookback(listing.year, now)),
    };
  };

const COMPUTING_ADVISER_DEPARTMENTS = [
  'Computer Science',
  'Electrical & Computer Engineering',
  'Electrical Engineering',
  'Statistics & Data Science',
  'Applied Mathematics',
  'Mathematics',
  'Applied Physics',
  'Physics',
  'Mechanical Engineering & Materials Science',
  'Biomedical Engineering',
  'Biomedical Informatics & Data Science',
  'Biostatistics',
  'Radiology & Biomedical Imaging',
  'Economics',
  'Linguistics',
  'Psychology',
  'Cognitive Science',
  'Neuroscience',
  'Management',
] as const;

const NEUROSCIENCE_ADVISER_DEPARTMENTS = [
  'Psychology',
  'Psychiatry',
  'Neuroscience',
  'Neurology',
  'Neurobiology',
  'Neurosurgery',
  'Child Study Center',
  'Cellular & Molecular Physiology',
  'Comparative Medicine',
  'Pharmacology',
  'Ophthalmology & Visual Science',
  'Radiology & Biomedical Imaging',
  'Biomedical Engineering',
  'Computer Science',
  'Electrical & Computer Engineering',
  'Statistics & Data Science',
  'Linguistics',
  'Cognitive Science',
  'Philosophy',
  'Molecular Biophysics & Biochemistry',
  'Genetics',
] as const;

const ECONOMIC_POLICY_ADVISER_DEPARTMENTS = [
  'Economics',
  'Management',
  'Law',
  'Political Science',
  'Sociology',
  'Global Affairs',
  'Public Health',
  'Health Policy',
  'Statistics & Data Science',
  'School of the Environment',
] as const;

const ENVIRONMENTAL_ADVISER_DEPARTMENTS = [
  'Ecology & Evolutionary Biology',
  'Earth & Planetary Sciences',
  'School of the Environment',
  'Molecular, Cellular & Developmental Biology',
  'Chemical & Environmental Engineering',
  'Environmental Health Sciences',
  'Anthropology',
  'Peabody Museum',
  'Economics',
] as const;

const COGNITIVE_SCIENCE_ADVISER_DEPARTMENTS = [
  'Cognitive Science',
  'Psychology',
  'Linguistics',
  'Philosophy',
  'Computer Science',
  'Neuroscience',
  'Psychiatry',
  'Child Study Center',
  'Neurology',
  'Economics',
  'Statistics & Data Science',
  'Anthropology',
  'Electrical & Computer Engineering',
  'Biomedical Engineering',
  'Management',
] as const;

const THEATER_ADVISER_DEPARTMENTS = [
  'Theater, Dance & Performance Studies',
  'Theater & Performance Studies',
  'Theater Studies',
  'Drama',
  'English',
  'Music',
  'African American Studies',
] as const;

const THEATER_PRODUCTIONS_ARCHIVE =
  'https://tdps.yale.edu/tdps-production-season/tdps-productions-archive';

const COGNITIVE_SCIENCE_ESSAYS = 'https://cogsci.yale.edu/research/past-senior-essays';
const EPS_THESES = 'https://earth.yale.edu/recent-alumni-and-senior-theses';

function adviserPairsAsMentorListings(
  source: UndergradListSource,
  pairs: readonly AdviserListPair[],
  pageUrl: string,
): MentorListing[] {
  return pairs.map((pair) => ({
    source,
    adviserName: pair.advisorName,
    year: pair.year,
    sourceUrl: pageUrl,
  }));
}

const EPS_ADVISER_DEPARTMENTS = ['Earth and Planetary Sciences', 'Geology and Geophysics'] as const;

const PSYCHOLOGY_PAGE = 'https://psychology.yale.edu/undergraduate/research-opportunities';

export const UNDERGRAD_LIST_SOURCE_CONFIGS: readonly MentorSourceConfig[] = [
  {
    source: 'cs-senior-projects',
    landingUrl: 'https://zoo.cs.yale.edu/classes/cpsc4900/',
    departmentScope: COMPUTING_ADVISER_DEPARTMENTS,
    read: csArchive('cs-senior-projects', 'https://zoo.cs.yale.edu/classes/cpsc4900/'),
  },
  {
    source: 'cs-directed-research',
    landingUrl: 'https://zoo.cs.yale.edu/classes/cs290/',
    departmentScope: COMPUTING_ADVISER_DEPARTMENTS,
    read: csArchive('cs-directed-research', 'https://zoo.cs.yale.edu/classes/cs290/'),
  },
  {
    source: 'tobin-research-assistantships',
    landingUrl: TOBIN_RA_BOARD_URL,
    departmentScope: ECONOMIC_POLICY_ADVISER_DEPARTMENTS,
    read: async (fetchText) => {
      const html = await fetchText(TOBIN_RA_BOARD_URL);
      if (!html) return { listings: [], complete: false };
      const board = tobinBoardListings(html, TOBIN_RA_BOARD_URL);
      return { listings: board.listings, complete: board.projectBlocks > 0 };
    },
  },
  {
    source: 'economics-senior-essay-advisers',
    landingUrl: 'https://economics.yale.edu/undergraduate/senior-essay/senior-essay-advisers',
    read: singlePage(
      'https://economics.yale.edu/undergraduate/senior-essay/senior-essay-advisers',
      economicsSeniorEssayAdviserListings,
    ),
  },
  {
    source: 'psychology-research-opportunities',
    landingUrl: PSYCHOLOGY_PAGE,
    read: async (fetchText) => {
      const page = await fetchText(PSYCHOLOGY_PAGE);
      const csvUrl = page ? googleSheetCsvUrl(page) : undefined;
      const csv = csvUrl ? await fetchText(csvUrl) : null;
      if (csv === null) return { listings: [], complete: false };
      const listings = psychologyResearchSheetListings(csv, PSYCHOLOGY_PAGE);
      return { listings, complete: listings.length > 0 };
    },
  },
  {
    source: 'wu-tsai-undergraduate-fellows',
    landingUrl: 'https://wti.yale.edu/humans/undergrads',
    departmentScope: NEUROSCIENCE_ADVISER_DEPARTMENTS,
    read: async (fetchText, now) => {
      const read = await singlePage('https://wti.yale.edu/humans/undergrads', wuTsaiFellowListings)(
        fetchText,
        now,
      );
      return {
        ...read,
        listings: read.listings.filter((listing) => withinLookback(listing.year, now)),
      };
    },
  },
  {
    source: 'physics-open-research-opportunities',
    landingUrl:
      'https://physics.yale.edu/undergraduate-academics/undergraduate-research-opportunities',
    read: singlePage(
      'https://physics.yale.edu/undergraduate-academics/undergraduate-research-opportunities',
      physicsOpenOpportunityListings,
    ),
  },
  ...(
    [
      [
        'english-senior-essays',
        'https://english.yale.edu/undergraduate/senior-essay/senior-essay-topics-2011-present',
        (html: string, url: string) => englishAdvisedByListings(html, url, 'english-senior-essays'),
      ],
      [
        'english-creative-writing-projects',
        'https://english.yale.edu/undergraduate/creative-writing-concentration/cw-concentration-project-topics-2011-present',
        (html: string, url: string) =>
          englishAdvisedByListings(html, url, 'english-creative-writing-projects'),
      ],
      [
        'political-science-senior-essay-prizes',
        'https://politicalscience.yale.edu/prizes',
        politicalScienceEssayPrizeListings,
      ],
      [
        'german-senior-essays',
        'https://german.yale.edu/programs/undergraduate-program/majoring-german/recent-senior-essays',
        germanSeniorEssayListings,
      ],
    ] as const
  ).map(([source, url, extract]) => ({
    source,
    landingUrl: url,
    read: recentOnly(singlePage(url, extract)),
  })),
  {
    source: 'cognitive-science-senior-essays',
    landingUrl: COGNITIVE_SCIENCE_ESSAYS,
    departmentScope: COGNITIVE_SCIENCE_ADVISER_DEPARTMENTS,
    read: recentOnly(
      singlePage(COGNITIVE_SCIENCE_ESSAYS, (html, pageUrl) =>
        adviserPairsAsMentorListings(
          'cognitive-science-senior-essays',
          parseSeniorEssayAdviserTables(html).pairs,
          pageUrl,
        ),
      ),
    ),
  },
  {
    source: 'eps-senior-theses',
    landingUrl: EPS_THESES,
    departmentScope: EPS_ADVISER_DEPARTMENTS,
    read: recentOnly(
      singlePage(EPS_THESES, (html, pageUrl) =>
        adviserPairsAsMentorListings(
          'eps-senior-theses',
          parseSeniorThesisAdviserParagraphs(html).pairs,
          pageUrl,
        ),
      ),
    ),
  },
  {
    source: 'yibs-summer-research-fellows',
    landingUrl: 'https://yibs.yale.edu/people/past_sures_fellows',
    departmentScope: ENVIRONMENTAL_ADVISER_DEPARTMENTS,
    read: recentOnly(
      singlePage('https://yibs.yale.edu/people/past_sures_fellows', yibsSuresFellowListings),
    ),
  },
  {
    source: 'theater-performance-studies-senior-projects',
    landingUrl: THEATER_PRODUCTIONS_ARCHIVE,
    departmentScope: THEATER_ADVISER_DEPARTMENTS,
    read: recentOnly(singlePage(THEATER_PRODUCTIONS_ARCHIVE, theaterSeniorProjectIndexListings)),
  },
];

const listingKey = (listing: MentorListing): string =>
  [
    listing.adviserEmail ? `email:${listing.adviserEmail}` : '',
    listing.adviserProfileUrl ? `profile:${listing.adviserProfileUrl.toLowerCase()}` : '',
    `name:${listing.adviserName.toLowerCase()}`,
    (listing.department ?? '').toLowerCase(),
    (listing.departmentScope ?? []).join(',').toLowerCase(),
  ].join('|');

async function researcherForEmail(email: string): Promise<UserMatch | null> {
  const researcher: any = await Researcher.findOne({
    'identifiers.email': email,
    archived: { $ne: true },
  })
    .select('_id displayName profile identifiers')
    .lean();
  return researcher ? researcherToUserMatch(researcher, researcherNetid(researcher)) : null;
}

const profileUrlVariants = (url: string): string[] => {
  const bare = url.replace(/\/+$/, '');
  const http = bare.replace(/^https:\/\//, 'http://');
  return [bare, `${bare}/`, http, `${http}/`];
};

const PROFILE_LINK_SOURCES: ReadonlySet<UndergradListSource> = new Set([
  'tobin-research-assistantships',
]);

/** The one live researcher whose profile links include this exact page, or none. */
async function soleResearcherForProfileUrl(url: string): Promise<UserMatch | null> {
  const holders: any[] = await Researcher.find({
    archived: { $ne: true },
    'profileLinks.url': { $in: profileUrlVariants(url) },
  })
    .select('_id displayName profile identifiers')
    .limit(2)
    .lean();
  return holders.length === 1
    ? researcherToUserMatch(holders[0], researcherNetid(holders[0]))
    : null;
}

/** The listed name and the matched researcher's name could be one person. */
export function listedNameAgrees(listedName: string, owner: Pick<UserMatch, 'fname' | 'lname'>) {
  const { first, last } = splitName(listedName);
  if (!last || !owner.lname || !surnamesCompatible(last, owner.lname)) return false;
  return !first || !owner.fname || givenNamesCouldNameOnePerson(first, owner.fname);
}

async function liveNamesakeCount(listedName: string): Promise<number> {
  const { first, last } = splitName(listedName);
  const surnameRe = surnameFetchRegex(last);
  if (!surnameRe || !first) return 0;
  const candidates: Array<{ displayName?: string }> = await Researcher.find(
    { displayName: surnameRe, archived: { $ne: true } },
    { displayName: 1 },
  ).lean();
  return candidates.filter((candidate) => {
    const parsed = splitName(candidate.displayName ?? '');
    return (
      surnamesCompatible(last, parsed.last) && givenNamesCouldNameOnePerson(first, parsed.first)
    );
  }).length;
}

/**
 * An email or a Tobin sponsor's profile link binds only when the researcher who holds it
 * carries the name the list prints, because a project card's contact email can belong to
 * someone else in the group, and a profile link binds only when exactly one live researcher
 * holds it. A name alone binds only when no second live researcher could carry it, and only
 * inside the departments the list states or plausibly draws from.
 */
export const defaultMentorResolver: MentorResolver = async (listing) => {
  const agrees = (candidate: UserMatch | null) =>
    candidate && listedNameAgrees(listing.adviserName, candidate) ? candidate : null;
  const byEmail = agrees(
    listing.adviserEmail ? await researcherForEmail(listing.adviserEmail) : null,
  );
  const byProfile =
    !byEmail && listing.adviserProfileUrl && PROFILE_LINK_SOURCES.has(listing.source)
      ? agrees(await soleResearcherForProfileUrl(listing.adviserProfileUrl))
      : null;
  let owner = byEmail ?? byProfile;
  const matchedByLink = Boolean(owner);
  const matchedBy: 'email' | 'profile' | 'name' = !owner ? 'name' : byEmail ? 'email' : 'profile';
  if (!owner) {
    const resolution = await defaultAdvisorResolution(listing.adviserName);
    if (resolution.status === 'ambiguous') return { status: 'refused', reason: 'ambiguous' };
    if (resolution.status !== 'matched' || !resolution.match) {
      return { status: 'refused', reason: 'no-match' };
    }
    if ((await liveNamesakeCount(listing.adviserName)) > 1) {
      return { status: 'refused', reason: 'ambiguous' };
    }
    owner = resolution.match;
  }
  if (!matchedByLink && UNDERGRAD_LIST_SOURCE_KIND[listing.source] === 'open') {
    const held: any = await Researcher.findById(owner._id).select('profile.title').lean();
    if (leadTitlesAreAllEmeritus([held?.profile?.title])) {
      return { status: 'refused', reason: 'emeritus-on-current-list' };
    }
  }
  const scope = listing.department ? [listing.department] : (listing.departmentScope ?? []);
  if (!matchedByLink && scope.length > 0) {
    const own = await leadRowDepartmentsForOwner(owner);
    if (!departmentsAgree(scope, [...own.departments, ...own.affiliations])) {
      return { status: 'refused', reason: 'department-mismatch' };
    }
  }
  const slug = await existingLeadRowSlugForOwner(owner);
  if (!slug) return { status: 'refused', reason: 'no-lead-row' };
  return {
    status: 'matched',
    slug,
    researcherId: String(owner._id),
    researcherName: [owner.fname, owner.lname].filter(Boolean).join(' '),
    matchedBy,
  };
};

const KNOWN_SOURCES: ReadonlySet<string> = new Set(undergradListSources);

export const defaultStoredListEvidenceFinder: StoredListEvidenceFinder = async () => {
  const rows: any[] = await ResearchEntity.find(
    { archived: { $ne: true }, [`${UNDERGRAD_LIST_EVIDENCE_FIELD}.0`]: { $exists: true } },
    { slug: 1, [UNDERGRAD_LIST_EVIDENCE_FIELD]: 1 },
  ).lean();
  return new Map(
    rows.map((row) => [
      String(row.slug),
      (row[UNDERGRAD_LIST_EVIDENCE_FIELD] as UndergradListEntry[]).filter((entry) =>
        KNOWN_SOURCES.has(entry?.source),
      ),
    ]),
  );
};

export interface MentorMatch {
  listing: MentorListing;
  resolution: MentorResolution;
}

export interface MentorMatchPlan {
  matches: MentorMatch[];
  completeSources: Set<UndergradListSource>;
  perSource: Record<string, Record<string, number>>;
  partialFailures: string[];
}

/** Reads the selected sources and resolves every listed adviser, once per identity. */
export async function planMentorMatches(input: {
  sources: readonly MentorSourceConfig[];
  only?: readonly string[];
  fetchText: (url: string) => Promise<string | null>;
  resolveMentor: MentorResolver;
  now: Date;
}): Promise<MentorMatchPlan> {
  const only = new Set(input.only ?? []);
  const selected = input.sources.filter((config) => only.size === 0 || only.has(config.source));
  const completeSources = new Set<UndergradListSource>();
  const resolutions = new Map<string, Promise<MentorResolution>>();
  const perSource: Record<string, Record<string, number>> = {};
  const partialFailures: string[] = [];
  const matches: MentorMatch[] = [];
  for (const config of selected) {
    const stats: Record<string, number> = { listings: 0, matched: 0 };
    perSource[config.source] = stats;
    let read: SourceRead;
    try {
      read = await config.read(input.fetchText, input.now);
    } catch (error) {
      partialFailures.push(`${config.source}: ${sanitizeLogValue(error)}`);
      continue;
    }
    if (read.complete) completeSources.add(config.source);
    else partialFailures.push(`${config.source}: not every page could be read`);
    const listings = read.listings.filter(
      (listing) => !isAfterLatestAcademicYearEnd(listing.year, input.now),
    );
    stats.listings = listings.length;
    for (const raw of listings) {
      const listing =
        config.departmentScope && !raw.department
          ? { ...raw, departmentScope: config.departmentScope }
          : raw;
      const key = listingKey(listing);
      if (!resolutions.has(key)) resolutions.set(key, input.resolveMentor(listing));
      const resolution = await resolutions.get(key)!;
      if (resolution.status === 'refused')
        stats[resolution.reason] = (stats[resolution.reason] ?? 0) + 1;
      else stats.matched += 1;
      matches.push({ listing, resolution });
    }
  }
  return { matches, completeSources, perSource, partialFailures };
}

export interface OfficialUndergradListDeps {
  fetchText?: MentorFetchText;
  resolveMentor?: MentorResolver;
  storedListEvidenceFinder?: StoredListEvidenceFinder;
  sources?: readonly MentorSourceConfig[];
}

export class OfficialUndergradListScraper implements IScraper {
  readonly name = OFFICIAL_UNDERGRAD_LISTS_SOURCE;
  readonly displayName = 'Official undergraduate lists';
  private readonly fetchText: MentorFetchText;
  private readonly resolveMentor: MentorResolver;
  private readonly storedListEvidenceFinder: StoredListEvidenceFinder;
  private readonly sources: readonly MentorSourceConfig[];

  constructor(deps: OfficialUndergradListDeps = {}) {
    this.fetchText = deps.fetchText ?? defaultMentorFetchText;
    this.resolveMentor = deps.resolveMentor ?? defaultMentorResolver;
    this.storedListEvidenceFinder =
      deps.storedListEvidenceFinder ?? defaultStoredListEvidenceFinder;
    this.sources = deps.sources ?? UNDERGRAD_LIST_SOURCE_CONFIGS;
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const now = ctx.options.referenceDate ?? new Date();
    const plan = await planMentorMatches({
      sources: this.sources,
      only: ctx.options.only,
      fetchText: this.fetchText,
      resolveMentor: this.resolveMentor,
      now,
    });
    const { completeSources, perSource, partialFailures } = plan;
    const listingsBySlug = new Map<string, MentorListing[]>();
    for (const match of plan.matches) {
      if (match.resolution.status !== 'matched') continue;
      const slug = match.resolution.slug;
      listingsBySlug.set(slug, [...(listingsBySlug.get(slug) ?? []), match.listing]);
    }

    const landingUrl = (source: UndergradListSource) =>
      this.sources.find((config) => config.source === source)?.landingUrl ?? '';
    const stored = await this.storedListEvidenceFinder();
    const slugs = new Set([...listingsBySlug.keys(), ...stored.keys()]);
    const observations: ObservationInput[] = [];
    for (const slug of slugs) {
      const fresh = aggregateListEntries(listingsBySlug.get(slug) ?? [], landingUrl).filter(
        (entry) => completeSources.has(entry.source),
      );
      const carried = (stored.get(slug) ?? []).filter(
        (entry) => !completeSources.has(entry.source),
      );
      const entries = [...fresh, ...carried].sort(
        (a, b) => undergradListSources.indexOf(a.source) - undergradListSources.indexOf(b.source),
      );
      const previous = stored.get(slug);
      if (entries.length === 0) {
        if (previous && previous.length > 0) {
          observations.push({
            entityType: 'researchEntity',
            entityKey: slug,
            field: UNDERGRAD_LIST_EVIDENCE_FIELD,
            value: null,
            assertsNoValueFor: [UNDERGRAD_LIST_EVIDENCE_FIELD],
            observedAt: now,
          });
        }
        continue;
      }
      observations.push({
        entityType: 'researchEntity',
        entityKey: slug,
        field: UNDERGRAD_LIST_EVIDENCE_FIELD,
        value: entries,
        sourceUrl: entries[0].sourceUrl,
        observedAt: now,
      });
    }

    for (const batch of observations) await ctx.emit(batch);
    const metrics = {
      perSource,
      rowsWithMentoring: observations.filter((obs) => obs.value).length,
    };
    ctx.reportMetrics?.(metrics as never);
    ctx.log('undergrad mentor lists read', metrics);
    return {
      observationCount: observations.length,
      entitiesObserved: observations.length,
      notes: `${completeSources.size} of ${Object.keys(perSource).length} sources read completely`,
      partialFailures,
      metrics: metrics as never,
    };
  }
}
