import * as cheerio from 'cheerio';

export const TOBIN_RA_BOARD_URL = 'https://economics.yale.edu/undergraduate/tobin-ra';
export const TOBIN_RA_PROGRAM_NAME = 'Tobin Undergraduate Research Assistantship';

const PROJECT_BLOCK_SELECTOR = 'article.node-teaser--opportunity';
const SPONSOR_LABEL = /^faculty sponsor\(s\)?$/i;
const SEMESTER_LABEL = /^semester$/i;
const FILLED_LABEL = /^position filled$/i;
const AWARD_LABEL = /^award$/i;
const SEMESTER_YEAR = /\b(20\d{2})\b/;

export interface TobinRaProject {
  year: number | null;
  filled: boolean;
  sponsorProfileUrls: string[];
}

export interface TobinRaBoardRead {
  projectBlocks: number;
  projects: TobinRaProject[];
}

const labelText = (text: string): string => text.replace(/\s+/g, ' ').trim();

const absoluteProfileUrl = (href: string, pageUrl: string): string | null => {
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
 * observation, a log line or a run report (#3551).
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

export function parseTobinRaBoard(html: string, pageUrl = TOBIN_RA_BOARD_URL): TobinRaBoardRead {
  const $ = cheerio.load(html);
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
    const sponsor = labelled(SPONSOR_LABEL);
    const sponsorProfileUrls = sponsor.length
      ? [
          ...new Set(
            sponsor
              .nextUntil('dt')
              .find('a[href]')
              .map((_, anchor) => absoluteProfileUrl($(anchor).attr('href') ?? '', pageUrl))
              .get()
              .filter((url): url is string => Boolean(url)),
          ),
        ]
      : [];
    projects.push({
      year: yearMatch ? Number(yearMatch[1]) : null,
      filled: labelled(FILLED_LABEL).length > 0,
      sponsorProfileUrls,
    });
  });
  return { projectBlocks: blocks.length, projects };
}

export interface TobinRaAdviseeYear {
  year: number;
  programName: string;
  count: number;
}

export function filledProjectYearsBySponsor(
  projects: readonly TobinRaProject[],
): Map<string, TobinRaAdviseeYear[]> {
  const countsBySponsor = new Map<string, Map<number, number>>();
  for (const project of projects) {
    if (!project.filled || project.year === null) continue;
    for (const sponsorUrl of project.sponsorProfileUrls) {
      const byYear = countsBySponsor.get(sponsorUrl) ?? new Map<number, number>();
      byYear.set(project.year, (byYear.get(project.year) ?? 0) + 1);
      countsBySponsor.set(sponsorUrl, byYear);
    }
  }
  return new Map(
    [...countsBySponsor].map(([sponsorUrl, byYear]) => [
      sponsorUrl,
      [...byYear]
        .sort(([left], [right]) => right - left)
        .map(([year, count]) => ({ year, programName: TOBIN_RA_PROGRAM_NAME, count })),
    ]),
  );
}

export function mergeAdviseeYears(
  lists: ReadonlyArray<readonly TobinRaAdviseeYear[]>,
): TobinRaAdviseeYear[] {
  const byYear = new Map<number, number>();
  for (const list of lists) {
    for (const entry of list) byYear.set(entry.year, (byYear.get(entry.year) ?? 0) + entry.count);
  }
  return [...byYear]
    .sort(([left], [right]) => right - left)
    .map(([year, count]) => ({ year, programName: TOBIN_RA_PROGRAM_NAME, count }));
}
