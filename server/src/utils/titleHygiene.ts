/**
 * Shared title hygiene for source-scraped person titles.
 *
 * A loose profile-page selector can lift a site navigation/menu or breadcrumb
 * container into a person's `title` field (issue #708: a Yale Quantum Institute
 * nav menu landed in a PI card's title). This guard fails closed: it rejects
 * navigation/menu/breadcrumb chrome so title extraction yields a real title or
 * nothing.
 *
 * Deliberately separate from `descriptionHygiene`: that module governs
 * student-facing prose descriptions; this one governs the short person `title`
 * field, which has a different chrome signature (concatenated menu link text,
 * breadcrumb trails) and a much tighter false-positive budget.
 */

export function normalizeTitleWhitespace(value: string | null | undefined): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

const NAV_MENU_PHRASES = [
  'about the institute',
  'about us',
  'mission & history',
  'mission and history',
  'community values',
  'our members',
  'our people',
  'our team',
  'annual report',
  'annual reports',
  'join the institute',
  'in the media',
  'location & contacts',
  'programs & events',
  'upcoming events',
  'artists-in-residence',
  'artist-in-residence',
  'colloquia and seminar',
  'seminar series',
  'news & events',
  'get involved',
  'contact us',
  'skip to content',
  'skip to main content',
  'toggle navigation',
  'main menu',
];

const navMenuPhrasePattern = new RegExp(
  NAV_MENU_PHRASES.map((phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'gi',
);

const breadcrumbSeparatorPattern = /[>»›•·]/g;

function concatenatedWordRunCount(value: string): number {
  return (value.match(/[a-z][A-Z]/g) || []).length;
}

/**
 * True when a candidate title looks like navigation, menu, or breadcrumb chrome
 * rather than a real job title.
 *
 * Signals (any one is sufficient):
 *  - concatenated link text: `.text()` on a menu container yields runs like
 *    "InstituteMission" with no separator; three or more lower-to-upper
 *    boundaries never occur in a genuine job title.
 *  - breadcrumb trails with two or more chained separators (> » › • ·).
 *  - two or more distinct navigation/menu phrases.
 */
export function isNavMenuChromeTitle(value: string | null | undefined): boolean {
  const text = normalizeTitleWhitespace(value);
  if (!text) return false;
  if (concatenatedWordRunCount(text) >= 3) return true;
  if ((text.match(breadcrumbSeparatorPattern) || []).length >= 2) return true;
  if ((text.match(navMenuPhrasePattern) || []).length >= 2) return true;
  return false;
}
