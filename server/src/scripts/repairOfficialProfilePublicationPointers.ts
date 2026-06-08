import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import * as cheerio from 'cheerio';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchScholarlyLink } from '../models/researchScholarlyLink';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);

export interface OfficialProfilePublicationPointerRepairOptions {
  apply: boolean;
  confirmOfficialProfilePublicationRepair: boolean;
  limit: number;
  limitExplicit: boolean;
  maxPublicationsPerPointer: number;
  output?: string;
}

export interface ExtractedFeaturedPublication {
  title: string;
  url: string;
}

type PointerRow = {
  _id: mongoose.Types.ObjectId;
  userId?: mongoose.Types.ObjectId;
  title: string;
  url?: string;
  sourceUrl?: string;
  externalIds?: Record<string, unknown>;
  user?: {
    netid?: string;
    fname?: string;
    lname?: string;
    website?: string;
    profileUrls?: Record<string, string>;
  };
};

const USER_AGENT = 'ylabs-publication-pointer-repair/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;
const MAX_CRAWL_PAGES_PER_POINTER = 12;

const genericPointerTitlePattern =
  /\b(?:for (?:a|the) (?:complete |expanded )?list|list of (?:selected |research )?publications|visit my (?:website|homepage)|see my (?:webpage|website)|click here for list|google scholar|ads publications|additional publications|orcid|publons|researcher id|inspire link|futher publications)\b/i;

const unsupportedIndexUrlPattern =
  /\b(?:scholar\.google\.|ui\.adsabs\.harvard\.edu|orcid\.org|publons\.com|inspirehep\.net)\b/i;

const externalIndexPointerTitlePattern =
  /\b(?:google scholar|ads publications|astrophysics data system|orcid|publons|researcher id|inspire link)\b/i;

const lowQualityExtractedTitlePattern =
  /^(?:main menu|sub menu|research|outreach|students|teaching|facebook|privacy policy|alum\/theses|authored and edited books|publications?|selected publications?|selected recent publications|year of publication|subject of publications|copyright\b.*|for a complete and up to date list)$/i;

