/**
 * Official department undergraduate-research page scraper.
 *
 * This source captures source-backed undergraduate research routes from Yale
 * department pages. It emits access evidence, not active posted opportunities.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { getCached, setCached } from '../snapshotCache';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import type { ResearchEntityType, ResearchGroupKind } from '../../models/researchAccessTypes';
import {
  deriveShortDescriptionFromFullDescription,
  shortDescriptionQuality,
} from '../../utils/researchEntityDescriptionQuality';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';

export const DEPARTMENT_UNDERGRAD_RESEARCH_SOURCE = 'department-undergrad-research';

const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;

export type DepartmentUndergradResearchParser =
  | 'physics-project-list'
  | 'general-guidance'
  | 'structured-opportunity';

export interface DepartmentUndergradResearchPageConfig {
  key: string;
  url: string;
  department: string;
  school: string;
  parser: DepartmentUndergradResearchParser;
  title?: string;
}

export interface DepartmentUndergradResearchRecord {
  entityKey: string;
  name: string;
  kind: Exclude<ResearchGroupKind, 'solo'>;
  entityType: ResearchEntityType;
  department: string;
  school: string;
  sourceUrl: string;
  websiteUrl?: string;
  description: string;
  shortDescription?: string;
  evidenceQuote: string;
  undergradAccessEvidence: boolean;
  contactName?: string;
  contactEmail?: string;
  contactRole?: string;
  joinPageUrl?: string;
}

type FetchHtml = (url: string, useCache: boolean) => Promise<string>;

export interface DepartmentUndergradResearchScraperDeps {
  pageConfigs?: DepartmentUndergradResearchPageConfig[];
  fetchHtml?: FetchHtml;
}

export const DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES: DepartmentUndergradResearchPageConfig[] = [
  {
    key: 'physics',
    url: 'https://physics.yale.edu/academics/undergraduate-studies/undergraduate-research',
    department: 'Physics',
    school: 'Yale Faculty of Arts and Sciences',
    parser: 'physics-project-list',
  },
  {
    key: 'chemistry',
    url: 'https://chem.yale.edu/academics/undergraduate-chemistry-at-yale/undergraduate-research',
    department: 'Chemistry',
    school: 'Yale Faculty of Arts and Sciences',
    parser: 'general-guidance',
    title: 'Chemistry Undergraduate Research',
  },
  {
    key: 'mcdb',
    url: 'https://mcdb.yale.edu/undergraduate/undergraduate-research-opportunities',
    department: 'Molecular, Cellular and Developmental Biology',
    school: 'Yale Faculty of Arts and Sciences',
    parser: 'structured-opportunity',
    title: 'Pediatric Emergency Medicine Undergraduate Research Associate Program',
  },
  {
    key: 'economics-tobin-ra',
    url: 'https://economics.yale.edu/undergraduate/tobin-ra/tobin-research-assistantship-application',
    department: 'Economics',
    school: 'Yale Faculty of Arts and Sciences',
    parser: 'structured-opportunity',
    title: 'Tobin Undergraduate Research Assistantships',
  },
  {
    key: 'psychology',
    url: 'https://psychology.yale.edu/what-undergraduate-research-opportunities-are-available',
    department: 'Psychology',
    school: 'Yale Faculty of Arts and Sciences',
    parser: 'general-guidance',
    title: 'Psychology Undergraduate Research Opportunities',
  },
  {
    key: 'astronomy',
    url: 'https://astronomy.yale.edu/academics/undergraduate-program/undergraduate-research',
    department: 'Astronomy',
    school: 'Yale Faculty of Arts and Sciences',
    parser: 'general-guidance',
    title: 'Astronomy Undergraduate Research',
  },
  {
    key: 'mathematics',
    url: 'https://math.yale.edu/undergraduates/undergraduate-research',
    department: 'Mathematics',
    school: 'Yale Faculty of Arts and Sciences',
    parser: 'general-guidance',
    title: 'Mathematics Undergraduate Research',
  },
  {
    key: 'engineering',
    url: 'https://engineering.yale.edu/academic-study/undergraduate/research',
    department: 'Engineering',
    school: 'Yale School of Engineering & Applied Science',
    parser: 'general-guidance',
    title: 'Undergraduate Engineering Research',
  },
  {
    key: 'cognitive-science',
    url: 'https://cogsci.yale.edu/research/undergraduate-research-opportunities',
    department: 'Cognitive Science',
    school: 'Yale Faculty of Arts and Sciences',
    parser: 'general-guidance',
    title: 'Cognitive Science Undergraduate Research Opportunities',
  },
  {
    key: 'eeb',
    url: 'https://eeb.yale.edu/academics/undergraduate-program/undergraduate-research-opportunities',
    department: 'Ecology and Evolutionary Biology',
    school: 'Yale Faculty of Arts and Sciences',
    parser: 'general-guidance',
    title: 'Ecology and Evolutionary Biology Undergraduate Research Opportunities',
  },
  {
    key: 'yale-undergraduate-research-science',
    url: 'https://science.yalecollege.yale.edu/yale-undergraduate-research/research-opportunities',
    department: 'Science and Quantitative Reasoning Education',
    school: 'Yale College',
    parser: 'general-guidance',
    title: 'Yale Undergraduate Research in Science and Engineering',
  },
  {
    key: 'anthropology',
    url: 'https://anthropology.yale.edu/undergraduate-program/undergraduate-research-in-anthropology',
    department: 'Anthropology',
    school: 'Yale Faculty of Arts and Sciences',
    parser: 'general-guidance',
    title: 'Anthropology Undergraduate Research',
  },
  {
    key: 'earth-planetary-sciences',
    url: 'https://earth.yale.edu/resources',
    department: 'Earth and Planetary Sciences',
    school: 'Yale Faculty of Arts and Sciences',
    parser: 'general-guidance',
    title: 'Earth and Planetary Sciences Research Opportunities',
  },
  {
    key: 'political-science',
    url: 'https://politicalscience.yale.edu/academics/about-undergraduate-program',
    department: 'Political Science',
    school: 'Yale Faculty of Arts and Sciences',
    parser: 'general-guidance',
    title: 'Political Science Undergraduate Research Opportunities',
  },
  {
    key: 'history',
    url: 'https://history.yale.edu/academics/undergraduate-program',
    department: 'History',
    school: 'Yale Faculty of Arts and Sciences',
    parser: 'general-guidance',
    title: 'History Undergraduate Research',
  },
  {
    key: 'neuroscience',
    url: 'https://neuroscience.yale.edu/research-opportunities',
    department: 'Neuroscience',
    school: 'Yale Faculty of Arts and Sciences',
    parser: 'general-guidance',
    title: 'Neuroscience Undergraduate Research Opportunities',
  },
  {
    key: 'molecular-biophysics-biochemistry',
    url: 'https://mbb.yale.edu/introduction-undergraduate-program',
    department: 'Molecular Biophysics and Biochemistry',
    school: 'Yale Faculty of Arts and Sciences',
    parser: 'general-guidance',
    title: 'Molecular Biophysics and Biochemistry Undergraduate Research',
  },
  {
    key: 'linguistics',
    url: 'https://ling.yale.edu/academics/undergraduate/research-opportunities/linguistics-research-opportunities-yale',
    department: 'Linguistics',
    school: 'Yale Faculty of Arts and Sciences',
    parser: 'general-guidance',
    title: 'Linguistics Undergraduate Research Opportunities',
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

function absoluteUrl(rawUrl: string | undefined, pageUrl: string): string | undefined {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed || trimmed.startsWith('#') || /^mailto:/i.test(trimmed)) return undefined;
  if (/[<>"\s]/.test(trimmed)) return undefined;
  try {
    const url = new URL(trimmed, pageUrl);
    if (!/^https?:$/i.test(url.protocol)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function firstEmail(text: string): string | undefined {
  return text.match(/[A-Z0-9._%+-]+@yale\.edu/i)?.[0]?.toLowerCase();
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

const sourceChromeTextPattern =
  /\b(?:show all breadcrumbs|expand all|homeabout|home academics|calendar|applyprizes|recipient|copyright|privacy)\b/i;

const undergradResearchGuidancePattern =
  /\b(?:undergraduate students?|students?|majors?)\b.{0,180}\bresearch\b|\bresearch\b.{0,180}\b(?:undergraduate students?|students?|majors?|faculty|laborator(?:y|ies)|opportunit(?:y|ies)|assistantships?)\b/i;

function usefulUndergradResearchSentences(text: string): string[] {
  const seen = new Set<string>();
  return sentenceList(text)
    .filter((sentence) => sentence.length >= 40)
    .filter((sentence) => !sourceChromeTextPattern.test(sentence))
    .filter((sentence) => undergradResearchGuidancePattern.test(sentence))
    .filter((sentence) => {
      const key = sentence.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function departmentGuidanceDescription(
  config: DepartmentUndergradResearchPageConfig,
  text: string,
): { fullDescription: string; shortDescription: string; evidenceQuote: string } {
  const sentences = usefulUndergradResearchSentences(text);
  const sourceBackedBody = sentences.slice(0, 3).join(' ') || text;
  return {
    fullDescription: conciseText(
      `Supports undergraduate research in ${config.department}. ${sourceBackedBody}`,
    ),
    shortDescription: conciseText(
      `Supports undergraduate research in ${config.department} through department guidance on finding faculty research opportunities.`,
      240,
    ),
    evidenceQuote: conciseText(sentences.slice(0, 2).join(' ') || text),
  };
}

function projectShortDescription(description: string): string | undefined {
  const source = normalizeText(description);
  const focusCandidates = [
    source.match(/\banalyses that focus on\s+(.+?)(?:[.!?]|$)/i)?.[1],
    source.match(/\bfocus(?:es)? on\s+(.+?)(?:[.!?]|$)/i)?.[1],
    source.match(/\binterested in understanding\s+(.+?)(?:[.!?]|$)/i)?.[1],
    source.match(/\bunderstanding\s+(.+?)(?:[.!?]|$)/i)?.[1],
    source.match(/\bprojects aiming to test\s+(.+?)(?:[.!?]|$)/i)?.[1],
  ].filter((value): value is string => Boolean(value?.trim()));

  const candidates = [
    ...focusCandidates.map((focus) => `Studies ${focus.replace(/[.!?]+$/g, '').trim()}.`),
    source && !/\b(?:studies|investigates|examines|explores|focuses|develops|uses|employs|researches|analyzes|models|measures|supports)\b/i.test(source)
      ? `Studies ${source.replace(/[.!?]+$/g, '').trim().replace(/^\w/, (char) => char.toLowerCase())}.`
      : '',
    deriveShortDescriptionFromFullDescription(description),
  ].filter(Boolean);

  return candidates.find((candidate) => shortDescriptionQuality(candidate, description).isUseful);
}

function stripLeadingContactChrome(text: string): string {
  return normalizeText(text)
    .replace(/^Contact:\s*[^()]+?\([^)]*\)\s*/i, '')
    .replace(/^Contact:\s*[^.]+?\s*/i, '')
    .replace(/^Website:\s*https?:\/\/\S+\s*/i, '')
    .trim();
}

