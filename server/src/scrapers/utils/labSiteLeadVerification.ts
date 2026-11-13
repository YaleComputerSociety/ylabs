/**
 * Pure judging core for verifying an attached lead against the research home's own website.
 *
 * SAFETY: this lane only ever records a verdict; it never attaches, detaches, or
 * suppresses a lead. `CONTRADICTED` demands positive evidence on the site: a
 * namesake, somebody else stated as the row's lead, or this lead listed in a non-lead
 * role, so an omission is never read as a refutation (#2647). A page that simply does
 * not state who leads the lab resolves to `UNSTATED`.
 */

import {
  CANONICAL_FACULTY_RESEARCH_ENTITY_TYPE,
  isLegacyFacultyResearchEntityType,
  labSiteLeadMatchReasons,
  labSiteLeadVerdicts,
  labSiteVerificationStates,
  type LabSiteLeadContradictionShape,
  type LabSiteLeadMatchReason,
  type LabSiteLeadVerdict,
  type LabSiteVerificationState,
} from '../../models/storedVocabularies';
import { personNameAliases } from '../../utils/personNameHygiene';
import { givenNamesCouldBeOneTransliteration, givenNamesCouldNameOnePerson } from './piNameMatch';
import {
  rowLeadEvidence,
  statementCouldBeLead,
  statementNamesLead,
  type LabSitePage,
  type RowLeadEvidence,
} from './labSiteLeadStatements';

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
    .replace(/<script[\s\S]*?<\/script\b[^>]*>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style\b[^>]*>/gi, ' ')
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
  namedOnPage?: boolean;
  contradictedBy?: LabSiteLeadContradictionShape;
}

export interface LabSiteReading {
  website: string;
  visitedUrls: string[];
  html: string;
  httpStatusCode?: number;
  pages?: LabSitePage[];
}

/**
 * Role words a person-shaped slug can carry without naming a person, so a
 * `/people/principal-investigator` or `/people/lab-director` link is a nav label.
 */
const LEAD_ROLE_SLUG_WORDS = [
  'principal investigator',
  'lab director',
  'laboratory director',
  'faculty director',
  'executive director',
  'founding director',
  'led by',
  'lab head',
];

/** A slug carrying a section or role word is a nav label, never another person. */
const NON_NAME_SLUG_WORDS = new Set(
  [...NON_PERSON_SLUGS, ...LEAD_ROLE_SLUG_WORDS, 'manager'].flatMap((entry) => entry.split(/[- ]/)),
);

