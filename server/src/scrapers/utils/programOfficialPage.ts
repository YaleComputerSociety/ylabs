import * as cheerio from 'cheerio';
import { isProgramApplicationPortalUrl } from '../../utils/researchHomeWebsiteUrl';

export const PROGRAM_OFFICIAL_PAGE_SOURCE = 'program-official-page';

const PROGRAM_NOUNS: ReadonlySet<string> = new Set([
  'fellowship',
  'fellowships',
  'fund',
  'funds',
  'award',
  'awards',
  'grant',
  'grants',
  'prize',
  'prizes',
  'scholarship',
  'scholarships',
  'stipend',
  'stipends',
  'internship',
  'internships',
  'program',
  'programs',
  'endowment',
]);

const NON_DISTINCTIVE_TOKENS: ReadonlySet<string> = new Set([
  ...PROGRAM_NOUNS,
  'a',
  'an',
  'and',
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
  'yale',
  'college',
  'university',
  'school',
  'research',
  'summer',
  'travel',
  'traveling',
  'travelling',
  'undergraduate',
  'undergraduates',
  'graduate',
  'student',
  'students',
  'senior',
  'seniors',
  'junior',
  'juniors',
  'memorial',
  'endowed',
  'international',
  'study',
  'studies',
  'project',
  'projects',
  'support',
  'iii',
  'ii',
  'jr',
]);

const TRAILING_SUFFIX_TOKENS: ReadonlySet<string> = new Set(['fund', 'funds', 'endowment']);

function foldedWords(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['\u2018\u2019`]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

export function normalizedTokens(text: string): string[] {
  return foldedWords(text).map((word) => word.toLowerCase());
}

interface PageWords {
  tokens: string[];
  capitalized: boolean[];
}

function pageWords(text: string): PageWords {
  const words = foldedWords(text);
  return {
    tokens: words.map((word) => word.toLowerCase()),
    capitalized: words.map((word) => /^[A-Z]/.test(word)),
  };
}

export function officialPageText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, template, svg').remove();
  const title = $('title').first().text();
  return `${title} ${$('body').text() || $.root().text()}`.replace(/\s+/g, ' ').trim();
}

function indexOfSequence(haystack: readonly string[], needle: readonly string[]): number {
  if (needle.length === 0 || needle.length > haystack.length) return -1;
  outer: for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) continue outer;
    }
    return start;
  }
  return -1;
}

function withoutParentheticals(title: string): string {
  return title.replace(/\([^)]*\)/g, ' ');
}

function titleVariants(title: string): string[][] {
  const variants: string[][] = [];
  const add = (tokens: string[]) => {
    if (tokens.length < 2) return;
    if (!tokens.some((token) => !NON_DISTINCTIVE_TOKENS.has(token))) return;
    if (variants.some((variant) => variant.join(' ') === tokens.join(' '))) return;
    variants.push(tokens);
  };
  for (const source of [title, withoutParentheticals(title)]) {
    let tokens = normalizedTokens(source);
    while (tokens[0] === 'the' || tokens[0] === 'yale') tokens = tokens.slice(1);
    add(tokens);
    while (tokens.length > 2 && TRAILING_SUFFIX_TOKENS.has(tokens[tokens.length - 1])) {
      tokens = tokens.slice(0, -1);
      add(tokens);
    }
  }
  return variants;
}

export interface FundNaming {
  named: boolean;
  phrase?: string;
}

const FUNDING_NOUNS: ReadonlySet<string> = new Set([
  'fellowship',
  'fellowships',
  'fund',
  'funds',
  'award',
  'awards',
  'grant',
  'grants',
  'prize',
  'prizes',
  'scholarship',
  'scholarships',
  'stipend',
  'stipends',
  'endowment',
]);

function nounFamily(token: string): string | null {
  if (FUNDING_NOUNS.has(token)) return 'funding';
  if (token === 'program' || token === 'programs') return 'program';
  if (token === 'internship' || token === 'internships') return 'internship';
  return null;
}

const isInitialOrClassYear = (token: string): boolean => /^(?:[a-z]|\d{2})$/.test(token);

const isGapToken = (token: string): boolean =>
  isInitialOrClassYear(token) || (NON_DISTINCTIVE_TOKENS.has(token) && !PROGRAM_NOUNS.has(token));

function withoutHostPrefix(tokens: string[], pageHost: string): string[] {
  const hostLabel =
    pageHost
      .toLowerCase()
      .replace(/^www\./, '')
      .split('.')[0] ?? '';
  let rest = tokens;
  if (hostLabel) {
    for (let end = Math.min(3, rest.length); end > 0; end -= 1) {
      if (rest.slice(0, end).join('') === hostLabel) {
        rest = rest.slice(end);
        break;
      }
    }
  }
  const collegeAt = rest.slice(0, 4).indexOf('college');
  return collegeAt >= 0 ? rest.slice(collegeAt + 1) : rest;
}