function pageMainText($: cheerio.CheerioAPI): string {
  const root = $('main').length ? $('main').first().clone() : $('body').clone();
  root.find('script, style, nav, header, footer, .breadcrumb, .breadcrumbs').remove();
  const chunks = root
    .find('p, li')
    .toArray()
    .map((node) => normalizeText($(node).text()))
    .filter(Boolean);
  return normalizeText((chunks.length > 0 ? chunks.join(' ') : root.text()) || '');
}

function departmentEntityKey(config: DepartmentUndergradResearchPageConfig): string {
  return `department-undergrad-research-${slugify(config.department || config.key)}`.slice(0, 100);
}

function structuredEntityKey(title: string): string {
  return `department-undergrad-research-${slugify(title)}`.slice(0, 120);
}

function facultyEntityKey(config: DepartmentUndergradResearchPageConfig, name: string): string {
  return `dept-${slugify(config.department)}-${slugify(name)}`.slice(0, 100);
}

function bestApplicationUrl($: cheerio.CheerioAPI, pageUrl: string): string | undefined {
  const links = $('a')
    .toArray()
    .map((node) => ({
      text: normalizeText($(node).text()),
      url: absoluteUrl($(node).attr('href'), pageUrl),
    }))
    .filter((link): link is { text: string; url: string } => Boolean(link.url));
  return links.find((link) => /apply|application|form|qualtrics|survey/i.test(`${link.text} ${link.url}`))
    ?.url;
}

