/**
 * Pure readers for official Yale lists that name a faculty member as the adviser or mentor
 * of a specific undergraduate, or as open to advising undergraduates now (#5551).
 *
 * Every list names the student beside the adviser. Only the adviser is read: no student
 * name, project title or topic leaves these functions.
 */
import * as cheerio from 'cheerio';
import { isTag, isText, type AnyNode, type Element } from 'domhandler';
import {
  undergradMentoringSources,
  type UndergradMentoringKind,
  type UndergradMentoringSource,
} from '../../models/storedVocabularies';

export { undergradMentoringSources, type UndergradMentoringKind, type UndergradMentoringSource };

export interface MentorListing {
  source: UndergradMentoringSource;
  adviserName: string;
  adviserEmail?: string;
  adviserProfileUrl?: string;
  department?: string;
  year?: number;
  sourceUrl: string;
}

export interface UndergradMentoringEntry {
  source: UndergradMentoringSource;
  kind: UndergradMentoringKind;
  count?: number;
  latestYear?: number;
  sourceUrl: string;
}

export const UNDERGRAD_MENTORING_SOURCE_KIND: Record<
  UndergradMentoringSource,
  UndergradMentoringKind
> = {
  'cs-senior-projects': 'advised',
  'cs-directed-research': 'advised',
  'tobin-research-assistantships': 'advised',
  'economics-senior-essay-advisers': 'open',
  'psychology-research-opportunities': 'open',
  'wu-tsai-undergraduate-fellows': 'advised',
  'physics-open-research-opportunities': 'open',
  'english-senior-essays': 'advised',
  'english-creative-writing-projects': 'advised',
  'political-science-senior-essay-prizes': 'advised',
  'german-senior-essays': 'advised',
  'yibs-summer-research-fellows': 'advised',
};

