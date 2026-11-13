export const SITE_CHROME_TITLE_LANE = 'official-profile-pi-backfill';
export const SITE_CHROME_TITLE_MIN_WORDS = 12;
export const SITE_CHROME_TITLE_MIN_SUBJECTS = 3;

export interface LaneTitleReading {
  observationId: string;
  subject: string;
  value: string;
  sourceUrl: string;
}

export interface SiteChromeTitleReading {
  host: string;
  value: string;
  words: number;
  subjects: number;
  observationIds: string[];
}

export const normalizedTitleReading = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const hostOf = (url: string): string => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
};

const wordCount = (value: string): number => value.split(' ').filter(Boolean).length;

/**
 * A site's own chrome (a navigation menu, a news teaser) reads the same on every profile
 * page it frames, while a real appointment that several people share is short. So a lane
 * title read verbatim on several subjects of one host, and longer than any shared
 * appointment, is that site's text rather than anyone's title (#6199, measured on
 * Development 2026-11-13: no real title on 3 or more subjects of a host exceeds 10 words).
 */
export function siteChromeTitleReadings(
  readings: readonly LaneTitleReading[],
): SiteChromeTitleReading[] {
  const groups = new Map<
    string,
    { host: string; value: string; subjects: Set<string>; observationIds: string[] }
  >();
  for (const reading of readings) {
    const value = normalizedTitleReading(reading.value);
    const host = hostOf(reading.sourceUrl);
    if (!value || !host || !reading.subject) continue;
    const key = `${host}\u0000${value}`;
    const group = groups.get(key) ?? { host, value, subjects: new Set(), observationIds: [] };
    group.subjects.add(reading.subject);
    group.observationIds.push(reading.observationId);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter(
      (group) =>
        group.subjects.size >= SITE_CHROME_TITLE_MIN_SUBJECTS &&
        wordCount(group.value) >= SITE_CHROME_TITLE_MIN_WORDS,
    )
    .map((group) => ({
      host: group.host,
      value: group.value,
      words: wordCount(group.value),
      subjects: group.subjects.size,
      observationIds: [...group.observationIds].sort(),
    }))
    .sort((left, right) => left.host.localeCompare(right.host) || right.words - left.words);
}
