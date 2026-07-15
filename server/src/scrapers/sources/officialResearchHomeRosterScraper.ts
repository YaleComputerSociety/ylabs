/**
 * Bounded acquisition of current research-home rosters from reviewed official pages.
 *
 * This source deliberately uses an allowlist of entity/page/section contracts. A page
 * is not treated as a current roster merely because it contains person names. Each
 * accepted section must be explicitly configured as current, every publish date must
 * be recent enough, and every materializable person must have a source-specific
 * official profile URL. Names and contact details are never identity proof.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { createHash } from 'crypto';
import { redactDirectContactInfo } from '../../utils/contactRedaction';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';
import { getCached, setCached } from '../snapshotCache';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';

export const OFFICIAL_RESEARCH_HOME_ROSTER_SOURCE = 'official-research-home-roster';
export const OFFICIAL_ROSTER_REFRESH_OWNER = 'Yale Research data operations';
export const OFFICIAL_ROSTER_REFRESH_CADENCE = 'weekly';
export const OFFICIAL_ROSTER_FRESHNESS_DAYS = 21;
export const OFFICIAL_ROSTER_MAX_PUBLISH_AGE_DAYS = 550;
export const OFFICIAL_ROSTER_MAX_MEMBERS_PER_ENTITY = 40;

export interface OfficialRosterConfig {
  researchEntityKey: string;
  url: string;
  currentSectionLabels: string[];
}

export interface ExtractedOfficialRosterMember {
  name: string;
  title: string;
  role: OfficialRosterRole;
  profileUrl: string;
  identityKey: string;
  membershipKey: string;
  sectionLabel: string;
}

export type OfficialRosterRole =
  | 'postdoc'
  | 'grad-student'
  | 'undergrad'
  | 'staff'
  | 'core-faculty'
  | 'affiliate';

export interface ExtractedOfficialRoster {
  state: 'current' | 'partial' | 'empty' | 'withheld' | 'stale';
  members: ExtractedOfficialRosterMember[];
  withheldCount: number;
  duplicateCount: number;
  sourcePublishedAt?: Date;
  observedAt: Date;
  freshnessExpiresAt: Date;
  complete: boolean;
}

export const OFFICIAL_ROSTER_CONFIGS: OfficialRosterConfig[] = [
  {
    researchEntityKey: 'ysm-turk',
    url: 'https://medicine.yale.edu/lab/turk/labmembers/',
    currentSectionLabels: ['Current Members'],
  },
  {
    researchEntityKey: 'ysm-haeny',
    url: 'https://medicine.yale.edu/lab/haeny/people/',
    currentSectionLabels: ['Postdoctoral Fellows', 'Lab Manager'],
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;

const normalizedText = (value: unknown): string =>
  redactDirectContactInfo(String(value || '').replace(/\s+/g, ' ').trim()).slice(0, 300);

const normalizedLabel = (value: unknown): string =>
  normalizedText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function dateFromPublishMeta(value: string): Date | undefined {
  const text = value.trim();
  const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  const parsed = slashMatch
    ? new Date(Date.UTC(Number(slashMatch[3]), Number(slashMatch[1]) - 1, Number(slashMatch[2])))
    : new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function officialProfileUrl(href: string, sourceUrl: string): string {
  if (!href) return '';
  try {
    const source = new URL(sourceUrl);
    const profile = new URL(href, source);
    if (profile.protocol !== 'https:' || profile.username || profile.password) return '';
    if (profile.hostname.toLowerCase() !== source.hostname.toLowerCase()) return '';
    if (!/(?:^|\/)profile(?:s)?\//i.test(profile.pathname)) return '';
    profile.hash = '';
    profile.search = '';
    return profile.toString();
  } catch {
    return '';
  }
}

const stableKey = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 24);

export function mapOfficialRosterRole(titleValue: unknown, sectionValue: unknown): OfficialRosterRole | null {
  const title = normalizedLabel(titleValue);
  const section = normalizedLabel(sectionValue);
  const evidence = `${section} ${title}`;
  if (/\b(postdoc|post doctoral|postdoctoral)\b/.test(evidence)) return 'postdoc';
  if (/\b(graduate student|phd student|doctoral student|predoctoral)\b/.test(evidence)) {
    return 'grad-student';
  }
  if (/\b(undergraduate|undergrad)\b/.test(evidence)) return 'undergrad';
  if (
    /\b(lab manager|laboratory manager|research assistant|research associate|research scientist|postgraduate associate|technician|coordinator|data manager|staff)\b/.test(
      evidence,
    )
  ) {
    return 'staff';
  }
  if (/\b(professor|faculty)\b/.test(evidence)) return 'core-faculty';
  if (/\b(member|affiliate|fellow|visitor|visiting)\b/.test(evidence)) return 'affiliate';
  return null;
}

export function extractOfficialResearchHomeRoster(
  html: string,
  config: OfficialRosterConfig,
  observedAt = new Date(),
): ExtractedOfficialRoster {
  const $ = cheerio.load(html);
  const freshnessExpiresAt = new Date(observedAt.getTime() + OFFICIAL_ROSTER_FRESHNESS_DAYS * DAY_MS);
  const sourcePublishedAt = dateFromPublishMeta(
    $('meta[property="publish-date"], meta[name="publish-date"]').first().attr('content') || '',
  );
  const publishAgeDays = sourcePublishedAt
    ? (observedAt.getTime() - sourcePublishedAt.getTime()) / DAY_MS
    : Number.POSITIVE_INFINITY;
  if (
    !sourcePublishedAt ||
    publishAgeDays < -2 ||
    publishAgeDays > OFFICIAL_ROSTER_MAX_PUBLISH_AGE_DAYS
  ) {
    return {
      state: 'stale',
      members: [],
      withheldCount: 0,
      duplicateCount: 0,
      sourcePublishedAt,
      observedAt,
      freshnessExpiresAt,
      complete: false,
    };
  }

  const acceptedLabels = new Set(config.currentSectionLabels.map(normalizedLabel));
  const candidates: ExtractedOfficialRosterMember[] = [];
  let withheldCount = 0;
  let acceptedSectionCount = 0;

  $('section.organization-member-listing').each((_index, element) => {
    const section = $(element);
    const sectionLabel = normalizedText(
      section.attr('aria-label') || section.find('h2,h3').first().text(),
    );
    if (!acceptedLabels.has(normalizedLabel(sectionLabel))) return;
    acceptedSectionCount += 1;

    section.find('article.profile-grid-item').each((_memberIndex, memberElement) => {
      if (candidates.length >= OFFICIAL_ROSTER_MAX_MEMBERS_PER_ENTITY) {
        withheldCount += 1;
        return;
      }
      const card = $(memberElement);
      const name = normalizedText(
        card.find('.profile-grid-item__name').first().text() || card.attr('aria-label'),
      ).replace(/['’]s Profile$/i, '');
      const title = normalizedText(card.find('.profile-grid-item__title').first().text());
      const profileUrl = officialProfileUrl(
        card.find('a.profile-grid-item__link-details').first().attr('href') || '',
        config.url,
      );
      const role = mapOfficialRosterRole(title, sectionLabel);
      if (!name || !profileUrl || !role) {
        withheldCount += 1;
        return;
      }
      const identityKey = `official-profile:${profileUrl.toLowerCase()}`;
      const membershipKey = `${identityKey}|${role}`;
      candidates.push({
        name,
        title,
        role,
        profileUrl,
        identityKey,
        membershipKey,
        sectionLabel,
      });
    });
  });

  if (acceptedSectionCount !== acceptedLabels.size) {
    return {
      state: 'withheld',
      members: [],
      withheldCount: Math.max(1, withheldCount),
      duplicateCount: 0,
      sourcePublishedAt,
      observedAt,
      freshnessExpiresAt,
      complete: false,
    };
  }

  const byMembershipKey = new Map<string, ExtractedOfficialRosterMember[]>();
  for (const candidate of candidates) {
    byMembershipKey.set(candidate.membershipKey, [
      ...(byMembershipKey.get(candidate.membershipKey) || []),
      candidate,
    ]);
  }
  const members: ExtractedOfficialRosterMember[] = [];
  let duplicateCount = 0;
  for (const group of byMembershipKey.values()) {
    const names = new Set(group.map((member) => normalizedLabel(member.name)));
    if (names.size > 1) {
      withheldCount += group.length;
      continue;
    }
    members.push(group[0]);
    duplicateCount += Math.max(0, group.length - 1);
  }

  const state =
    members.length > 0
      ? withheldCount > 0
        ? 'partial'
        : 'current'
      : withheldCount > 0
        ? 'withheld'
        : 'empty';
  return {
    state,
    members,
    withheldCount,
    duplicateCount,
    sourcePublishedAt,
    observedAt,
    freshnessExpiresAt,
    complete: state === 'current',
  };
}

export function officialRosterObservations(
  config: OfficialRosterConfig,
  roster: ExtractedOfficialRoster,
): ObservationInput[] {
  const statusValue = {
    state: roster.state,
    complete: roster.complete,
    memberCount: roster.members.length,
    withheldCount: roster.withheldCount,
    duplicateCount: roster.duplicateCount,
    memberKeys: roster.members.map((member) => member.membershipKey),
    sourceUrl: config.url,
    sourcePublishedAt: roster.sourcePublishedAt?.toISOString(),
    observedAt: roster.observedAt.toISOString(),
    freshnessExpiresAt: roster.freshnessExpiresAt.toISOString(),
    refreshOwner: OFFICIAL_ROSTER_REFRESH_OWNER,
    refreshCadence: OFFICIAL_ROSTER_REFRESH_CADENCE,
  };
  const observations: ObservationInput[] = [
    {
      entityType: 'researchEntity',
      entityKey: config.researchEntityKey,
      field: 'rosterEnrichment',
      value: statusValue,
      sourceUrl: config.url,
      observedAt: roster.observedAt,
    },
  ];

  for (const member of roster.members) {
    const entityKey = `official-roster:${config.researchEntityKey}:${stableKey(member.membershipKey)}`;
    const base = {
      entityType: 'researchGroupMember' as const,
      entityKey,
      sourceUrl: config.url,
      observedAt: roster.observedAt,
    };
    observations.push(
      { ...base, field: 'researchGroupKey', value: config.researchEntityKey },
      { ...base, field: 'name', value: member.name },
      { ...base, field: 'title', value: member.title },
      { ...base, field: 'role', value: member.role },
      { ...base, field: 'profileUrl', value: member.profileUrl },
      { ...base, field: 'identityKey', value: member.identityKey },
      { ...base, field: 'membershipKey', value: member.membershipKey },
      { ...base, field: 'currentStatus', value: 'current' },
      { ...base, field: 'evidenceStatus', value: 'verified' },
      { ...base, field: 'sectionLabel', value: member.sectionLabel },
      {
        ...base,
        field: 'sourcePublishedAt',
        value: roster.sourcePublishedAt?.toISOString(),
      },
      {
        ...base,
        field: 'freshnessExpiresAt',
        value: roster.freshnessExpiresAt.toISOString(),
      },
      { ...base, field: 'sourceName', value: OFFICIAL_RESEARCH_HOME_ROSTER_SOURCE },
    );
  }
  return observations;
}

function failedRosterObservation(config: OfficialRosterConfig, observedAt: Date): ObservationInput {
  return {
    entityType: 'researchEntity',
    entityKey: config.researchEntityKey,
    field: 'rosterEnrichment',
    value: {
      state: 'failed',
      complete: false,
      memberCount: 0,
      withheldCount: 0,
      duplicateCount: 0,
      memberKeys: [],
      sourceUrl: config.url,
      observedAt: observedAt.toISOString(),
      refreshOwner: OFFICIAL_ROSTER_REFRESH_OWNER,
      refreshCadence: OFFICIAL_ROSTER_REFRESH_CADENCE,
    },
    sourceUrl: config.url,
    observedAt,
  };
}

async function fetchRosterPage(url: string, useCache: boolean): Promise<string> {
  const safeUrl = await assertPublicHttpUrl(url);
  const cacheKey = safeUrl.toString();
  if (useCache) {
    const cached = await getCached<string>(OFFICIAL_RESEARCH_HOME_ROSTER_SOURCE, cacheKey);
    if (cached) return cached;
  }
  const agents = ssrfSafeAgents();
  const response = await axios.get(safeUrl.toString(), {
    timeout: 30_000,
    maxRedirects: 5,
    headers: { 'User-Agent': 'ylabs-scraper/1.0 (+https://yalelabs.io)' },
    httpAgent: agents.httpAgent,
    httpsAgent: agents.httpsAgent,
  });
  const html = String(response.data || '');
  if (useCache) await setCached(OFFICIAL_RESEARCH_HOME_ROSTER_SOURCE, cacheKey, html);
  return html;
}

export class OfficialResearchHomeRosterScraper implements IScraper {
  readonly name = OFFICIAL_RESEARCH_HOME_ROSTER_SOURCE;
  readonly displayName = 'Official research-home current rosters';

  constructor(
    private readonly configs: OfficialRosterConfig[] = OFFICIAL_ROSTER_CONFIGS,
    private readonly fetchPage: (url: string, useCache: boolean) => Promise<string> = fetchRosterPage,
  ) {}

  async run(context: ScraperContext): Promise<ScraperResult> {
    const only = context.options.only?.length
      ? new Set(context.options.only.map((value) => value.trim().toLowerCase()))
      : undefined;
    const selected = this.configs
      .filter((config) => !only || only.has(config.researchEntityKey.toLowerCase()))
      .slice(0, context.options.limit || this.configs.length);
    let observationCount = 0;
    let entitiesObserved = 0;
    let failed = 0;
    let withheld = 0;

    for (const config of selected) {
      const observedAt = new Date();
      try {
        const html = await this.fetchPage(config.url, context.options.useCache);
        const roster = extractOfficialResearchHomeRoster(html, config, observedAt);
        const observations = officialRosterObservations(config, roster);
        await context.emit(observations);
        observationCount += observations.length;
        entitiesObserved += 1 + roster.members.length;
        withheld += roster.withheldCount;
        context.log(
          `${config.researchEntityKey}: ${roster.state}, ${roster.members.length} verified, ${roster.withheldCount} withheld`,
        );
      } catch {
        await context.emit(failedRosterObservation(config, observedAt));
        observationCount += 1;
        entitiesObserved += 1;
        failed += 1;
        context.log(`${config.researchEntityKey}: optional roster fetch failed`);
      }
    }

    return {
      observationCount,
      entitiesObserved,
      notes: `Reviewed sources=${selected.length}; failed=${failed}; withheld=${withheld}; broad enablement remains audit-gated.`,
    };
  }
}
