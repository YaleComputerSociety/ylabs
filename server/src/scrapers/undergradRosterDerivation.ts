import * as cheerio from 'cheerio';
import { ResearchEntity } from '../models/researchEntity';
import {
  detectOfficialRosterTemplate,
  type OfficialRosterTemplate,
  extractOfficialResearchHomeRoster,
  listedPersonLines,
  listedPersonNames,
  SCHOOL_KNOWN_BY_ONE_NAME,
  undergraduateSectionCandidates,
  type DerivedRosterOutcome,
  type DerivedRosterRequest,
  type DerivedRosterRun,
  type ExtractedOfficialRoster,
  type ListedPersonLine,
  type OfficialRosterConfig,
  type OfficialRosterUndergraduate,
} from './sources/officialResearchHomeRosterScraper';
import { OWNER_DENIED_ROSTER_KEY_DIGESTS } from './officialRosterConfigs';
import { deniedRosterKeyDigest } from './rosterStrikeDigests';
import { rosterSnippetNamesAnUndergraduate } from './undergradQuoteRelevance';

export interface UndergradRosterProposal {
  id: number;
  researchEntityKey: string;
  config: OfficialRosterConfig;
  current: OfficialRosterUndergraduate[];
  past: OfficialRosterUndergraduate[];
  otherCurrentMembers: number;
  undergraduateWithheldCount: number;
  rosterState: string;
  /** The page is the row person's own by first and last name and is a Yale page (#5433). */
  listsRowPerson: boolean;
}

export type UndergradRosterProposalOutcome =
  | {
      kind: 'proposed';
      proposal: Omit<UndergradRosterProposal, 'id'>;
      roster: ExtractedOfficialRoster;
    }
  | { kind: 'no-undergraduate-section' }
  | { kind: 'page-of-another-lab' }
  | { kind: 'page-of-another-institution' }
  | { kind: 'no-listed-undergraduate'; rosterState: string };

const NOT_A_ROSTER_LABEL =
  /\b(?:opportunit\w*|join\w*|prospective|apply\w*|interested|openings?|positions?|how to|publications?|papers|teaching|courses?|news|events?|seminars?|talks|press)\b/i;
const PLURAL_ROSTER_LABEL =
  /\b(?:people|students|researchers|assistants|associates|undergrads|undergraduates|members|scholars|interns|team|alumni|alumnae)\b/i;

/**
 * Any section of people may hold an undergraduate who says so on their own line, so the
 * heading only has to be short and not one that names something other than a roster.
 */
const isOwnLineSectionLabel = (label: string): boolean =>
  label.length <= 80 && !NOT_A_ROSTER_LABEL.test(label);

export function isProposableSectionLabel(label: string, template: string): boolean {
  if (label.length > 80 || NOT_A_ROSTER_LABEL.test(label)) return false;
  return template !== 'heading-list' || PLURAL_ROSTER_LABEL.test(label);
}

