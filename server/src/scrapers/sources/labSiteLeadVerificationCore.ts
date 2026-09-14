/**
 * Pure judging core for verifying an attached lead against the research home's own website.
 *
 * SAFETY: this lane only ever records a verdict; it never attaches, detaches, or
 * suppresses a lead. `CONTRADICTED` demands positive person evidence for somebody
 * else on the same site, so an omission is never read as a refutation (#2647). A
 * page that simply does not state who leads the lab resolves to `UNSTATED`.
 */

export const LAB_SITE_LEAD_VERIFICATION_SOURCE = 'lab-site-lead-verification';

export const labSiteLeadVerdicts = ['CONFIRMED', 'CONTRADICTED', 'UNSTATED'] as const;
export type LabSiteLeadVerdict = (typeof labSiteLeadVerdicts)[number];

export const labSiteLeadMatchReasons = [
  'OFFICIAL_PROFILE_LINK',
  'NAMED_ON_PAGE',
  'SURNAME_IN_SITE_URL',
  'NONE',
] as const;
export type LabSiteLeadMatchReason = (typeof labSiteLeadMatchReasons)[number];

export const labSiteVerificationStates = [
  'verified',
  'partial',
  'contradicted',
  'unstated',
  'unreachable',
] as const;
export type LabSiteVerificationState = (typeof labSiteVerificationStates)[number];

export const MAX_VERIFIED_LEADS_PER_ENTITY = 20;
export const MAX_PEOPLE_SUBPAGES = 6;

/**
 * Academic credentials and post-nominals. Dropped from a display name so
 * `Jane Roe, MD, PhD` and `Jane Roe` yield the same surname.
 */
const CREDENTIAL_TOKENS = new Set([
  'phd',
  'md',
  'ms',
  'msc',
  'mph',
  'mha',
  'dr',
  'mba',
  'dds',
  'dvm',
  'rn',
  'do',
  'jr',
  'sr',
  'ii',
  'iii',
  'iv',
  'esq',
  'edd',
  'jd',
  'scd',
  'mbbs',
  'msn',
  'aprn',
  'frcp',
  'facc',
  'faap',
  'mmsc',
  'bs',
  'ba',
  'bsc',
  'pa',
  'np',
]);

/**
 * Surname particles. A particle is never the matchable core of a surname, so
 * `van der Berg` keys on `berg` exactly as `Berg` does.
 */
const SURNAME_PARTICLES = new Set([
  'van',
  'von',
  'de',
  'del',
  'dela',
  'della',
  'di',
  'da',
  'das',
  'dos',
  'du',
  'der',
  'den',
  'la',
  'le',
  'lo',
  'el',
  'al',
  'bin',
  'ibn',
  'ter',
  'ten',
  'vander',
  'af',
  'av',
  'zu',
  'zur',
  'saint',
  'st',
]);

/**
 * Path words that mark a subpage as likely to carry people, and never a
 * publication list or a news archive (which name unrelated co-authors).
 */
const PEOPLE_SUBPAGE_WORDS =
  /(members|people|team|lab-?members|contact|about|who-we-are|personnel|staff|principal|investigator|director|faculty|group)/i;

/**
 * Path segments under which a slug names a person rather than a section. Kept
 * wider than the strict person-page reader in `personProfileEntityMatch` on
 * purpose: this looks for whom a site names, it does not gate a write.
 */
const PERSON_SLUG_PATH =
  /\/(?:profile|profiles|people|person|bio|faculty|members|member)\/([A-Za-z0-9._-]{3,60})/g;

/**
 * Slugs that a person-shaped path can carry without naming anybody. Without
 * this a `/people/faculty` listing link would count as evidence that the site
 * names some other person, which is exactly what turns an unstated page into a
 * false contradiction.
 */
const NON_PERSON_SLUGS = new Set([
  'faculty',
  'people',
  'staff',
  'directory',
  'index',
  'roster',
  'listing',
  'emeriti',
  'postdocs',
  'students',
  'alumni',
  'members',
  'member',
  'team',
  'our',
  'admin',
  'custom',
  'previous',
  'join-our-team',
  'lab-pets',
  'current',
  'former',
  'contact',
  'about',
  'search',
  'all',
  'home',
  'profile',
  'profiles',
  'graduate-students',
  'postdoctoral-fellows',
  'undergraduates',
  'affiliated',
  'fellows',
  'jr-faculty',
  'faculty-by-section',
  'faculty-mentoring-program',
]);

