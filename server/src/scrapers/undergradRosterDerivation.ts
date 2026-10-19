import { ResearchEntity } from '../models/researchEntity';
import {
  detectOfficialRosterTemplate,
  extractOfficialResearchHomeRoster,
  undergraduateSectionCandidates,
  type DerivedRosterOutcome,
  type DerivedRosterRequest,
  type DerivedRosterRun,
  type ExtractedOfficialRoster,
  type OfficialRosterConfig,
  type OfficialRosterUndergraduate,
} from './sources/officialResearchHomeRosterScraper';
import { OWNER_DENIED_ROSTER_KEYS } from './officialRosterConfigs';
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
}

export type UndergradRosterProposalOutcome =
  | {
      kind: 'proposed';
      proposal: Omit<UndergradRosterProposal, 'id'>;
      roster: ExtractedOfficialRoster;
    }
  | { kind: 'no-undergraduate-section' }
  | { kind: 'no-listed-undergraduate'; rosterState: string };

const NOT_A_ROSTER_LABEL =
  /\b(?:opportunit\w*|join\w*|prospective|apply\w*|interested|openings?|positions?|how to)\b/i;
const PLURAL_ROSTER_LABEL =
  /\b(?:students|researchers|assistants|associates|undergrads|undergraduates|members|scholars|interns|team|alumni|alumnae)\b/i;

export function isProposableSectionLabel(label: string, template: string): boolean {
  if (label.length > 60 || NOT_A_ROSTER_LABEL.test(label)) return false;
  return template !== 'heading-list' || PLURAL_ROSTER_LABEL.test(label);
}

const isUndergraduateProgramPage = (url: string): boolean => {
  try {
    return /undergrad/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
};

export function proposeUndergradRosterConfig(
  html: string,
  researchEntityKey: string,
  url: string,
  observedAt: Date,
): UndergradRosterProposalOutcome {
  if (isUndergraduateProgramPage(url)) return { kind: 'no-undergraduate-section' };
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
    roster,
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
  | 'no-longer-badged'
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

export function derivedRosterWithheldReason(
  config: OfficialRosterConfig,
  roster: ExtractedOfficialRoster,
  websiteUrl: string,
): DerivedRosterWithheldReason | null {
  if (!websiteUrl) return 'no-website';
  if (!derivedRosterPageBelongsToRow(config.url, websiteUrl)) return 'page-not-this-row';
  const labels = [...config.currentSectionLabels, ...(config.pastSectionLabels ?? [])];
  if (labels.some(sectionLabelCombinesGraduateLevels)) return 'combined-section-label';
  if (roster.undergraduates.length > DERIVED_ROSTER_MAX_UNDERGRADUATES) return 'too-many-names';
  if (roster.undergraduates.some((member) => !rosterSnippetNamesAnUndergraduate(member.name))) {
    return 'name-not-an-undergraduate';
  }
  return null;
}

export interface DerivedRosterCandidate {
  researchEntityKey: string;
  websiteUrl: string;
  citedUrls: string[];
  badged: boolean;
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
  if (!candidate.badged) {
    return candidate.hasDerivedRoster
      ? {
          kind: 'withheld',
          researchEntityKey: key,
          sourceUrl: candidate.websiteUrl,
          reason: 'no-longer-badged',
        }
      : { kind: 'not-found', researchEntityKey: key, reason: 'no-longer-badged' };
  }
  const pages = [...new Set([...candidate.citedUrls, candidate.websiteUrl].filter(Boolean))];
  let passed: { config: OfficialRosterConfig; roster: ExtractedOfficialRoster } | undefined;
  let refused: { reason: DerivedRosterWithheldReason; url: string; size: number } | undefined;
  let lastOutcome = 'no-page';
  for (let index = 0; index < pages.length && index < DERIVED_ROSTER_MAX_PAGES; index += 1) {
    const url = pages[index];
    let html: string;
    try {
      html = await readPage(url);
    } catch {
      lastOutcome = 'fetch-failed';
      continue;
    }
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
    $or: [{ hasUndergradHostingEvidence: true }, { 'rosterEnrichment.configOrigin': 'derived' }],
  })
    .select(
      'slug websiteUrl hasUndergradHostingEvidence rosterEnrichment.configOrigin fieldProvenance.currentUndergradCount.sourceUrl fieldProvenance.undergradEvidenceQuote.sourceUrl',
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
    badged: row.hasUndergradHostingEvidence === true,
    hasDerivedRoster: row.rosterEnrichment?.configOrigin === 'derived',
  }));
}

export const DERIVED_ROSTER_FETCH_DELAY_MS = 1000;

export function createUndergradRosterDeriver(
  loadCandidates: () => Promise<DerivedRosterCandidate[]> = loadDerivedRosterCandidates,
  fetchDelayMs = DERIVED_ROSTER_FETCH_DELAY_MS,
  ownerDeniedKeys: readonly string[] = OWNER_DENIED_ROSTER_KEYS,
): (request: DerivedRosterRequest) => Promise<DerivedRosterRun> {
  return async (request) => {
    const denied = new Set(ownerDeniedKeys);
    const all = (await loadCandidates()).filter(
      (candidate) => !request.only || request.only.has(candidate.researchEntityKey.toLowerCase()),
    );
    const staticOverridden = all.filter((c) => request.staticKeys.has(c.researchEntityKey)).length;
    const deniedCandidates = all.filter(
      (c) => !request.staticKeys.has(c.researchEntityKey) && denied.has(c.researchEntityKey),
    );
    const candidates = all
      .filter(
        (c) => !request.staticKeys.has(c.researchEntityKey) && !denied.has(c.researchEntityKey),
      )
      .slice(0, request.limit || undefined);
    const readPage = async (url: string): Promise<string> => {
      const html = await request.fetchPage(url);
      if (fetchDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, fetchDelayMs));
      return html;
    };
    const outcomes: DerivedRosterOutcome[] = deniedCandidates
      .filter((candidate) => candidate.hasDerivedRoster)
      .map((candidate) => ({
        kind: 'withheld',
        researchEntityKey: candidate.researchEntityKey,
        sourceUrl: candidate.websiteUrl,
        reason: 'owner-denied',
      }));
    for (const candidate of candidates) {
      outcomes.push(
        await deriveUndergradRosterForCandidate(candidate, readPage, request.observedAt),
      );
    }
    return { outcomes, staticOverridden, ownerDenied: deniedCandidates.length };
  };
}