function pageHasUndergradResearchEvidence(text: string): boolean {
  return /undergraduate/i.test(text) && /\b(research|laborator|assistant|opportunit|project|mentor)/i.test(text);
}

export function parsePhysicsUndergradResearchPage(
  html: string,
  config: DepartmentUndergradResearchPageConfig,
): DepartmentUndergradResearchRecord[] {
  const $ = cheerio.load(html);
  const headings = $('h3').toArray();
  const pageContext = normalizeText($('h1, h2').text());
  const records: DepartmentUndergradResearchRecord[] = [];

  for (const heading of headings) {
    const name = normalizeText($(heading).text());
    if (!name || /research opportunities/i.test(name)) continue;

    const chunks: string[] = [];
    const links: string[] = [];
    let cursor = $(heading).next();
    while (cursor.length > 0 && cursor.prop('tagName')?.toLowerCase() !== 'h3') {
      const text = normalizeText(cursor.text());
      if (text) chunks.push(text);
      cursor.find('a[href]').each((_i, link) => {
        const url = absoluteUrl($(link).attr('href'), config.url);
        if (url) links.push(url);
      });
      cursor = cursor.next();
    }

    const body = normalizeText(chunks.join(' '));
    if (!pageHasUndergradResearchEvidence(`${pageContext} ${name} ${body}`)) continue;
    const email = firstEmail(body);
    const websiteUrl = links.find((url) => !url.startsWith('mailto:'));
    const description = stripLeadingContactChrome(body);
    const fullDescription = conciseText(description || body);

    records.push({
      entityKey: facultyEntityKey(config, name),
      name: `${name} Lab`,
      kind: 'lab',
      entityType: 'LAB',
      department: config.department,
      school: config.school,
      sourceUrl: config.url,
      websiteUrl,
      description: fullDescription,
      shortDescription: projectShortDescription(fullDescription),
      evidenceQuote: conciseText(body),
      undergradAccessEvidence: true,
      contactName: name,
      contactEmail: email,
      contactRole: 'Faculty PI',
    });
  }

  return records;
}

