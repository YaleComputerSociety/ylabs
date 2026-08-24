/**
 * Course-based research pathway scraper.
 *
 * Acquires Yale's for-credit, course-based undergraduate research pathways -
 * directed research, independent study, and senior-essay/senior-thesis course
 * sequences - as `COURSE_SEQUENCE` research homes. Each pilot department's own
 * directed-research / senior-thesis course page is the cited source; catalog
 * and course-search index roots are never cited.
 *
 * This source is discovery-only. It emits identity (course-sequence name +
 * owning department), the official course page URL, and a source-backed
 * description. It fails closed on contact data and never manufactures
 * undergraduate-access claims, posted openings, application links, or contact
 * routes.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { getCached, setCached } from '../snapshotCache';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import {
  sourceChromeTextPattern,
  stripInlineUrls,
  stripLeadingSectionHeadingChrome,
} from '../../utils/descriptionHygiene';
import { redactDirectContactInfo } from '../../utils/contactRedaction';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';

export const COURSE_BASED_RESEARCH_PATHWAY_SOURCE = 'course-based-research-pathways';

const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;

export interface CourseBasedResearchPathwayPageConfig {
  key: string;
  url: string;
  name: string;
  department: string;
  school: string;
}

export interface CourseBasedResearchPathwayRecord {
  entityKey: string;
  name: string;
  entityType: 'COURSE_SEQUENCE';
  kind: 'program';
  department: string;
  school: string;
  sourceUrl: string;
  fullDescription: string;
  shortDescription: string;
}

type FetchHtml = (url: string, useCache: boolean) => Promise<string>;

export interface CourseBasedResearchPathwayScraperDeps {
  pageConfigs?: CourseBasedResearchPathwayPageConfig[];
  fetchHtml?: FetchHtml;
}

const FAS = 'Yale Faculty of Arts and Sciences';

export const DEFAULT_COURSE_BASED_RESEARCH_PATHWAY_PAGES: CourseBasedResearchPathwayPageConfig[] = [
  {
    key: 'psychology-directed-research',
    url: 'https://psychology.yale.edu/what-directed-research-course',
    name: 'Psychology Directed Research Courses',
    department: 'Psychology',
    school: FAS,
  },
  {
    key: 'history-senior-essay',
    url: 'https://history.yale.edu/undergraduate/senior-essay',
    name: 'History Senior Essay',
    department: 'History',
    school: FAS,
  },
  {
    key: 'english-senior-essay',
    url: 'https://english.yale.edu/undergraduate/senior-essay',
    name: 'English Senior Essay',
    department: 'English',
    school: FAS,
  },
  {
    key: 'mcdb-senior-research',
    url: 'https://mcdb.yale.edu/undergraduate/undergrad-degree-programs',
    name: 'Molecular, Cellular, and Developmental Biology Senior Research',
    department: 'Molecular, Cellular, and Developmental Biology',
    school: FAS,
  },
  {
    key: 'mbb-senior-requirement',
    url: 'https://mbb.yale.edu/undergraduate-education/programs-study-requirements',
    name: 'Molecular Biophysics and Biochemistry Senior Research Requirement',
    department: 'Molecular Biophysics and Biochemistry',
    school: FAS,
  },
  {
    key: 'chemistry-independent-research',
    url: 'https://chem.yale.edu/academics/undergraduate-chemistry-at-yale/independent-research-opportunities',
    name: 'Chemistry Independent Research Courses',
    department: 'Chemistry',
    school: FAS,
  },
  {
    key: 'astronomy-senior-project',
    url: 'https://astronomy.yale.edu/undergraduate-program/guidelines-senior-projects-astronomy-ba-and-astrophysics-bs-majors',
    name: 'Astronomy Senior Project',
    department: 'Astronomy',
    school: FAS,
  },
  {
    key: 'economics-senior-essay',
    url: 'https://economics.yale.edu/undergraduate/senior-essay',
    name: 'Economics Senior Essay',
    department: 'Economics',
    school: FAS,
  },
  {
    key: 'american-studies-senior-essay',
    url: 'https://americanstudies.yale.edu/undergraduate-program/senior-year/senior-essay-course-requirements',
    name: 'American Studies Senior Essay',
    department: 'American Studies',
    school: FAS,
  },
  {
    key: 'wgss-senior-essay',
    url: 'https://wgss.yale.edu/undergraduate-program/requirements-wgss-major',
    name: "Women's, Gender, and Sexuality Studies Senior Essay",
    department: "Women's, Gender, and Sexuality Studies",
    school: FAS,
  },
  {
    key: 'linguistics-senior-essay',
    url: 'https://ling.yale.edu/undergraduate-studies/program-requirements',
    name: 'Linguistics Senior Essay',
    department: 'Linguistics',
    school: FAS,
  },
  {
    key: 'hshm-senior-project',
    url: 'https://hshm.yale.edu/undergraduate-major/senior-project',
    name: 'History of Science and Medicine Senior Project',
    department: 'History of Science and Medicine',
    school: FAS,
  },
  {
    key: 'statistics-data-science-senior-essay',
    url: 'https://statistics.yale.edu/undergraduates/the-major/49104920-senior-essay',
    name: 'Statistics and Data Science Senior Essay',
    department: 'Statistics and Data Science',
    school: FAS,
  },
];

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function slugify(value: string): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

function conciseText(text: string, maxLength = 700): string {
  const normalized = normalizeText(text);
  if (normalized.length <= maxLength) return normalized;
  const truncated = normalized.slice(0, maxLength).trim();
  const sentenceEnd = Math.max(
    truncated.lastIndexOf('.'),
    truncated.lastIndexOf('!'),
    truncated.lastIndexOf('?'),
  );
  if (sentenceEnd >= 160) return truncated.slice(0, sentenceEnd + 1).trim();
  return truncated.replace(/\s+\S*$/, '').trim();
}

const sentenceList = (text: string): string[] =>
  normalizeText(text)
    .match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)
    ?.map((sentence) => normalizeText(sentence))
    .filter(Boolean) || [];

const courseBasedResearchPathwayPattern =
  /\b(directed research|independent (?:study|research)|senior (?:essay|thesis|project|research|requirement)|research (?:course|tutorial)|for credit|course credit|receive(?:s)? (?:course )?credit|enroll(?:ing)? in [A-Z]{2,5}\s?\d{3,4})\b/i;

function entityKeyFor(config: CourseBasedResearchPathwayPageConfig): string {
  return `course-based-research-${slugify(config.key || config.name)}`.slice(0, 110);
}

function mainContentRoot($: cheerio.CheerioAPI): cheerio.Cheerio<any> {
  const root = $('main').length ? $('main').first().clone() : $('body').clone();
  root.find('script, style, nav, header, footer, .breadcrumb, .breadcrumbs').remove();
  return root;
}

function pageMainText($: cheerio.CheerioAPI): string {
  const root = mainContentRoot($);
  const chunks = root
    .find('p, li')
    .toArray()
    .map((node) => normalizeText($(node).text()))
    .filter(Boolean);
  return normalizeText((chunks.length > 0 ? chunks.join(' ') : root.text()) || '');
}

function pageHasCourseBasedResearchEvidence(text: string): boolean {
  return courseBasedResearchPathwayPattern.test(text) && /\bresearch\b/i.test(text);
}

function usefulCoursePathwaySentences(text: string): string[] {
  const seen = new Set<string>();
  return sentenceList(stripInlineUrls(text))
    .map(stripLeadingSectionHeadingChrome)
    .map((sentence) => normalizeText(redactDirectContactInfo(sentence)))
    .filter((sentence) => sentence.length >= 40)
    .filter((sentence) => /^[A-Z]/.test(sentence))
    .filter((sentence) => !sourceChromeTextPattern.test(sentence))
    .filter((sentence) => courseBasedResearchPathwayPattern.test(sentence))
    .filter((sentence) => {
      const key = sentence.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function coursePathwayDescription(
  config: CourseBasedResearchPathwayPageConfig,
  text: string,
): { fullDescription: string; shortDescription: string } {
  const sentences = usefulCoursePathwaySentences(text);
  const lead = `A for-credit, course-based research pathway in ${config.department}.`;
  const sourceBackedBody = sentences.slice(0, 3).join(' ');
  return {
    fullDescription: conciseText(sourceBackedBody ? `${lead} ${sourceBackedBody}` : lead),
    shortDescription: conciseText(
      `A for-credit ${config.department} research pathway through directed research, independent study, and senior-essay or senior-thesis courses.`,
      240,
    ),
  };
}

const CATALOG_OR_COURSE_SEARCH_INDEX_ROOT =
  /^(?:catalog\.yale\.edu\/ycps|courses\.yale\.edu|catalog\.yale\.edu\/courses)\/?$/i;

export function isCatalogOrCourseSearchIndexRootUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const hostPath = `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/g, '')}`;
    return CATALOG_OR_COURSE_SEARCH_INDEX_ROOT.test(hostPath);
  } catch {
    return false;
  }
}

export function parseCourseBasedResearchPathwayPage(
  html: string,
  config: CourseBasedResearchPathwayPageConfig,
): CourseBasedResearchPathwayRecord[] {
  if (isCatalogOrCourseSearchIndexRootUrl(config.url)) return [];
  const $ = cheerio.load(html);
  const text = pageMainText($);
  const pageContext = normalizeText($('h1, h2, h3').text());
  if (!pageHasCourseBasedResearchEvidence(`${pageContext} ${text}`)) return [];

  const description = coursePathwayDescription(config, text);
  return [
    {
      entityKey: entityKeyFor(config),
      name: config.name,
      entityType: 'COURSE_SEQUENCE',
      kind: 'program',
      department: config.department,
      school: config.school,
      sourceUrl: config.url,
      fullDescription: description.fullDescription,
      shortDescription: description.shortDescription,
    },
  ];
}

export function courseBasedResearchPathwayRecordsToObservations(
  records: CourseBasedResearchPathwayRecord[],
): ObservationInput[] {
  return records
    .filter((record) => !isCatalogOrCourseSearchIndexRootUrl(record.sourceUrl))
    .flatMap((record) => {
      const base = {
        entityType: 'researchEntity' as const,
        entityKey: record.entityKey,
        sourceUrl: record.sourceUrl,
      };
      return [
        { ...base, field: 'slug', value: record.entityKey },
        { ...base, field: 'name', value: record.name },
        { ...base, field: 'kind', value: record.kind },
        { ...base, field: 'entityType', value: record.entityType },
        { ...base, field: 'school', value: record.school },
        { ...base, field: 'departments', value: [record.department] },
        { ...base, field: 'websiteUrl', value: record.sourceUrl },
        { ...base, field: 'sourceUrls', value: [record.sourceUrl] },
        { ...base, field: 'fullDescription', value: record.fullDescription },
        { ...base, field: 'shortDescription', value: record.shortDescription },
      ];
    });
}

async function defaultFetchHtml(url: string, useCache: boolean): Promise<string> {
  const safeUrl = await assertPublicHttpUrl(url);
  const safeUrlText = safeUrl.toString();
  const cacheKey = `page:${safeUrlText}`;
  if (useCache) {
    const cached = await getCached<string>(COURSE_BASED_RESEARCH_PATHWAY_SOURCE, cacheKey);
    if (cached) return cached;
  }
  const agents = ssrfSafeAgents();
  const response = await axios.get(safeUrlText, {
    timeout: FETCH_TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT },
    maxRedirects: 5,
    httpAgent: agents.httpAgent,
    httpsAgent: agents.httpsAgent,
  });
  const html = response.data as string;
  if (useCache) await setCached(COURSE_BASED_RESEARCH_PATHWAY_SOURCE, cacheKey, html);
  return html;
}

function parseRuntimeIntegerOption(
  value: number | undefined,
  flag: string,
  options: { min: number; label: 'positive' | 'non-negative'; fallback: number },
): number {
  if (value === undefined) return options.fallback;
  if (!Number.isSafeInteger(value) || value < options.min) {
    throw new Error(`${flag} must be a safe ${options.label} integer`);
  }
  return value;
}

export class CourseBasedResearchPathwayScraper implements IScraper {
  readonly name = COURSE_BASED_RESEARCH_PATHWAY_SOURCE;
  readonly displayName = 'Course-based research pathways';
  private readonly pageConfigs: CourseBasedResearchPathwayPageConfig[];
  private readonly fetchHtml: FetchHtml;

  constructor(deps: CourseBasedResearchPathwayScraperDeps = {}) {
    this.pageConfigs = deps.pageConfigs || DEFAULT_COURSE_BASED_RESEARCH_PATHWAY_PAGES;
    this.fetchHtml = deps.fetchHtml || defaultFetchHtml;
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const only =
      ctx.options.only && ctx.options.only.length > 0
        ? new Set(ctx.options.only.map((value) => value.trim().toLowerCase()).filter(Boolean))
        : null;
    const limit = parseRuntimeIntegerOption(ctx.options.limit, '--limit', {
      min: 1,
      label: 'positive',
      fallback: Infinity,
    });
    const offset = parseRuntimeIntegerOption(ctx.options.offset, '--offset', {
      min: 0,
      label: 'non-negative',
      fallback: 0,
    });
    let totalObs = 0;
    let totalEntities = 0;
    const summaries: string[] = [];

    const pages = this.pageConfigs.filter((page) => !only || only.has(page.key.toLowerCase()));
    for (const page of pages) {
      if (totalEntities >= limit) break;
      ctx.log(`Fetching ${page.url}`);
      const html = await this.fetchHtml(page.url, ctx.options.useCache);
      const parsed = parseCourseBasedResearchPathwayPage(html, page);
      const selected = parsed.slice(offset, offset + Math.max(0, limit - totalEntities));
      const observations = courseBasedResearchPathwayRecordsToObservations(selected);
      if (observations.length > 0) await ctx.emit(observations);
      totalObs += observations.length;
      totalEntities += selected.length;
      summaries.push(`${page.key}=${selected.length}`);
    }

    return {
      observationCount: totalObs,
      entitiesObserved: totalEntities,
      notes: `Course-based research pathway rows: ${summaries.join(', ')}`,
    };
  }
}