const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Fold to ASCII lower case and reduce EVERY run of non-alphanumerics to a single
 * space, so a name reads the same whether the site carries it as prose
 * (`Jane Roe`), an href slug (`jane_roe`), a host (`janeroelab.yale.edu`), or a
 * social handle (`janeroe.bsky.social`). Matching visible text alone with word
 * boundaries missed all four shapes and produced far more false contradictions
 * than real ones.
 */
export function flattenForNameMatch(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
}

export function personNameTokens(displayName: unknown): string[] {
  return flattenForNameMatch(displayName)
    .split(' ')
    .filter((token) => token.length >= 2 && !CREDENTIAL_TOKENS.has(token));
}

/** The matchable core of a surname: the last token after leading particles. */
export function surnameCore(displayName: unknown): string {
  const tokens = personNameTokens(displayName);
  if (!tokens.length) return '';
  let index = 0;
  while (index < tokens.length - 1 && SURNAME_PARTICLES.has(tokens[index])) index += 1;
  return tokens[tokens.length - 1] || '';
}

export function givenNameCore(displayName: unknown): string {
  const tokens = personNameTokens(displayName);
  return tokens.length >= 2 ? tokens[0] : '';
}

/**
 * Strip markup so prose reads as prose, then keep the markup too: a members grid
 * often carries a name only in an `href` or an `aria-label`.
 */
export function siteHaystack(html: string, visitedUrls: readonly string[] = []): string {
  const stripped = String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  return ` ${flattenForNameMatch(`${stripped} ${html} ${visitedUrls.join(' ')}`)} `;
}

/**
 * Whether the site names this person. Given and family name must sit within
 * three intervening tokens of each other, so a members page that happens to
 * list an unrelated person sharing only the surname never counts - that
 * coincidence is the whole failure mode this lane exists to catch. A
 * concatenated form is accepted because hosts and handles carry names that way.
 */
export function siteNamesPerson(haystack: string, displayName: unknown): boolean {
  const given = givenNameCore(displayName);
  const surname = surnameCore(displayName);
  if (given.length < 2 || surname.length < 3 || given === surname) return false;
  const escape = (token: string) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const forward = new RegExp(
    `(?:^| )${escape(given)}(?: [a-z0-9]{1,12}){0,3} ${escape(surname)}(?: |$)`,
  );
  if (forward.test(haystack)) return true;
  const reversed = new RegExp(`(?:^| )${escape(surname)} ${escape(given)}(?: |$)`);
  if (reversed.test(haystack)) return true;
  return haystack.includes(`${given}${surname}`);
}

/**
 * Whether the research home's own HOSTNAME carries this person's surname
 * (`roelab.yale.edu`, `roe-lab.org`). Deliberately the hostname only, never a
 * path segment: a dedicated domain is the lab asserting whose lab it is, but
 * `medicine.yale.edu/lab/roe/` is one slug on a multi-lab CMS and every namesake
 * matches it equally well. Treating a path segment as confirmation would make
 * this signal certify exactly the surname-only attachment `surnameOnlyMatch`
 * forbids, silently confirming the namesake collisions this lane exists to find.
 * Requires a surname long enough not to collide by chance.
 */
export function surnameInSiteUrl(website: unknown, displayName: unknown): boolean {
  const surname = surnameCore(displayName);
  if (surname.length < 4 || !givenNameCore(displayName)) return false;
  let hostname: string;
  try {
    hostname = new URL(textValue(website)).hostname;
  } catch {
    return false;
  }
  return flattenForNameMatch(hostname).includes(surname);
}

/** The last path segment of an official profile URL, which names the person. */
export function profileSlugFromUrl(value: unknown): string {
  const url = textValue(value);
  if (!url) return '';
  try {
    const segments = new URL(url).pathname.replace(/\/+$/, '').split('/');
    return (segments[segments.length - 1] || '').toLowerCase();
  } catch {
    return '';
  }
}

