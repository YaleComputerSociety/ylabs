/**
 * Curated official Yale program pages outside the central fellowship catalog.
 *
 * This adapter intentionally fetches only configured public pages. Application
 * portals are preserved as links but are not crawled.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import {
  candidateToProgramObservations,
  finalizeProgramCandidate,
  inferProgramAccessRole,
  parseProgramDeadlineToUtcEndOfDay,
  type ProgramAccessRole,
  type ProgramCandidate,
} from '../programCandidate';
import { getCached, setCached } from '../snapshotCache';
import type { IScraper, ScraperContext, ScraperResult } from '../types';

export const OFFICIAL_YALE_PROGRAMS_SOURCE = 'official-yale-programs';

export type FetchPage = (url: string, useCache: boolean) => Promise<string>;

export interface OfficialYaleProgramPageConfig {
  url?: string;
  sourceName?: string;
  pageUrl?: string;
  programCategory: string;
  hostedByResearchEntityName: string;
  hostedByResearchEntityUrl: string;
}

interface OfficialYaleProgramsScraperDeps {
  pages?: OfficialYaleProgramPageConfig[];
  fetchPage?: FetchPage;
}

const DEFAULT_PAGES: OfficialYaleProgramPageConfig[] = [
  {
    url: 'https://wti.yale.edu/initiatives/undergraduate',
    programCategory: 'SUMMER_RESEARCH_PROGRAM',
    hostedByResearchEntityName: 'Wu Tsai Institute',
    hostedByResearchEntityUrl: 'https://wti.yale.edu',
  },
  {
    url: 'https://library.yale.edu/digital-humanities-laboratory',
    programCategory: 'CENTER_INTERNSHIP',
    hostedByResearchEntityName: 'Digital Humanities Lab',
    hostedByResearchEntityUrl: 'https://library.yale.edu/digital-humanities-laboratory',
  },
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function absoluteUrl(rawUrl: string | undefined, pageUrl: string): string | undefined {
  if (!rawUrl) return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith('#') || /^mailto:/i.test(trimmed)) return undefined;
  try {
    return new URL(trimmed, pageUrl).toString();
  } catch {
    return undefined;
  }
}

function isPublicLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function inferAccessRole(title: string, text: string, programCategory: string): ProgramAccessRole {
  const inferred = inferProgramAccessRole(title, text);
  if (inferred !== 'UNKNOWN') return inferred;
  if (programCategory === 'CENTER_INTERNSHIP' && /\binternships?\b/i.test(`${title} ${text}`)) {
    return 'HOSTED_INTERNSHIP';
  }
  return inferred;
}

function hasExplicitActiveApplicationLanguage(text: string): boolean {
  return /\bapplications?\s+(are\s+)?(now\s+)?open\b|\bcurrently accepting applications\b/i.test(
    text,
  );
}

function bestDeadlineText(text: string): string {
  return text.match(/[^.]*\b(?:deadline|due)\b[^.]*\./i)?.[0] || text;
}

export function parseOfficialYaleProgramPage(
  html: string,
  config: OfficialYaleProgramPageConfig,
  referenceDate: Date = new Date(),
): ProgramCandidate[] {
  const pageUrl = config.pageUrl || config.url;
  if (!pageUrl) return [];
  const sourceName = config.sourceName || OFFICIAL_YALE_PROGRAMS_SOURCE;
  const $ = cheerio.load(html);
  const title = normalizeWhitespace($('h1').first().text());
  if (!title) return [];

  const bodyText = normalizeWhitespace(
    $('main, [role="main"], article').first().text() || $('body').text(),
  );
  const links = $('a')
    .toArray()
    .map((link) => {
      const url = absoluteUrl($(link).attr('href'), pageUrl);
      const label = normalizeWhitespace($(link).text()) || 'Link';
      return url && isPublicLink(url) ? { label, url } : undefined;
    })
    .filter((link): link is { label: string; url: string } => !!link);
  const applicationLink = links.find((link) =>
    /apply|application/i.test(`${link.label} ${link.url}`),
  )?.url;
  const deadline = parseProgramDeadlineToUtcEndOfDay(bestDeadlineText(bodyText), referenceDate);
  const programAccessRole = inferAccessRole(title, bodyText, config.programCategory);

  return [
    finalizeProgramCandidate({
      sourceName,
      title,
      sourceUrl: pageUrl,
      summary: bodyText.slice(0, 500) || undefined,
      description: bodyText.slice(0, 2000) || undefined,
      applicationLink,
      links,
      deadline,
      applicationOpenDate: undefined,
      contactOffice: config.hostedByResearchEntityName,
      contactEmail: undefined,
      yearOfStudy: [],
      termOfAward: /\bsummer\b/i.test(bodyText) ? ['Summer'] : [],
      purpose: /\bresearch\b/i.test(bodyText) ? ['Research'] : [],
      globalRegions: [],
      citizenshipStatus: [],
      isAcceptingApplications:
        (deadline ? deadline.getTime() > referenceDate.getTime() : false) ||
        hasExplicitActiveApplicationLanguage(bodyText),
      reviewRequired: !deadline,
      programCategory: config.programCategory,
      programAccessRole,
      hostedByResearchEntityName: config.hostedByResearchEntityName,
      hostedByResearchEntityUrl: config.hostedByResearchEntityUrl,
    }),
  ];
}

async function fetchHtml(url: string, useCache: boolean): Promise<string> {
  const cacheKey = `page:${url}`;
  if (useCache) {
    const cached = await getCached<string>(OFFICIAL_YALE_PROGRAMS_SOURCE, cacheKey);
    if (cached) return cached;
  }

  const res = await axios.get(url, {
    timeout: 30000,
    headers: {
      'User-Agent': 'YLabsBot/1.0 (+https://ylabs.yale.edu)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  const html = String(res.data || '');
  if (useCache) await setCached(OFFICIAL_YALE_PROGRAMS_SOURCE, cacheKey, html);
  return html;
}

export class OfficialYaleProgramsScraper implements IScraper {
  readonly name = OFFICIAL_YALE_PROGRAMS_SOURCE;
  readonly displayName = 'Official Yale Programs';

  private readonly pages: OfficialYaleProgramPageConfig[];
  private readonly fetchPage: FetchPage;

  constructor(deps: OfficialYaleProgramsScraperDeps = {}) {
    this.pages = deps.pages || DEFAULT_PAGES;
    this.fetchPage = deps.fetchPage || fetchHtml;
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const referenceDate = new Date();
    const limit =
      typeof ctx.options.limit === 'number' && ctx.options.limit >= 0
        ? ctx.options.limit
        : undefined;
    const candidates: ProgramCandidate[] = [];
    const failedUrls: string[] = [];

    for (const page of this.pages) {
      if (limit !== undefined && candidates.length >= limit) break;
      if (!page.url) continue;
      try {
        const html = await this.fetchPage(page.url, ctx.options.useCache);
        candidates.push(
          ...parseOfficialYaleProgramPage(
            html,
            {
              ...page,
              sourceName: ctx.sourceName || OFFICIAL_YALE_PROGRAMS_SOURCE,
              pageUrl: page.pageUrl || page.url,
            },
            referenceDate,
          ),
        );
      } catch (error) {
        failedUrls.push(page.url);
        ctx.log('Skipping official Yale program page after fetch/parse failure', {
          url: page.url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (failedUrls.length === this.pages.length && failedUrls.length > 0) {
      throw new Error(
        `No official Yale program pages could be fetched; failed URLs: ${failedUrls.join(', ')}`,
      );
    }

    const selected = limit !== undefined ? candidates.slice(0, limit) : candidates;
    const observations = selected.flatMap((candidate) =>
      candidateToProgramObservations(candidate).map((observation) => ({
        ...observation,
        confidenceOverride: ctx.sourceWeight,
      })),
    );
    if (observations.length > 0) await ctx.emit(observations);

    return {
      observationCount: observations.length,
      entitiesObserved: selected.length,
      notes:
        failedUrls.length > 0
          ? `Skipped ${failedUrls.length} official Yale program page(s) after fetch/parse failure.`
          : undefined,
    };
  }
}