interface FundNameCore {
  core: string[];
  family: string;
  noun: string;
  qualifiers: ReadonlySet<string>;
}

const STOP_WORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

const singular = (token: string): string => token.replace(/s$/, '');

function fundNameCore(fundTitle: string, pageHost: string): FundNameCore | null {
  let tokens = normalizedTokens(withoutParentheticals(fundTitle));
  while (tokens[0] === 'the' || tokens[0] === 'yale') tokens = tokens.slice(1);
  tokens = withoutHostPrefix(tokens, pageHost);
  const fundingNounAt = tokens.findIndex((token) => nounFamily(token) === 'funding');
  const nounAt =
    fundingNounAt >= 0 ? fundingNounAt : tokens.findIndex((token) => nounFamily(token) !== null);
  if (nounAt <= 0) return null;
  const core = tokens
    .slice(0, nounAt)
    .filter((token) => !NON_DISTINCTIVE_TOKENS.has(token) && !isInitialOrClassYear(token));
  if (core.length === 0 || !core.some((token) => token.length >= 4)) return null;
  return {
    core,
    family: nounFamily(tokens[nounAt]) as string,
    noun: singular(tokens[nounAt]),
    qualifiers: new Set(
      tokens.filter(
        (token) => !STOP_WORDS.has(token) && !core.includes(token) && nounFamily(token) === null,
      ),
    ),
  };
}

const MAX_GAP_TOKENS = 2;

function coreNameEndsAt(page: readonly string[], start: number, core: readonly string[]): number {
  let at = start;
  for (let index = 1; index < core.length; index += 1) {
    let next = at + 1;
    while (next < page.length && next - at - 1 < MAX_GAP_TOKENS && page[next] !== core[index]) {
      if (!isGapToken(page[next])) return -1;
      next += 1;
    }
    if (page[next] !== core[index]) return -1;
    at = next;
  }
  return at;
}

function continuesAnotherName(page: PageWords, start: number): boolean {
  let before = start - 1;
  while (before >= 0 && /^[a-z]$/.test(page.tokens[before])) before -= 1;
  if (before < 0) return false;
  const token = page.tokens[before];
  return page.capitalized[before] && !NON_DISTINCTIVE_TOKENS.has(token) && !/^\d/.test(token);
}

function spanSpeaksForFund(
  name: FundNameCore,
  between: readonly string[],
  pageNoun: string,
): boolean {
  if (name.core.length > 1) return true;
  return singular(pageNoun) === name.noun || between.some((token) => name.qualifiers.has(token));
}

function namedByCore(page: PageWords, name: FundNameCore): string | null {
  const tokens = page.tokens;
  for (let start = 0; start < tokens.length; start += 1) {
    if (tokens[start] !== name.core[0] || continuesAnotherName(page, start)) continue;
    const coreEnd = coreNameEndsAt(tokens, start, name.core);
    if (coreEnd < 0) continue;
    for (let at = coreEnd + 1; at < tokens.length && at <= coreEnd + 4; at += 1) {
      if (
        nounFamily(tokens[at]) === name.family &&
        spanSpeaksForFund(name, tokens.slice(coreEnd + 1, at), tokens[at])
      ) {
        return tokens.slice(start, at + 1).join(' ');
      }
      if (!isGapToken(tokens[at])) break;
    }
  }
  return null;
}

export function officialPageNamesFund(
  fundTitle: string,
  pageText: string,
  pageHost = '',
): FundNaming {
  const page = pageWords(pageText);
  if (page.tokens.length === 0) return { named: false };
  for (const variant of titleVariants(fundTitle)) {
    const at = indexOfSequence(page.tokens, variant);
    if (at >= 0) {
      return { named: true, phrase: page.tokens.slice(at, at + variant.length).join(' ') };
    }
  }
  const name = fundNameCore(fundTitle, pageHost);
  const phrase = name ? namedByCore(page, name) : null;
  return phrase ? { named: true, phrase } : { named: false };
}

export function isCitableOfficialPageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) return false;
  return !isProgramApplicationPortalUrl(value.trim());
}

export function chooseOfficialPage(input: {
  storedSourceUrl?: unknown;
  ownCitedUrl?: unknown;
  seedUrl?: unknown;
}): string | null {
  for (const candidate of [input.storedSourceUrl, input.ownCitedUrl, input.seedUrl]) {
    if (isCitableOfficialPageUrl(candidate)) return candidate.trim();
  }
  return null;
}
