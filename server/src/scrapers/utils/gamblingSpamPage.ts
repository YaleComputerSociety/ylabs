const GAMBLING_SITE_PHRASES: readonly RegExp[] = [
  /\bgacor\b/i,
  /\btogel\b/i,
  /\bjudi\b/i,
  /\bsitus\s+(?:resmi|slot|judi)\b/i,
  /\bslot\s+(?:online|gacor|deposit)\b/i,
  /\bminimal\s+(?:deposit|withdraw)\b/i,
  /\blink\s+(?:alternatif|resmi)\b/i,
  /\bbosku\b/i,
];

const MIN_DISTINCT_PHRASES = 2;

/**
 * Whether a fetched page is a gambling-site page rather than anything a research row could cite
 * (#6532). A personal research site whose domain lapsed and was taken over answers 200 with such
 * a page, so neither the page-text lane nor the link probe saw anything wrong.
 *
 * The phrases are the Indonesian-language gambling-site vocabulary those pages carry, and a page
 * needs two distinct ones, so research about gambling, which uses English terms such as casino,
 * betting or slot machines, is never matched. Measured on Development 2026-11-18: of 4,094 live
 * page-text observations, 4 pages matched, every one a gambling page with 3 to 5 phrases, and
 * every other page on those rows matched none.
 */
export function isGamblingSpamPage(text: string): boolean {
  let distinct = 0;
  for (const phrase of GAMBLING_SITE_PHRASES) {
    if (phrase.test(text)) distinct += 1;
    if (distinct >= MIN_DISTINCT_PHRASES) return true;
  }
  return false;
}