function cleanText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function absolutize(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function normalizeUrlForDedupe(value: unknown): string {
  try {
    const url = new URL(String(value || ''));
    url.hash = '';
    url.searchParams.sort();
    return url.toString().replace(/\/+$/, '').toLowerCase();
  } catch {
    return cleanText(value).replace(/\/+$/, '').toLowerCase();
  }
}

function normalizePublicationTitle(value: unknown): string {
  return cleanText(value)
    .replace(/^(?:pdf|link|download|abstract|paper|publication)\s*[:\-–—]?\s*/i, '')
    .replace(/^["'“”‘’]+|["'“”‘’.,;:]+$/g, '')
    .replace(/\s+([:;,.!?])/g, '$1')
    .trim();
}

function normalizePublicationTitleKey(value: unknown): string {
  return normalizePublicationTitle(value)
    .toLowerCase()
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39);/gi, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function findFeaturedPublicationByTitle(
  publications: ExtractedFeaturedPublication[],
  title: string,
): ExtractedFeaturedPublication | null {
  const wanted = normalizePublicationTitleKey(title);
  if (!wanted) return null;
  return publications.find((publication) => normalizePublicationTitleKey(publication.title) === wanted) || null;
}

function isExternalIndexPointerTitle(value: unknown): boolean {
  return externalIndexPointerTitlePattern.test(cleanText(value));
}

export function isGenericPublicationPointerTitle(value: unknown): boolean {
  const title = cleanText(value);
  if (!title) return false;
  return (
    genericPointerTitlePattern.test(title) ||
    /^(?:google scholar|ads publications|additional publications|publications?|selected publications?|publication page)$/i.test(
      title,
    )
  );
}

function isUnsupportedIndexUrl(value: unknown): boolean {
  return unsupportedIndexUrlPattern.test(cleanText(value));
}

function urlHash(value: unknown): string {
  try {
    return new URL(cleanText(value)).hash;
  } catch {
    const raw = cleanText(value);
    const hashIndex = raw.indexOf('#');
    return hashIndex >= 0 ? raw.slice(hashIndex) : '';
  }
}

function isGeneratedPublicationAnchor(row: PointerRow): boolean {
  if (!row.url || !row.sourceUrl) return false;
  if (!/^#publication-/i.test(urlHash(row.url))) return false;
  return normalizeUrlForDedupe(row.url) === normalizeUrlForDedupe(row.sourceUrl);
}

function candidateRepairUrls(row: PointerRow): string[] {
  const rawUrls = [
    row.url,
    row.user?.website,
    row.user?.profileUrls?.lab,
    row.user?.profileUrls?.personal,
  ];
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const raw of rawUrls) {
    const url = cleanText(raw);
    if (!/^https?:\/\//i.test(url)) continue;
    if (isUnsupportedIndexUrl(url)) continue;
    if (
      row.sourceUrl &&
      normalizeUrlForDedupe(url) === normalizeUrlForDedupe(row.sourceUrl)
    ) {
      continue;
    }
    const key = normalizeUrlForDedupe(url);
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(url);
  }

  return urls;
}

function isLikelyAuthorPrefix(value: string): boolean {
  const text = cleanText(value);
  if (!text) return false;
  return (
    /(?:^|,\s*)[A-Z]\.\s*[A-Z]?[a-z]+/.test(text) ||
    text.split(',').length >= 3 ||
    /\b(?:and|&)\s+[A-Z][a-z]+\s+[A-Z][a-z]+/.test(text)
  );
}

function titleFromCitationText(value: string): string {
  const protectedInitials = cleanText(value).replace(/\b([A-Z])\.\s*/g, '$1§ ');
  const parts = protectedInitials
    .split(/\.\s+/)
    .map((part) => normalizePublicationTitle(part.replace(/§/g, '.')))
    .filter(Boolean);
  if (parts.length >= 2 && isLikelyAuthorPrefix(parts[0])) return parts[1];
  return parts[0] || '';
}

function isLowQualityExtractedTitle(value: string): boolean {
  const title = cleanText(value);
  if (!title) return true;
  if (lowQualityExtractedTitlePattern.test(title)) return true;
  if (isGenericPublicationPointerTitle(title)) return true;
  if (/^- Any -/.test(title)) return true;
  if (/^The standard gateway for finding and accessing astronomy and astrophysics papers\b/i.test(title)) {
    return true;
  }
  return false;
}

function nodeTextWithSeparators($: cheerio.CheerioAPI, node: cheerio.Cheerio<any>): string {
  const parts = node
    .contents()
    .map((_i, child) => cleanText($(child).text()))
    .get()
    .filter(Boolean);
  return parts.length > 0 ? parts.join('; ') : cleanText(node.text());
}

function titleFromPublicationNode($: cheerio.CheerioAPI, node: cheerio.Cheerio<any>): string {
  const linkedTitle = node
    .find('a[href]')
    .toArray()
    .map((link) => normalizePublicationTitle($(link).text()))
    .find(
      (title) =>
        title.length >= 8 &&
        !isGenericPublicationPointerTitle(title) &&
        !isLowQualityExtractedTitle(title),
    );
  if (linkedTitle) return linkedTitle;

  const semanticTitle = normalizePublicationTitle(
    node.find('.p-desc b, .publication-title, .paper-title, em, cite, b').first().text(),
  );
  if (
    semanticTitle &&
    !isGenericPublicationPointerTitle(semanticTitle) &&
    !isLikelyAuthorPrefix(semanticTitle)
  ) {
    return semanticTitle;
  }

  const quotedTitle = normalizePublicationTitle(
    (cleanText(node.text()).match(/[“"]([^”"]{8,220})[”"]/) || [])[1],
  );
  if (quotedTitle && !isGenericPublicationPointerTitle(quotedTitle)) return quotedTitle;

  const segmented = nodeTextWithSeparators($, node)
    .split(/[;\n\r]+/)
    .map((part) => titleFromCitationText(part.replace(/\b(?:18|19|20)\d{2}\b/g, '')))
    .find(
      (part) =>
        part.length >= 8 &&
        !isLikelyAuthorPrefix(part) &&
        !isLowQualityExtractedTitle(part),
    );
  return segmented || '';
}

function publicationFromNode(
  $: cheerio.CheerioAPI,
  node: cheerio.Cheerio<any>,
  pageUrl: string,
): ExtractedFeaturedPublication | null {
  const title = titleFromPublicationNode($, node);
  if (!title || title.length < 8 || title.length > 260 || isLowQualityExtractedTitle(title)) {
    return null;
  }
  const href = cleanText(node.find('a[href]').first().attr('href'));
  if (!href) return null;
  return {
    title,
    url: absolutize(href, pageUrl),
  };
}

export function extractFeaturedPublicationsFromHtml(
  html: string,
  pageUrl: string,
  maxPublications = 10,
): ExtractedFeaturedPublication[] {
  const $ = cheerio.load(html);
  const candidates: ExtractedFeaturedPublication[] = [];

  const collectFrom = (section: cheerio.Cheerio<any>) => {
    let items = section.is('li,p')
      ? section
      : section.is('ul,ol')
        ? section.find('li')
        : section.find('li,p');
    if (items.length === 0 && !section.is('body,main,section')) {
      items = section.find('[class*="publication"],[class*="paper"]');
    }
    items.each((_i, item) => {
      const publication = publicationFromNode($, $(item), pageUrl);
      if (publication) candidates.push(publication);
    });
  };

  $('[class*="publication"], [id*="publication"], [class*="papers"], [id*="papers"]').each(
    (_i, section) => collectFrom($(section)),
  );

  $('h1,h2,h3,h4,h5,h6,strong').each((_i, heading) => {
    const label = cleanText($(heading).text());
    if (!/\b(selected |featured |recent |representative |key )?(publications?|papers?)\b/i.test(label)) {
      return;
    }

    const starts = [$(heading).next(), $(heading).parent().next()].filter((node) => node.length > 0);
    for (const start of starts) {
      let cursor = start;
      while (cursor.length > 0) {
        if (/^h[1-6]$/i.test(cursor.prop('tagName') || '')) break;
        collectFrom(cursor);
        cursor = cursor.next();
      }
    }
  });

  const pageLabel = cleanText(`${$('title').first().text()} ${$('h1').first().text()} ${pageUrl}`);
  if (
    candidates.length === 0 &&
    /\b(?:publication|publications|paper|papers|journals?|conferences?|workshops?)\b/i.test(pageLabel)
  ) {
    collectFrom($('body'));
  }

  const seen = new Set<string>();
  return candidates
    .filter((publication) => {
      const key = publication.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxPublications);
}

function isLikelyPublicationListLink(text: string, href: string, pageUrl: string): boolean {
  const normalizedText = cleanText(text).toLowerCase();
  const normalizedHref = cleanText(href).toLowerCase();
  const signal = `${normalizedText} ${normalizedHref}`;
  if (isGenericPublicationPointerTitle(signal)) return true;
  if (
    /\b(?:publications?|papers?|writings|bibliography)\b/i.test(normalizedText) &&
    /\b(?:publication|publications|paper|papers|writing|bibliography)\b/i.test(normalizedHref)
  ) {
    return true;
  }
  if (
    /\b(?:writings?)\b/i.test(normalizedText) &&
    /\b(?:publication|publications)\b/i.test(normalizedHref)
  ) {
    return true;
  }
  if (
    /\b(?:publication|publications|paper|papers)\b/i.test(pageUrl) &&
    /^(?:journals?|conferences?|workshops?|books?|book chapters?)$/i.test(normalizedText)
  ) {
    return true;
  }
  return false;
}

export function extractPublicationListUrlsFromHtml(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html);
  const urls: string[] = [];
  const seen = new Set<string>();

  $('a[href]').each((_i, el) => {
    const link = $(el);
    const href = cleanText(link.attr('href'));
    if (!href || /^mailto:|^tel:|^#|^javascript:/i.test(href)) return;
    if (isUnsupportedIndexUrl(href)) return;
    if (!isLikelyPublicationListLink(link.text(), href, pageUrl)) return;

    const url = absolutize(href, pageUrl);
    if (normalizeUrlForDedupe(url) === normalizeUrlForDedupe(pageUrl)) return;
    const key = normalizeUrlForDedupe(url);
    if (seen.has(key)) return;
    seen.add(key);
    urls.push(url);
  });

  return urls.slice(0, 8);
}

export function createRepairPageReader(fetcher: (url: string) => Promise<string>) {
  const htmlByUrl = new Map<string, Promise<string>>();
  const publicationsByUrl = new Map<string, Promise<ExtractedFeaturedPublication[]>>();
  const publicationListUrlsByUrl = new Map<string, Promise<string[]>>();
  let fetchedUrlCount = 0;

  const html = async (url: string): Promise<string> => {
    const key = normalizeUrlForDedupe(url);
    if (!htmlByUrl.has(key)) {
      htmlByUrl.set(
        key,
        (async () => {
          fetchedUrlCount += 1;
          return fetcher(url);
        })(),
      );
    }
    return htmlByUrl.get(key) as Promise<string>;
  };

  const featuredPublications = async (
    url: string,
    maxPublications: number,
  ): Promise<ExtractedFeaturedPublication[]> => {
    const key = normalizeUrlForDedupe(url);
    if (!publicationsByUrl.has(key)) {
      publicationsByUrl.set(
        key,
        html(url).then((pageHtml) => extractFeaturedPublicationsFromHtml(pageHtml, url, 500)),
      );
    }
    const publications = await publicationsByUrl.get(key);
    return (publications || []).slice(0, maxPublications);
  };

  const publicationListUrls = async (url: string): Promise<string[]> => {
    const key = normalizeUrlForDedupe(url);
    if (!publicationListUrlsByUrl.has(key)) {
      publicationListUrlsByUrl.set(
        key,
        html(url).then((pageHtml) => extractPublicationListUrlsFromHtml(pageHtml, url)),
      );
    }
    return publicationListUrlsByUrl.get(key) as Promise<string[]>;
  };

  return {
    featuredPublications,
    publicationListUrls,
    fetchedUrlCount: () => fetchedUrlCount,
  };
}

function parseNonNegativeInteger(value: string, flag: string): number {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

export function parseOfficialProfilePublicationPointerRepairArgs(
  argv: string[],
): OfficialProfilePublicationPointerRepairOptions {
  const options: OfficialProfilePublicationPointerRepairOptions = {
    apply: false,
    confirmOfficialProfilePublicationRepair: false,
    limit: 250,
    limitExplicit: false,
    maxPublicationsPerPointer: 10,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--confirm-official-profile-publication-repair') {
      options.confirmOfficialProfilePublicationRepair = true;
    } else if (arg.startsWith('--limit=')) {
      options.limit = parseNonNegativeInteger(arg.slice('--limit='.length), '--limit');
      options.limitExplicit = true;
    } else if (arg.startsWith('--max-publications-per-pointer=')) {
      options.maxPublicationsPerPointer = parseNonNegativeInteger(
        arg.slice('--max-publications-per-pointer='.length),
        '--max-publications-per-pointer',
      );
    } else if (arg === '--output') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) throw new Error('--output requires a path');
      options.output = next;
      i += 1;
    } else if (arg.startsWith('--output=')) {
      const output = arg.slice('--output='.length).trim();
      if (!output || output.startsWith('--')) throw new Error('--output requires a path');
      options.output = output;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export function assertOfficialProfilePublicationPointerRepairApplyAllowed(
  options: OfficialProfilePublicationPointerRepairOptions,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
) {
  if (options.apply && !options.confirmOfficialProfilePublicationRepair) {
    throw new Error(
      '--confirm-official-profile-publication-repair is required when --apply is set',
    );
  }
  if (options.apply && (!options.limitExplicit || !Number.isFinite(options.limit))) {
    throw new Error('--limit is required when --apply is set for officialProfilePublicationPointerRepair');
  }
  return assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'officialProfilePublicationPointerRepair',
    mongoUrl,
    env,
  });
}

export function writeOfficialProfilePublicationPointerRepairOutput(
  report: unknown,
  output?: string,
): void {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
}

async function loadPointerRows(limit: number): Promise<PointerRow[]> {
  return ResearchScholarlyLink.aggregate([
    {
      $match: {
        archived: { $ne: true },
        discoveredVia: 'OFFICIAL_PROFILE',
        $or: [
          { title: genericPointerTitlePattern },
          { url: /#publication-/i },
        ],
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    { $sort: { 'user.netid': 1, title: 1 } },
    { $limit: limit },
    {
      $project: {
        _id: 1,
        userId: 1,
        title: 1,
        url: 1,
        sourceUrl: 1,
        externalIds: 1,
        user: {
          netid: '$user.netid',
          fname: '$user.fname',
          lname: '$user.lname',
          website: '$user.website',
          profileUrls: '$user.profileUrls',
        },
      },
    },
  ]);
}

export async function fetchHtmlForRepair(url: string): Promise<string> {
  const response = await axios.get(url, {
    timeout: FETCH_TIMEOUT_MS,
    maxRedirects: 5,
    headers: { 'User-Agent': USER_AGENT },
  });
  return String(response.data || '');
}

async function crawlFeaturedPublications(
  urls: string[],
  maxPublications: number,
  reader: ReturnType<typeof createRepairPageReader>,
): Promise<{ publications: ExtractedFeaturedPublication[]; fetchedUrls: number; repairedFromUrl: string; error: string }> {
  const queue = [...urls];
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const publications: ExtractedFeaturedPublication[] = [];
  const fetchedUrlCountBefore = reader.fetchedUrlCount();
  let repairedFromUrl = '';
  let error = '';

  while (queue.length > 0 && seenUrls.size < MAX_CRAWL_PAGES_PER_POINTER) {
    const url = queue.shift() || '';
    const key = normalizeUrlForDedupe(url);
    if (!url || seenUrls.has(key)) continue;
    seenUrls.add(key);

    try {
      for (const publication of await reader.featuredPublications(url, maxPublications)) {
        const titleKey = normalizePublicationTitleKey(publication.title);
        if (!titleKey || seenTitles.has(titleKey)) continue;
        seenTitles.add(titleKey);
        publications.push(publication);
        if (!repairedFromUrl) repairedFromUrl = url;
      }
      if (publications.length >= maxPublications) break;
      queue.push(...await reader.publicationListUrls(url));
    } catch (err: any) {
      error = err?.message || String(err);
    }
  }

  return {
    publications: publications.slice(0, maxPublications),
    fetchedUrls: reader.fetchedUrlCount() - fetchedUrlCountBefore,
    repairedFromUrl,
    error,
  };
}

async function findMatchingPublicationFromUrls(
  urls: string[],
  title: string,
  reader: ReturnType<typeof createRepairPageReader>,
): Promise<{
  publication: ExtractedFeaturedPublication | null;
  fetchedUrls: number;
  repairedFromUrl: string;
  error: string;
}> {
  const queue = [...urls];
  const seenUrls = new Set<string>();
  const fetchedUrlCountBefore = reader.fetchedUrlCount();
  let error = '';

  while (queue.length > 0 && seenUrls.size < MAX_CRAWL_PAGES_PER_POINTER) {
    const url = queue.shift() || '';
    const key = normalizeUrlForDedupe(url);
    if (!url || seenUrls.has(key)) continue;
    seenUrls.add(key);

    try {
      const publications = await reader.featuredPublications(url, 500);
      const publication = findFeaturedPublicationByTitle(publications, title);
      if (publication) {
        return {
          publication,
          fetchedUrls: reader.fetchedUrlCount() - fetchedUrlCountBefore,
          repairedFromUrl: url,
          error,
        };
      }
      queue.push(...await reader.publicationListUrls(url));
    } catch (err: any) {
      error = err?.message || String(err);
    }
  }

  return {
    publication: null,
    fetchedUrls: reader.fetchedUrlCount() - fetchedUrlCountBefore,
    repairedFromUrl: '',
    error,
  };
}

async function archivePointerRow(row: PointerRow, archivedReason: string): Promise<number> {
  const result = await ResearchScholarlyLink.updateOne(
    { _id: row._id },
    {
      $set: {
        archived: true,
        archivedReason,
      },
    },
  );
  return result.modifiedCount || 0;
}

async function main() {
  const options = parseOfficialProfilePublicationPointerRepairArgs(process.argv.slice(2));
  const guard = assertOfficialProfilePublicationPointerRepairApplyAllowed(
    options,
    process.env,
    process.env.MONGODBURL,
  );

  await initializeConnections();
  const rows = await loadPointerRows(options.limit);
  const report: any = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    options,
    counts: {
      pointerRows: rows.length,
      repairableRows: 0,
      unresolvedRows: 0,
      fetchedUrls: 0,
      extractedPublications: 0,
      archivedPointers: 0,
      upsertedPublications: 0,
      modifiedPublications: 0,
    },
    repaired: [] as any[],
    unresolved: [] as any[],
  };
  const reader = createRepairPageReader(fetchHtmlForRepair);

  for (const row of rows) {
    const generatedPointer = isGeneratedPublicationAnchor(row);
    const genericPointer = isGenericPublicationPointerTitle(row.title);
    if (!generatedPointer && !genericPointer) continue;

    if (genericPointer && isExternalIndexPointerTitle(row.title)) {
      report.counts.unresolvedRows += 1;
      report.unresolved.push({
        id: String(row._id),
        netid: row.user?.netid,
        title: row.title,
        reason: 'external_index_pointer_not_faculty_website_signal',
        url: row.url,
      });
      if (options.apply) {
        report.counts.archivedPointers += await archivePointerRow(
          row,
          'generic_publication_pointer_external_index_removed_from_research_activity',
        );
      }
      continue;
    }

    const urls = candidateRepairUrls(row);
    if (urls.length === 0 || !row.userId) {
      report.counts.unresolvedRows += 1;
      report.unresolved.push({
        id: String(row._id),
        netid: row.user?.netid,
        title: row.title,
        reason: row.userId ? 'no_supported_faculty_website_url' : 'missing_user_id',
        url: row.url,
      });
      if (options.apply) {
        report.counts.archivedPointers += await archivePointerRow(
          row,
          'generic_publication_pointer_missing_supported_website_removed_from_research_activity',
        );
      }
      continue;
    }

    if (generatedPointer) {
      const match = await findMatchingPublicationFromUrls(urls, row.title, reader);
      report.counts.fetchedUrls += match.fetchedUrls;

      if (!match.publication) {
        report.counts.unresolvedRows += 1;
        report.unresolved.push({
          id: String(row._id),
          netid: row.user?.netid,
          title: row.title,
          reason: match.error ? 'fetch_or_parse_failed' : 'no_matching_publication_link_found',
          error: match.error || undefined,
          urls,
        });
        if (options.apply) {
          report.counts.archivedPointers += await archivePointerRow(
            row,
            match.error
              ? 'generated_official_profile_publication_anchor_fetch_failed_removed_from_research_activity'
              : 'generated_official_profile_publication_anchor_no_matching_publication_link_removed_from_research_activity',
          );
        }
        continue;
      }

      report.counts.repairableRows += 1;
      report.counts.extractedPublications += 1;
      report.repaired.push({
        id: String(row._id),
        netid: row.user?.netid,
        title: row.title,
        repairedFromUrl: match.repairedFromUrl,
        extractedTitles: [match.publication.title],
        extractedUrls: [match.publication.url],
      });

      if (!options.apply) continue;

      const result = await ResearchScholarlyLink.updateOne(
        { _id: row._id },
        {
          $set: {
            url: match.publication.url,
            sourceUrl: match.repairedFromUrl,
            displaySource: 'Faculty publication website',
            externalIds: {
              ...(row.externalIds || {}),
              officialProfileSourceUrl: row.sourceUrl,
              repairedPublicationListUrl: match.repairedFromUrl,
            },
            archived: false,
          },
        },
      );
      report.counts.modifiedPublications += result.modifiedCount || 0;
      continue;
    }

    const crawl = await crawlFeaturedPublications(urls, options.maxPublicationsPerPointer, reader);
    report.counts.fetchedUrls += crawl.fetchedUrls;
    const extracted = crawl.publications;
    const repairedFromUrl = crawl.repairedFromUrl;
    const fetchError = crawl.error;

    if (extracted.length === 0) {
      report.counts.unresolvedRows += 1;
      report.unresolved.push({
        id: String(row._id),
        netid: row.user?.netid,
        title: row.title,
        reason: fetchError ? 'fetch_or_parse_failed' : 'no_featured_publications_found',
        error: fetchError || undefined,
        urls,
      });
      if (options.apply) {
        report.counts.archivedPointers += await archivePointerRow(
          row,
          fetchError
            ? 'generic_publication_pointer_fetch_failed_removed_from_research_activity'
            : 'generic_publication_pointer_no_featured_publications_found_removed_from_research_activity',
        );
      }
      continue;
    }

    report.counts.repairableRows += 1;
    report.counts.extractedPublications += extracted.length;
    report.repaired.push({
      id: String(row._id),
      netid: row.user?.netid,
      title: row.title,
      repairedFromUrl,
      extractedTitles: extracted.map((publication) => publication.title),
      extractedUrls: extracted.map((publication) => publication.url),
    });

    if (!options.apply) continue;

    const observedAt = new Date();
    const bulkResult = await ResearchScholarlyLink.bulkWrite(
      extracted.map((publication) => ({
        updateOne: {
          filter: {
            userId: row.userId,
            title: publication.title,
            sourceUrl: repairedFromUrl,
          },
          update: {
            $set: {
              userId: row.userId,
              title: publication.title,
              url: publication.url,
              destinationKind: 'OTHER',
              displaySource: 'Official Yale profile',
              freeFullTextUrl: '',
              freeFullTextLabel: '',
              discoveredVia: 'OFFICIAL_PROFILE',
              confidence: 0.9,
              observedAt,
              sourceUrl: repairedFromUrl,
              externalIds: {
                officialProfileSourceUrl: repairedFromUrl,
              },
              archived: false,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    report.counts.archivedPointers += await archivePointerRow(
      row,
      'generic_publication_pointer_replaced_by_featured_website_publications',
    );
    report.counts.upsertedPublications += bulkResult.upsertedCount || 0;
    report.counts.modifiedPublications += bulkResult.modifiedCount || 0;
  }

  console.log(JSON.stringify(report, null, 2));
  writeOfficialProfilePublicationPointerRepairOutput(report, options.output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error('Failed to repair official-profile publication pointers:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