const HONORIFIC = /^(?:prof(?:essor)?\.?|dr\.?|mr\.?|ms\.?|mrs\.?)\s+/i;
const TRAILING_CREDENTIAL = /,?\s+(?:ph\.?\s?d\.?|m\.?d\.?|jr\.?|sr\.?)$/i;
const NAME_SEPARATOR = /\s*(?:,|;|\/|&|\band\b)\s*/i;
const PLAUSIBLE_NAME = /^[\p{L}][\p{L}.'\- ]{2,80}$/u;

export function cleanAdviserName(raw: string): string {
  let name = raw.replace(/\s+/g, ' ').trim();
  name = name.replace(HONORIFIC, '');
  while (TRAILING_CREDENTIAL.test(name)) name = name.replace(TRAILING_CREDENTIAL, '');
  return name.replace(/[.,;:]+$/, '').trim();
}

/** "A and B", "A, B" or "A & B" read as separate advisers; a single name passes through. */
export function splitAdviserNames(raw: string): string[] {
  return raw
    .split(NAME_SEPARATOR)
    .map(cleanAdviserName)
    .filter((name) => PLAUSIBLE_NAME.test(name) && name.includes(' '));
}

const yaleEmail = (value: string | undefined): string | undefined => {
  const email = value
    ?.replace(/^mailto:/i, '')
    .trim()
    .toLowerCase();
  return email && /^[^\s@]+@(?:[a-z0-9-]+\.)*yale\.edu$/.test(email) ? email : undefined;
};

const absoluteUrl = (href: string | undefined, base: string): string | undefined => {
  if (!href) return undefined;
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
};

const yearIn = (text: string): number | undefined => {
  const years = Array.from(text.matchAll(/\b(20\d\d|19\d\d)\b/g), (match) => Number(match[1]));
  return years.length > 0 ? Math.max(...years) : undefined;
};

/** Term pages linked from a CS course archive index, such as `25-26b/index.html`. */
export function csArchiveTermUrls(indexHtml: string, indexUrl: string): string[] {
  const $ = cheerio.load(indexHtml);
  const urls = new Set<string>();
  $('a[href]').each((_index, element) => {
    const href = $(element).attr('href') ?? '';
    if (!/^\d\d-\d\d[ab]\/index\.html$/i.test(href)) return;
    const url = absoluteUrl(href, indexUrl);
    if (url) urls.add(url);
  });
  return [...urls];
}

/** Each project in a CS term page ends with "Adviser: <name>." */
export function csArchiveTermListings(
  html: string,
  url: string,
  source: UndergradMentoringSource,
): MentorListing[] {
  const $ = cheerio.load(html);
  const year = yearIn($('h2').first().text()) ?? yearIn($('title').text());
  const listings: MentorListing[] = [];
  $('li').each((_index, element) => {
    const item = $(element).clone();
    item.find('a').remove();
    const text = item.text().replace(/\s+/g, ' ').trim();
    const adviser = /\bAdvis(?:e|o)rs?:\s*(.{3,160}?)\.?\s*$/.exec(text)?.[1];
    if (!adviser) return;
    for (const adviserName of splitAdviserNames(adviser)) {
      listings.push({ source, adviserName, year, sourceUrl: url });
    }
  });
  return listings;
}

/** Tobin RA project pages, listed in the Economics sitemap under `/tobin-ra/<year>/`. */
export function tobinProjectUrls(sitemapXml: string): string[] {
  return Array.from(
    sitemapXml.matchAll(/<loc>\s*([^<\s]+\/undergraduate\/tobin-ra\/\d{4}\/[^<\s]+)\s*<\/loc>/g),
    (match) => match[1].replace(/^http:\/\//, 'https://'),
  );
}

/** Child sitemaps of a sitemap index, so the project pages can be found on every page. */
export function sitemapIndexUrls(sitemapXml: string): string[] {
  if (!/<sitemapindex\b/i.test(sitemapXml)) return [];
  return Array.from(sitemapXml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g), (match) =>
    match[1].replace(/^http:\/\//, 'https://').replace(/&amp;/g, '&'),
  );
}

const asideValue = ($: cheerio.CheerioAPI, label: RegExp) =>
  $('.node__aside-label')
    .filter((_index, element) => label.test($(element).text().trim()))
    .first()
    .parent();

/** The faculty sponsors of one Tobin project; the "Award" field names the student and is skipped. */
export function tobinProjectListings(html: string, url: string): MentorListing[] {
  const $ = cheerio.load(html);
  const semester = asideValue($, /^semester$/i).text();
  const year = yearIn(semester) ?? yearIn(url);
  const sponsors = asideValue($, /^faculty sponsors?(?:\(s\))?$/i);
  const listings: MentorListing[] = [];
  sponsors.find('.node-teaser--person').each((_index, element) => {
    const teaser = $(element);
    const adviserName = cleanAdviserName(teaser.find('.node-teaser__heading').first().text());
    if (!PLAUSIBLE_NAME.test(adviserName)) return;
    listings.push({
      source: 'tobin-research-assistantships',
      adviserName,
      adviserEmail: yaleEmail(teaser.find('a[href^="mailto:"]').first().attr('href')),
      adviserProfileUrl: absoluteUrl(
        teaser.find('.node-teaser__heading a[href]').first().attr('href'),
        url,
      ),
      year,
      sourceUrl: url,
    });
  });
  return listings;
}

/** The Economics directory of faculty available to advise senior essays. */
export function economicsSeniorEssayAdviserListings(html: string, url: string): MentorListing[] {
  const $ = cheerio.load(html);
  const listings: MentorListing[] = [];
  $('td.faculty-member-info').each((_index, element) => {
    const cell = $(element);
    const link = cell.find('a[href]:not([href^="mailto:"])').first();
    const adviserName = cleanAdviserName(link.text());
    if (!PLAUSIBLE_NAME.test(adviserName)) return;
    listings.push({
      source: 'economics-senior-essay-advisers',
      adviserName,
      adviserEmail: yaleEmail(cell.find('a[href^="mailto:"]').first().attr('href')),
      adviserProfileUrl: absoluteUrl(link.attr('href'), url),
      department: 'Economics',
      sourceUrl: url,
    });
  });
  return listings;
}

/** The CSV export of the Google Sheet a department page links for its research openings. */
export function googleSheetCsvUrl(pageHtml: string): string | undefined {
  const id = /docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(pageHtml)?.[1];
  return id ? `https://docs.google.com/spreadsheets/d/${id}/export?format=csv` : undefined;
}

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * The Psychology research-opportunities sheet: one row per lab, grouped under section rows
 * that name the department or school, with the PI in a labelled column.
 */
export function psychologyResearchSheetListings(csv: string, sheetUrl: string): MentorListing[] {
  const rows = parseCsv(csv);
  const header = rows.findIndex((row) => row.some((cell) => /^\s*PI\b/i.test(cell)));
  if (header < 0) return [];
  const piColumn = rows[header].findIndex((cell) => /^\s*PI\b/i.test(cell));
  const listings: MentorListing[] = [];
  let department: string | undefined;
  for (const row of rows.slice(header + 1)) {
    const filled = row.filter((cell) => cell.trim());
    if (filled.length === 1 && row[0]?.trim()) {
      department = row[0].trim();
      continue;
    }
    for (const adviserName of splitAdviserNames(row[piColumn] ?? '')) {
      listings.push({
        source: 'psychology-research-opportunities',
        adviserName,
        department,
        sourceUrl: sheetUrl,
      });
    }
  }
  return listings;
}

const ADVISER_LABEL = /Advis(?:e|o)rs?:/i;

function linksAfterAdviserLabel(nodes: AnyNode[]): Element[] {
  const links: Element[] = [];
  let textSoFar = '';
  const visit = (node: AnyNode) => {
    if (isText(node)) {
      textSoFar += node.data;
      return;
    }
    if (!isTag(node)) return;
    if (node.tagName === 'a' && node.attribs.href && ADVISER_LABEL.test(textSoFar)) {
      links.push(node);
    }
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return links;
}

/** Wu Tsai undergraduate fellows, grouped in sections headed by the summer they ran. */
export function wuTsaiFellowListings(html: string, url: string): MentorListing[] {
  const $ = cheerio.load(html);
  const listings: MentorListing[] = [];
  $('.accordion-item').each((_index, element) => {
    const item = $(element);
    const year = yearIn(item.find('[class*="accordion-item__"]').first().text());
    item.find('p').each((_paragraph, paragraph) => {
      const block = $(paragraph);
      if (!ADVISER_LABEL.test(block.text())) return;
      const links = linksAfterAdviserLabel(block.contents().toArray());
      if (links.length === 0) {
        const named = /Advis(?:e|o)rs?:\s*(.+)$/i.exec(block.text().replace(/\s+/g, ' '))?.[1];
        for (const adviserName of splitAdviserNames(named ?? '')) {
          listings.push({
            source: 'wu-tsai-undergraduate-fellows',
            adviserName,
            year,
            sourceUrl: url,
          });
        }
        return;
      }
      links.forEach((link) => {
        for (const adviserName of splitAdviserNames($(link).text())) {
          listings.push({
            source: 'wu-tsai-undergraduate-fellows',
            adviserName,
            adviserProfileUrl: absoluteUrl($(link).attr('href'), url),
            year,
            sourceUrl: url,
          });
        }
      });
    });
  });
  return listings;
}

const emailNameTokens = (email: string | undefined): Set<string> =>
  new Set(
    (email?.split('@')[0] ?? '')
      .toLowerCase()
      .split(/[._-]+/)
      .filter((token) => token.length > 1),
  );

/**
 * A card heading that prints the name and then the title, such as "<name> Professor of
 * Physics": the name is the leading words the person's own email local part spells.
 */
export function nameFromHeadingAndEmail(heading: string, email: string | undefined): string {
  const words = cleanAdviserName(heading).split(' ');
  const tokens = emailNameTokens(email);
  if (tokens.size < 2) return '';
  const normalized = (word: string) =>
    word
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z-]/g, '');
  const kept: string[] = [];
  for (const word of words) {
    const key = normalized(word);
    if (tokens.has(key) || key.split('-').every((part) => tokens.has(part))) kept.push(word);
    else if (/^[A-Z]\.?$/.test(word) && kept.length > 0) kept.push(word);
    else break;
  }
  while (kept.length > 0 && /^[A-Z]\.?$/.test(kept[kept.length - 1])) kept.pop();
  return kept.length >= 2 ? kept.join(' ') : '';
}

/**
 * Physics faculty listed under "Faculty with Open Research Opportunities": every card from
 * that heading to the next section heading, each naming the professor with their email.
 */
export function physicsOpenOpportunityListings(html: string, url: string): MentorListing[] {
  const $ = cheerio.load(html);
  const listings: MentorListing[] = [];
  let inSection = false;
  $('h2, li.custom-card').each((_index, element) => {
    const node = $(element);
    if (node.is('h2') && !node.hasClass('custom-card__heading')) {
      inSection = /open research opportunities/i.test(node.text());
      return;
    }
    if (!inSection || !node.is('li.custom-card')) return;
    const link = node.find('.custom-card__heading a[href]').first();
    const cardText = (node.html() ?? '').replace(/<[^>]+>/g, ' ');
    const adviserEmail = yaleEmail(
      node.find('a[href^="mailto:"]').first().attr('href') ??
        /[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)*yale\.edu/i.exec(cardText)?.[0],
    );
    const heading = link.text().replace(/\s+/g, ' ').trim();
    const adviserName = nameFromHeadingAndEmail(heading, adviserEmail) || cleanAdviserName(heading);
    if (!PLAUSIBLE_NAME.test(adviserName) || !adviserName.includes(' ')) return;
    listings.push({
      source: 'physics-open-research-opportunities',
      adviserName,
      adviserEmail,
      adviserProfileUrl: absoluteUrl(link.attr('href'), url),
      department: 'Physics',
      sourceUrl: url,
    });
  });
  return listings;
}

/** The end year of a heading such as "2024-2025", "2024-25" or "Prize Winners 2023-24". */
export function academicYearEndIn(text: string): number | undefined {
  const range = /\b((?:19|20)\d\d)\s*[-\u2013]\s*((?:19|20)?\d\d)\b/.exec(text);
  if (range)
    return range[2].length === 2 ? Number(range[1].slice(0, 2) + range[2]) : Number(range[2]);
  return yearIn(text);
}

const ADVISED_BY = /\badvised\s+by\s+(.+?)\s*[.;]?\s*$/i;

/**
 * An English senior essay or Creative Writing project page: a heading per academic year,
 * then one paragraph per essay ending "advised by <adviser>".
 */
export function englishAdvisedByListings(
  html: string,
  url: string,
  source: UndergradMentoringSource,
): MentorListing[] {
  const $ = cheerio.load(html);
  const listings: MentorListing[] = [];
  let year: number | undefined;
  $('h2, h3, p').each((_index, element) => {
    const node = $(element);
    const text = node.text().replace(/\s+/g, ' ').trim();
    if (node.is('h2, h3')) {
      year = /\b(?:19|20)\d\d\s*[-\u2013]\s*(?:19|20)?\d\d\b/.test(text)
        ? academicYearEndIn(text)
        : year;
      return;
    }
    const adviser = ADVISED_BY.exec(text)?.[1];
    if (!adviser || year === undefined) return;
    for (const adviserName of splitAdviserNames(adviser)) {
      listings.push({ source, adviserName, department: 'English', year, sourceUrl: url });
    }
  });
  return listings;
}

/** Political Science senior essay prizes: each winner's line names "(advisor <name>)". */
export function politicalScienceEssayPrizeListings(html: string, url: string): MentorListing[] {
  const $ = cheerio.load(html);
  const listings: MentorListing[] = [];
  let year: number | undefined;
  $('h2, h3, li, p').each((_index, element) => {
    const node = $(element);
    const text = node.text().replace(/\s+/g, ' ').trim();
    if (node.is('h2, h3')) {
      year = academicYearEndIn(text) ?? year;
      return;
    }
    if (node.is('p') && node.parents('li').length > 0) return;
    for (const match of text.matchAll(/\(\s*advis(?:e|o)rs?:?\s+([^)]+)\)/gi)) {
      for (const adviserName of splitAdviserNames(match[1])) {
        listings.push({
          source: 'political-science-senior-essay-prizes',
          adviserName,
          department: 'Political Science',
          year,
          sourceUrl: url,
        });
      }
    }
  });
  return listings;
}

