import type * as cheerio from 'cheerio';
import { unwrapMicrosoftSafeLinksUrl } from '../../utils/safeLinksUrl';
import { parseProgramDate } from './programDeadline';
import type { YearOfStudy } from './fundYearOfStudy';

/**
 * The structured record a funding.yale.edu external-award page carries beside its prose
 * (#4363): an "Application or Website Link" field, an "Application Open/Deadline" window,
 * and an "Application Year" list. Every external-award page measured on 2026-10-02 (127 of
 * 127) carried all three, while the lane read none of them: the link was dropped because
 * its host is the outside program's own, the prose deadline reader took the window's
 * opening date, and the year list was never parsed.
 */
export interface ExternalAwardRecord {
  websiteUrls: string[];
  deadline?: Date;
  applicationOpenDate?: Date;
  yearsOfStudy: YearOfStudy[];
}

const WEBSITE_FIELD = '.field-name-field-application-website-lin';
const WINDOW_FIELD = '.field-name-field-application-deadline';
const YEAR_FIELD = '.field-name-field-application-year';

const APPLICATION_YEAR_VALUES: Record<string, YearOfStudy> = {
  'first-year': 'First-Year Student',
  sophomore: 'Sophomore',
  junior: 'Junior',
  senior: 'Senior',
};

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

function websiteUrls($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>, pageUrl: string): string[] {
  const urls: string[] = [];
  for (const anchor of root.find(`${WEBSITE_FIELD} .field-item a[href]`).toArray()) {
    let resolved: URL;
    try {
      resolved = new URL(
        unwrapMicrosoftSafeLinksUrl(new URL($(anchor).attr('href') || '', pageUrl).href),
      );
    } catch {
      continue;
    }
    if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') continue;
    if (!urls.includes(resolved.href)) urls.push(resolved.href);
  }
  return urls;
}

const RANGE_SEPARATOR = /\s+to\s+/i;

function windowEnds(window: cheerio.Cheerio<any>): { opens: string; closes: string } {
  const spanned = {
    opens: normalizeWhitespace(window.find('.date-display-start').first().text()),
    closes: normalizeWhitespace(window.find('.date-display-end').first().text()),
  };
  if (spanned.closes) return spanned;
  const parts = normalizeWhitespace(window.find('.field-item').first().text()).split(
    RANGE_SEPARATOR,
  );
  return parts.length === 2 ? { opens: parts[0], closes: parts[1] } : { opens: '', closes: '' };
}

/**
 * A window with one date does not say whether that date opens or closes it, and the
 * single dates measured are mostly the day the records were imported, so only a range
 * yields a deadline and an opening date; any other window leaves the page's prose to decide.
 */
function windowDates(
  window: cheerio.Cheerio<any>,
  referenceDate: Date,
): Pick<ExternalAwardRecord, 'deadline' | 'applicationOpenDate'> {
  const { opens, closes } = windowEnds(window);
  const deadline = closes ? parseProgramDate(closes, 'deadline', referenceDate) : undefined;
  if (!deadline) return {};
  return {
    deadline,
    applicationOpenDate: opens ? parseProgramDate(opens, 'opens', referenceDate) : undefined,
  };
}

/**
 * Only a list of undergraduate years is read. The office's one graduate option,
 * "Graduate Student and Alumni", sits beside "Senior" on postgraduate awards a senior
 * applies to and beside every year on awards open to anyone, so a list carrying it says
 * nothing a reader can map; measured on 2026-10-02, reading it put undergraduate years on
 * postdoctoral and graduate research fellowships. Any option outside the list makes the
 * whole list unreadable rather than partly read, so a new option never narrows a
 * program's stated audience.
 */
function yearsOfStudy($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>): YearOfStudy[] {
  const years: YearOfStudy[] = [];
  for (const item of root.find(`${YEAR_FIELD} .field-item`).toArray()) {
    const year = APPLICATION_YEAR_VALUES[normalizeWhitespace($(item).text()).toLowerCase()];
    if (!year) return [];
    if (!years.includes(year)) years.push(year);
  }
  return years;
}

export function withoutRecordWindow(root: cheerio.Cheerio<any>): cheerio.Cheerio<any> {
  const copy = root.clone();
  copy.find(WINDOW_FIELD).remove();
  return copy;
}

export function externalAwardRecord(
  $: cheerio.CheerioAPI,
  root: cheerio.Cheerio<any>,
  pageUrl: string,
  referenceDate: Date,
): ExternalAwardRecord {
  const window = root.find(WINDOW_FIELD).first();
  return {
    websiteUrls: websiteUrls($, root, pageUrl),
    ...windowDates(window, referenceDate),
    yearsOfStudy: yearsOfStudy($, root),
  };
}
