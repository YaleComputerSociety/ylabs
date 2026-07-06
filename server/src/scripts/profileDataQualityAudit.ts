/**
 * Read-only profile data-quality audit.
 *
 * This script turns recurring profile-review questions into repeatable checks:
 * missing official Yale person URLs, chrome/title-only bios, wrong-person
 * profile URLs, and research summaries that appear to come from a broad
 * affiliation even though a stronger lead home exists.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import { User } from '../models/user';
import {
  dedupeProfileResearchEntities,
  isLikelyPersonUrl,
  normalizePublicProfile,
} from '../services/profileService';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../utils/ssrfGuard';
import { selectOfficialBioUrl } from './backfillProfileBiosFromOfficialUrls';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export type ProfileAuditIssue =
  | 'missing-official-profile-url'
  | 'bio-chrome-or-title'
  | 'bio-not-personal-bio'
  | 'title-chrome-or-directory-label'
  | 'profile-url-slug-mismatch'
  | 'wrong-person-profile-url'
  | 'official-profile-name-or-title-mismatch'
  | 'weak-affiliation-summary';

export interface ProfileAuditFinding {
  issue: ProfileAuditIssue;
  netid: string;
  name: string;
  title?: string;
  detail?: string;
  url?: string;
  candidateUrls?: string[];
  verifiedCandidateUrls?: string[];
  officialName?: string;
  officialTitle?: string;
  currentEntity?: string;
  strongerEntity?: string;
}

export interface ProfileDataQualityAuditOptions {
  limit: number;
  skip: number;
  sampleLimit: number;
  verifyLive: boolean;
  liveMissingSkip: number;
  liveMissingLimit: number;
  liveCompareSkip: number;
  liveCompareLimit: number;
  output?: string;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const nameForUser = (user: Record<string, any>): string =>
  [user.fname, user.lname].filter(Boolean).join(' ') ||
  textValue(user.displayName) ||
  textValue(user.name) ||
  textValue(user.netid);

const slugPart = (value: unknown): string =>
  textValue(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const uniqueStrings = (values: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = textValue(value);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
};

const corpusForProfile = (user: Record<string, any>): string =>
  [
    user.title,
    user.primaryDepartment,
    user.primary_department,
    user.department,
    ...(Array.isArray(user.departments) ? user.departments : []),
    ...(Array.isArray(user.secondaryDepartments) ? user.secondaryDepartments : []),
    ...(Array.isArray(user.secondary_departments) ? user.secondary_departments : []),
  ]
    .map(textValue)
    .filter(Boolean)
    .join(' ');

export function candidateOfficialProfileUrls(user: Record<string, any>): string[] {
  const first = slugPart(user.fname || user.firstName);
  const last = slugPart(user.lname || user.lastName);
  if (!first || !last) return [];

  const exactNameSlug = `${first}-${last}`;
  const compactParticleSurnameSlug = last.includes('-') ? `${first[0]}${last.replace(/-/g, '')}` : '';
  const slugs = [
    exactNameSlug,
    `${exactNameSlug}-1`,
    `${exactNameSlug}2`,
    `${first[0]}-${last}`,
    compactParticleSurnameSlug,
    slugPart(textValue(user.email).split('@')[0] || ''),
    slugPart(user.netid),
  ].filter(Boolean);
  const corpus = corpusForProfile(user).toLowerCase();
  const urls: string[] = [];
  if (/\b(?:public health|epidemiology|biostatistics|health policy|microbial diseases)\b/i.test(corpus)) {
    urls.push(...slugs.map((slug) => `https://ysph.yale.edu/profile/${slug}/`));
  }
  if (
    /\b(?:medicine|medical|psychiatry|pediatrics|radiology|surgery|pathology|immunobiology|epidemiology|public health)\b/i.test(
      corpus,
    )
  ) {
    urls.push(...slugs.map((slug) => `https://medicine.yale.edu/profile/${slug}/`));
  }
  return uniqueStrings(urls);
}

const hasStrongOfficialProfileTitleSignal = (value: unknown): boolean => {
  const title = textValue(value);
  if (!title) return false;
  if (
    /\b(?:support specialist|systems programmer|technologist|clinical writer|research associate\b(?!.*\bscientist\b)|postdoctoral|postdoc|visiting|medical school recruit|fringe benefits|400 list)\b/i.test(
      title,
    )
  ) {
    return false;
  }
  return /\b(?:professor|lecturer|lector|instructor|scientist|investigator)\b|\brsrch\s+scientist\b/i.test(
    title,
  );
};

const normalizedCompact = (value: unknown): string =>
  textValue(value).toLowerCase().replace(/[^a-z0-9]+/g, '');

const nameTokensForOfficialFacts = (value: unknown, options: { keepInitials?: boolean } = {}): string[] =>
  textValue(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token && (options.keepInitials || token.length > 1));

export type StoredBioIssue =
  | ''
  | 'title-only'
  | 'website-or-address-chrome'
  | 'cta-or-navigation-chrome'
  | 'research-interest-summary';

export type StoredTitleIssue =
  | ''
  | 'navigation-chrome'
  | 'contact-or-address-chrome'
  | 'generic-directory-label';

const substantialBioWordCount = (value: string): number =>
  value
    .replace(/\b(?:personal|professional|lab|website|room|phone|fax|email)\b/gi, ' ')
    .split(/\s+/)
    .filter((token) => /^[a-z][a-z'-]{2,}$/i.test(token)).length;

const hasSubstantialBiographySignal = (value: string): boolean =>
  substantialBioWordCount(value) >= 22 &&
  /\b(?:stud(?:y|ies)|research|focus(?:es)?|works?|develops?|explores?|examines?|combines?|current|interested|specializ(?:e|es|ing)|graduate|author|journalist|founded|serv(?:e|ed|es)|represented|clerked|appointed|lectur(?:e|ed|er)|published|practice|professional|clinical|patients?|treat(?:s|ing|ment)?|surgery|surgical|diagnos(?:e|es|is|ing)|condition|disease)\b/i.test(
    value,
  );

export function classifyStoredBioIssue(user: { bio?: unknown; title?: unknown }): StoredBioIssue {
  const bio = textValue(user.bio);
  if (!bio) return '';
  if (normalizedCompact(bio) && normalizedCompact(bio) === normalizedCompact(user.title)) {
    return 'title-only';
  }
  if (/\bofficial Yale profile (?:lists research interests?|summarizes (?:their )?research(?: focus)?(?: in)?)\b/i.test(bio)) {
    return 'research-interest-summary';
  }
  if (
    /\b(?:website|room|kline tower|po box|new haven,?\s*ct|mailing address|contact info|phone|fax)\b/i.test(
      bio,
    )
  ) {
    return hasSubstantialBiographySignal(bio) ? '' : 'website-or-address-chrome';
  }
  if (/\b(?:skip to main content|view full profile|read more|learn more|cookie preferences)\b/i.test(bio)) {
    return hasSubstantialBiographySignal(bio) ? '' : 'cta-or-navigation-chrome';
  }
  return '';
}

const hasTitleRoleSignal = (value: string): boolean =>
  /\b(?:professor|lecturer|lector|instructor|scientist|investigator|fellow|resident|director|dean|curator|librarian|researcher|associate|assistant|chair|affiliate|affiliated|emeritus|emerita)\b/i.test(
    value,
  );

export function classifyStoredTitleIssue(user: { title?: unknown }): StoredTitleIssue {
  const title = textValue(user.title);
  if (!title) return '';

  if (
    /\b(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|new haven,?\s*ct|po box|room\s+\w+|prospect street|phone|fax|\+\d[\d\s().-]{6,})\b/i.test(
      title,
    )
  ) {
    return 'contact-or-address-chrome';
  }

  const navMatches = title.match(
    /\b(?:home|about|research|academics|people|media|events|outreach|opportunities|belonging|prospectives|contact|news)\b/gi,
  );
  if ((navMatches?.length || 0) >= 5 && !hasTitleRoleSignal(title)) {
    return 'navigation-chrome';
  }

  if (/^(?:research\s*\/\s*faculty|related research|faculty research)$/i.test(title)) {
    return 'generic-directory-label';
  }

  return '';
}

const profileUrlValues = (user: Record<string, any>): string[] => {
  const profileUrls = user.profileUrls || user.profile_urls || {};
  const values = profileUrls && typeof profileUrls === 'object' ? Object.values(profileUrls) : [];
  return uniqueStrings([user.website, user.websiteUrl, user.website_url, ...values].map(String));
};

const storedOfficialProfileUrls = (user: Record<string, any>): string[] =>
  profileUrlValues(user).filter((url) => isYalePersonProfileUrl(url));

const isYalePersonProfileUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return /(^|\.)yale\.edu$/i.test(parsed.hostname) && /\/(?:profile|people|faculty|faculty-directory)\//i.test(parsed.pathname);
  } catch {
    return false;
  }
};

const pathLastSegment = (value: string): string => {
  try {
    const parsed = new URL(value);
    return decodeURIComponent(parsed.pathname.split('/').filter(Boolean).at(-1) || '').toLowerCase();
  } catch {
    return '';
  }
};

const localEmailSlugPart = (email: unknown): string => {
  const value = textValue(email).split('@')[0] || '';
  return slugPart(value);
};

const profileUrlMatchesEmailLocalPart = (url: string, user: Record<string, any>): boolean => {
  const emailSlug = localEmailSlugPart(user.email);
  if (!emailSlug || emailSlug.length < 4) return false;

  const urlSlug = pathLastSegment(url).replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!urlSlug) return false;

  const firstTokens = nameTokensForOfficialFacts(user.fname || user.firstName);
  const lastTokens = nameTokensForOfficialFacts(user.lname || user.lastName);
  const firstCompact = firstTokens.join('');
  const lastCompact = lastTokens.join('');
  const emailCompact = emailSlug.replace(/[^a-z0-9]+/g, '');
  const urlCompact = urlSlug.replace(/[^a-z0-9]+/g, '');

  const emailLooksPersonSpecific =
    (firstCompact.length >= 3 && emailCompact.includes(firstCompact)) ||
    (lastCompact.length >= 3 && emailCompact.includes(lastCompact)) ||
    firstTokens.some((token) => token.length >= 3 && emailCompact.includes(token)) ||
    lastTokens.some((token) => token.length >= 3 && emailCompact.includes(token));
  if (!emailLooksPersonSpecific) return false;

  if (urlSlug === emailSlug || urlCompact === emailCompact) return true;

  const emailTokens = nameTokensForOfficialFacts(emailSlug);
  const emailLast = emailTokens.at(-1) || '';
  const firstInitials = firstTokens.map((token) => token[0]).filter(Boolean);
  return Boolean(
    emailLast.length >= 4 &&
      firstInitials.some((initial) => urlCompact === `${initial}${emailLast}`),
  );
};

const isAcceptableOpaqueOrSurnameProfileUrl = (url: string, user: Record<string, any>): boolean => {
  const lastSegment = pathLastSegment(url).replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!lastSegment) return false;
  const netid = textValue(user.netid).toLowerCase();
  const last = slugPart(user.lname || user.lastName);
  if (netid && lastSegment === netid) return true;
  return Boolean(last && lastSegment === last && !/\/profile\//i.test(url));
};

export function profileUrlMismatchIssue(user: Record<string, any>): ProfileAuditFinding | null {
  const first = textValue(user.fname || user.firstName);
  const last = textValue(user.lname || user.lastName);
  if (!first || !last) return null;
  for (const url of profileUrlValues(user)) {
    if (!isYalePersonProfileUrl(url)) continue;
    if (isLikelyPersonUrl(url, first, last)) continue;
    if (profileUrlMatchesEmailLocalPart(url, user)) continue;
    if (isAcceptableOpaqueOrSurnameProfileUrl(url, user)) continue;
    return {
      issue: 'wrong-person-profile-url',
      netid: textValue('netid' in user ? user.netid : undefined),
      name: nameForUser(user),
      title: textValue(user.title),
      url,
      detail: 'Yale person-profile URL slug does not match the stored user name.',
    };
  }
  return null;
}

export interface OfficialProfileFacts {
  url: string;
  name: string;
  title: string;
  email: string;
}

function collectObjects(value: unknown, out: Record<string, any>[] = []): Record<string, any>[] {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) collectObjects(item, out);
    return out;
  }
  out.push(value as Record<string, any>);
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') collectObjects(child, out);
  }
  return out;
}

export function extractOfficialProfileFactsFromHtml(html: string, url: string): OfficialProfileFacts {
  const ch = cheerio.load(html || '');
  const pageTitleName = textValue(ch('title').first().text().split('|')[0])
    .replace(/\b(?:MD|PhD|MFA|MPH|MS|MA|MBA|RN|APRN|PA-C)\b\.?/gi, ' ')
    .replace(/[,|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const scripts = ch('script[type="application/ld+json"]')
    .map((_, element) => ch(element).text())
    .get();
  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script);
      const person = collectObjects(parsed).find((candidate) => {
        const type = candidate['@type'];
        return type === 'Person' || (Array.isArray(type) && type.includes('Person'));
      });
      if (!person) continue;
      const personName = textValue(person.name);
      const titleTokens = nameTokensForOfficialFacts(pageTitleName);
      const personTokens = nameTokensForOfficialFacts(personName);
      const titleProvidesFullerName =
        titleTokens.length > personTokens.length &&
        personTokens.length >= 2 &&
        personTokens.every((token, index) => titleTokens[titleTokens.length - personTokens.length + index] === token);
      return {
        url,
        name: titleProvidesFullerName ? pageTitleName : personName,
        title: textValue(person.jobTitle || person.title),
        email: textValue(person.email),
      };
    } catch {
      // Ignore malformed JSON-LD blocks and fall back to page title.
    }
  }
  return {
    url,
    name: textValue(ch('h1').first().text()),
    title: '',
    email: '',
  };
}

const titleRank = (value: unknown): string => {
  const text = textValue(value).toLowerCase();
  if (/\bassistant\s+professor\b/.test(text)) return 'assistant professor';
  if (/\bassociate\s+professor\b/.test(text)) return 'associate professor';
  if (/\bprofessor\b/.test(text)) return 'professor';
  if (/\binstructor\b/.test(text)) return 'instructor';
  if (/\blecturer\b|\blector\b/.test(text)) return 'lecturer';
  return '';
};

const preferredFirstNameAliases = new Map<string, Set<string>>([
  ['avi', new Set(['abraham'])],
  ['changwan', new Set(['wonnie'])],
  ['dmitry', new Set(['dima'])],
  ['harold', new Set(['harry'])],
  ['klar', new Set(['henry'])],
  ['lawrence', new Set(['larry'])],
  ['lex', new Set(['alexander'])],
  ['lucile', new Set(['andrea'])],
  ['maisy', new Set(['meredith'])],
  ['maddie', new Set(['madeleine'])],
  ['maddy', new Set(['madeleine'])],
  ['nova', new Set(['xavier'])],
  ['novak', new Set(['xuan'])],
  ['river', new Set(['riv'])],
]);

const firstNameAliasMatches = (storedToken: string, officialToken: string): boolean =>
  Boolean(preferredFirstNameAliases.get(storedToken)?.has(officialToken));

const nameMatchesOfficialFacts = (
  user: Record<string, any>,
  officialName: string,
  officialUrl?: string,
): boolean => {
  const first = textValue(user.fname || user.firstName);
  const last = textValue(user.lname || user.lastName);
  if (!officialName || !first || !last) return true;
  if (isLikelyPersonUrl(`https://example.test/profile/${slugPart(officialName)}/`, first, last)) {
    return true;
  }

  const officialTokens = nameTokensForOfficialFacts(officialName, { keepInitials: true });
  const officialTokenSet = new Set(officialTokens);
  const firstTokens = nameTokensForOfficialFacts(first);
  const lastTokens = nameTokensForOfficialFacts(last);
  if (!firstTokens.length || !lastTokens.length) return true;

  const emailLocalTokens = nameTokensForOfficialFacts(textValue(user.email).split('@')[0] || '');
  const officialFirstToken = officialTokens.find((token) => token.length > 1) || '';
  const emailSupportsOfficialFirst =
    officialFirstToken.length >= 3 && emailLocalTokens.includes(officialFirstToken);
  const emailSupportsStoredLast = lastTokens.some(
    (token) => token.length >= 3 && emailLocalTokens.includes(token),
  );
  const aliasMatchesOfficialFirst =
    officialFirstToken.length >= 3 &&
    firstTokens.some((token) => firstNameAliasMatches(token, officialFirstToken)) &&
    firstTokens.some((token) => emailLocalTokens.includes(token));
  const firstMatches =
    firstTokens.some((token) => officialTokenSet.has(token)) ||
    Boolean(
      officialTokens[0]?.length === 1 &&
        firstTokens.some((firstToken) => firstToken[0] === officialTokens[0]),
    ) ||
    (emailSupportsOfficialFirst && emailSupportsStoredLast) ||
    aliasMatchesOfficialFirst;
  if (!firstMatches) return false;

  const matchedLastTokens = lastTokens.filter((token) => officialTokenSet.has(token));
  if (!matchedLastTokens.length) {
    return Boolean(
      officialUrl && isLikelyPersonUrl(officialUrl, first, last, { allowSurnameOnly: false }),
    );
  }
  if (matchedLastTokens.length === lastTokens.length) return true;

  const missingLastTokens = lastTokens.filter((token) => !officialTokenSet.has(token));
  const urlTokenSet = new Set(nameTokensForOfficialFacts(officialUrl || ''));
  return (
    lastTokens.length > 1 &&
    matchedLastTokens.some((token) => token.length >= 4) &&
    missingLastTokens.every(
      (token) => officialTokenSet.has(token[0] || '') || !urlTokenSet.has(token),
    )
  );
};

const emailMatchesOfficialFacts = (user: Record<string, any>, officialEmail: string): boolean => {
  const stored = textValue(user.email).toLowerCase();
  const official = textValue(officialEmail).toLowerCase();
  return Boolean(stored && official && stored === official);
};

const officialEmailAliasIdentifiesUser = (
  user: Record<string, any>,
  officialEmail: string,
): boolean => {
  const official = textValue(officialEmail).toLowerCase();
  if (!official.endsWith('@yale.edu')) return false;
  const localTokens = nameTokensForOfficialFacts(official.split('@')[0] || '');
  if (!localTokens.length) return false;
  const firstTokens = nameTokensForOfficialFacts(user.fname || user.firstName);
  const lastTokens = nameTokensForOfficialFacts(user.lname || user.lastName);
  return (
    firstTokens.some((token) => token.length >= 3 && localTokens.includes(token)) &&
    lastTokens.some((token) => token.length >= 3 && localTokens.includes(token))
  );
};

const officialEmailIdentifiesStoredUser = (
  user: Record<string, any>,
  officialEmail: string,
): boolean =>
  emailMatchesOfficialFacts(user, officialEmail) ||
  officialEmailAliasIdentifiesUser(user, officialEmail);

export function candidateProfileFactsMatchUser(
  user: Record<string, any>,
  facts: OfficialProfileFacts,
): boolean {
  if (officialEmailIdentifiesStoredUser(user, facts.email)) return true;
  return Boolean(facts.name && nameMatchesOfficialFacts(user, facts.name, facts.url));
}

export function compareOfficialProfileFacts(
  user: Record<string, any>,
  facts: OfficialProfileFacts,
): ProfileAuditFinding | null {
  const emailIdentifiesStoredUser = officialEmailIdentifiesStoredUser(user, facts.email);
  if (facts.name && !emailIdentifiesStoredUser && !nameMatchesOfficialFacts(user, facts.name, facts.url)) {
    return {
      issue: 'official-profile-name-or-title-mismatch',
      netid: textValue(user.netid),
      name: nameForUser(user),
      title: textValue(user.title),
      url: facts.url,
      officialName: facts.name,
      officialTitle: facts.title,
      detail: 'name-mismatch',
    };
  }

  const storedRank = titleRank(user.title);
  const officialRank = titleRank(facts.title);
  if (storedRank && officialRank && storedRank !== officialRank) {
    return {
      issue: 'official-profile-name-or-title-mismatch',
      netid: textValue(user.netid),
      name: nameForUser(user),
      title: textValue(user.title),
      url: facts.url,
      officialName: facts.name,
      officialTitle: facts.title,
      detail: 'title-rank-mismatch',
    };
  }
  return null;
}

export function reconcileProfileUrlMismatchFinding(
  user: Record<string, any>,
  finding: ProfileAuditFinding,
  facts: OfficialProfileFacts,
): ProfileAuditFinding | null {
  if (finding.issue !== 'wrong-person-profile-url' && finding.issue !== 'profile-url-slug-mismatch') {
    return finding;
  }
  if (officialEmailIdentifiesStoredUser(user, facts.email)) return null;
  if (facts.name && nameMatchesOfficialFacts(user, facts.name, facts.url)) return null;
  return {
    ...finding,
    issue: 'wrong-person-profile-url',
    officialName: facts.name,
    officialTitle: facts.title,
  };
}

export function reconcileLiveProfileUrlMismatchFinding(
  user: Record<string, any>,
  finding: ProfileAuditFinding,
  facts: OfficialProfileFacts | null,
): ProfileAuditFinding | null {
  if (!facts) return null;
  return reconcileProfileUrlMismatchFinding(user, finding, facts);
}

export function reconcileWrongPersonFindingsForFacts(
  findings: ProfileAuditFinding[],
  user: Record<string, any>,
  facts: OfficialProfileFacts,
): ProfileAuditFinding[] {
  const netid = textValue(user.netid);
  return findings.flatMap((finding) => {
    const isProfileUrlMismatch =
      finding.issue === 'wrong-person-profile-url' || finding.issue === 'profile-url-slug-mismatch';
    if (!isProfileUrlMismatch || finding.netid !== netid) {
      return [finding];
    }
    if (finding.url !== facts.url) {
      const factsIdentifyStoredUser =
        officialEmailIdentifiesStoredUser(user, facts.email) ||
        Boolean(facts.name && nameMatchesOfficialFacts(user, facts.name, facts.url));
      return factsIdentifyStoredUser ? [] : [finding];
    }
    const reconciled = reconcileProfileUrlMismatchFinding(user, finding, facts);
    return reconciled ? [reconciled] : [];
  });
}

export function reconcileMissingOfficialProfileFinding(
  user: Record<string, any>,
  finding: ProfileAuditFinding,
  storedFacts: OfficialProfileFacts[],
): ProfileAuditFinding | null {
  if (finding.issue !== 'missing-official-profile-url') return finding;
  return storedFacts.some((facts) => candidateProfileFactsMatchUser(user, facts)) ? null : finding;
}

const LEAD_ROLES = new Set(['pi', 'principal_investigator', 'principal-investigator', 'lead', 'faculty_lead']);

const isLeadRole = (role: unknown): boolean => LEAD_ROLES.has(textValue(role).toLowerCase());

const hasProfileDirectoryLabelContamination = (value: unknown): boolean =>
  /\b(?:research\s+areas?|teaching\s+interests?)\s*:/i.test(textValue(value));

const hasResearchWorkSignal = (value: unknown): boolean =>
  /\b(?:stud(?:y|ies)\s+(?:how|why|whether|the|a|an|methods?|mechanisms?|systems?|processes?|disease|policy|policies|cells?|patients?|data|models?|approaches?|ways?|effects?|role|biology|chemistry|physics|genetics)|investigates?|examines?|explores?|focus(?:es)?\s+on|works?\s+on|develops?|combines?|integrates?|applies?|uses?|employs?|research(?:es)?|analyzes?|models?|conducts?\s+research|directs?\s+(?:the\s+)?[\w -]*lab|lab\s+stud(?:y|ies)|research\s+relates?\s+to)\b/i.test(
    textValue(value),
  );

const weakResearchSummaryTextIssue = (value: unknown): string => {
  const summary = textValue(value);
  if (!summary) return '';
  if (hasProfileDirectoryLabelContamination(summary)) {
    return 'Research context summary contains profile-directory labels instead of direct research prose.';
  }
  if (/\b(?:is|was)\s+affiliated\s+with\b/i.test(summary) && !hasResearchWorkSignal(summary)) {
    return 'Research entity summary is affiliation-only and does not describe research work.';
  }
  return '';
};

export function weakAffiliationSummaryIssue(publicProfile: Record<string, any>): ProfileAuditFinding | null {
  const researchEntities = Array.isArray(publicProfile.researchEntities)
    ? publicProfile.researchEntities
    : [];
  const summary = textValue(publicProfile.research_interest_summary);

  const weakSummaryDetail = weakResearchSummaryTextIssue(summary);
  if (weakSummaryDetail) {
    const currentEntity = researchEntities.find((entity: any) => {
      const entityText = [
        entity?.name,
        entity?.displayName,
        entity?.shortDescription,
        entity?.description,
      ]
        .map(textValue)
        .filter(Boolean)
        .join(' ');
      return entityText && (hasProfileDirectoryLabelContamination(entityText) || summary.includes(entityText));
    });
    return {
      issue: 'weak-affiliation-summary',
      netid: textValue(publicProfile.netid),
      name: nameForUser(publicProfile),
      title: textValue(publicProfile.title),
      currentEntity: textValue(
        currentEntity?.name ||
          currentEntity?.displayName ||
          researchEntities[0]?.name ||
          researchEntities[0]?.displayName,
      ),
      detail: weakSummaryDetail,
    };
  }

  const weakEntity = researchEntities.find((entity: any) =>
    weakResearchSummaryTextIssue([entity?.shortDescription, entity?.description].map(textValue).join(' ')),
  );
  if (weakEntity) {
    return {
      issue: 'weak-affiliation-summary',
      netid: textValue(publicProfile.netid),
      name: nameForUser(publicProfile),
      title: textValue(publicProfile.title),
      currentEntity: textValue(weakEntity.name || weakEntity.displayName),
      detail: weakResearchSummaryTextIssue(
        [weakEntity.shortDescription, weakEntity.description].map(textValue).join(' '),
      ),
    };
  }

  if (researchEntities.length < 2) return null;
  const first = researchEntities[0];
  if (!first || isLeadRole(first.role)) return null;
  const laterLead = researchEntities.slice(1).find((entity: any) => isLeadRole(entity?.role));
  const firstName = textValue(first.name || first.displayName);
  if (!laterLead || !summary || !firstName) return null;
  if (!summary.toLowerCase().includes(firstName.toLowerCase())) return null;
  return {
    issue: 'weak-affiliation-summary',
    netid: textValue(publicProfile.netid),
    name: nameForUser(publicProfile),
    title: textValue(publicProfile.title),
    currentEntity: firstName,
    strongerEntity: textValue(laterLead.name || laterLead.displayName),
    detail: 'Research context summary appears to use a broad first affiliation before a later lead-role home.',
  };
}

export function auditProfileRecord(input: {
  user: Record<string, any>;
  publicProfile?: Record<string, any>;
}): ProfileAuditFinding[] {
  const { user } = input;
  const publicProfile: Record<string, any> = input.publicProfile || normalizePublicProfile(user);
  const netid = textValue(user.netid || publicProfile.netid);
  const name = nameForUser(user);
  const title = textValue(user.title);
  const findings: ProfileAuditFinding[] = [];

  const mismatch = profileUrlMismatchIssue(user);
  const officialUrl =
    selectOfficialBioUrl(
      user.profileUrls || user.profile_urls,
      user.website,
      textValue(user.fname || user.firstName),
      textValue(user.lname || user.lastName),
    ) || storedOfficialProfileUrls(user).find((url) => url !== mismatch?.url);
  const candidateUrls = candidateOfficialProfileUrls(user);
  const publicLinkOutUrl = textValue(publicProfile.website);
  if (
    !officialUrl &&
    !publicLinkOutUrl &&
    candidateUrls.length > 0 &&
    hasStrongOfficialProfileTitleSignal(user.title)
  ) {
    findings.push({
      issue: 'missing-official-profile-url',
      netid,
      name,
      title,
      candidateUrls,
      detail:
        'No stored official Yale person-profile URL or safe public website fallback, but name, title, and school/department signals produce likely official-profile candidates.',
    });
  }

  const bioIssue = classifyStoredBioIssue(user);
  if (bioIssue) {
    findings.push({
      issue: bioIssue === 'research-interest-summary' ? 'bio-not-personal-bio' : 'bio-chrome-or-title',
      netid,
      name,
      title,
      detail: bioIssue,
    });
  }

  const titleIssue = classifyStoredTitleIssue(user);
  if (titleIssue) {
    findings.push({
      issue: 'title-chrome-or-directory-label',
      netid,
      name,
      title,
      detail: titleIssue,
    });
  }

  if (mismatch) {
    findings.push({
      ...mismatch,
      issue: 'profile-url-slug-mismatch',
      detail:
        'Yale person-profile URL slug does not match the stored user name; live official facts are required before treating this as a wrong-person URL.',
    });
  }

  const weakSummary = weakAffiliationSummaryIssue(publicProfile);
  if (weakSummary) {
    findings.push({
      ...weakSummary,
      netid,
      name,
      title,
    });
  }

  return findings;
}

const parsePositiveInt = (value: string | undefined, label: string): number => {
  if (!value || value.startsWith('--') || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${label} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} must be a positive integer`);
  return parsed;
};

const parseNonNegativeInt = (value: string | undefined, label: string): number => {
  if (!value || value.startsWith('--') || !/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} must be a non-negative integer`);
  return parsed;
};

export function parseProfileDataQualityAuditArgs(argv: string[]): ProfileDataQualityAuditOptions {
  const options: ProfileDataQualityAuditOptions = {
    limit: 250,
    skip: 0,
    sampleLimit: 25,
    verifyLive: false,
    liveMissingSkip: 0,
    liveMissingLimit: 100,
    liveCompareSkip: 0,
    liveCompareLimit: 100,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--verify-live') options.verifyLive = true;
    else if (arg.startsWith('--limit=')) options.limit = parsePositiveInt(arg.slice('--limit='.length), '--limit');
    else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1], '--limit');
      i += 1;
    } else if (arg.startsWith('--skip=')) {
      options.skip = parseNonNegativeInt(arg.slice('--skip='.length), '--skip');
    } else if (arg === '--skip') {
      options.skip = parseNonNegativeInt(argv[i + 1], '--skip');
      i += 1;
    } else if (arg.startsWith('--sample-limit=')) {
      options.sampleLimit = parsePositiveInt(arg.slice('--sample-limit='.length), '--sample-limit');
    } else if (arg === '--sample-limit') {
      options.sampleLimit = parsePositiveInt(argv[i + 1], '--sample-limit');
      i += 1;
    } else if (arg.startsWith('--live-compare-limit=')) {
      options.liveCompareLimit = parseNonNegativeInt(
        arg.slice('--live-compare-limit='.length),
        '--live-compare-limit',
      );
    } else if (arg === '--live-compare-limit') {
      options.liveCompareLimit = parseNonNegativeInt(argv[i + 1], '--live-compare-limit');
      i += 1;
    } else if (arg.startsWith('--live-compare-skip=')) {
      options.liveCompareSkip = parseNonNegativeInt(
        arg.slice('--live-compare-skip='.length),
        '--live-compare-skip',
      );
    } else if (arg === '--live-compare-skip') {
      options.liveCompareSkip = parseNonNegativeInt(argv[i + 1], '--live-compare-skip');
      i += 1;
    } else if (arg.startsWith('--live-missing-limit=')) {
      options.liveMissingLimit = parseNonNegativeInt(
        arg.slice('--live-missing-limit='.length),
        '--live-missing-limit',
      );
    } else if (arg === '--live-missing-limit') {
      options.liveMissingLimit = parseNonNegativeInt(argv[i + 1], '--live-missing-limit');
      i += 1;
    } else if (arg.startsWith('--live-missing-skip=')) {
      options.liveMissingSkip = parseNonNegativeInt(
        arg.slice('--live-missing-skip='.length),
        '--live-missing-skip',
      );
    } else if (arg === '--live-missing-skip') {
      options.liveMissingSkip = parseNonNegativeInt(argv[i + 1], '--live-missing-skip');
      i += 1;
    } else if (arg === '--output') {
      const next = argv[i + 1];
      options.output = resolveSafeJsonReportOutputPath(next);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length).trim());
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function fetchOfficialProfileFacts(url: string): Promise<OfficialProfileFacts | null> {
  const safeUrl = await assertPublicHttpUrl(url);
  const safeUrlText = safeUrl.toString();
  const agents = ssrfSafeAgents();
  const response = await axios.get(safeUrlText, {
    timeout: 8000,
    maxRedirects: 5,
    validateStatus: (status) => status >= 200 && status < 400,
    headers: { 'User-Agent': 'ylabs-profile-audit/1.0 (+https://yalelabs.io)' },
    httpAgent: agents.httpAgent,
    httpsAgent: agents.httpsAgent,
  });
  const finalUrl = response.request?.res?.responseUrl || safeUrlText;
  return extractOfficialProfileFactsFromHtml(String(response.data || ''), String(finalUrl));
}

async function verifiedLiveProfileUrls(user: Record<string, any>, urls: string[]): Promise<string[]> {
  const verified: string[] = [];
  for (const url of urls) {
    try {
      const facts = await fetchOfficialProfileFacts(url);
      if (facts?.url && candidateProfileFactsMatchUser(user, facts)) verified.push(facts.url);
    } catch {
      // Candidate construction is intentionally separate from live verification.
    }
  }
  return uniqueStrings(verified);
}

async function main(): Promise<void> {
  const options = parseProfileDataQualityAuditArgs(process.argv.slice(2));
  await initializeConnections();
  try {
    const users = await User.find({
      archived: { $ne: true },
      userType: { $in: ['professor', 'faculty'] },
    })
      .select(
        '_id netid fname lname name displayName email title primaryDepartment secondaryDepartments departments bio website websiteUrl profileUrls userType',
      )
      .sort({ netid: 1, _id: 1 })
      .skip(options.skip)
      .limit(options.limit)
      .lean();

    const userIds = users.map((user: any) => user._id).filter(Boolean);
    const memberships = await ResearchGroupMember.find({
      userId: { $in: userIds },
      archived: { $ne: true },
      isCurrentMember: { $ne: false },
      researchEntityId: { $exists: true, $ne: null },
    })
      .select('userId researchEntityId role')
      .lean();
    const entityIds = [
      ...new Set(memberships.map((membership: any) => serializedDocumentId(membership.researchEntityId)).filter(Boolean)),
    ];
    const entities = await ResearchEntity.find({
      _id: { $in: entityIds },
      archived: { $ne: true },
      studentVisibilityTier: { $in: publicStudentVisibilityTiers },
    })
      .select(
        '_id slug name displayName kind entityType shortDescription fullDescription description departments researchAreas sourceUrls website websiteUrl',
      )
      .lean();
    const entityById = new Map((entities as any[]).map((entity) => [serializedDocumentId(entity._id) || '', entity]));
    const homesByUserId = new Map<string, any[]>();
    for (const membership of memberships as any[]) {
      const entity = entityById.get(serializedDocumentId(membership.researchEntityId) || '');
      if (!entity) continue;
      const key = serializedDocumentId(membership.userId) || '';
      const rows = homesByUserId.get(key) || [];
      rows.push({
        _id: serializedDocumentId(entity._id) || '',
        slug: entity.slug || '',
        name: entity.name || '',
        displayName: entity.displayName || '',
        kind: entity.kind || '',
        entityType: entity.entityType || '',
        shortDescription: entity.shortDescription || '',
        description: entity.description || '',
        departments: entity.departments || [],
        researchAreas: entity.researchAreas || [],
        _bioFullDescription: entity.fullDescription || '',
        _bioSourceUrls: entity.sourceUrls || [],
        _bioWebsite: entity.website || '',
        _bioWebsiteUrl: entity.websiteUrl || '',
        role: membership.role || '',
      });
      homesByUserId.set(key, rows);
    }

    const findings: ProfileAuditFinding[] = [];
    for (const user of users as any[]) {
      const researchEntities = dedupeProfileResearchEntities(
        homesByUserId.get(serializedDocumentId(user._id) || '') || [],
        user,
      );
      const publicProfile = normalizePublicProfile(user, {
        researchEntities,
        trustedResearchEntities: true,
      });
      findings.push(
        ...auditProfileRecord({
          user,
          publicProfile: publicProfile
            ? {
                ...publicProfile,
                researchEntities,
                research_interest_summary:
                  user.researchInterestSummary ||
                  user.research_interest_summary ||
                  publicProfile.research_interest_summary,
              }
            : undefined,
        }),
      );
    }

    if (options.verifyLive) {
      let liveMissingSeen = 0;
      let liveMissingChecks = 0;
      for (const finding of findings) {
        if (finding.issue !== 'missing-official-profile-url' || !finding.candidateUrls?.length) continue;
        if (liveMissingSeen < options.liveMissingSkip) {
          liveMissingSeen += 1;
          continue;
        }
        if (liveMissingChecks >= options.liveMissingLimit) break;
        liveMissingSeen += 1;
        liveMissingChecks += 1;
        const user = (users as any[]).find((row) => textValue(row.netid) === finding.netid);
        finding.verifiedCandidateUrls = user
          ? await verifiedLiveProfileUrls(user, finding.candidateUrls)
          : [];
      }

      const reconciledFindings: ProfileAuditFinding[] = [];
      for (const finding of findings) {
        if (finding.issue === 'missing-official-profile-url') {
          const user = (users as any[]).find((row) => textValue(row.netid) === finding.netid);
          if (!user) {
            reconciledFindings.push(finding);
            continue;
          }
          const storedFacts: OfficialProfileFacts[] = [];
          for (const url of storedOfficialProfileUrls(user)) {
            try {
              const facts = await fetchOfficialProfileFacts(url);
              if (facts) storedFacts.push(facts);
            } catch {
              // Missing-profile reconciliation only needs a positive match from an existing URL.
            }
          }
          const reconciled = reconcileMissingOfficialProfileFinding(user, finding, storedFacts);
          if (reconciled) reconciledFindings.push(reconciled);
          continue;
        }

        if (
          (finding.issue !== 'wrong-person-profile-url' &&
            finding.issue !== 'profile-url-slug-mismatch') ||
          !finding.url
        ) {
          reconciledFindings.push(finding);
          continue;
        }
        const user = (users as any[]).find((row) => textValue(row.netid) === finding.netid);
        if (!user) {
          reconciledFindings.push(finding);
          continue;
        }
        try {
          const facts = await fetchOfficialProfileFacts(finding.url);
          const reconciled = reconcileLiveProfileUrlMismatchFinding(user, finding, facts);
          if (reconciled) reconciledFindings.push(reconciled);
        } catch {
          // In live mode, slug-only wrong-person findings are not source-backed
          // unless the official page facts can be fetched and compared.
        }
      }
      findings.splice(0, findings.length, ...reconciledFindings);

      let compared = 0;
      let compareSeen = 0;
      for (const user of users as any[]) {
        if (compared >= options.liveCompareLimit) break;
        const url = storedOfficialProfileUrls(user)[0];
        if (!url) continue;
        if (compareSeen < options.liveCompareSkip) {
          compareSeen += 1;
          continue;
        }
        compareSeen += 1;
        compared += 1;
        try {
          const facts = await fetchOfficialProfileFacts(url);
          if (facts) {
            findings.splice(0, findings.length, ...reconcileWrongPersonFindingsForFacts(findings, user, facts));
          }
          const mismatch = facts ? compareOfficialProfileFacts(user, facts) : null;
          if (mismatch) findings.push(mismatch);
        } catch {
          // A dead official URL is already covered by URL/source-health style audits.
        }
      }
    }

    const counts = findings.reduce<Record<string, number>>((acc, finding) => {
      acc[finding.issue] = (acc[finding.issue] || 0) + 1;
      return acc;
    }, {});
    const payload = {
      generatedAt: new Date().toISOString(),
      options,
      scanned: users.length,
      counts,
      samples: findings.slice(0, options.sampleLimit),
      findings,
    };
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, `${JSON.stringify(payload, null, 2)}\n`);
      console.log(`Saved profile data-quality audit to ${safeOutput}`);
    }
    console.log(JSON.stringify({ scanned: payload.scanned, counts, samples: payload.samples }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