/** German recent senior essays: year in bold, then each essay ending "Advisor: <name>". */
export function germanSeniorEssayListings(html: string, url: string): MentorListing[] {
  const $ = cheerio.load(html);
  const listings: MentorListing[] = [];
  let year: number | undefined;
  $('p').each((_index, element) => {
    const node = $(element);
    const bold = node.find('strong').first().text().trim();
    if (/^(?:19|20)\d\d$/.test(bold) && node.text().trim() === bold) {
      year = Number(bold);
      return;
    }
    const html = node.html() ?? '';
    const lines = html
      .split(/<br\s*\/?>/i)
      .map((line) => cheerio.load(`<p>${line}</p>`)('p').text().replace(/\s+/g, ' ').trim());
    const adviser = lines
      .map((line) => /^Advis(?:e|o)rs?\s*:\s*(.+)$/i.exec(line)?.[1])
      .find((value): value is string => Boolean(value));
    if (!adviser) return;
    for (const adviserName of splitAdviserNames(adviser)) {
      listings.push({
        source: 'german-senior-essays',
        adviserName,
        department: 'German',
        year,
        sourceUrl: url,
      });
    }
  });
  return listings;
}

/**
 * YIBS past SURES fellows: one block per fellow whose text names "Advisor : <name>, <title>".
 * Only the name before the first comma is the adviser.
 */