export function parseGeneralDepartmentResearchPage(
  html: string,
  config: DepartmentUndergradResearchPageConfig,
): DepartmentUndergradResearchRecord[] {
  const $ = cheerio.load(html);
  const text = pageMainText($);
  const pageContext = normalizeText($('h1, h2').text());
  if (!pageHasUndergradResearchEvidence(`${pageContext} ${text}`)) return [];

  const title = config.title || `${config.department} Undergraduate Research`;
  const description = departmentGuidanceDescription(config, text);
  return [
    {
      entityKey: departmentEntityKey(config),
      name: title,
      kind: 'program',
      entityType: 'PROGRAM',
      department: config.department,
      school: config.school,
      sourceUrl: config.url,
      websiteUrl: config.url,
      description: description.fullDescription,
      shortDescription: description.shortDescription,
      evidenceQuote: description.evidenceQuote,
      undergradAccessEvidence: true,
      contactRole: 'Faculty member for undergraduate research',
    },
  ];
}

export function parseStructuredOpportunityPage(
  html: string,
  config: DepartmentUndergradResearchPageConfig,
): DepartmentUndergradResearchRecord[] {
  const $ = cheerio.load(html);
  const text = pageMainText($);
  const pageContext = normalizeText($('h1, h2, h3, h4').text());
  if (!pageHasUndergradResearchEvidence(`${pageContext} ${text}`)) return [];

  const title =
    config.title ||
    normalizeText($('h1').first().text()) ||
    `${config.department} Undergraduate Research Opportunity`;
  const contactEmail = firstEmail(text);
  const joinPageUrl = bestApplicationUrl($, config.url);
  const description = departmentGuidanceDescription(config, text);

  return [
    {
      entityKey: structuredEntityKey(title),
      name: title,
      kind: 'program',
      entityType: 'PROGRAM',
      department: config.department,
      school: config.school,
      sourceUrl: config.url,
      websiteUrl: config.url,
      description: description.fullDescription,
      shortDescription: description.shortDescription,
      evidenceQuote: description.evidenceQuote,
      undergradAccessEvidence: true,
      contactEmail,
      contactRole: contactEmail ? 'Program contact for undergraduate research' : undefined,
      joinPageUrl,
    },
  ];
}