const isUndergraduateProgramPage = (url: string): boolean => {
  try {
    return /undergrad/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
};

const PERSON_KEY_PREFIX =
  /^(?:ysm-faculty|yse-faculty|bbs|dept-[a-z]+(?:-[a-z]+)*?|faculty-research-area|nih-pi)-(?=[a-z])/;

const lettersOnly = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

const keyNameTokens = (researchEntityKey: string): string[] =>
  PERSON_KEY_PREFIX.test(researchEntityKey)
    ? researchEntityKey
        .replace(PERSON_KEY_PREFIX, '')
        .split('-')
        .map(lettersOnly)
        .filter((token) => token.length >= 2)
    : [];

const ownerIsKeyPerson = (owner: string, nameTokens: string[]): boolean =>
  nameTokens.some((token) => (token.length <= 3 ? owner === token : owner.includes(token)));

const SURNAME_PARTICLE = /^(?:van|von|de|der|den|del|della|di|da|du|le|la|ter|ten|st|dos|das)+$/;

/**
 * A compound surname is one token in a key ("vandijk") and only its last word in a title
 * ("van Dijk Lab" names "dijk"), so the title's owner may also be the key token less its
 * particle.
 */
const labOwnerIsKeyPerson = (owner: string, nameTokens: string[]): boolean =>
  ownerIsKeyPerson(owner, nameTokens) ||
  nameTokens.some(
    (token) =>
      owner.length >= 4 &&
      token.endsWith(owner) &&
      SURNAME_PARTICLE.test(token.slice(0, -owner.length)),
  );

const pageText = ($: cheerio.CheerioAPI): string => {
  $('script, style, noscript').remove();
  return $('body').text().replace(/\s+/g, ' ');
};

/**
 * The lab a page names itself after: a single capitalized word before "Lab" or "Group" in
 * its title or first heading, or the name its host is built on (ishizukalab.org). It counts
 * only when the page also lists a person by that name, so "The Uplift Lab" names no one.
 */
function namedLabOwners($: cheerio.CheerioAPI, url: string, listedNames: string[]): string[] {
  const people = listedNames.map((name) => name.split(/\s+/));
  const surnames = new Set(people.map((tokens) => lettersOnly(tokens[tokens.length - 1])));
  const fullNames = new Set(people.map((tokens) => lettersOnly(tokens.join(''))));
  const owners: string[] = [];
  const titles = `${$('title').first().text()} | ${$('h1').first().text()}`;
  for (const match of titles.matchAll(
    /\b(\p{Lu}\p{Ll}[\p{L}'’-]*)\s+(?:Lab|Laboratory|Group)\b/gu,
  )) {
    const owner = lettersOnly(match[1]);
    if (owner && surnames.has(owner)) owners.push(owner);
  }
  try {
    const parsed = new URL(url);
    const hostOwner = /^(?:www\.)?([a-z-]+?)-?(?:lab|labs|group)(?:-yale)?\./.exec(
      parsed.hostname,
    )?.[1];
    const pathOwner = /\/lab\/([a-z-]+)\//.exec(parsed.pathname)?.[1];
    for (const candidate of [hostOwner, pathOwner]) {
      const owner = lettersOnly(candidate ?? '');
      if (owner && (surnames.has(owner) || fullNames.has(owner))) owners.push(owner);
    }
  } catch {
    return owners;
  }
  return owners;
}

const OTHER_UNIVERSITY =
  /\b(?:University of (?:the )?\p{Lu}[\p{L}-]*|\p{Lu}[\p{L}-]*\s+University|UPenn)\b/gu;

const isOnYaleHost = (url: string, unparsedIsYale = true): boolean => {
  try {
    return /(?:^|\.)yale\.edu$/i.test(new URL(url).hostname);
  } catch {
    return unparsedIsYale;
  }
};

/**
 * A site builder repeats the site's name in its header, so "The Fixture Lab | Yale" there
 * is the site naming itself, not the page placing its people at Yale.
 */
function withoutSiteTitle($: cheerio.CheerioAPI, text: string): string {
  const title = $('title').first().text().replace(/\s+/g, ' ').trim();
  const siteName = title.replace(/\s+[-\u2013\u2014|]\s+[^-\u2013\u2014|]*$/, '');
  return [title, siteName]
    .filter((name) => name.length >= 6)
    .reduce((remaining, name) => remaining.split(name).join(' '), text);
}

const namesAnotherUniversity = (line: string): boolean =>
  SCHOOL_KNOWN_BY_ONE_NAME.test(line) ||
  [...line.matchAll(OTHER_UNIVERSITY)].some((match) => !/\bYale\b/.test(match[0]));

/**
 * A page off Yale's hosts that never names Yale is another university's lab page (the PI's
 * lab before or besides Yale) when it keeps naming one other university, or when an
 * undergraduate it lists is placed at one, so its students are that university's students.
 */
function isAnotherInstitutionsPage(url: string, text: string, lines: ListedPersonLine[]): boolean {
  if (isOnYaleHost(url) || /\bYale\b/i.test(text)) return false;
  const counts = new Map<string, number>();
  for (const match of text.matchAll(OTHER_UNIVERSITY)) {
    counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
  }
  return (
    [...counts.values()].some((count) => count >= 3) ||
    lines.some((line) => line.role === 'undergrad' && namesAnotherUniversity(line.ownLine))
  );
}

const NOT_THE_LEAD_BUT_THEIR_STAFF = String.raw`(?!['’]s\b|\s+(?:assistant|coordinator|manager|administrator)s?\b)`;
const LEADS_THE_LAB = new RegExp(
  String.raw`\b(?:principal investigators?|lab(?:oratory)? (?:directors?|heads?)|group (?:leaders?|heads?)|faculty directors?)\b${NOT_THE_LEAD_BUT_THEIR_STAFF}`,
  'i',
);
const LEADS_THE_LAB_ABBREVIATED = new RegExp(
  String.raw`\b(?:Co-?)?PIs?\b${NOT_THE_LEAD_BUT_THEIR_STAFF}`,
);

const leadsTheLab = (line: ListedPersonLine): boolean =>
  [line.ownLine, line.sectionLabel].some(
    (text) => LEADS_THE_LAB.test(text) || LEADS_THE_LAB_ABBREVIATED.test(text),
  );

/**
 * Whether the page is some other lab's page: the key names a person, and the page is named
 * after someone listed on it who is not that person, or it names a lab head and never lists
 * that person at all, or it belongs to another institution.
 */
export function pageOwnershipRefusal(
  html: string,
  researchEntityKey: string,
  url: string,
): 'page-of-another-lab' | 'page-of-another-institution' | undefined {
  const $ = cheerio.load(html);
  const text = withoutSiteTitle($, pageText($));
  const template = detectOfficialRosterTemplate(html);
  const lines = listedPersonLines(html, template);
  if (isAnotherInstitutionsPage(url, text, lines)) return 'page-of-another-institution';
  const nameTokens = keyNameTokens(researchEntityKey);
  if (nameTokens.length === 0) return undefined;
  const isKeyPerson = (name: string): boolean =>
    name
      .split(/[\s-]+/)
      .map(lettersOnly)
      .some((word) => word.length >= 2 && ownerIsKeyPerson(word, nameTokens));
  if (lines.some(leadsTheLab) && !lines.some((line) => isKeyPerson(line.name))) {
    return 'page-of-another-lab';
  }
  const owners = namedLabOwners($, url, listedPersonNames(html, template));
  return owners.length > 0 && !owners.some((owner) => labOwnerIsKeyPerson(owner, nameTokens))
    ? 'page-of-another-lab'
    : undefined;
}

/**
 * Whether the page is the own Yale page of the person a person-keyed row is named after:
 * their first and last name on one listed line, or both in the page's title or first
 * heading, which a shared first name alone never satisfies, and Yale's host or Yale named
 * on that same line or title, since the page of a lab the person led elsewhere names them
 * too.
 */
function pageIsRowPersonsYalePage(
  html: string,
  template: OfficialRosterTemplate,
  researchEntityKey: string,
  url: string,
): boolean {
  const tokens = keyNameTokens(researchEntityKey);
  if (tokens.length < 2) return false;
  const [first, last] = [tokens[0], tokens[tokens.length - 1]];
  const namesBoth = (words: string[]): boolean =>
    words.some((w) => ownerIsKeyPerson(w, [first])) &&
    words.some((w) => ownerIsKeyPerson(w, [last]));
  const words = (text: string): string[] =>
    text
      .split(/[\s-]+/)
      .map(lettersOnly)
      .filter(Boolean);
  const onYaleHost = isOnYaleHost(url, false);
  const placesAtYale = (text: string): boolean => onYaleHost || /\bYale\b/.test(text);
  const $ = cheerio.load(html);
  const title = `${$('title').first().text()} ${$('h1').first().text()}`;
  if (namesBoth(words(title)) && placesAtYale(title)) return true;
  return listedPersonLines(html, template).some(
    (line) => namesBoth(words(line.name)) && placesAtYale(line.ownLine),
  );
}

export function proposeUndergradRosterConfig(
  html: string,
  researchEntityKey: string,
  url: string,
  observedAt: Date,
): UndergradRosterProposalOutcome {
  if (isUndergraduateProgramPage(url)) return { kind: 'no-undergraduate-section' };
  const ownershipRefusal = pageOwnershipRefusal(html, researchEntityKey, url);
  if (ownershipRefusal) return { kind: ownershipRefusal };
  const template = detectOfficialRosterTemplate(html);
  const allCandidates = undergraduateSectionCandidates(html, template);
  const sectionCandidates = allCandidates.filter(
    (candidate) =>
      candidate.label &&
      candidate.undergraduateEntries > 0 &&
      isProposableSectionLabel(candidate.label, template),
  );
  const undergraduatesByOwnLine = sectionCandidates.length === 0;
  const candidates = undergraduatesByOwnLine
    ? allCandidates.filter(
        (candidate) =>
          candidate.undergraduateEntriesByOwnLine > 0 && isOwnLineSectionLabel(candidate.label),
      )
    : sectionCandidates;
  if (candidates.length === 0) return { kind: 'no-undergraduate-section' };
  const config: OfficialRosterConfig = {
    researchEntityKey,
    url,
    template,
    ...(template === 'profile-grid' ? { currency: 'section-label' as const } : {}),
    currentSectionLabels: candidates.filter((c) => !c.past).map((c) => c.label),
    pastSectionLabels: candidates.filter((c) => c.past).map((c) => c.label),
    ...(undergraduatesByOwnLine ? { undergraduatesByOwnLine: true } : {}),
  };
  const roster = extractOfficialResearchHomeRoster(html, config, observedAt);
  const current = roster.undergraduates.filter((member) => member.status === 'current');
  const past = roster.undergraduates.filter((member) => member.status === 'past');
  if (current.length + past.length === 0) {
    return { kind: 'no-listed-undergraduate', rosterState: roster.state };
  }
  return {
    kind: 'proposed',
    roster,
    proposal: {
      researchEntityKey,
      config,
      current,
      past,
      otherCurrentMembers: roster.members.filter((member) => member.role !== 'undergrad').length,
      undergraduateWithheldCount: roster.undergraduateWithheldCount,
      rosterState: roster.state,
      listsRowPerson: pageIsRowPersonsYalePage(html, template, researchEntityKey, url),
    },
  };
}

const PEOPLE_PAGE_LEAF =
  /(?:^|[-_])(?:people|team|members|personnel|group|lab-members|our-lab|who-we-are)(?:[-_]\d+)?$/i;
const ALUMNI_PAGE_LEAF =
  /(?:^|[-_])(?:alumni|alumnae|former|past-members|previous-members)(?:[-_]\d+)?$/i;

const hostWithoutWww = (url: URL): string => url.hostname.toLowerCase().replace(/^www\./, '');

const sectionRoot = (url: URL): string => {
  const path = url.pathname.replace(/\/+$/, '');
  return path.includes('.') ? path.slice(0, path.lastIndexOf('/')) : path;
};

export interface LabSitePageLinks {
  peoplePages: string[];
  alumniPages: string[];
}

/**
 * The people and alumni pages a lab site links to, kept inside the lab's own section of
 * its host: on a shared host such as medicine.yale.edu a sibling path is another lab or
 * the department's roster, never this lab's.
 */
export function labSitePageLinks(html: string, siteUrl: string): LabSitePageLinks {
  let site: URL;
  try {
    site = new URL(siteUrl);
  } catch {
    return { peoplePages: [], alumniPages: [] };
  }
  const root = sectionRoot(site);
  const peoplePages = new Set<string>();
  const alumniPages = new Set<string>();
  const hrefs = Array.from(html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["']/gi), (m) => m[1]);
  for (const href of hrefs) {
    let link: URL;
    try {
      link = new URL(href, site);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(link.protocol) || hostWithoutWww(link) !== hostWithoutWww(site)) continue;
    const path = link.pathname.replace(/\/+$/, '');
    if (root && path !== root && !path.startsWith(`${root}/`)) continue;
    const leaf = path.slice(path.lastIndexOf('/') + 1);
    link.hash = '';
    link.search = '';
    if (ALUMNI_PAGE_LEAF.test(leaf)) alumniPages.add(link.toString());
    else if (PEOPLE_PAGE_LEAF.test(leaf)) peoplePages.add(link.toString());
  }
  return { peoplePages: [...peoplePages].slice(0, 3), alumniPages: [...alumniPages].slice(0, 2) };
}

export const DERIVED_ROSTER_MAX_UNDERGRADUATES = 60;
export const DERIVED_ROSTER_MAX_PAGES = 4;

export type DerivedRosterWithheldReason =
  | 'no-website'
  | 'page-not-this-row'
  | 'combined-section-label'
  | 'name-not-an-undergraduate'
  | 'too-many-names'
  | 'owner-denied';

const sameSiteHost = (url: URL): string => url.hostname.toLowerCase().replace(/^www\./, '');

/**
 * A derived roster is read only from the row's own site: the same host, and under the
 * row's section of it, so on a shared host such as medicine.yale.edu a sibling lab's
 * people page never lists this row's undergraduates.
 */
export function derivedRosterPageBelongsToRow(pageUrl: string, websiteUrl: string): boolean {
  let page: URL;
  let site: URL;
  try {
    page = new URL(pageUrl);
    site = new URL(websiteUrl);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(page.protocol) || sameSiteHost(page) !== sameSiteHost(site)) return false;
  const root = sectionRoot(site);
  const path = page.pathname.replace(/\/+$/, '');
  return !root || path === root || path.startsWith(`${root}/`);
}

const GRADUATE_LEVEL_LABEL =
  /\b(?:graduate|grad|ph\.?\s?d\.?s?|doctoral|masters?|master['’]s|post-?docs?|postdoctoral|post-?bacs?|rotation|rotating|medical)\b/i;

export function sectionLabelCombinesGraduateLevels(label: string): boolean {
  return GRADUATE_LEVEL_LABEL.test(label.replace(/\bundergrad(?:uate)?s?\b/gi, ' '));
}

const NOT_A_YALE_UNDERGRADUATE_GROUP_LABEL =
  /\b(?:post-?grads?|postgraduates?|high school|visiting|programs?|other (?:universities|colleges|schools|institutions))\b/i;

/**
 * A label that also names people who are not Yale undergraduates ("Postgrads, Yale
 * Undergrads, High School"). It is publishable only where the extractor read every listed
 * undergraduate from a named sub-group of it; otherwise the list would be a guess.
 */
const namesAGroupOtherThanYaleUndergraduates = (label: string): boolean =>
  NOT_A_YALE_UNDERGRADUATE_GROUP_LABEL.test(label);

export function sectionLabelMixesOtherGroups(label: string): boolean {
  return sectionLabelCombinesGraduateLevels(label) || namesAGroupOtherThanYaleUndergraduates(label);
}

/**
 * More current undergraduates than one lab hosts means the page is not one lab's roster. An
 * alumni list grows with every year the lab has run, so its length says nothing of the kind.
 */
const currentUndergraduateCount = (roster: ExtractedOfficialRoster): number =>
  roster.undergraduates.filter((member) => member.status === 'current').length;

export function derivedRosterWithheldReason(
  config: OfficialRosterConfig,
  roster: ExtractedOfficialRoster,
  websiteUrl: string,
  pageListsRowPerson = false,
): DerivedRosterWithheldReason | null {
  if (!websiteUrl) {
    if (!pageListsRowPerson) return 'no-website';
  } else if (!derivedRosterPageBelongsToRow(config.url, websiteUrl)) {
    return 'page-not-this-row';
  }
  const labels = [...config.currentSectionLabels, ...(config.pastSectionLabels ?? [])];
  const separated = new Set(roster.subgroupedSectionLabels ?? []);
  const mixesOtherGroups = config.undergraduatesByOwnLine
    ? namesAGroupOtherThanYaleUndergraduates
    : sectionLabelMixesOtherGroups;
  if (labels.some((label) => !separated.has(label) && mixesOtherGroups(label))) {
    return 'combined-section-label';
  }
  if (currentUndergraduateCount(roster) > DERIVED_ROSTER_MAX_UNDERGRADUATES)
    return 'too-many-names';
  if (roster.undergraduates.some((member) => !rosterSnippetNamesAnUndergraduate(member.name))) {
    return 'name-not-an-undergraduate';
  }
  return null;
}

export interface DerivedRosterCandidate {
  researchEntityKey: string;
  websiteUrl: string;
  citedUrls: string[];
  hasDerivedRoster: boolean;
}

const httpUrl = (value: unknown): string => {
  const text = String(value || '').trim();
  try {
    return /^https?:$/.test(new URL(text).protocol) ? text : '';
  } catch {
    return '';
  }
};

const undergraduateCount = (roster: ExtractedOfficialRoster): number =>
  roster.undergraduates.length;

/**
 * Reads the pages the row's undergraduate evidence cites, then the people pages its own site
 * links to, and keeps the largest roster that passes every publish check. When none passes,
 * the largest refused one names the reason.
 */
export async function deriveUndergradRosterForCandidate(
  candidate: DerivedRosterCandidate,
  readPage: (url: string) => Promise<string>,
  observedAt: Date,
): Promise<DerivedRosterOutcome> {
  const key = candidate.researchEntityKey;
  const pages = [...new Set([...candidate.citedUrls, candidate.websiteUrl].filter(Boolean))];
  let passed: { config: OfficialRosterConfig; roster: ExtractedOfficialRoster } | undefined;
  let refused: { reason: DerivedRosterWithheldReason; url: string; size: number } | undefined;
  let lastOutcome = 'no-page';
  let readAnyPage = false;
  for (let index = 0; index < pages.length && index < DERIVED_ROSTER_MAX_PAGES; index += 1) {
    const url = pages[index];
    let html: string;
    try {
      html = await readPage(url);
    } catch {
      if (!readAnyPage) lastOutcome = 'fetch-failed';
      continue;
    }
    readAnyPage = true;
    if (url === candidate.websiteUrl) {
      const links = labSitePageLinks(html, url);
      pages.push(...links.peoplePages.filter((link) => !pages.includes(link)));
    }
    const outcome = proposeUndergradRosterConfig(html, key, url, observedAt);
    if (outcome.kind !== 'proposed') {
      lastOutcome = outcome.kind;
      continue;
    }
    const size = undergraduateCount(outcome.roster);
    const reason = derivedRosterWithheldReason(
      outcome.proposal.config,
      outcome.roster,
      candidate.websiteUrl,
      outcome.proposal.listsRowPerson,
    );
    if (reason) {
      if (!refused || size > refused.size) refused = { reason, url, size };
      continue;
    }
    if (!passed || size > undergraduateCount(passed.roster)) {
      passed = { config: outcome.proposal.config, roster: outcome.roster };
    }
  }
  if (passed) return { kind: 'derived', researchEntityKey: key, ...passed };
  if (refused) {
    return {
      kind: 'withheld',
      researchEntityKey: key,
      sourceUrl: refused.url,
      reason: refused.reason,
    };
  }
  if (candidate.hasDerivedRoster && lastOutcome === 'fetch-failed') {
    return {
      kind: 'failed',
      researchEntityKey: key,
      sourceUrl: candidate.citedUrls[0] || candidate.websiteUrl,
    };
  }
  if (candidate.hasDerivedRoster) {
    return {
      kind: 'withheld',
      researchEntityKey: key,
      sourceUrl: candidate.citedUrls[0] || candidate.websiteUrl,
      reason: lastOutcome,
    };
  }
  return { kind: 'not-found', researchEntityKey: key, reason: lastOutcome };
}

export async function loadDerivedRosterCandidates(): Promise<DerivedRosterCandidate[]> {
  const rows = await ResearchEntity.find({
    archived: { $ne: true },
    $or: [
      { websiteUrl: { $regex: /^https?:\/\//i } },
      { hasUndergradHostingEvidence: true },
      { 'rosterEnrichment.configOrigin': 'derived' },
    ],
  })
    .select(
      'slug websiteUrl rosterEnrichment.configOrigin fieldProvenance.currentUndergradCount.sourceUrl fieldProvenance.undergradEvidenceQuote.sourceUrl',
    )
    .sort({ slug: 1 })
    .lean();
  return rows.map((row: any) => ({
    researchEntityKey: String(row.slug),
    websiteUrl: httpUrl(row.websiteUrl),
    citedUrls: [
      ...new Set(
        [
          httpUrl(row.fieldProvenance?.currentUndergradCount?.sourceUrl),
          httpUrl(row.fieldProvenance?.undergradEvidenceQuote?.sourceUrl),
        ].filter(Boolean),
      ),
    ],
    hasDerivedRoster: row.rosterEnrichment?.configOrigin === 'derived',
  }));
}

export const DERIVED_ROSTER_FETCH_DELAY_MS = 1000;

export const DERIVED_ROSTER_CANDIDATES_IN_PARALLEL = 8;

const pageHost = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

export function perHostSpacedReader(
  fetchPage: (url: string) => Promise<string>,
  delayMs: number,
): (url: string) => Promise<string> {
  const hostTurns = new Map<string, Promise<void>>();
  return async (url) => {
    const host = pageHost(url);
    const previous = hostTurns.get(host) ?? Promise.resolve();
    let release: () => void = () => {};
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    hostTurns.set(
      host,
      previous.then(() => turn),
    );
    await previous;
    try {
      return await fetchPage(url);
    } finally {
      if (delayMs > 0) setTimeout(release, delayMs);
      else release();
    }
  };
}

export function createUndergradRosterDeriver(
  loadCandidates: () => Promise<DerivedRosterCandidate[]> = loadDerivedRosterCandidates,
  fetchDelayMs = DERIVED_ROSTER_FETCH_DELAY_MS,
  ownerDeniedKeyDigests: readonly string[] = OWNER_DENIED_ROSTER_KEY_DIGESTS,
  candidatesInParallel = DERIVED_ROSTER_CANDIDATES_IN_PARALLEL,
): (request: DerivedRosterRequest) => Promise<DerivedRosterRun> {
  return async (request) => {
    const deniedDigests = new Set(ownerDeniedKeyDigests);
    const denied = (key: string): boolean => deniedDigests.has(deniedRosterKeyDigest(key));
    const all = (await loadCandidates()).filter(
      (candidate) => !request.only || request.only.has(candidate.researchEntityKey.toLowerCase()),
    );
    const staticOverridden = all.filter((c) => request.staticKeys.has(c.researchEntityKey)).length;
    const deniedCandidates = all.filter(
      (c) => !request.staticKeys.has(c.researchEntityKey) && denied(c.researchEntityKey),
    );
    const candidates = all
      .filter((c) => !request.staticKeys.has(c.researchEntityKey) && !denied(c.researchEntityKey))
      .slice(0, request.limit || undefined);
    const readPage = perHostSpacedReader(request.fetchPage, fetchDelayMs);
    const outcomes: DerivedRosterOutcome[] = deniedCandidates
      .filter((candidate) => candidate.hasDerivedRoster)
      .map((candidate) => ({
        kind: 'withheld',
        researchEntityKey: candidate.researchEntityKey,
        sourceUrl: candidate.websiteUrl,
        reason: 'owner-denied',
      }));
    const derived: DerivedRosterOutcome[] = new Array(candidates.length);
    let nextIndex = 0;
    const worker = async () => {
      for (let index = nextIndex++; index < candidates.length; index = nextIndex++) {
        derived[index] = await deriveUndergradRosterForCandidate(
          candidates[index],
          readPage,
          request.observedAt,
        );
      }
    };
    const workers = Math.max(1, Math.min(candidatesInParallel, candidates.length));
    await Promise.all(Array.from({ length: workers }, worker));
    outcomes.push(...derived);
    return { outcomes, staticOverridden, ownerDenied: deniedCandidates.length };
  };
}
