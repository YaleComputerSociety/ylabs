/**
 * Pure judging core for verifying an attached lead against the research home's own website.
 *
 * SAFETY: this lane only ever records a verdict; it never attaches, detaches, or
 * suppresses a lead. `CONTRADICTED` demands positive person evidence for somebody
 * else on the same site, so an omission is never read as a refutation (#2647). A
 * page that simply does not state who leads the lab resolves to `UNSTATED`.
 */

import {
  CANONICAL_FACULTY_RESEARCH_ENTITY_TYPE,
  isLegacyFacultyResearchEntityType,
  labSiteLeadMatchReasons,
  labSiteLeadVerdicts,
  labSiteVerificationStates,
  type LabSiteLeadMatchReason,
  type LabSiteLeadVerdict,
  type LabSiteVerificationState,
} from '../../models/storedVocabularies';

export const LAB_SITE_LEAD_VERIFICATION_SOURCE = 'lab-site-lead-verification';

export {
  labSiteLeadMatchReasons,
  labSiteLeadVerdicts,
  labSiteVerificationStates,
  type LabSiteLeadMatchReason,
  type LabSiteLeadVerdict,
  type LabSiteVerificationState,
};

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

function givenInitialOnly(displayName: unknown): string {
  const raw = flattenForNameMatch(displayName).trim().split(' ').filter(Boolean);
  return raw.length >= 2 && raw[0].length === 1 && /[a-z]/.test(raw[0]) ? raw[0] : '';
}

/**
 * Strip markup so prose reads as prose, then keep the markup too: a members grid
 * often carries a name only in an `href` or an `aria-label`.
 */
export function siteHaystack(html: string, visitedUrls: readonly string[] = []): string {
  return ` ${flattenForNameMatch(`${pageText(html)} ${html} ${visitedUrls.join(' ')}`)} `;
}

/**
 * The page's visible words, flattened, without its markup or the visited URLs.
 * A slug's own href repeats the slug, so judging a slug against the haystack
 * would let the slug supply its own evidence.
 */
export function visiblePageText(html: string): string {
  return ` ${flattenForNameMatch(pageText(html))} `;
}

function pageText(html: string): string {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');
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
  if (given.length < 2 || surname.length < 2) return false;
  const shortSurname = surname.length < 3;
  const between = shortSurname ? '(?: [a-z]){0,2}' : '(?: [a-z0-9]{1,12}){0,3}';
  const forward = new RegExp(
    `(?:^| )${escapeForRegExp(given)}${between} ${escapeForRegExp(surname)}(?: |$)`,
  );
  if (forward.test(haystack)) return true;
  const reversed = new RegExp(
    `(?:^| )${escapeForRegExp(surname)} ${escapeForRegExp(given)}(?: |$)`,
  );
  if (reversed.test(haystack)) return true;
  return !shortSurname && given.length >= 3 && haystack.includes(`${given}${surname}`);
}

const escapeForRegExp = (token: string) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether the page names a lead whose given name is only an initial. The initial
 * must carry its period, read from the page text rather than the flattened
 * haystack, because a bare letter before a word is ordinary prose: `A. Young` is
 * a name and `a young investigator` is not.
 */
