import * as cheerio from 'cheerio';
import {
  detectOfficialRosterTemplate,
  extractOfficialResearchHomeRoster,
  listedPersonNames,
  undergraduateSectionCandidates,
  type OfficialRosterConfig,
  type OfficialRosterUndergraduate,
} from '../scrapers/sources/officialResearchHomeRosterScraper';

export interface UndergradRosterProposal {
  id: number;
  researchEntityKey: string;
  config: OfficialRosterConfig;
  current: OfficialRosterUndergraduate[];
  past: OfficialRosterUndergraduate[];
  otherCurrentMembers: number;
  undergraduateWithheldCount: number;
  rosterState: string;
}

export type UndergradRosterProposalOutcome =
  | { kind: 'proposed'; proposal: Omit<UndergradRosterProposal, 'id'> }
  | { kind: 'no-undergraduate-section' }
  | { kind: 'page-of-another-lab' }
  | { kind: 'page-of-another-institution' }
  | { kind: 'no-listed-undergraduate'; rosterState: string };

const NOT_A_ROSTER_LABEL =
  /\b(?:opportunit\w*|join\w*|prospective|apply\w*|interested|openings?|positions?|how to)\b/i;
const PLURAL_ROSTER_LABEL =
  /\b(?:people|students|researchers|assistants|associates|undergrads|undergraduates|members|scholars|interns|team|alumni|alumnae)\b/i;

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

/**
 * A page off Yale's hosts that never names Yale and keeps naming one other university is
 * that university's lab page (the PI's lab before or besides Yale), so its students are
 * that university's students.
 */
function isAnotherInstitutionsPage(url: string, text: string): boolean {
  try {
    if (/(?:^|\.)yale\.edu$/i.test(new URL(url).hostname)) return false;
  } catch {
    return false;
  }
  if (/\bYale\b/i.test(text)) return false;
  const counts = new Map<string, number>();
  for (const match of text.matchAll(OTHER_UNIVERSITY)) {
    counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
  }
  return [...counts.values()].some((count) => count >= 3);
}

/**
 * Whether the page is some other lab's page: the key names a person, and the page is named
 * after someone listed on it who is not that person, or it belongs to another institution.
 */
export function pageOwnershipRefusal(
  html: string,
  researchEntityKey: string,
  url: string,
): 'page-of-another-lab' | 'page-of-another-institution' | undefined {
  const $ = cheerio.load(html);
  const text = pageText($);
  if (isAnotherInstitutionsPage(url, text)) return 'page-of-another-institution';
  const nameTokens = keyNameTokens(researchEntityKey);
  if (nameTokens.length === 0) return undefined;
  const owners = namedLabOwners(
    $,
    url,
    listedPersonNames(html, detectOfficialRosterTemplate(html)),
  );
  return owners.length > 0 && !owners.some((owner) => ownerIsKeyPerson(owner, nameTokens))
    ? 'page-of-another-lab'
    : undefined;
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
  const candidates = undergraduateSectionCandidates(html, template).filter((candidate) =>
    isProposableSectionLabel(candidate.label, template),
  );
  if (candidates.length === 0) return { kind: 'no-undergraduate-section' };
  const config: OfficialRosterConfig = {
    researchEntityKey,
    url,
    template,
    ...(template === 'profile-grid' ? { currency: 'section-label' as const } : {}),
    currentSectionLabels: candidates.filter((c) => !c.past).map((c) => c.label),
    pastSectionLabels: candidates.filter((c) => c.past).map((c) => c.label),
  };
  const roster = extractOfficialResearchHomeRoster(html, config, observedAt);
  const current = roster.undergraduates.filter((member) => member.status === 'current');
  const past = roster.undergraduates.filter((member) => member.status === 'past');
  if (current.length + past.length === 0) {
    return { kind: 'no-listed-undergraduate', rosterState: roster.state };
  }
  return {
    kind: 'proposed',
    proposal: {
      researchEntityKey,
      config,
      current,
      past,
      otherCurrentMembers: roster.members.filter((member) => member.role !== 'undergrad').length,
      undergraduateWithheldCount: roster.undergraduateWithheldCount,
      rosterState: roster.state,
    },
  };
}

const memberLine = (member: OfficialRosterUndergraduate): string => {
  const years =
    member.status === 'current'
      ? member.startYear
        ? ` (${member.startYear} - present)`
        : ''
      : member.startYear && member.endYear && member.startYear !== member.endYear
        ? ` (${member.startYear} - ${member.endYear})`
        : member.endYear || member.startYear
          ? ` (${member.endYear ?? member.startYear})`
          : '';
  return `${member.name}${years}${member.profileUrl ? ' [profile]' : ''}`;
};

const quotedLabels = (labels: string[] | undefined): string =>
  labels && labels.length > 0 ? labels.map((label) => `"${label}"`).join(', ') : 'none';

export function renderUndergradRosterReviewSheet(proposals: UndergradRosterProposal[]): string {
  const lines = [
    '# Undergraduate roster review',
    '',
    'Each lab below would list these undergraduates by name on its detail page.',
    'Check each against its page: are these people undergraduates in this lab, is anyone missing or extra, and is current versus past right?',
    'Reply with the numbers to approve, or "all except" the numbers to reject.',
    '',
  ];
  for (const proposal of proposals) {
    const { config } = proposal;
    lines.push(
      `## ${proposal.id}. ${proposal.researchEntityKey}`,
      '',
      `- Page: ${config.url}`,
      `- Layout: ${config.template}${config.currency === 'section-label' ? ' (publish date not required)' : ''}`,
      `- Current headings: ${quotedLabels(config.currentSectionLabels)}`,
      `- Past headings: ${quotedLabels(config.pastSectionLabels)}`,
      `- Other current members linked from the same headings: ${proposal.otherCurrentMembers}`,
      `- Entries refused as not a name: ${proposal.undergraduateWithheldCount}`,
      '',
      `Current undergraduates (${proposal.current.length}):`,
      ...(proposal.current.length > 0
        ? proposal.current.map((m) => `- ${memberLine(m)}`)
        : ['- none']),
      '',
      `Past undergraduates (${proposal.past.length}):`,
      ...(proposal.past.length > 0 ? proposal.past.map((m) => `- ${memberLine(m)}`) : ['- none']),
      '',
    );
  }
  return `${lines.join('\n')}\n`;
}

export function officialRosterConfigSource(configs: OfficialRosterConfig[]): string {
  return configs
    .map((config) => {
      const fields = [
        `    researchEntityKey: ${JSON.stringify(config.researchEntityKey)},`,
        `    url: ${JSON.stringify(config.url)},`,
        ...(config.template ? [`    template: ${JSON.stringify(config.template)},`] : []),
        ...(config.currency ? [`    currency: ${JSON.stringify(config.currency)},`] : []),
        `    currentSectionLabels: ${JSON.stringify(config.currentSectionLabels)},`,
        ...(config.pastSectionLabels && config.pastSectionLabels.length > 0
          ? [`    pastSectionLabels: ${JSON.stringify(config.pastSectionLabels)},`]
          : []),
        ...(config.withheldNames && config.withheldNames.length > 0
          ? [`    withheldNames: ${JSON.stringify(config.withheldNames)},`]
          : []),
        ...(config.pastNames && config.pastNames.length > 0
          ? [`    pastNames: ${JSON.stringify(config.pastNames)},`]
          : []),
      ];
      return `  {\n${fields.join('\n')}\n  },`;
    })
    .join('\n');
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