export function yibsSuresFellowListings(html: string, url: string): MentorListing[] {
  const $ = cheerio.load(html);
  const listings: MentorListing[] = [];
  $('.field-collection-item-field-person-info').each((_index, element) => {
    const text = $(element).text().replace(/\s+/g, ' ').trim();
    const year = yearIn(text);
    for (const match of text.matchAll(/Advis(?:e|o)rs?\s*:\s*([^,;(]+)/gi)) {
      for (const adviserName of splitAdviserNames(match[1])) {
        listings.push({
          source: 'yibs-summer-research-fellows',
          adviserName,
          year,
          sourceUrl: url,
        });
      }
    }
  });
  return listings;
}

/**
 * One entry per source for a row: how many undergraduates the lists name for it and the
 * latest year, or for a list of who is open now, that it lists them.
 */
export function aggregateMentoringEntries(
  listings: readonly MentorListing[],
  sourceUrlFor: (source: UndergradMentoringSource) => string,
): UndergradMentoringEntry[] {
  const bySource = new Map<UndergradMentoringSource, MentorListing[]>();
  for (const listing of listings) {
    bySource.set(listing.source, [...(bySource.get(listing.source) ?? []), listing]);
  }
  return undergradMentoringSources
    .filter((source) => bySource.has(source))
    .map((source) => {
      const entries = bySource.get(source) ?? [];
      const kind = UNDERGRAD_MENTORING_SOURCE_KIND[source];
      const years = entries.map((entry) => entry.year).filter((year): year is number => !!year);
      return {
        source,
        kind,
        ...(kind === 'advised' ? { count: entries.length } : {}),
        ...(years.length > 0 ? { latestYear: Math.max(...years) } : {}),
        sourceUrl: sourceUrlFor(source),
      };
    });
}