/** Person-naming slugs the site links, with section and listing slugs removed. */
export function personSlugsOnSite(html: string): Set<string> {
  const slugs = new Set<string>();
  for (const match of String(html ?? '').matchAll(PERSON_SLUG_PATH)) {
    const slug = match[1].toLowerCase().replace(/\.(?:html?|php|aspx)$/, '');
    if (!slug || NON_PERSON_SLUGS.has(slug)) continue;
    if (!/[a-z]/.test(slug)) continue;
    slugs.add(slug);
  }
  return slugs;
}

/**
 * Bounded same-subtree people pages to follow. Confined to the subtree rather
 * than the host, because a host-wide crawl on a shared CMS reaches other labs'
 * pages and would import their people as this lab's evidence.
 */
export function peopleSubpageUrls(
  html: string,
  baseUrl: string,
  limit = MAX_PEOPLE_SUBPAGES,
): string[] {
  let root: URL;
  try {
    root = new URL(baseUrl);
  } catch {
    return [];
  }
  const directory = root.pathname.replace(/\/[^/]*\.(?:aspx|html?|php)$/i, '/').replace(/\/+$/, '');
  const rootPath = root.pathname.replace(/\/+$/, '');
  const found = new Set<string>();
  for (const match of String(html ?? '').matchAll(/href="([^"#?]+)/g)) {
    let candidate: URL;
    try {
      candidate = new URL(match[1], root);
    } catch {
      continue;
    }
    if (candidate.hostname !== root.hostname) continue;
    if (candidate.protocol !== 'http:' && candidate.protocol !== 'https:') continue;
    const path = candidate.pathname.replace(/\/+$/, '');
    if (directory && !path.toLowerCase().startsWith(directory.toLowerCase())) continue;
    if (path === rootPath) continue;
    if (!PEOPLE_SUBPAGE_WORDS.test(path)) continue;
    found.add(`${candidate.origin}${candidate.pathname}`);
    if (found.size >= limit) break;
  }
  return [...found];
}

export interface LabSiteLeadCandidate {
  personId: string;
  role: string;
  displayName: string;
  officialProfileUrls: string[];
}

export interface LabSiteLeadJudgement {
  personId: string;
  role: string;
  verdict: LabSiteLeadVerdict;
  matchedBy: LabSiteLeadMatchReason;
  evidenceUrl: string;
}

export interface LabSiteReading {
  website: string;
  visitedUrls: string[];
  html: string;
  httpStatusCode?: number;
}

/**
 * Judge one lead against what the site says. `CONTRADICTED` is returned only
 * when the site names somebody else, so a thin, JS-rendered, or director-less
 * page yields `UNSTATED` and never accuses a correct attachment.
 */
export function judgeLeadAgainstSite(
  lead: LabSiteLeadCandidate,
  reading: LabSiteReading,
  siteSlugs: Set<string>,
  haystack: string,
  contestedSurnames: ReadonlySet<string> = new Set(),
): LabSiteLeadJudgement {
  const base = { personId: lead.personId, role: lead.role };
  const leadSlugs = lead.officialProfileUrls.map(profileSlugFromUrl).filter(Boolean);
  const linkedSlug = leadSlugs.find((slug) => siteSlugs.has(slug));
  if (linkedSlug) {
    const evidenceUrl =
      lead.officialProfileUrls.find((url) => profileSlugFromUrl(url) === linkedSlug) || '';
    return { ...base, verdict: 'CONFIRMED', matchedBy: 'OFFICIAL_PROFILE_LINK', evidenceUrl };
  }
  if (siteNamesPerson(haystack, lead.displayName)) {
    return {
      ...base,
      verdict: 'CONFIRMED',
      matchedBy: 'NAMED_ON_PAGE',
      evidenceUrl: reading.visitedUrls[0] || reading.website,
    };
  }
  // A surname the entity's own leads disagree over cannot be confirmed by a
  // surname, however the site spells it: that is the collision under audit.
  if (
    !contestedSurnames.has(surnameCore(lead.displayName)) &&
    surnameInSiteUrl(reading.website, lead.displayName)
  ) {
    return {
      ...base,
      verdict: 'CONFIRMED',
      matchedBy: 'SURNAME_IN_SITE_URL',
      evidenceUrl: reading.website,
    };
  }
  const namesSomebodyElse = [...siteSlugs].some((slug) => !leadSlugs.includes(slug));
  return {
    ...base,
    verdict: namesSomebodyElse ? 'CONTRADICTED' : 'UNSTATED',
    matchedBy: 'NONE',
    evidenceUrl: namesSomebodyElse ? reading.visitedUrls[0] || reading.website : '',
  };
}

export interface LabSiteLeadVerification {
  state: LabSiteVerificationState;
  checkedUrl: string;
  httpStatusCode?: number;
  pagesRead: number;
  confirmedCount: number;
  contradictedCount: number;
  unstatedCount: number;
  leads: LabSiteLeadJudgement[];
  observedAt: string;
}

/**
 * The entity-level roll-up. A single contradiction dominates: it is the finding
 * an operator has to act on, and averaging it away behind confirmed co-leads is
 * how a wrong lead stays invisible.
 */
export function rollUpVerificationState(
  judgements: readonly LabSiteLeadJudgement[],
): LabSiteVerificationState {
  if (judgements.some((judgement) => judgement.verdict === 'CONTRADICTED')) return 'contradicted';
  const confirmed = judgements.filter((judgement) => judgement.verdict === 'CONFIRMED').length;
  if (confirmed === 0) return 'unstated';
  return confirmed === judgements.length ? 'verified' : 'partial';
}

/**
 * Surnames that two or more of this entity's leads share while carrying different
 * given names. Exactly one of them can be right, so no surname-shaped signal may
 * confirm any of them.
 */
export function contestedSurnamesAmong(leads: readonly LabSiteLeadCandidate[]): Set<string> {
  const givenNamesBySurname = new Map<string, Set<string>>();
  for (const lead of leads) {
    const surname = surnameCore(lead.displayName);
    const given = givenNameCore(lead.displayName);
    if (!surname || !given) continue;
    givenNamesBySurname.set(
      surname,
      (givenNamesBySurname.get(surname) || new Set<string>()).add(given),
    );
  }
  const contested = new Set<string>();
  for (const [surname, givenNames] of givenNamesBySurname) {
    if (givenNames.size > 1) contested.add(surname);
  }
  return contested;
}

export function buildLabSiteLeadVerification(
  leads: readonly LabSiteLeadCandidate[],
  reading: LabSiteReading,
  observedAt: Date,
): LabSiteLeadVerification {
  const bounded = leads.slice(0, MAX_VERIFIED_LEADS_PER_ENTITY);
  const siteSlugs = personSlugsOnSite(reading.html);
  const haystack = siteHaystack(reading.html, reading.visitedUrls);
  const contestedSurnames = contestedSurnamesAmong(bounded);
  const judgements = bounded.map((lead) =>
    judgeLeadAgainstSite(lead, reading, siteSlugs, haystack, contestedSurnames),
  );
  return {
    state: rollUpVerificationState(judgements),
    checkedUrl: reading.website,
    ...(typeof reading.httpStatusCode === 'number'
      ? { httpStatusCode: reading.httpStatusCode }
      : {}),
    pagesRead: reading.visitedUrls.length,
    confirmedCount: judgements.filter((one) => one.verdict === 'CONFIRMED').length,
    contradictedCount: judgements.filter((one) => one.verdict === 'CONTRADICTED').length,
    unstatedCount: judgements.filter((one) => one.verdict === 'UNSTATED').length,
    leads: judgements,
    observedAt: observedAt.toISOString(),
  };
}

export function unreachableLabSiteVerification(
  website: string,
  observedAt: Date,
  httpStatusCode?: number,
): LabSiteLeadVerification {
  return {
    state: 'unreachable',
    checkedUrl: website,
    ...(typeof httpStatusCode === 'number' ? { httpStatusCode } : {}),
    pagesRead: 0,
    confirmedCount: 0,
    contradictedCount: 0,
    unstatedCount: 0,
    leads: [],
    observedAt: observedAt.toISOString(),
  };
}