export function siteNamesInitialAndSurname(html: string, displayName: unknown): boolean {
  const initial = givenInitialOnly(displayName);
  const surname = surnameCore(displayName);
  if (!initial || surname.length < 4) return false;
  const text = pageText(html).normalize('NFKD').replace(/[̀-ͯ]/g, '');
  return new RegExp(
    `(?:^|[^a-z0-9])${initial}\\.\\s*${escapeForRegExp(surname)}(?![a-z0-9])`,
    'i',
  ).test(text);
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
 * The words a page uses to say who leads it. Deliberately not a bare
 * `director`: a department page names a director of undergraduate studies, a
 * medical director and a co-director of a core, and none of them leads the lab
 * the row is about.
 */
const LEAD_ROLE_PHRASES = [
  'principal investigator',
  'lab director',
  'laboratory director',
  'faculty director',
  'executive director',
  'founding director',
  'led by',
  'lab head',
];

const LEAD_ROLE_PHRASE = new RegExp(`(?:^| )(?:${LEAD_ROLE_PHRASES.join('|')})(?: |$)`);

/** A slug carrying a section or role word is a nav label, never another person. */
const NON_NAME_SLUG_WORDS = new Set(
  [...NON_PERSON_SLUGS, ...LEAD_ROLE_PHRASES, 'manager'].flatMap((entry) => entry.split(/[- ]/)),
);

const LEAD_ROLE_WINDOW_CHARS = 60;

/** Two-letter surnames collide by chance among lab members, so they need the lead-role arm. */
const MIN_NAMESAKE_SURNAME_LETTERS = 3;

export function personNameTokensFromSlug(slug: string): string[] {
  if (slug.includes('.')) return [];
  const tokens = slug
    .replace(/[0-9]+$/, '')
    .split(/[-_]+/)
    .filter(Boolean);
  if (tokens.length < 2 || tokens.some((token) => !/^[a-z]{2,}$/.test(token))) return [];
  if (tokens.some((token) => NON_NAME_SLUG_WORDS.has(token))) return [];
  return tokens;
}

function slugNamesTheLead(tokens: readonly string[], leadDisplayName: unknown): boolean {
  if (!tokens.includes(surnameCore(leadDisplayName))) return false;
  const given = givenNameCore(leadDisplayName);
  if (given) return tokens.includes(given);
  const initial = givenInitialOnly(leadDisplayName);
  const surname = surnameCore(leadDisplayName);
  return Boolean(initial) && tokens.some((token) => token !== surname && token.startsWith(initial));
}

/**
 * Whether a person the site links is positively another lead of this row, which
 * is what `CONTRADICTED` must mean. A members page linking a student, a staff
 * listing and a social handle all name somebody else without saying that
 * somebody else leads the lab, and reading them as a contradiction made 32 of 47
 * hand-read decidable contradictions wrong (#3750).
 *
 * Two shapes count. A namesake, because a same-surname person with a different
 * given name is the collision this lane exists to find. Or a person the page
 * itself names next to a lead-role phrase.
 */
export function slugNamesAnotherLead(
  slug: string,
  leadDisplayName: unknown,
  visibleText: string,
): boolean {
  const tokens = personNameTokensFromSlug(slug);
  if (!tokens.length || slugNamesTheLead(tokens, leadDisplayName)) return false;
  const surname = surnameCore(leadDisplayName);
  if (surname.length >= MIN_NAMESAKE_SURNAME_LETTERS && tokens.includes(surname)) return true;
  const first = escapeForRegExp(tokens[0]);
  const last = escapeForRegExp(tokens[tokens.length - 1]);
  const named = new RegExp(`(?:^| )${first}(?: [a-z0-9]{1,12}){0,3} ${last}(?= |$)`, 'g');
  for (const match of visibleText.matchAll(named)) {
    const start = Math.max(0, (match.index ?? 0) - LEAD_ROLE_WINDOW_CHARS);
    const end = (match.index ?? 0) + match[0].length + LEAD_ROLE_WINDOW_CHARS;
    if (LEAD_ROLE_PHRASE.test(visibleText.slice(start, end))) return true;
  }
  return false;
}

/**
 * A faculty research profile is about its lead, so the lead is right by
 * construction and a site naming other people says the row's website is not the
 * profile's own page. That is a website defect, and reading it as a lead
 * contradiction accused the subject of 17 of the 19 hand-read profile rows (#3750).
 */
export function leadIsTheRecordSubjectFor(entityType: unknown): boolean {
  return (
    entityType === CANONICAL_FACULTY_RESEARCH_ENTITY_TYPE ||
    isLegacyFacultyResearchEntityType(typeof entityType === 'string' ? entityType : undefined)
  );
}

/**
 * Judge one lead against what the site says. `CONTRADICTED` is returned only
 * when the site names somebody else as a lead, so a thin, JS-rendered, or
 * director-less page yields `UNSTATED` and never accuses a correct attachment.
 */
export function judgeLeadAgainstSite(
  lead: LabSiteLeadCandidate,
  reading: LabSiteReading,
  siteSlugs: Set<string>,
  haystack: string,
  contestedSurnames: ReadonlySet<string> = new Set(),
  leadIsTheRecordSubject = false,
): LabSiteLeadJudgement {
  const base = { personId: lead.personId, role: lead.role };
  const leadSlugs = lead.officialProfileUrls.map(profileSlugFromUrl).filter(Boolean);
  const linkedSlug = leadSlugs.find((slug) => siteSlugs.has(slug));
  if (linkedSlug) {
    const evidenceUrl =
      lead.officialProfileUrls.find((url) => profileSlugFromUrl(url) === linkedSlug) || '';
    return { ...base, verdict: 'CONFIRMED', matchedBy: 'OFFICIAL_PROFILE_LINK', evidenceUrl };
  }
  if (
    siteNamesPerson(haystack, lead.displayName) ||
    siteNamesInitialAndSurname(reading.html, lead.displayName)
  ) {
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
  const visibleText = leadIsTheRecordSubject ? '' : visiblePageText(reading.html);
  const namesSomebodyElse =
    !leadIsTheRecordSubject &&
    [...siteSlugs].some(
      (slug) =>
        !leadSlugs.includes(slug) && slugNamesAnotherLead(slug, lead.displayName, visibleText),
    );
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
  entityType?: unknown,
): LabSiteLeadVerification {
  const bounded = leads.slice(0, MAX_VERIFIED_LEADS_PER_ENTITY);
  const siteSlugs = personSlugsOnSite(reading.html);
  const haystack = siteHaystack(reading.html, reading.visitedUrls);
  const contestedSurnames = contestedSurnamesAmong(bounded);
  const leadIsTheRecordSubject = leadIsTheRecordSubjectFor(entityType);
  const judgements = bounded.map((lead) =>
    judgeLeadAgainstSite(
      lead,
      reading,
      siteSlugs,
      haystack,
      contestedSurnames,
      leadIsTheRecordSubject,
    ),
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