function parsePage(
  html: string,
  config: DepartmentUndergradResearchPageConfig,
): DepartmentUndergradResearchRecord[] {
  if (config.parser === 'physics-project-list') return parsePhysicsUndergradResearchPage(html, config);
  if (config.parser === 'structured-opportunity') return parseStructuredOpportunityPage(html, config);
  return parseGeneralDepartmentResearchPage(html, config);
}

export function departmentUndergradResearchRecordsToObservations(
  records: DepartmentUndergradResearchRecord[],
): ObservationInput[] {
  return records.flatMap((record) => {
    const base = {
      entityType: 'researchEntity' as const,
      entityKey: record.entityKey,
      sourceUrl: record.sourceUrl,
    };
    const sourceUrls = Array.from(
      new Set([record.sourceUrl, record.websiteUrl, record.joinPageUrl].filter(Boolean)),
    );
    const observations: ObservationInput[] = [
      { ...base, field: 'slug', value: record.entityKey },
      { ...base, field: 'name', value: record.name },
      { ...base, field: 'kind', value: record.kind },
      { ...base, field: 'entityType', value: record.entityType },
      { ...base, field: 'school', value: record.school },
      { ...base, field: 'departments', value: [record.department] },
      { ...base, field: 'websiteUrl', value: record.websiteUrl || record.sourceUrl },
      { ...base, field: 'sourceUrls', value: sourceUrls },
      { ...base, field: 'fullDescription', value: record.description },
      { ...base, field: 'shortDescription', value: record.shortDescription || record.description },
      {
        ...base,
        field: 'undergradAccessEvidence',
        value: { openToUndergrads: 'yes', evidenceSource: 'department_undergrad_research_page' },
        confidenceOverride: 0.8,
      },
      { ...base, field: 'undergradEvidenceQuote', value: record.evidenceQuote, confidenceOverride: 0.8 },
      { ...base, field: 'acceptingUndergrads', value: true, confidenceOverride: 0.75 },
    ];

    if (record.contactName) observations.push({ ...base, field: 'contactName', value: record.contactName });
    if (record.contactEmail) {
      observations.push({
        ...base,
        field: 'contactEmail',
        value: record.contactEmail,
        confidenceOverride: 0.75,
      });
    }
    if (record.contactRole) observations.push({ ...base, field: 'contactRole', value: record.contactRole });
    if (record.joinPageUrl) observations.push({ ...base, field: 'joinPageUrl', value: record.joinPageUrl });
    return observations;
  });
}

async function defaultFetchHtml(url: string, useCache: boolean): Promise<string> {
  const safeUrl = await assertPublicHttpUrl(url);
  const safeUrlText = safeUrl.toString();
  const cacheKey = `page:${safeUrlText}`;
  if (useCache) {
    const cached = await getCached<string>(DEPARTMENT_UNDERGRAD_RESEARCH_SOURCE, cacheKey);
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
  if (useCache) await setCached(DEPARTMENT_UNDERGRAD_RESEARCH_SOURCE, cacheKey, html);
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

export class DepartmentUndergradResearchScraper implements IScraper {
  readonly name = DEPARTMENT_UNDERGRAD_RESEARCH_SOURCE;
  readonly displayName = 'Department undergraduate research pages';
  private readonly pageConfigs: DepartmentUndergradResearchPageConfig[];
  private readonly fetchHtml: FetchHtml;

  constructor(deps: DepartmentUndergradResearchScraperDeps = {}) {
    this.pageConfigs = deps.pageConfigs || DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES;
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
      const parsed = parsePage(html, page);
      const selected = parsed.slice(offset, offset + Math.max(0, limit - totalEntities));
      const observations = departmentUndergradResearchRecordsToObservations(selected);
      if (observations.length > 0) await ctx.emit(observations);
      totalObs += observations.length;
      totalEntities += selected.length;
      summaries.push(`${page.key}=${selected.length}`);
    }

    return {
      observationCount: totalObs,
      entitiesObserved: totalEntities,
      notes: `Department undergraduate research evidence rows: ${summaries.join(', ')}`,
    };
  }
}