/** Two-letter surnames collide by chance among lab members, so they never read as a namesake. */
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
 * Whether a person the site links is a namesake of this lead: a same-surname person
 * with a different given name, the collision this lane exists to find. A members page
 * linking a student, a staff listing and a social handle all name somebody else
 * without saying that somebody else leads the lab, and reading them as a
 * contradiction made 32 of 47 hand-read decidable contradictions wrong (#3750).
 *
 * A person named next to a lead-role phrase no longer counts here: that 60-character
 * window could not tell which entity the phrase was about, so the row-anchored lead
 * statements in `labSiteLeadStatements.ts` replaced it (#5962).
 */
export function slugNamesAnotherLead(slug: string, leadDisplayName: unknown): boolean {
  return slugContradictionShape(slug, leadDisplayName) !== '';
}

function sharedTrailingTokenCount(left: readonly string[], right: readonly string[]): number {
  let count = 0;
  while (
    count < left.length &&
    count < right.length &&
    left[left.length - 1 - count] === right[right.length - 1 - count]
  ) {
    count += 1;
  }
  return count;
}

/**
 * Whether a namesake's given name could still be this lead's, which is what keeps a
 * nickname, an initial, a transliteration or a former name from reading as a different
 * person (#4916). Read on every name the lead's display name gives, so a former-name
 * annotation counts, and wider than `givenNamesCouldNameOnePerson` by a transliteration
 * fold, so `muhammad` and `mohammed` stay one name while `tom` and `tim` stay two.
 */
function namesakeGivenNameCouldBeTheLead(
  slugTokens: readonly string[],
  surname: string,
  leadDisplayName: unknown,
): boolean {
  return personNameAliases(String(leadDisplayName ?? '')).some((alias) => {
    const tokens = flattenForNameMatch(alias)
      .trim()
      .split(' ')
      .filter((token) => token && !CREDENTIAL_TOKENS.has(token));
    const sharedSurnameRun = sharedTrailingTokenCount(tokens, slugTokens);
    const isGivenName = (token: string) => token !== surname && !SURNAME_PARTICLES.has(token);
    const leadGiven = tokens.slice(0, -Math.max(1, sharedSurnameRun)).filter(isGivenName);
    const slugGiven = slugTokens.slice(0, slugTokens.length - sharedSurnameRun).filter(isGivenName);
    if (givenNamesCouldNameOnePerson(leadGiven.join(' '), slugGiven.join(' '))) return true;
    return leadGiven.some((left) =>
      slugGiven.some((right) => givenNamesCouldBeOneTransliteration(left, right)),
    );
  });
}

/**
 * `NAMESAKE` when a person the site links is a same-surname person whose given name
 * cannot be the lead's, or `''` when it is not.
 */
export function slugContradictionShape(
  slug: string,
  leadDisplayName: unknown,
): LabSiteLeadContradictionShape | '' {
  const tokens = personNameTokensFromSlug(slug);
  if (!tokens.length || slugNamesTheLead(tokens, leadDisplayName)) return '';
  const surname = surnameCore(personNameAliases(String(leadDisplayName ?? ''))[0] ?? '');
  if (surname.length >= MIN_NAMESAKE_SURNAME_LETTERS && tokens.includes(surname)) {
    return namesakeGivenNameCouldBeTheLead(tokens, surname, leadDisplayName) ? '' : 'NAMESAKE';
  }
  return '';
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

export const EMPTY_ROW_LEAD_EVIDENCE: RowLeadEvidence = {
  statements: [],
  nonLeadListings: [],
  leadTitledNames: [],
};

type PresenceConfirmation = Pick<LabSiteLeadJudgement, 'matchedBy' | 'evidenceUrl' | 'namedOnPage'>;

function presenceConfirmation(
  lead: LabSiteLeadCandidate,
  leadSlugs: readonly string[],
  reading: LabSiteReading,
  siteSlugs: Set<string>,
  haystack: string,
  contestedSurnames: ReadonlySet<string>,
): PresenceConfirmation | null {
  const linkedSlug = leadSlugs.find((slug) => siteSlugs.has(slug));
  const namedInVisibleText =
    siteNamesPerson(visiblePageText(reading.html), lead.displayName) ||
    siteNamesInitialAndSurname(reading.html, lead.displayName);
  const namedOnPageMark = namedInVisibleText ? { namedOnPage: true } : {};
  if (linkedSlug) {
    const evidenceUrl =
      lead.officialProfileUrls.find((url) => profileSlugFromUrl(url) === linkedSlug) || '';
    return { matchedBy: 'OFFICIAL_PROFILE_LINK', evidenceUrl, ...namedOnPageMark };
  }
  if (namedInVisibleText || siteNamesPerson(haystack, lead.displayName)) {
    return {
      matchedBy: 'NAMED_ON_PAGE',
      ...namedOnPageMark,
      evidenceUrl: reading.visitedUrls[0] || reading.website,
    };
  }
  // A surname the entity's own leads disagree over cannot be confirmed by a
  // surname, however the site spells it: that is the collision under audit.
  if (
    !contestedSurnames.has(surnameCore(lead.displayName)) &&
    surnameInSiteUrl(reading.website, lead.displayName)
  ) {
    return { matchedBy: 'SURNAME_IN_SITE_URL', evidenceUrl: reading.website };
  }
  return null;
}

interface RowEvidenceReading {
  namedAsRowLeadOn?: string;
  contradiction?: { shape: LabSiteLeadContradictionShape; evidenceUrl: string };
}

/**
 * What the row-anchored statements say about this lead. A statement naming the lead
 * wins over any other, so co-leads never contradict each other. A statement contradicts
 * only when it names a person who could not be this lead and is none of the row's own
 * attached leads, and only when the page shows the stated name is a person (a credential,
 * an honorific, or an email or person page with the surname). A lead the site already
 * names or links is overturned only by a sentence about the row or a title qualified by
 * the row's name, never by a bare card title, because card scoping misreads section
 * labels on real pages far more often than a sentence misreads its subject (#5962 flip
 * grading). A non-lead listing contradicts only a lead no statement names. A lead
 * the site lists under any lead word ("Scientific Director", "Co-founder") is never
 * contradicted, because the vocabulary that confirms is narrower than the one that
 * should stop an accusation.
 */
function readRowEvidenceFor(
  lead: LabSiteLeadCandidate,
  attachedLeads: readonly LabSiteLeadCandidate[],
  evidence: RowLeadEvidence,
  leadIsPresent: boolean,
): RowEvidenceReading {
  const naming = evidence.statements.find((statement) =>
    statementNamesLead(statement.personName, lead),
  );
  if (naming) return { namedAsRowLeadOn: naming.pageUrl };
  if (evidence.leadTitledNames.some((name) => statementNamesLead(name, lead))) return {};
  const outsider = evidence.statements.find(
    (statement) =>
      statement.personEvidenced &&
      (!leadIsPresent || statement.form !== 'CARD_TITLE') &&
      !statementCouldBeLead(statement.personName, lead) &&
      !attachedLeads.some((other) => statementNamesLead(statement.personName, other)),
  );
  if (outsider) {
    return { contradiction: { shape: 'NAMED_AS_LEAD', evidenceUrl: outsider.pageUrl } };
  }
  const listed = evidence.nonLeadListings.find((entry) =>
    statementNamesLead(entry.personName, lead),
  );
  if (listed) {
    return { contradiction: { shape: 'LISTED_IN_NON_LEAD_ROLE', evidenceUrl: listed.pageUrl } };
  }
  return {};
}

/**
 * Judge one lead against what the site says. `CONTRADICTED` needs positive evidence
 * about somebody else or about this lead's own non-lead role, so a thin, JS-rendered,
 * or director-less page yields `UNSTATED` and never accuses a correct attachment.
 *
 * A statement anchored to this row is stronger than presence, so it may overturn a
 * presence confirmation (#5962). The namesake check keeps its position and inputs,
 * running only when no presence arm confirms, so the set of `NAMESAKE` verdicts the
 * gate reads is unchanged by the row-anchored rules.
 */
export function judgeLeadAgainstSite(
  lead: LabSiteLeadCandidate,
  reading: LabSiteReading,
  siteSlugs: Set<string>,
  haystack: string,
  contestedSurnames: ReadonlySet<string> = new Set(),
  leadIsTheRecordSubject = false,
  rowEvidence: RowLeadEvidence = EMPTY_ROW_LEAD_EVIDENCE,
  attachedLeads: readonly LabSiteLeadCandidate[] = [lead],
): LabSiteLeadJudgement {
  const base = { personId: lead.personId, role: lead.role };
  const leadSlugs = lead.officialProfileUrls.map(profileSlugFromUrl).filter(Boolean);
  const presence = presenceConfirmation(
    lead,
    leadSlugs,
    reading,
    siteSlugs,
    haystack,
    contestedSurnames,
  );
  const rowReading = leadIsTheRecordSubject
    ? {}
    : readRowEvidenceFor(lead, attachedLeads, rowEvidence, presence !== null);
  const contradicted = (
    shape: LabSiteLeadContradictionShape,
    evidenceUrl: string,
  ): LabSiteLeadJudgement => ({
    ...base,
    verdict: 'CONTRADICTED',
    matchedBy: 'NONE',
    evidenceUrl,
    contradictedBy: shape,
  });
  if (presence) {
    if (rowReading.contradiction) {
      return contradicted(rowReading.contradiction.shape, rowReading.contradiction.evidenceUrl);
    }
    return { ...base, verdict: 'CONFIRMED', ...presence };
  }
  const namesake =
    !leadIsTheRecordSubject &&
    [...siteSlugs]
      .filter((slug) => !leadSlugs.includes(slug))
      .some((slug) => slugContradictionShape(slug, lead.displayName) === 'NAMESAKE');
  if (namesake) return contradicted('NAMESAKE', reading.visitedUrls[0] || reading.website);
  if (rowReading.namedAsRowLeadOn) {
    return {
      ...base,
      verdict: 'CONFIRMED',
      matchedBy: 'NAMED_AS_ROW_LEAD',
      evidenceUrl: rowReading.namedAsRowLeadOn,
    };
  }
  if (rowReading.contradiction) {
    return contradicted(rowReading.contradiction.shape, rowReading.contradiction.evidenceUrl);
  }
  return { ...base, verdict: 'UNSTATED', matchedBy: 'NONE', evidenceUrl: '' };
}

export interface LabSiteLeadVerification {
  state: LabSiteVerificationState;
  checkedUrl: string;
  requestedUrl?: string;
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

function normalizedUrl(url: string): string {
  try {
    return new URL(url).toString();
  } catch {
    return url;
  }
}

export function buildLabSiteLeadVerification(
  leads: readonly LabSiteLeadCandidate[],
  reading: LabSiteReading,
  observedAt: Date,
  entityType?: unknown,
  entityName?: unknown,
): LabSiteLeadVerification {
  const bounded = leads.slice(0, MAX_VERIFIED_LEADS_PER_ENTITY);
  const siteSlugs = personSlugsOnSite(reading.html);
  const haystack = siteHaystack(reading.html, reading.visitedUrls);
  const contestedSurnames = contestedSurnamesAmong(bounded);
  const leadIsTheRecordSubject = leadIsTheRecordSubjectFor(entityType);
  const rowEvidence =
    leadIsTheRecordSubject || !reading.pages?.length
      ? EMPTY_ROW_LEAD_EVIDENCE
      : rowLeadEvidence(reading.pages, entityName);
  const judgements = bounded.map((lead) =>
    judgeLeadAgainstSite(
      lead,
      reading,
      siteSlugs,
      haystack,
      contestedSurnames,
      leadIsTheRecordSubject,
      rowEvidence,
      bounded,
    ),
  );
  const checkedUrl = reading.visitedUrls[0] || reading.website;
  return {
    state: rollUpVerificationState(judgements),
    checkedUrl,
    ...(normalizedUrl(checkedUrl) !== normalizedUrl(reading.website)
      ? { requestedUrl: reading.website }
      : {}),
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

export interface LabSiteLeadVerdictRow {
  entityKey: string;
  personId: string;
  role: string;
  verdict: LabSiteLeadVerdict;
  matchedBy: LabSiteLeadMatchReason;
  contradictedBy?: LabSiteLeadContradictionShape;
  rowState: LabSiteVerificationState;
}

const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (values as readonly string[]).includes(value);

/**
 * One row per lead the lane judged on this entity. An unreachable or malformed
 * verification judged nobody, so it yields no row rather than a guessed verdict.
 */
export function perLeadVerdicts(entityKey: string, verification: unknown): LabSiteLeadVerdictRow[] {
  const record = verification as Partial<LabSiteLeadVerification> | null | undefined;
  if (!entityKey || !record || !isOneOf(labSiteVerificationStates, record.state)) return [];
  const rowState = record.state;
  const leads = Array.isArray(record.leads) ? record.leads : [];
  return leads.flatMap((lead) => {
    const personId = textValue(lead?.personId);
    if (!personId || !isOneOf(labSiteLeadVerdicts, lead.verdict)) return [];
    return [
      {
        entityKey,
        personId,
        role: textValue(lead.role),
        verdict: lead.verdict,
        matchedBy: isOneOf(labSiteLeadMatchReasons, lead.matchedBy) ? lead.matchedBy : 'NONE',
        ...(lead.contradictedBy ? { contradictedBy: lead.contradictedBy } : {}),
        rowState,
      },
    ];
  });
}
