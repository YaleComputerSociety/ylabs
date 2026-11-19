/**
 * A default document is the directory it sits in, so `/lab/x/index.aspx` and `/lab/x/`
 * are one page. Shared by the website identity key and the field-value refusal key, so
 * the dedupe and a refusal cannot disagree about which spellings name one page (#3191).
 */
const DEFAULT_DOCUMENT_LEAF = /\/(?:index|default)\.(?:aspx?|html?|php|cfm)$/i;

export const DEFAULT_DOCUMENT_LEAVES = [
  'index.aspx',
  'index.asp',
  'index.html',
  'index.htm',
  'index.php',
  'index.cfm',
  'default.aspx',
  'default.asp',
  'default.html',
  'default.htm',
  'default.php',
  'default.cfm',
] as const;

export function foldDefaultDocumentLeaf(key: string): string {
  return key.replace(DEFAULT_DOCUMENT_LEAF, '');
}

/**
 * Normalizes a websiteUrl into a scheme-agnostic identity key: the same lab home
 * reached over `http://` and `https://`, with or without a trailing slash, a leading
 * `www.`, or a trailing default document, must collapse to one key so a URL-identity
 * lane clusters them. Query strings and fragments are dropped; an unparseable value
 * yields ''.
 */
export function normalizeWebsiteUrlIdentityKey(value: string | undefined): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return '';
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!host) return '';
  const pathname = foldDefaultDocumentLeaf(parsed.pathname.replace(/\/+$/, '')).replace(/\/+$/, '');
  return `${host}${pathname}`;
}

const WEBSITE_URL_IDENTITY_KEY_SCHEMES = ['https://', 'http://'];
const WEBSITE_URL_IDENTITY_KEY_HOST_PREFIXES = ['', 'www.'];
const WEBSITE_URL_IDENTITY_KEY_PATH_SUFFIXES = [
  '',
  '/',
  ...DEFAULT_DOCUMENT_LEAVES.map((leaf) => `/${leaf}`),
];

/**
 * Every stored `websiteUrl` spelling that `normalizeWebsiteUrlIdentityKey` folds into
 * `key`, so a caller can look the key up with an equality query rather than storing a
 * second normalized copy of the URL on the row (#3036).
 *
 * Changing `normalizeWebsiteUrlIdentityKey` requires changing this with it: they are an
 * encoder and its inverse, and the inverse only recovers what the encoder drops
 * reversibly - the scheme, a leading `www.`, a trailing slash, and a lower-case default
 * document. A URL carrying a query string or a fragment cannot be recovered, because the
 * encoder discards those without recording them; measured on Development, 7 of 1,763
 * live `websiteUrl` values are in that residue and none of them is a resolver target.
 */
export function websiteUrlIdentityKeyVariants(key: string): string[] {
  const trimmed = key.trim();
  if (!trimmed) return [];
  const variants: string[] = [];
  for (const scheme of WEBSITE_URL_IDENTITY_KEY_SCHEMES) {
    for (const hostPrefix of WEBSITE_URL_IDENTITY_KEY_HOST_PREFIXES) {
      for (const suffix of WEBSITE_URL_IDENTITY_KEY_PATH_SUFFIXES) {
        variants.push(`${scheme}${hostPrefix}${trimmed}${suffix}`);
      }
    }
  }
  return variants;
}

export interface RedirectLandingVerdict {
  url?: unknown;
  redirectLandingUrl?: unknown;
  checkedAt?: unknown;
}

const verdictTime = (value: unknown): number => {
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ''));
  return Number.isFinite(time) ? time : 0;
};

/**
 * Maps a URL's identity key to the identity key of the page its own host redirected it
 * to, read from stored link-health verdicts (`redirectLandingUrl`). This is the only
 * evidence a host or path alias is admitted on: a probe that followed the host's own
 * redirect and landed on a live page, the same proof the vanity-host repair and the
 * organization-graft retirement take live (#2758). Nothing is aliased by pattern.
 *
 * When verdicts disagree about one URL, the most recent probe wins, because a site can
 * move twice and only the newest landing describes it now.
 */
export function redirectLandingIdentityKeys(
  verdicts: Iterable<RedirectLandingVerdict>,
): Map<string, string> {
  const newest = new Map<string, { landing: string; at: number }>();
  for (const verdict of verdicts) {
    if (typeof verdict?.url !== 'string' || typeof verdict.redirectLandingUrl !== 'string') {
      continue;
    }
    const from = normalizeWebsiteUrlIdentityKey(verdict.url);
    const landing = normalizeWebsiteUrlIdentityKey(verdict.redirectLandingUrl);
    if (!from || !landing || from === landing) continue;
    const at = verdictTime(verdict.checkedAt);
    const held = newest.get(from);
    if (!held || at > held.at) newest.set(from, { landing, at });
  }
  return new Map([...newest].map(([from, { landing }]) => [from, landing]));
}

/**
 * The identity key a URL resolves to once a recorded redirect is followed. Landings are
 * final URLs after every hop, so one lookup is the whole chain.
 */
export function websiteUrlIdentityKeyThroughRedirect(
  value: string | undefined,
  landings: ReadonlyMap<string, string>,
): string {
  const key = normalizeWebsiteUrlIdentityKey(value);
  if (!key) return '';
  return landings.get(key) || key;
}
