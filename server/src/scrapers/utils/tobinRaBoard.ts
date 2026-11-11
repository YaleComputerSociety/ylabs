import { createHmac, randomBytes } from 'node:crypto';
import * as cheerio from 'cheerio';

export const TOBIN_RA_BOARD_URL = 'https://economics.yale.edu/undergraduate/tobin-ra';

const PROJECT_BLOCK_SELECTOR = 'article.node-teaser--opportunity';
const SPONSOR_LABEL = /^faculty sponsors?(?:\(s\))?$/i;
const SEMESTER_LABEL = /^semester$/i;
const FILLED_LABEL = /^position filled$/i;
const AWARD_LABEL = /^award$/i;
const SEMESTER_YEAR = /\b(20\d{2})\b/;

export interface TobinRaSponsor {
  name: string;
  profileUrl: string;
}

export interface TobinRaProject {
  projectUrl: string | null;
  year: number | null;
  filled: boolean;
  sponsors: TobinRaSponsor[];
  unlinkedSponsorText: string;
  awardeeKeys: string[];
}

export interface TobinRaBoardRead {
  projectBlocks: number;
  projects: TobinRaProject[];
}

const labelText = (text: string): string => text.replace(/\s+/g, ' ').trim();

const absoluteUrl = (href: string, pageUrl: string): string | null => {
  try {
    const url = new URL(href, pageUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/+$/, '').toLowerCase();
  } catch {
    return null;
  }
};

/**
 * The `Award` entry names the students who hold a filled project. It is removed from the
 * document before anything else is read, so no student name can reach a parsed value, an
 * observation, a log line or a run report (#3551). The one thing taken from it first is
 * `awardeeKeysByBlock`'s salted digest, which only tells two postings of one student apart
 * from two students (#5609).
 */
export function removeAwardSections($: cheerio.CheerioAPI): void {
  $('dt').each((_, element) => {
    const label = $(element);
    if (!AWARD_LABEL.test(labelText(label.text()))) return;
    label.nextUntil('dt').remove();
    label.remove();
  });
  $('[class*="award" i]').remove();
}

const AWARDEE_SEPARATOR = /\s*(?:,|;|&|\band\b)\s*/i;

const awardeeIdentity = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();

/**
 * One digest per student named on each project, keyed with a salt drawn for this read only.
 * A digest is equal across two postings of one board read and unrelated across reads, so it
 * counts distinct students without becoming a stable pseudonym anywhere (#5609).
 */
function awardeeKeysByBlock($: cheerio.CheerioAPI): Map<unknown, string[]> {
  const salt = randomBytes(32);
  const keysByBlock = new Map<unknown, string[]>();
  $(PROJECT_BLOCK_SELECTOR).each((_, element) => {
    const keys = new Set<string>();
    $(element)
      .find('dt')
      .filter((_, label) => AWARD_LABEL.test(labelText($(label).text())))
      .each((_, label) => {
        for (const name of labelText($(label).nextUntil('dt').text()).split(AWARDEE_SEPARATOR)) {
          const identity = awardeeIdentity(name);
          if (identity) keys.add(createHmac('sha256', salt).update(identity).digest('hex'));
        }
      });
    keysByBlock.set(element, [...keys]);
  });
  return keysByBlock;
}

export function parseTobinRaBoard(html: string, pageUrl = TOBIN_RA_BOARD_URL): TobinRaBoardRead {
  const $ = cheerio.load(html);
  const awardeeKeys = awardeeKeysByBlock($);
  removeAwardSections($);
  const blocks = $(PROJECT_BLOCK_SELECTOR);
  const projects: TobinRaProject[] = [];
  blocks.each((_, element) => {
    const block = $(element);
    const labels = block.find('dt');
    const labelled = (pattern: RegExp) =>
      labels.filter((_, label) => pattern.test(labelText($(label).text()))).first();
    const semester = labelled(SEMESTER_LABEL);
    const semesterText = semester.length ? labelText(semester.nextUntil('dt').text()) : '';
    const yearMatch = semesterText.match(SEMESTER_YEAR);
    const sponsorsByUrl = new Map<string, TobinRaSponsor>();
    const sponsorEntries = labelled(SPONSOR_LABEL).nextUntil('dt');
    sponsorEntries.find('a[href]').each((_, anchor) => {
      const profileUrl = absoluteUrl($(anchor).attr('href') ?? '', pageUrl);
      const name = labelText($(anchor).text());
      if (profileUrl && name && !sponsorsByUrl.has(profileUrl)) {
        sponsorsByUrl.set(profileUrl, { name, profileUrl });
      }
    });
    const heading = block.find('.node-teaser__heading a[href]').first().attr('href');
    projects.push({
      projectUrl: heading ? absoluteUrl(heading, pageUrl) : null,
      year: yearMatch ? Number(yearMatch[1]) : null,
      filled: labelled(FILLED_LABEL).length > 0,
      sponsors: [...sponsorsByUrl.values()],
      unlinkedSponsorText: labelText(sponsorEntries.clone().find('a').remove().end().text()),
      awardeeKeys: awardeeKeys.get(element) ?? [],
    });
  });
  return { projectBlocks: blocks.length, projects };
}
