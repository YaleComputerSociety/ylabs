import axios from 'axios';
import * as cheerio from 'cheerio';
import { ResearchEntity } from '../../models/researchEntity';
import { ResearchGroupMember } from '../../models/researchGroupMember';
import { Observation } from '../../models/observation';
import { User } from '../../models/user';
import { VisibilityReleaseQueueItem } from '../../models/visibilityReleaseQueueItem';
import { publicStudentVisibilityTiers } from '../../models/studentVisibility';
import { normalizeOrcid } from '../../utils/orcid';
import { sanitizeProfileResearchTerms } from '../../utils/profileResearchTerms';
import {
  assessResearchEntityDescriptionQuality,
  deriveShortDescriptionFromFullDescription,
} from '../../utils/researchEntityDescriptionQuality';
import {
  cleanPublicProfileBio,
  isLikelyPersonUrl,
  isLikelySameNameContaminatedProfile,
  stripTrailingOfficialProfileUpdateMetadata,
} from '../../services/profileService';
import { getCached, setCached } from '../snapshotCache';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import {
  isLikelyPersonSpecificYaleEmail,
  normalizeName,
  slugify,
  splitName,
} from '../utils/scraperHelpers';

const SOURCE_NAME = 'official-profile-pi-backfill';
const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;
const PROFILE_FETCH_THROTTLE_MS = 150;
const QUEUED_PI_BACKFILL_KEY = 'medicine-pi-backfill';
const VISIBLE_PROFILE_BIO_BACKFILL_KEY = 'visible-profile-bio-backfill';
const PROFILE_RESEARCH_HOME_BACKFILL_KEY = 'profile-research-home-backfill';
const PROFILE_DESCRIPTION_BACKFILL_KEY = 'profile-description-backfill';
const LEAD_DIRECT_WEBSITE_BACKFILL_KEY = 'lead-direct-website-backfill';
const SOURCE_URL_WEBSITE_BACKFILL_KEY = 'source-url-website-backfill';
const PROFILE_BIO_MIN_LENGTH = 120;
const OFFICIAL_PROFILE_BIO_MAX_LENGTH = 1200;
const VISIBLE_PROFILE_MEMBER_ROLES = ['pi', 'co-pi', 'director', 'co-director', 'core-faculty'];
export const PROFILE_DESCRIPTION_SUPPRESSED_BY_PREFERRED_SOURCE_NAMES_FIELD =
  'profileDescriptionSuppressedByPreferredSourceNames';
const PROFILE_DESCRIPTION_FIELDS = ['description', 'fullDescription', 'shortDescription'];
const PROFILE_DESCRIPTION_PREFERRED_SOURCE_NAMES = ['lab-microsite-description-llm'];
const OFFICIAL_PROFILE_MODE_KEYS = new Set([
  QUEUED_PI_BACKFILL_KEY,
  VISIBLE_PROFILE_BIO_BACKFILL_KEY,
  PROFILE_RESEARCH_HOME_BACKFILL_KEY,
  PROFILE_DESCRIPTION_BACKFILL_KEY,
  LEAD_DIRECT_WEBSITE_BACKFILL_KEY,
  SOURCE_URL_WEBSITE_BACKFILL_KEY,
]);

export interface OfficialProfileIdentity {
  canonicalUrl: string;
  fetchedUrl: string;
  displayName: string;
  email: string;
  title: string;
  imageUrl?: string;
  departments: string[];
  bio?: string;
  researchInterests: string[];
  orcid?: string;
  suppressDerivedBio?: boolean;
}

interface OfficialProfileIdentityOptions {
  requireEmail?: boolean;
  expectedPeople?: Array<{
    fname?: string;
    lname?: string;
    email?: string;
  }>;
}

export interface ExistingProfileUser {
  _id?: string;
  netid: string;
  email?: string;
}

interface IdentityToUserObservationOptions {
  includeProfileEnrichment?: boolean;
  includeIdentityEnrichment?: boolean;
}

export interface OfficialProfileResearchHome {
  name: string;
  rawName: string;
  url: string;
  kind: 'center' | 'institute' | 'lab' | 'program' | 'initiative';
  entityType: 'CENTER' | 'INSTITUTE' | 'LAB' | 'PROGRAM' | 'INITIATIVE';
  score: number;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const uniqueStrings = (values: unknown[]): string[] =>
  Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.replace(/\s+/g, ' ').trim())
        .filter(Boolean),
    ),
  );

const objectStringValues = (value: unknown): string[] => {
  if (!value) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(objectStringValues);
  if (typeof value === 'object') return Object.values(value).flatMap(objectStringValues);
  return [];
};

const sleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

const idValue = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof (value as any).toHexString === 'function') return (value as any).toHexString();
  if (typeof value === 'object' && '_id' in value) {
    return idValue((value as Record<string, unknown>)._id);
  }
  return String(value).trim();
};

const yaleNetidFromEmail = (value: unknown): string => {
  const email = textValue(value).toLowerCase();
  const match = email.match(/^([a-z0-9._-]+)@yale\.edu$/i);
  return match?.[1] || '';
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const absolutize = (href: string, base: string): string => {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
};

function canonicalLegacyResearchHomeUrl(url: URL): URL {
  const path = url.pathname.replace(/\/+$/, '/').toLowerCase();
  if (url.hostname === 'rjohnwilliams.wordpress.com') {
    return new URL('https://campuspress.yale.edu/rjohnwilliams/');
  }
  if (url.hostname === 'slavlab.yale.edu') {
    return new URL('https://campuspress.yale.edu/squirrel/people/the-bagriantsev-lab/');
  }
  if (url.hostname === 'squirrel.commons.yale.edu') {
    return new URL('https://campuspress.yale.edu/squirrel/people/elena-gracheva-lab/');
  }
  if (url.hostname === 'mrrc.yale.edu') {
    return new URL('https://medicine.yale.edu/biomedical-imaging-institute/core-facilities/mr-core/');
  }
  if (url.hostname === 'childstudycenter.yale.edu' && path === '/research/del/') {
    return new URL(
      'https://medicine.yale.edu/childstudy/research/collaborative-labs/developmental-electrophysiology-lab/',
    );
  }
  if (url.hostname === 'medicine.yale.edu' && path === '/cnrr/index.aspx') {
    return new URL('https://medicine.yale.edu/cnrr/');
  }
  return url;
}

export function normalizeOfficialProfileUrl(value: unknown): string {
  const raw = textValue(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLowerCase();
    const sociologyPeopleMatch = url.pathname.match(/^\/people\/([^/]+)\/?$/i);
    if (url.hostname === 'sociology.yale.edu' && sociologyPeopleMatch) {
      url.pathname = `/profile/${sociologyPeopleMatch[1]}`;
    }
    url.pathname = url.pathname.replace(/^\/[^/]+\/profile\//i, '/profile/');
    if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`;
    else url.pathname = url.pathname.replace(/\/+$/, '/');
    return url.toString();
  } catch {
    return raw;
  }
}

function isOfficialYaleProfileUrl(value: unknown): boolean {
  const normalized = normalizeOfficialProfileUrl(value);
  try {
    const url = new URL(normalized);
    return /(^|\.)yale\.edu$/i.test(url.hostname) && /\/profile\//i.test(url.pathname);
  } catch {
    return false;
  }
}

function isOfficialYalePersonPageUrl(value: unknown): boolean {
  const normalized = normalizeOfficialProfileUrl(value);
  try {
    const url = new URL(normalized);
    if (!/(^|\.)yale\.edu$/i.test(url.hostname)) return false;
    if (/\/profile\//i.test(url.pathname)) return true;
    const parts = url.pathname
      .split('/')
      .map((part) => part.toLowerCase())
      .filter(Boolean);
    const anchorIndex = parts.findIndex((part) =>
      ['people', 'faculty', 'faculty-directory'].includes(part),
    );
    if (anchorIndex < 0) return false;
    const last = parts.at(-1) || '';
    return Boolean(last && !['people', 'faculty', 'faculty-directory', 'staff'].includes(last));
  } catch {
    return false;
  }
}

function personPageUrlMatchesUser(value: unknown, user: Record<string, any>): boolean {
  const normalized = normalizeOfficialProfileUrl(value);
  let pathTokens: string[] = [];
  try {
    pathTokens = new URL(normalized).pathname
      .split(/[^a-z0-9]+/i)
      .map((token) => token.toLowerCase())
      .filter(Boolean);
  } catch {
    return false;
  }

  const split = splitName(textValue(user.name || user.displayName));
  const first = textValue(user.fname) || split.first;
  const last = textValue(user.lname) || split.last;
  const firstTokens = slugify(normalizeName(first)).split('-').filter(Boolean);
  const lastTokens = slugify(normalizeName(last)).split('-').filter(Boolean);
  if (firstTokens.length === 0 || lastTokens.length === 0) return false;

  const compactPath = pathTokens.join('');
  const firstMatches = firstTokens.some(
    (token) => pathTokens.includes(token) || (token.length >= 4 && compactPath.includes(token)),
  );
  const lastCompact = lastTokens.join('');
  const lastMatches =
    lastTokens.every((token) => pathTokens.includes(token)) ||
    (lastCompact.length >= 4 && compactPath.includes(lastCompact));
  return firstMatches && lastMatches;
}

function entityNameAsUser(entity: Record<string, any>): Record<string, any> | null {
  const name = normalizeName(
    textValue(entity.name || entity.displayName)
      .replace(/\s+(?:lab|faculty research|research area)$/i, '')
      .replace(/\s+[-–—]\s+research$/i, ''),
  );
  if (!name) return null;
  const split = splitName(name);
  if (!split.first || !split.last) return null;
  return {
    fname: split.first,
    lname: split.last,
    name,
    displayName: name,
  };
}

function entityExpectedPeople(entity: Record<string, any>): Array<Record<string, any>> {
  return [
    ...(Array.isArray(entity.leadUsers) ? entity.leadUsers : []),
    entityNameAsUser(entity),
  ].filter((value): value is Record<string, any> => Boolean(value));
}

function isPotentialDirectYalePersonPageUrl(value: unknown): boolean {
  const normalized = normalizeOfficialProfileUrl(value);
  try {
    const url = new URL(normalized);
    if (!/(^|\.)yale\.edu$/i.test(url.hostname)) return false;
    if (/\/profile\//i.test(url.pathname)) return true;
    if (/\.(?:pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|webp|svg)$/i.test(url.pathname)) return false;
    const parts = url.pathname
      .split('/')
      .map((part) => part.toLowerCase())
      .filter(Boolean);
    if (parts.length === 0) return false;
    if (
      parts.some((part) => {
        const tokens = part.split(/[^a-z0-9]+/i).filter(Boolean);
        return [
          'about',
          'admissions',
          'apply',
          'calendar',
          'course',
          'courses',
          'events',
          'initiative',
          'initiatives',
          'institute',
          'institutes',
          'lab',
          'labs',
          'news',
          'programs',
          'research',
          'search',
          'center',
          'centers',
        ].some((blocked) => part === blocked || tokens.includes(blocked));
      })
    ) {
      return false;
    }
    const last = parts.at(-1) || '';
    if (!last || ['people', 'faculty', 'faculty-directory', 'staff'].includes(last)) return false;
    return last.split(/[^a-z0-9]+/i).filter(Boolean).length >= 2;
  } catch {
    return false;
  }
}

function officialPersonUrlMatchesEntity(value: unknown, entity: Record<string, any>): boolean {
  if (isOfficialYaleProfileUrl(value)) return true;
  if (!isOfficialYalePersonPageUrl(value) && !isPotentialDirectYalePersonPageUrl(value)) return false;
  return entityExpectedPeople(entity).some((person) => personPageUrlMatchesUser(value, person));
}

function officialProfileSlugMatchesGivenNameVariant(
  value: unknown,
  user: Record<string, any>,
): boolean {
  const slugTokens = slugify(profileSlug(value)).split('-').filter(Boolean);
  if (slugTokens.length < 2) return false;

  const split = splitName(textValue(user.name || user.displayName));
  const first = textValue(user.fname) || split.first;
  const last = textValue(user.lname) || split.last;
  const firstTokens = slugify(normalizeName(first)).split('-').filter(Boolean);
  const lastTokens = slugify(normalizeName(last)).split('-').filter(Boolean);
  if (firstTokens.length < 2 || lastTokens.length === 0) return false;

  const compactSlug = slugTokens.join('');
  return firstTokens.every(
    (token) => slugTokens.includes(token) || (token.length >= 4 && compactSlug.includes(token)),
  );
}

function visibleBioProfileUrlMatchesUser(url: string, user: Record<string, any>): boolean {
  if (!isOfficialYalePersonPageUrl(url)) return false;

  const first = textValue(user.fname);
  const last = textValue(user.lname);
  if (isOfficialYaleProfileUrl(url)) {
    return (
      isLikelyPersonUrl(url, first, last) ||
      officialProfileSlugMatchesGivenNameVariant(url, user)
    );
  }

  return isLikelyPersonUrl(url, first, last) && personPageUrlMatchesUser(url, user);
}

function visibleBioProfileUrlsForUser(user: Record<string, any>): string[] {
  const profileUrls =
    user.profileUrls && typeof user.profileUrls === 'object'
      ? Object.values(user.profileUrls as Record<string, unknown>)
      : [];
  return uniqueStrings([
    ...objectStringValues(user.leadProfileUrls),
    ...objectStringValues(user.leadUserProfileUrls),
    user.websiteUrl,
    user.website,
    ...profileUrls,
  ])
    .filter((url) => visibleBioProfileUrlMatchesUser(url, user))
    .map(normalizeOfficialProfileUrl)
    .filter(Boolean);
}

export function officialProfileUrlsForEntity(entity: Record<string, any>): string[] {
  return uniqueStrings([
    ...objectStringValues(entity.leadUserProfileUrls),
    ...objectStringValues(entity.leadProfileUrls),
    entity.websiteUrl,
    entity.website,
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
    ...objectStringValues(entity.profileUrls),
    ...objectStringValues(entity.sourceObservationUrls),
  ])
    .filter((url) => officialPersonUrlMatchesEntity(url, entity))
    .map(normalizeOfficialProfileUrl)
    .filter(Boolean);
}

export function officialProfileUrlsForUser(user: Record<string, any>): string[] {
  const profileUrls =
    user.profileUrls && typeof user.profileUrls === 'object'
      ? Object.values(user.profileUrls as Record<string, unknown>)
      : [];
  return uniqueStrings([user.websiteUrl, user.website, ...profileUrls])
    .filter(isOfficialYaleProfileUrl)
    .map(normalizeOfficialProfileUrl)
    .filter(Boolean);
}

export function shouldQueueEntityForPiBackfill(entity: Record<string, any>): boolean {
  return officialProfileUrlsForEntity(entity).length === 1;
}

export function preferredOfficialProfileUrl(candidates: string[]): string {
  return candidates.find((url) => /medicine\.yale\.edu/i.test(url)) || candidates[0] || '';
}

function publicBioNeedsBackfill(user: Record<string, any>): boolean {
  if (isLikelySameNameContaminatedProfile(user)) return true;
  const bio = cleanPublicProfileBio(user);
  return bio.length < PROFILE_BIO_MIN_LENGTH || bio.length > OFFICIAL_PROFILE_BIO_MAX_LENGTH;
}

function userIdentityMatchEntity(
  user: Record<string, any>,
  leadProfileUrls: string[] = [],
): Record<string, any> {
  const name = normalizeName([user.fname, user.lname].filter(Boolean).join(' '));
  return {
    _id: user._id,
    netid: user.netid,
    email: user.email,
    fname: user.fname,
    lname: user.lname,
    name,
    displayName: name,
    slug: slugify(name),
    website: user.website,
    websiteUrl: user.websiteUrl,
    profileUrls: user.profileUrls,
    leadProfileUrls,
  };
}

export function generatedOfficialProfileUrlCandidatesForPerson(person: Record<string, any>): string[] {
  const first = textValue(person.fname);
  const last = textValue(person.lname);
  const email = textValue(person.email).toLowerCase();
  if (!first || !last) return [];
  if (email && !email.endsWith('@yale.edu')) return [];
  const slug = slugify(normalizeName([first, last].join(' ')));
  if (!slug || slug.split('-').length < 2) return [];
  return [
    `https://medicine.yale.edu/profile/${slug}/`,
    `https://ysph.yale.edu/profile/${slug}/`,
  ];
}

function canonicalUrlFromHtml($: cheerio.CheerioAPI, fallbackUrl: string): string {
  const href =
    $('link[rel="canonical"]').first().attr('href') ||
    $('meta[property="og:url"]').first().attr('content') ||
    fallbackUrl;
  return normalizeOfficialProfileUrl(absolutize(href, fallbackUrl));
}

function profileSlug(value: unknown): string {
  const normalized = normalizeOfficialProfileUrl(value);
  try {
    const parts = new URL(normalized).pathname.split('/').filter(Boolean);
    const profileIndex = parts.findIndex((part) => part.toLowerCase() === 'profile');
    return profileIndex >= 0 ? parts[profileIndex + 1] || '' : '';
  } catch {
    return '';
  }
}

function sameOfficialProfilePerson(left: string, right: string): boolean {
  const leftSlug = profileSlug(left);
  const rightSlug = profileSlug(right);
  return Boolean(leftSlug && rightSlug && leftSlug === rightSlug);
}

function orderedProfileFetchCandidates(candidates: string[]): string[] {
  return uniqueStrings([preferredOfficialProfileUrl(candidates), ...candidates]).filter(Boolean);
}

function sameOfficialPersonPageForEntity(
  left: string,
  right: string,
  entity: Record<string, any>,
): boolean {
  const normalizedLeft = normalizeOfficialProfileUrl(left);
  const normalizedRight = normalizeOfficialProfileUrl(right);
  const leftIsProfile = isOfficialYaleProfileUrl(normalizedLeft);
  const rightIsProfile = isOfficialYaleProfileUrl(normalizedRight);
  if (leftIsProfile && rightIsProfile) {
    return false;
  }
  if (
    normalizedLeft.replace(/^https?:\/\//i, '') ===
    normalizedRight.replace(/^https?:\/\//i, '')
  ) {
    return true;
  }
  return (
    officialPersonUrlMatchesEntity(normalizedLeft, entity) &&
    officialPersonUrlMatchesEntity(normalizedRight, entity)
  );
}

function cleanOfficialProfileTitle(value: string): string {
  const cleaned = textValue(value)
    .replace(/\b(?:Bio|Biography|Education|Contact|Courses Taught|Curriculum Vitae)\b[\s\S]*$/i, '')
    .replace(/\s+\|.+$/g, '')
    .trim();
  if (!cleaned || cleaned.length > 220) return '';
  return cleaned;
}

function firstUsefulText($: cheerio.CheerioAPI, selectors: string[]): string {
  for (const selector of selectors) {
    const elements = $(selector).toArray();
    for (const el of elements) {
      const value = textValue($(el).text() || $(el).attr('content'));
      if (!value || /^information for$/i.test(value)) continue;
      return value;
    }
  }
  return '';
}

const officialProfileTitlePattern =
  /\b(?:professor|faculty|scientist|investigator|lecturer|director|research\s+(?:professor|scientist|scholar|faculty|associate|fellow|staff|director)|(?:senior|associate|assistant)\s+research(?:er)?|researcher)\b/i;

function cleanOfficialProfileDisplayName(value: string): string {
  return textValue(value)
    .replace(/\s+\|\s+.*$/g, '')
    .replace(
      /\s*,?\s+(?:Ph\.?\s*D|M\.?\s*A|M\.?\s*S|M\.?\s*Sc|B\.?\s*A|B\.?\s*S|B\.?\s*Sc|M\.?\s*Phil|MPH|MFA|DPhil|JD|MD)(?=\s|,|$|Professor|Research|Associate|Assistant|Director|Scientist|Lecturer)[\s\S]*$/i,
      '',
    )
    .replace(/\b(?:Professor|Research Scientist|Associate Director|Assistant Director|Director)\b[\s\S]*$/i, '')
    .trim();
}

function isCredentialOnlyOfficialProfileBio(value: string, hasResearchAction: boolean): boolean {
  const degreeMatches =
    value.match(/\b(?:Ph\.?\s*D|M\.?\s*A|M\.?\s*S|M\.?\s*Sc|B\.?\s*A|B\.?\s*S|B\.?\s*Sc|M\.?\s*Phil|MFA|DPhil|JD|MD)\b/gi) ||
    [];
  return (
    !hasResearchAction &&
    degreeMatches.length >= 1 &&
    /^\s*(?:Ph\.?\s*D|M\.?\s*A|M\.?\s*S|M\.?\s*Sc|B\.?\s*A|B\.?\s*S|B\.?\s*Sc|M\.?\s*Phil|MFA|DPhil|JD|MD)\b/i.test(
      value,
    ) &&
    /\b(?:university|college|school|institute)\b/i.test(value)
  );
}

function isPublicationListOfficialProfileBio(value: string): boolean {
  return (
    /"[^"]{12,220}"/.test(value) &&
    /\b(?:19|20)\d{2}\b/.test(value) &&
    /\b[A-Z][a-z]+(?:\s+[A-Z]\.)?\s+[A-Z][a-z]+,\s+[A-Z][a-z]+/.test(value)
  );
}

function isAppointmentOnlyOfficialProfileBio(value: string): boolean {
  if (!/\b(?:assistant|associate|full|adjunct|clinical|visiting)?\s*professor\b/i.test(value)) {
    return false;
  }
  if (/[.!?]/.test(value)) return false;
  if (
    /\b(?:research|investigates?|develops?|focuses\s+on|works\s+on|explores?|writes?\s+(?:about|on)|publishes?\s+(?:about|on)|author\s+of)\b/i.test(
      value,
    )
  ) {
    return false;
  }
  return true;
}

function isSemicolonDelimitedProfileTopicList(value: string): boolean {
  const text = textValue(value);
  const semicolonCount = (text.match(/;/g) || []).length;
  if (semicolonCount < 2) return false;
  const sentenceCount = text.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean).length;
  return sentenceCount <= 1;
}

function hasExternalScholarProfileCallout(value: string): boolean {
  return (
    /\b(?:google scholar|pubmed)\s+profile\b/i.test(value) ||
    /\b(?:for\s+(?:a\s+)?(?:full\s+list|more)|refer\s+to|visit)\b.{0,140}\b(?:google scholar|pubmed|external link)\b/i.test(
      value,
    )
  );
}

function firstUsefulProfileTitle($: cheerio.CheerioAPI): string {
  const selectors = [
    '[class*="title"]',
    '[class*="appointment"]',
    '[class*="position"]',
    'meta[name="description"]',
  ];
  for (const selector of selectors) {
    const elements = $(selector).toArray();
    for (const el of elements) {
      const value = cleanOfficialProfileTitle($(el).text() || $(el).attr('content') || '');
      if (!value || /^information for$/i.test(value)) continue;
      if (officialProfileTitlePattern.test(value)) return value;
    }
  }
  return '';
}

function isUsefulOfficialProfileBioText(value: string): boolean {
  if (value.length < 40) return false;
  const researchActionText = value.replace(
    /\b(?:Institution for\s+)?(?:[A-Z][A-Za-z&-]*(?:\s+| and | & )){0,5}Studies\b/g,
    '',
  );
  const hasResearchAction =
    /\b(?:stud(?:y|ies)|conducts?\s+research|researches|investigates?|develops?|focuses on|works on|leads?|uses?|includes?|explores?|specializes in|writes? (?:about|on)|publishes? (?:about|on))\b/i.test(
      researchActionText,
    ) ||
    /\bresearch\s+(?:revolves around|centers? (?:on|in)|focuses on|examines|explores)\b/i.test(
      researchActionText,
    ) ||
    /\b(?:is|was)\s+(?:the\s+|an?\s+)?author\s+of\b/i.test(researchActionText);
  if (!cleanPublicProfileBio({ bio: value }) && !hasResearchAction) return false;
  if (/@yale\.edu\b/i.test(value)) return false;
  if (isSemicolonDelimitedProfileTopicList(value)) return false;
  if (/^view this doctor'?s clinical profile\b/i.test(value)) return false;
  if (/^voluntary\s+faculty\s+are\s+typically\s+clinicians\b/i.test(value)) return false;
  if (/^background\s*:/i.test(value)) return false;
  if (hasExternalScholarProfileCallout(value)) return false;
  if (
    /\bwe\s+(?:previously\s+)?conducted\s+(?:a\s+|an\s+)?(?:(?:single-|two-|multi-|[a-z]+\s+)?institution\s+)?phase\s+\d\s+trial\b/i.test(
      value,
    ) &&
    /\b(?:patients?|trial|NCT\d{8}|bevacizumab|pembrolizumab|nivolumab)\b/i.test(value)
  ) {
    return false;
  }
  if (
    /\b(?:po box|new haven,?\s*ct|united states|mailing address|contact info|prospect street|west campus drive|kline tower)\b/i.test(
      value,
    )
  ) {
    return false;
  }
  if (/^(?:see my webpage|this professor is accepting|medical research interests)\b/i.test(value)) {
    return false;
  }
  if (/^department of\b/i.test(value)) return false;
  if (isAppointmentOnlyOfficialProfileBio(value)) return false;
  if (isCredentialOnlyOfficialProfileBio(value, hasResearchAction)) return false;
  if (isPublicationListOfficialProfileBio(value)) return false;
  const hasResearchTopicPhrase =
    /\b(?:problems?|mechanisms?|pathways?|approaches?|methods?|models?)\s+(?:in|of|to|for)\b/i.test(
      value,
    ) ||
    /\b(?:theory|biology|chemistry|physics|neuroscience|genetics|immunology|oncology|epidemiology|microbiology)\b/i.test(
      value,
    );
  if (value.length < 120 && !hasResearchAction && !hasResearchTopicPhrase) {
    return false;
  }
  if (
    value.length < 120 &&
    /\b(?:selected publications?|wins?|elected|awards?|faculty research awards?)\b/i.test(value) &&
    !hasResearchAction
  ) {
    return false;
  }
  if (/^copy link$/i.test(value)) return false;
  return true;
}

function firstUsefulBioText($: cheerio.CheerioAPI, selectors: string[]): string {
  for (const selector of selectors) {
    for (const el of $(selector).toArray()) {
      const value = textValue($(el).text() || $(el).attr('content'));
      if (isUsefulOfficialProfileBioText(value)) return value;
    }
  }
  return '';
}

function firstBioHeadingText($: cheerio.CheerioAPI): string {
  for (const heading of $('h2,h3,h4').toArray()) {
    const label = textValue($(heading).text());
    if (!/^(?:biography|overview|research overview)$/i.test(label)) continue;
    const value = textValue($(heading).next().text());
    if (isUsefulOfficialProfileBioText(value)) return value;
  }
  return '';
}

function flattenJsonLd(value: unknown): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (typeof value !== 'object') return [];
  const record = value as Record<string, any>;
  return [record, ...flattenJsonLd(record['@graph']), ...flattenJsonLd(record.mainEntity)];
}

function jsonLdProfiles($: cheerio.CheerioAPI): Array<Record<string, any>> {
  const profiles: Array<Record<string, any>> = [];
  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text());
      profiles.push(...flattenJsonLd(parsed));
    } catch {
      // Ignore malformed embedded metadata.
    }
  });
  return profiles;
}

function canonicalResearchHomeName(value: unknown): string {
  return textValue(value)
    .replace(/\s*\(([A-Z][A-Z0-9&/ -]{1,24})\)\s*$/g, '')
    .replace(/^Director of (?:the )?/i, '')
    .trim();
}

function publicOfficialYaleResearchHomeUrl(value: unknown, baseUrl: string): string {
  const raw = textValue(value);
  if (!raw) return '';
  try {
    const url = new URL(absolutize(raw, baseUrl));
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLowerCase();
    if (!/(^|\.)yale\.edu$/i.test(url.hostname)) return '';
    if (/\/profile\//i.test(url.pathname)) return '';
    if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`;
    return canonicalLegacyResearchHomeUrl(url).toString();
  } catch {
    return '';
  }
}

function publicProfileLinkedLabWebsiteUrl(value: unknown, baseUrl: string): string {
  const raw = textValue(value);
  if (!raw) return '';
  try {
    const url = new URL(absolutize(raw, baseUrl));
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLowerCase();
    if (!/^https?:$/i.test(url.protocol)) return '';
    if (/\/profile\//i.test(url.pathname)) return '';
    if (
      /\b(?:orcid\.org|pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov|doi\.org|linkedin\.com|researchgate\.net|streamlinehq\.com)$/i.test(
        url.hostname,
      )
    ) {
      return '';
    }
    if (!url.pathname.endsWith('/') && !/\.[a-z0-9]{2,8}$/i.test(url.pathname)) {
      url.pathname = `${url.pathname}/`;
    }
    return canonicalLegacyResearchHomeUrl(url).toString();
  } catch {
    return '';
  }
}

const genericYaleWebsiteSubdomains = new Set([
  'african',
  'americanstudies',
  'art',
  'arthistory',
  'astronomy',
  'classics',
  'eall',
  'earth',
  'economics',
  'eeb',
  'engineering',
  'english',
  'environment',
  'erm',
  'filmstudies',
  'german',
  'gsp',
  'history',
  'jackson',
  'law',
  'macmillan',
  'medicine',
  'mba',
  'music',
  'nelc',
  'physics',
  'politicalscience',
  'russian-studies',
  'sociology',
  'som',
  'wgss',
  'yalemusic',
]);

function isCustomYaleResearchHomeSubdomain(url: URL): boolean {
  if (!/(^|\.)yale\.edu$/i.test(url.hostname)) return false;
  const prefix = url.hostname.replace(/\.yale\.edu$/i, '');
  return Boolean(prefix && !prefix.includes('.') && !genericYaleWebsiteSubdomains.has(prefix));
}

function publicLeadDirectResearchHomeUrl(value: unknown): string {
  const raw = textValue(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLowerCase();
    if (!/^https?:$/i.test(url.protocol)) return '';
    if (/\.(?:pdf|docx?|pptx?)$/i.test(url.pathname)) return '';
    if (/\/profile\//i.test(url.pathname)) return '';
    if (
      /(?:^|\.)(?:orcid\.org|pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov|doi\.org|linkedin\.com|researchgate\.net|scholar\.google\.com|reporter\.nih\.gov|nsf\.gov|academia\.edu|ispu\.org)$/i.test(
        url.hostname,
      )
    ) {
      return '';
    }
    if (!url.pathname.endsWith('/') && !/\.[a-z0-9]{2,8}$/i.test(url.pathname)) {
      url.pathname = `${url.pathname}/`;
    }
    if (
      /\/(?:people|person|faculty|faculty-directory)\//i.test(url.pathname) ||
      /\/directory\/faculty\//i.test(url.pathname) ||
      /\/who-we-are\/faculty\//i.test(url.pathname)
    ) {
      return '';
    }

    const hostPath = `${url.hostname}${url.pathname}`;
    const isYale = /(^|\.)yale\.edu$/i.test(url.hostname);
    const isDirectPersonalSite =
      /(?:^|\.)campuspress\.yale\.edu$/i.test(url.hostname) ||
      /github\.io$/i.test(url.hostname) ||
      !isYale;
    const isYaleResearchHomePath = /(?:lab|labs|research|center|project|group)/i.test(hostPath);
    if (
      !isDirectPersonalSite &&
      !isYaleResearchHomePath &&
      !isCustomYaleResearchHomeSubdomain(url)
    ) {
      return '';
    }
    return canonicalLegacyResearchHomeUrl(url).toString();
  } catch {
    return '';
  }
}

export function leadDirectResearchHomeUrlsForUser(user: Record<string, any>): string[] {
  const profileUrls =
    user.profileUrls && typeof user.profileUrls === 'object'
      ? Object.values(user.profileUrls as Record<string, unknown>)
      : [];
  return uniqueStrings([user.websiteUrl, user.website, ...profileUrls])
    .map(publicLeadDirectResearchHomeUrl)
    .filter(Boolean);
}

export function leadDirectResearchHomeUrlsForEntity(entity: Record<string, any>): string[] {
  return uniqueStrings([
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
    ...objectStringValues(entity.sourceObservationUrls),
  ])
    .map(publicLeadDirectResearchHomeUrl)
    .filter(Boolean);
}

function publicSourceUrlWebsiteBackfillUrl(value: unknown): string {
  const raw = textValue(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLowerCase();
    if (!/^https?:$/i.test(url.protocol)) return '';
    if (/\.(?:pdf|docx?|pptx?|xlsx?)$/i.test(url.pathname)) return '';
    if (/\/profile\//i.test(url.pathname)) return '';
    if (['epilepsy.yale.edu', 'sites.google.com'].includes(url.hostname)) return '';
    if (['alexandercoppock.com', 'www.alexandercoppock.com'].includes(url.hostname)) return '';
    if (url.hostname === 'www.yale.edu' && /^\/macmillan\/shapiro\/index\.htm\/?$/i.test(url.pathname)) {
      return '';
    }
    if (
      /\b(?:orcid\.org|pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov|doi\.org|linkedin\.com|researchgate\.net|scholar\.google\.com|reporter\.nih\.gov|nsf\.gov|academia\.edu|ispu\.org)$/i.test(
        url.hostname,
      )
    ) {
      return '';
    }
    if (!url.pathname.endsWith('/') && !/\.[a-z0-9]{2,8}$/i.test(url.pathname)) {
      url.pathname = `${url.pathname}/`;
    }
    if (
      /\/(?:people|person|faculty|faculty-directory)\//i.test(url.pathname) ||
      /\/directory\/faculty\//i.test(url.pathname) ||
      /\/who-we-are\/faculty\//i.test(url.pathname)
    ) {
      return '';
    }
    if (
      /\/(?:membership\/directory|research-opportunities-undergraduates?|diversity\/research-opportunities)\b/i.test(
        url.pathname,
      )
    ) {
      return '';
    }
    if (
      /\/(?:story|stories|news|search\/user)\b/i.test(url.pathname) ||
      /(?:^|[/-])people(?:[/-]|$)/i.test(url.pathname)
    ) {
      return '';
    }

    const hostPath = `${url.hostname}${url.pathname}`;
    const isYale = /(^|\.)yale\.edu$/i.test(url.hostname);
    if (
      isYale &&
      genericYaleWebsiteSubdomains.has(url.hostname.replace(/\.yale\.edu$/i, '')) &&
      /\/opportunities(?:-[0-9]+)?\//i.test(url.pathname)
    ) {
      return '';
    }
    const isDirectPersonalSite =
      /(?:^|\.)campuspress\.yale\.edu$/i.test(url.hostname) ||
      /github\.io$/i.test(url.hostname) ||
      !isYale;
    const isSpecificYaleResearchHomePath = /(?:lab|labs|project|group)/i.test(hostPath);
    if (
      !isDirectPersonalSite &&
      !isSpecificYaleResearchHomePath &&
      !isCustomYaleResearchHomeSubdomain(url)
    ) {
      return '';
    }
    return canonicalLegacyResearchHomeUrl(url).toString();
  } catch {
    return '';
  }
}

export function sourceUrlResearchHomeUrlsForEntity(entity: Record<string, any>): string[] {
  return uniqueStrings([
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
    ...objectStringValues(entity.sourceObservationUrls),
  ])
    .map(publicSourceUrlWebsiteBackfillUrl)
    .filter(Boolean);
}

export function firstNonDuplicateLeadDirectWebsiteUrl(
  urls: string[],
  duplicateWebsiteUrls: Set<string>,
): string {
  const duplicateWebsiteKeys = new Set(
    Array.from(duplicateWebsiteUrls).map(websiteDuplicateKey).filter(Boolean),
  );
  return (
    uniqueStrings(urls).find(
      (url) => !duplicateWebsiteUrls.has(url) && !duplicateWebsiteKeys.has(websiteDuplicateKey(url)),
    ) || ''
  );
}

function websiteDuplicateKey(value: unknown): string {
  const raw = textValue(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLowerCase();
    if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`;
    const protocolAgnostic = /^(?:http|https):$/i.test(url.protocol);
    return protocolAgnostic ? `${url.hostname}${url.pathname}` : url.toString();
  } catch {
    return raw;
  }
}

export function websiteDuplicateLookupUrls(value: unknown): string[] {
  const raw = textValue(value);
  if (!raw) return [];
  try {
    const url = new URL(raw);
    if (!/^(?:http|https):$/i.test(url.protocol)) return [raw];
    url.hash = '';
    url.search = '';
    if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`;
    const httpsUrl = new URL(url.toString());
    httpsUrl.protocol = 'https:';
    const httpUrl = new URL(url.toString());
    httpUrl.protocol = 'http:';
    return uniqueStrings([httpsUrl.toString(), httpUrl.toString()]);
  } catch {
    return [raw];
  }
}

function classifyResearchHome(
  name: string,
  url: string,
): Pick<OfficialProfileResearchHome, 'kind' | 'entityType'> | null {
  const text = `${name} ${url}`;
  if (/\b(?:lab|laboratory)\b/i.test(text)) return { kind: 'lab', entityType: 'LAB' };
  if (/\bcent(?:er|re)\b/i.test(text)) return { kind: 'center', entityType: 'CENTER' };
  if (/\binstitute\b/i.test(text)) return { kind: 'institute', entityType: 'INSTITUTE' };
  if (/\bprogram\b/i.test(text)) return { kind: 'program', entityType: 'PROGRAM' };
  if (/\binitiative\b/i.test(text)) return { kind: 'initiative', entityType: 'INITIATIVE' };
  return null;
}

function genericOrganizationName(name: string): boolean {
  return (
    /^(?:yale medicine|yale university|yale school of medicine|yale new haven health system)$/i.test(name) ||
    /^(?:internal medicine|cardiovascular medicine|clinical radiology|nuclear cardiology|child study center)$/i.test(name) ||
    /^(?:interdepartmental neuroscience program|yale combined program in the biological and biomedical sciences|community research fellows program)$/i.test(name) ||
    /\b(?:department|section|division)\b/i.test(name) ||
    /\b(?:track|ventures|patient|clinical program)\b/i.test(name) ||
    /\b(?:day\s*care|daycare|kindergarten|public sector leadership|student leadership)\b/i.test(name)
  );
}

function profileEvidenceText($: cheerio.CheerioAPI, profiles: Array<Record<string, any>>): string {
  return uniqueStrings([
    ...profiles.flatMap((profile) => [
      profile.name,
      profile.description,
      ...(Array.isArray(profile.jobTitle) ? profile.jobTitle : [profile.jobTitle]),
    ]),
    $('main').text(),
    $('article').text(),
    $('[class*="biography"]').text(),
    $('[class*="profile-body"]').text(),
    $('[class*="field--name-body"]').text(),
  ]).join(' ');
}

function leadershipMentionsOrganization(text: string, name: string, rawName: string): boolean {
  return uniqueStrings([name, rawName]).some((variant) => {
    const pattern = escapeRegex(variant).replace(/\s+/g, '\\s+');
    const yalePrefix = /^yale\b/i.test(variant) ? '' : '(?:Yale\\s+)?';
    const organizationPattern = `${yalePrefix}${pattern}(?=\\s*(?:\\(|[,.;:]|$|Visit\\b|Contact\\b|Learn\\b))`;
    const leadershipTitle =
      '(?:co-director|associate\\s+director|principal\\s+investigator|director|pi)';
    return [
      `\\b${leadershipTitle}\\b\\s*(?:,|of\\s+(?:the\\s+)?)\\s*${organizationPattern}\\b`,
      `\\b${leadershipTitle}\\b\\s+of\\s+[^,.;]{1,64}\\s+in\\s+(?:the\\s+)?${organizationPattern}\\b`,
    ].some((source) => {
      const regex = new RegExp(source, 'gi');
      for (const match of text.matchAll(regex)) {
        const matchIndex = match.index ?? 0;
        const prefix = text.slice(Math.max(0, matchIndex - 24), matchIndex);
        const suffix = text.slice(matchIndex + match[0].length, matchIndex + match[0].length + 96);
        if (/deputy\s+$/i.test(prefix)) continue;
        if (/^\s*,\s*(?:US\s+)?Department of Veterans? Affairs\b/i.test(suffix)) continue;
        return true;
      }
      return false;
    });
  });
}

function affiliationValuesFromProfiles(profiles: Array<Record<string, any>>): unknown[] {
  const values: unknown[] = [];
  for (const profile of profiles) {
    for (const field of ['affiliation', 'memberOf', 'worksFor', 'department']) {
      const raw = profile[field];
      values.push(...(Array.isArray(raw) ? raw : [raw]));
    }
  }
  return values.filter(Boolean);
}

function isProfileChromeLink(link: cheerio.Cheerio<any>): boolean {
  return (
    link.closest(
      'header, footer, nav, [role="navigation"], .menu, .breadcrumb, .navigation-panel, [class*="navigation-panel"], [class*="site-nav"], [class*="mega-menu"]',
    ).length > 0
  );
}

function profileNameFromProfiles(profiles: Array<Record<string, any>>): string {
  for (const profile of profiles) {
    const name = textValue(profile.name).replace(
      /,\s*(?:MD|PhD|ScD|MPH|MHS|MS|MA|MBA|RN|APRN|FAHA|FACC|FACS|AB)\b(?:\s*,\s*(?:MD|PhD|ScD|MPH|MHS|MS|MA|MBA|RN|APRN|FAHA|FACC|FACS|AB)\b)*$/i,
      '',
    );
    if (name) return name;
  }
  return '';
}

function dedupeRepeatedProfileCardLabel(value: string): string {
  const text = textValue(value);
  if (text.length % 2 === 0) {
    const middle = text.length / 2;
    const left = text.slice(0, middle);
    const right = text.slice(middle);
    if (left.toLowerCase() === right.toLowerCase()) return left;
  }

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length % 2 !== 0) return textValue(value);
  const middle = words.length / 2;
  const left = words.slice(0, middle).join(' ');
  const right = words.slice(middle).join(' ');
  return left.toLowerCase() === right.toLowerCase() ? left : textValue(value);
}

function cleanProfileCardLabWebsiteLabel(value: string): string {
  return dedupeRepeatedProfileCardLabel(
    textValue(value)
      .replace(/\bLab\s+Whisk\s+Cup\s+Streamline\s+Icon:\s*https?:\/\/streamlinehq\.com/gi, ' ')
      .replace(/\)([A-Z])/g, ') $1')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\bBio\s+Image\s+Suite\b/g, 'BioImage Suite')
      .replace(/\bCar\s+DS\b/g, 'CarDS')
      .replace(/\bNOu\s+RISH\b/g, 'NOURISH')
      .replace(
        /\bY-Weight:\s*Yale\s+Obesity\s+Research\s+Center\b[\s\S]*$/i,
        'Yale Obesity Research Center (Y-Weight)',
      )
      .replace(/^\s*The\s+Ycsc\b/i, 'Yale Child Study Center')
      .replace(/\bYcsc\b/g, 'YCSC')
      .replace(/^\s*(?:The\s+)?Elena\s+Lab\s*$/i, 'Elena Gracheva Lab')
      .replace(/^\s*(?:The\s+)?Slav\s+Lab\s*$/i, 'Slav Bagriantsev Lab')
      .replace(/^[^/]{2,80}\s+Lab\s*\/\s*(?=(?:Yale\s+)?(?:Center|Centre)\b)/i, '')
      .replace(
        /(\([^)]*\blab\))\s+(?:my|our|his|her|their|dr\.?|this)\s+lab\b[\s\S]*$/i,
        '$1',
      )
      .replace(
        /\b(labs?|laboratory|center|program|initiative)\s+(?:my|our|his|her|their|dr\.?|this)\b[\s\S]*$/i,
        '$1',
      )
      .replace(/\b(labs?|laboratory|center|program|initiative)\s+website\b[\s\S]*$/i, '$1')
      .replace(/\blabs?\b/gi, (match) => (match.toLowerCase() === 'labs' ? 'Labs' : 'Lab')),
  );
}

function profileLinkedLabWebsiteName(
  rawName: string,
  context: string,
  profileName: string,
): string {
  const labelText = cleanProfileCardLabWebsiteLabel(
    textValue(context || rawName)
      .replace(/View\s+Lab\s+Website\b[\s\S]*$/i, '')
      .replace(/\b(?:Research at a Glance|News|Academic Achievements)\b[\s\S]*$/i, ''),
  ).trim();
  const label = canonicalResearchHomeName(dedupeRepeatedProfileCardLabel(labelText));
  if (label && !/^View\s+Lab\s+Website$/i.test(label) && !genericOrganizationName(label)) {
    return label;
  }
  return profileName ? `${profileName} Lab` : '';
}

function disallowedProfileLinkedResearchHome(name: string, url: string): boolean {
  return (
    /(?:^|\/\/)sites\.google\.com\//i.test(url) ||
    /(?:^|\/\/)(?!campuspress\.yale\.edu)[^/]*\.yale\.edu\/(?:people|person|faculty|faculty-directory)\//i.test(
      url,
    ) ||
    /(?:^|\/\/)(?!campuspress\.yale\.edu)[^/]*\.yale\.edu\/directory\/faculty\//i.test(url) ||
    /\.profile\/?$/i.test(url) ||
    /\b(?:day\s*care|kindergarten)\b/i.test(name) ||
    /calvinhilldaycare\.org/i.test(url) ||
    /\bpublic\s+sector\s+leadership\b/i.test(name) ||
    /law\.yale\.edu\/leadership\/public-sector/i.test(url) ||
    /\bmedieval\s+studies\s+program\b/i.test(name) ||
    /(?:^|\/\/)(?:www\.)?yale\.edu\/medieval\//i.test(url) ||
    /\b(?:md\s*-\s*ph\s*d|global\s+health\s+scholars|national\s+clinician\s+scholars)\s+program\b/i.test(
      name,
    ) ||
    /medicine\.yale\.edu\/(?:mdphd|internal-medicine\/education\/)/i.test(url) ||
    /\bbiomedical\s+informatics\s*&?\s*(?:and\s+)?data\s+science\b/i.test(name) ||
    /medicine\.yale\.edu\/biomedical-informatics-data-science\/?$/i.test(url) ||
    /medicine\.yale\.edu\/internal-medicine\/infdis\/research\/yccr\/?$/i.test(url) ||
    /medicine\.yale\.edu\/psychiatry\/prch\/research\/recovery-finance-project\/?$/i.test(url) ||
    /(?:^|\/\/)(?:www\.)?sozenlab\.org\/?$/i.test(url) ||
    /(?:^|\/\/)(?:www\.)?partnershipsforschools\.org\/?$/i.test(url) ||
    /(?:^|\/\/)(?:www\.)?painmanagementcollaboratory\.org\/?$/i.test(url) ||
    /yalemedicine\.org\/departments\//i.test(url) ||
    /\bdiagnostic(?:s)?\s+laborator(?:y|ies)\b/i.test(name) ||
    /medicine\.yale\.edu\/genetics\/dna\//i.test(url) ||
    /medicine\.yale\.edu\/childstudy\/research\/?$/i.test(url)
  );
}

function profileLinkedLabWebsitesFromHtml(
  $: cheerio.CheerioAPI,
  profiles: Array<Record<string, any>>,
  profileUrl: string,
): OfficialProfileResearchHome[] {
  const homes: OfficialProfileResearchHome[] = [];
  const profileName = profileNameFromProfiles(profiles);
  const evidenceText = profileEvidenceText($, profiles);

  $('main a[href], article a[href], body a[href]').each((_i, el) => {
    const link = $(el);
    if (isProfileChromeLink(link)) return;

    const rawName = textValue(link.text());
    const context = textValue(link.closest('p,li,article,section,div').first().text());
    if (!/\bView\s+Lab\s+Website\b/i.test(`${rawName} ${context}`)) return;

    const url = publicProfileLinkedLabWebsiteUrl(link.attr('href'), profileUrl);
    if (!url) return;
    if (/\/(?:internal-medicine|intmed)\/ctra\//i.test(new URL(url).pathname)) return;
    const name = profileLinkedLabWebsiteName(rawName, context, profileName);
    if (!name || genericOrganizationName(name)) return;
    if (disallowedProfileLinkedResearchHome(name, url)) return;
    const sectionHeading = textValue(
      link.closest('section,aside').find('h2,h3,h4').first().text(),
    );
    if (
      /contact\s+info/i.test(sectionHeading) &&
      !leadershipMentionsOrganization(evidenceText, name, rawName)
    ) {
      return;
    }
    const classification = classifyResearchHome(name, url) || {
      kind: 'lab' as const,
      entityType: 'LAB' as const,
    };

    homes.push({
      name,
      rawName: rawName || name,
      url,
      ...classification,
      score: 20,
    });
  });

  return homes;
}

function linkedResearchHomesFromHtml(
  $: cheerio.CheerioAPI,
  profileUrl: string,
): OfficialProfileResearchHome[] {
  const homes: OfficialProfileResearchHome[] = [];
  $('main a[href], article a[href], body a[href]').each((_i, el) => {
    const link = $(el);
    if (isProfileChromeLink(link)) return;

    const rawName = textValue(link.text());
    const name = canonicalResearchHomeName(rawName);
    if (!name || genericOrganizationName(name)) return;
    const url = publicOfficialYaleResearchHomeUrl(link.attr('href'), profileUrl);
    if (!url) return;
    if (disallowedProfileLinkedResearchHome(name, url)) return;
    const classification = classifyResearchHome(name, url);
    if (!classification) return;

    const context = textValue(link.closest('p,li,section,div').first().text());
    const hasLeadershipEvidence = leadershipMentionsOrganization(context, name, rawName);
    if (!hasLeadershipEvidence) return;
    let score = 0;
    score += 5;
    if (/\bresearch\b/i.test(name)) score += 2;
    if (/\b(?:lab|laboratory|cent(?:er|re)|institute|program|initiative)\b/i.test(name)) {
      score += 2;
    }
    if (/\/(?:research|lab|labs|center|centers|institute|institutes|program|programs)\b/i.test(url)) {
      score += 2;
    }
    if (score < 5) return;

    homes.push({ name, rawName, url, ...classification, score });
  });
  return homes;
}

export function extractOfficialProfileResearchHomes(
  html: string,
  profileUrl: string,
): OfficialProfileResearchHome[] {
  const $ = cheerio.load(html);
  const profiles = jsonLdProfiles($);
  const evidenceText = profileEvidenceText($, profiles);
  const homes = new Map<string, OfficialProfileResearchHome>();

  const addHome = (home: OfficialProfileResearchHome) => {
    const key = `${home.name.toLowerCase()}|${home.url}`;
    if (homes.has(key)) return;
    homes.set(key, home);
  };

  for (const value of affiliationValuesFromProfiles(profiles)) {
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, any>;
    const rawName = textValue(record.name);
    const name = canonicalResearchHomeName(rawName);
    const url = publicOfficialYaleResearchHomeUrl(record.url || record['@id'], profileUrl);
    if (!name || !url || genericOrganizationName(name)) continue;
    if (disallowedProfileLinkedResearchHome(name, url)) continue;
    const classification = classifyResearchHome(name, url);
    if (!classification) continue;

    const hasLeadershipEvidence = leadershipMentionsOrganization(evidenceText, name, rawName);
    if (!hasLeadershipEvidence) continue;
    let score = 0;
    score += 5;
    if (/\bresearch\b/i.test(name)) score += 2;
    if (/\b(?:lab|laboratory|cent(?:er|re)|institute|program|initiative)\b/i.test(name)) {
      score += 2;
    }
    if (/\/(?:research|lab|labs|center|centers|institute|institutes|program|programs)\b/i.test(url)) {
      score += 2;
    }
    if (score < 5) continue;

    addHome({ name, rawName, url, ...classification, score });
  }

  for (const home of linkedResearchHomesFromHtml($, profileUrl)) {
    addHome(home);
  }

  for (const home of profileLinkedLabWebsitesFromHtml($, profiles, profileUrl)) {
    addHome(home);
  }

  return Array.from(homes.values()).sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name),
  );
}

export function entityResearchHomeToObservations(
  entity: Record<string, any>,
  home: OfficialProfileResearchHome | undefined,
  profileUrl: string,
): ObservationInput[] {
  if (!home) return [];
  const entityId = idValue(entity._id || entity.id);
  const entityKey = textValue(entity.slug || entity._id);
  const sourceUrls = uniqueStrings([
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
    normalizeOfficialProfileUrl(profileUrl),
    home.url,
  ]);
  const base = {
    entityType: 'researchEntity' as const,
    ...(entityId ? { entityId } : {}),
    ...(entityKey ? { entityKey } : {}),
    sourceUrl: normalizeOfficialProfileUrl(profileUrl),
    confidenceOverride: 0.96,
  };

  return [
    { ...base, field: 'name', value: home.name },
    { ...base, field: 'displayName', value: home.name },
    { ...base, field: 'kind', value: home.kind },
    { ...base, field: 'entityType', value: home.entityType },
    { ...base, field: 'website', value: home.url },
    { ...base, field: 'websiteUrl', value: home.url },
    { ...base, field: 'sourceUrls', value: sourceUrls },
  ];
}

export function entityLeadDirectWebsiteToObservations(
  entity: Record<string, any>,
  websiteUrl: string,
): ObservationInput[] {
  const url = publicLeadDirectResearchHomeUrl(websiteUrl);
  if (!url) return [];
  const entityId = idValue(entity._id || entity.id);
  const entityKey = textValue(entity.slug || entity._id);
  const sourceUrls = uniqueStrings([
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
    url,
  ]);
  const base = {
    entityType: 'researchEntity' as const,
    ...(entityId ? { entityId } : {}),
    ...(entityKey ? { entityKey } : {}),
    sourceUrl: url,
    confidenceOverride: 0.88,
  };

  return [
    { ...base, field: 'website', value: url },
    { ...base, field: 'websiteUrl', value: url },
    { ...base, field: 'sourceUrls', value: sourceUrls },
  ];
}

function firstJsonLdText(profiles: Array<Record<string, any>>, fields: string[]): string {
  for (const profile of profiles) {
    for (const field of fields) {
      const raw = profile[field];
      const value = Array.isArray(raw) ? textValue(raw[0]) : textValue(raw);
      if (value) return value;
    }
  }
  return '';
}

function imageUrlFromJsonLdImage(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return textValue(value);
  if (Array.isArray(value)) {
    return value.map(imageUrlFromJsonLdImage).find(Boolean) || '';
  }
  if (typeof value !== 'object') return '';
  const record = value as Record<string, any>;
  return textValue(record.url || record.contentUrl || record['@id']);
}

function extractImageUrl(
  $: cheerio.CheerioAPI,
  profiles: Array<Record<string, any>>,
  profileUrl: string,
): string {
  const candidates = [
    ...profiles.map((profile) => imageUrlFromJsonLdImage(profile.image)),
    $('meta[property="og:image:secure_url"]').first().attr('content') || '',
    $('meta[property="og:image"]').first().attr('content') || '',
    $('meta[name="twitter:image"]').first().attr('content') || '',
  ];
  const candidate = candidates.map(textValue).find((value) => /^https?:\/\//i.test(value));
  return candidate ? absolutize(candidate, profileUrl) : '';
}

function extractEmail(
  $: cheerio.CheerioAPI,
  profiles: Array<Record<string, any>>,
  displayName: string,
): string {
  const candidates: string[] = [];
  for (const profile of profiles) {
    const email = profile.email;
    candidates.push(...(Array.isArray(email) ? email : [email]).map(textValue));
  }
  $('a[href^="mailto:"]').each((_i, el) => {
    candidates.push(($(el).attr('href') || '').replace(/^mailto:/i, ''));
  });
  candidates.push($('body').text());
  for (const candidate of candidates) {
    const text = textValue(candidate);
    for (const match of text.matchAll(/\b[a-z0-9._%+-]+@yale\.edu\b/gi)) {
      const email = match[0].toLowerCase();
      if (isLikelyPersonSpecificYaleEmail(email, displayName)) return email;
    }
  }
  return '';
}

function extractDepartments($: cheerio.CheerioAPI): string[] {
  const values: string[] = [];
  $('[class*="department"], [class*="organization"], [class*="affiliation"]').each((_i, el) => {
    const value = textValue($(el).text());
    if (value && value.length < 160) values.push(value);
  });
  return uniqueStrings(values).slice(0, 5);
}

function extractResearchInterests($: cheerio.CheerioAPI): string[] {
  const values: string[] = [];
  $('[class*="research-interest"], [class*="field-of-study"], [class*="interests"]').each(
    (_i, el) => {
      const text = textValue($(el).text());
      values.push(...text.split(/[,;|•\n\r]+/));
    },
  );
  $('h2,h3,h4,strong').each((_i, heading) => {
    const label = textValue($(heading).text()).toLowerCase();
    if (!/\b(research interests?|fields? of study|topics?)\b/.test(label)) return;
    values.push(...textValue($(heading).next().text()).split(/[,;|•\n\r]+/));
  });
  return sanitizeProfileResearchTerms(
    uniqueStrings(values)
      .filter((value) => value.length > 2)
      .filter((value) => !/\b(?:professor|dean|director|chair|lecturer|instructor)\b/i.test(value))
      .filter(
        (value) =>
          !/\b(?:Ph\.?\s*D|M\.?\s*A|M\.?\s*S|M\.?\s*Sc|B\.?\s*A|B\.?\s*S|B\.?\s*Sc|M\.?\s*Phil|MFA|DPhil|JD|MD)\b/i.test(
            value,
          ) && !/\b(?:university|college|school|institute)\b/i.test(value),
      )
      .slice(0, 20),
  ).slice(0, 20);
}

const OFFICIAL_PROFILE_BIO_SELECTORS = [
  '[class*="profile-body"]',
  '[class*="biography"]',
  '[class*="field--name-body"] p',
  '[class*="field--name-body"]',
  '[class*="bio"]',
  'main p',
];

function extractBio($: cheerio.CheerioAPI): string {
  const value = firstBioHeadingText($) || firstUsefulBioText($, OFFICIAL_PROFILE_BIO_SELECTORS);
  return value ? clipOfficialProfileBio(value) : '';
}

function isSuppressedProfileBioText(value: string): boolean {
  const text = textValue(value);
  return (
    /\bvoluntary faculty are typically clinicians\b/i.test(text) ||
    /^view this doctor'?s clinical profile\b/i.test(text) ||
    isAppointmentOnlyOfficialProfileBio(text) ||
    isCredentialOnlyOfficialProfileBio(text, false)
  );
}

function hasSuppressedProfileBioText($: cheerio.CheerioAPI): boolean {
  for (const selector of OFFICIAL_PROFILE_BIO_SELECTORS) {
    for (const el of $(selector).toArray()) {
      const value = textValue($(el).text() || $(el).attr('content'));
      if (value && !isUsefulOfficialProfileBioText(value) && isSuppressedProfileBioText(value)) {
        return true;
      }
    }
  }
  return false;
}

function firstTerseResearchFocusText($: cheerio.CheerioAPI): string {
  for (const selector of OFFICIAL_PROFILE_BIO_SELECTORS) {
    for (const el of $(selector).toArray()) {
      const cleaned = cleanPublicProfileBio({
        bio: textValue($(el).text() || $(el).attr('content')),
      });
      if (cleaned.length >= 40 && cleaned.length < PROFILE_BIO_MIN_LENGTH) return cleaned;
    }
  }
  return '';
}

function clipOfficialProfileBio(value: string): string {
  const text = stripTrailingOfficialProfileUpdateMetadata(textValue(value));
  if (text.length <= OFFICIAL_PROFILE_BIO_MAX_LENGTH) return text;

  const prefix = text.slice(0, OFFICIAL_PROFILE_BIO_MAX_LENGTH).trim();
  const sentenceEnds = Array.from(prefix.matchAll(/[.!?](?=\s|$)/g)).filter((match) => {
    if (typeof match.index !== 'number') return false;
    const candidate = prefix.slice(0, match.index + 1).trim();
    return (
      !/(?:^|\s)(?:Dr|Prof|Mr|Mrs|Ms|Mx|St|Jr|Sr|Hon|Rev|Fr|Gen|Col|Lt|Capt|Sgt)\.$/i.test(
        candidate,
      ) && !/(?:^|\s)[A-Z]\.$/.test(candidate)
    );
  });
  const lastSentenceEnd = sentenceEnds.at(-1);
  if (lastSentenceEnd && typeof lastSentenceEnd.index === 'number' && lastSentenceEnd.index >= 300) {
    return prefix.slice(0, lastSentenceEnd.index + 1).trim();
  }

  const wordBoundary = prefix.replace(/\s+\S*$/, '').replace(/[,;:\-–—]+$/g, '').trim();
  return wordBoundary ? `${wordBoundary}.` : prefix;
}

function extractOrcid($: cheerio.CheerioAPI): string | undefined {
  const candidates: string[] = [];
  $('a[href*="orcid.org"], a[href^="orcid:"]').each((_i, el) => {
    candidates.push($(el).attr('href') || '', $(el).text());
  });
  const bodyMatches = $('body').text().match(/\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{3}[\dX]\b/gi) || [];
  candidates.push(...bodyMatches);
  return candidates.map(normalizeOrcid).find(Boolean);
}

function nameMatchesEntity(displayName: string, entity: Record<string, any>): boolean {
  const nameSlug = slugify(normalizeName(displayName));
  if (!nameSlug) return false;
  const entityText = uniqueStrings([entity.name, entity.displayName, entity.slug]).join(' ');
  const entitySlug = slugify(entityText);
  const nameParts = nameSlug.split('-').filter(Boolean);
  if (nameParts.length < 2) return false;
  return entitySlug.includes(nameParts[0]) && entitySlug.includes(nameParts[nameParts.length - 1]);
}

function officialProfileIdentityMatchesExpectedPerson(
  displayName: string,
  email: string,
  expectedPeople: OfficialProfileIdentityOptions['expectedPeople'],
): boolean {
  const expected = expectedPeople || [];
  if (expected.length === 0) return true;
  const displayWords = new Set(normalizeName(displayName).toLowerCase().split(/\s+/).filter(Boolean));
  const normalizedEmail = textValue(email).toLowerCase();

  return expected.some((person) => {
    const expectedEmail = textValue(person.email).toLowerCase();
    if (expectedEmail && normalizedEmail && expectedEmail === normalizedEmail) return true;

    const first = normalizeName(person.fname || '').toLowerCase().split(/\s+/).filter(Boolean)[0];
    const last = normalizeName(person.lname || '').toLowerCase().split(/\s+/).filter(Boolean).at(-1);
    return Boolean(first && last && displayWords.has(first) && displayWords.has(last));
  });
}

export function extractOfficialProfileIdentity(
  html: string,
  profileUrl: string,
  entity: Record<string, any>,
  options: OfficialProfileIdentityOptions = {},
): OfficialProfileIdentity | null {
  const $ = cheerio.load(html);
  const profiles = jsonLdProfiles($);
  const canonicalUrl = canonicalUrlFromHtml($, profileUrl);
  const fetchedUrl = normalizeOfficialProfileUrl(profileUrl);
  if (
    canonicalUrl !== fetchedUrl &&
    !sameOfficialProfilePerson(canonicalUrl, fetchedUrl) &&
    !sameOfficialPersonPageForEntity(canonicalUrl, fetchedUrl, entity)
  ) {
    return null;
  }

  const displayName = normalizeName(
    cleanOfficialProfileDisplayName(
      firstJsonLdText(profiles, ['name']) ||
        firstUsefulText($, [
          'h1',
          '[class*="profile"] [class*="name"]',
          '[class*="person"] [class*="name"]',
          'meta[property="og:title"]',
          'title',
        ]),
    ),
  );
  const email = extractEmail($, profiles, displayName);
  if (!email && options.requireEmail !== false) return null;
  const hasExpectedPeople = (options.expectedPeople || []).length > 0;
  const matchesExpectedPerson = officialProfileIdentityMatchesExpectedPerson(
    displayName,
    email,
    options.expectedPeople,
  );
  if (hasExpectedPeople ? !matchesExpectedPerson : !nameMatchesEntity(displayName, entity)) return null;

  const title = uniqueStrings([
    firstJsonLdText(profiles, ['jobTitle']),
    firstUsefulProfileTitle($),
  ]).find((value) => officialProfileTitlePattern.test(value)) || '';
  if (!title) return null;

  const bio = extractBio($);
  const extractedResearchInterests = extractResearchInterests($);
  const terseResearchFocus =
    extractedResearchInterests.length === 0
      ? bio && bio.length < PROFILE_BIO_MIN_LENGTH
        ? bio
        : firstTerseResearchFocusText($)
      : '';
  const researchInterests = terseResearchFocus ? [terseResearchFocus] : extractedResearchInterests;
  const imageUrl = extractImageUrl($, profiles, profileUrl);
  return {
    canonicalUrl,
    fetchedUrl,
    displayName,
    email,
    title,
    ...(imageUrl ? { imageUrl } : {}),
    departments: extractDepartments($),
    ...(bio ? { bio } : {}),
    researchInterests,
    orcid: extractOrcid($),
    ...(bio ? {} : hasSuppressedProfileBioText($) ? { suppressDerivedBio: true } : {}),
  };
}

function formatInterestList(values: string[]): string {
  const cleaned = values.map(cleanInterestForBio).filter(Boolean);
  if (cleaned.length <= 1) return cleaned[0] || '';
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(', ')}, and ${cleaned.at(-1)}`;
}

function cleanInterestForBio(value: string): string {
  return textValue(value)
    .replace(/^fields?\s+of\s+interest\s+/i, '')
    .replace(/^research\s+areas?\s+/i, '')
    .replace(/[.;:,]+$/g, '')
    .trim();
}

function isPseudoProfileResearchTerm(value: string): boolean {
  const text = textValue(value);
  return (
    /\b(?:research associate|professor|director|dean|chair|lecturer|instructor)\b/i.test(text) ||
    /\b(?:papers?|publications?)\s+published\b/i.test(text) ||
    /\b(?:full list|google scholar|pubmed|external link|visit prof\.?)\b/i.test(text)
  );
}

function publicProfileResearchTerms(values: unknown[]): string[] {
  return sanitizeProfileResearchTerms(values)
    .map(cleanInterestForBio)
    .filter(Boolean)
    .filter((term) => !isPseudoProfileResearchTerm(term));
}

function meaningfulProfileTitle(value: string): string {
  const title = textValue(value);
  if (!title) return '';
  if (/^(?:research\s*\/\s*faculty|related research)$/i.test(title)) return '';
  if (/^homeabout/i.test(title)) return '';
  return title;
}

function profileDescriptionPrefix(identity: OfficialProfileIdentity): string {
  const title = meaningfulProfileTitle(identity.title).replace(
    new RegExp(`^${escapeRegex(identity.displayName)}\\s+`, 'i'),
    '',
  );
  return title ? `${identity.displayName} is ${title}. Their` : `${identity.displayName}'s`;
}

function lowerInitial(value: string): string {
  return value ? `${value.charAt(0).toLowerCase()}${value.slice(1)}` : '';
}

function terseOfficialBioTopic(identity: OfficialProfileIdentity): string {
  let topic = textValue(identity.bio).replace(/[.;:,]+$/g, '').trim();
  if (!topic || topic.length >= PROFILE_BIO_MIN_LENGTH) return '';
  if (!isUsefulOfficialProfileBioText(topic)) return '';

  const displayNamePattern = escapeRegex(identity.displayName).replace(/\s+/g, '\\s+');
  topic = topic
    .replace(
      new RegExp(
        `^${displayNamePattern}\\s+(?:stud(?:y|ies)|research(?:es)?|investigates?|develops?|focuses\\s+on|works\\s+on|uses?|explores?)\\s+`,
        'i',
      ),
      '',
    )
    .replace(
      /^(?:my|their|his|her|our)\s+research\s+(?:stud(?:y|ies)|investigates?|develops?|focuses\s+on|works\s+on|uses?|explores?)\s+/i,
      '',
    )
    .replace(/^(?:problems?|approaches?|methods?|models?)\s+(?:in|of|to|for)\s+/i, '')
    .trim();

  return lowerInitial(topic);
}

function derivedBioFromOfficialProfileInterests(identity: OfficialProfileIdentity): string {
  const interests = publicProfileResearchTerms(identity.researchInterests)
    .filter((term) => !/^(?:alcoholic|researcher|ys[mn])$/i.test(term))
    .slice(0, 5);
  if (interests.length === 0) return '';

  const interestText = formatInterestList(interests);
  const prefix = profileDescriptionPrefix(identity);
  if (interests.length === 1) {
    return meaningfulProfileTitle(identity.title)
      ? `${prefix} official Yale profile summarizes research in ${interestText}.`
      : `${identity.displayName}'s official Yale profile summarizes their research focus in ${interestText}, based on Yale's official profile data.`;
  }
  return `${prefix} official Yale profile lists research interests in ${interestText}.`;
}

function derivedBioFromOfficialProfile(identity: OfficialProfileIdentity): string {
  if (identity.suppressDerivedBio) return '';
  return (
    derivedBioFromOfficialProfileInterests(identity) ||
    (() => {
      const topic = terseOfficialBioTopic(identity);
      return topic
        ? `${profileDescriptionPrefix(identity)} official Yale profile summarizes research in ${topic}.`
        : '';
    })()
  );
}

export function identityToUserObservations(
  identity: OfficialProfileIdentity,
  existingUser: ExistingProfileUser,
  options: IdentityToUserObservationOptions = {},
): ObservationInput[] {
  const netid = textValue(existingUser.netid);
  if (!netid) return [];
  const { first, last } = splitName(identity.displayName);
  if (!first || !last) return [];
  const includeProfileEnrichment = options.includeProfileEnrichment ?? true;
  const includeIdentityEnrichment = options.includeIdentityEnrichment ?? true;
  const profileUrls = {
    medicine: identity.fetchedUrl,
    official: identity.canonicalUrl,
  };
  const identityObservations: Array<[string, unknown]> = [
    ['netid', netid],
    ['fname', first],
    ['lname', last],
    ['userType', 'faculty'],
    ['profileVerified', true],
    ['dataSources', [SOURCE_NAME]],
  ];
  if (includeProfileEnrichment) {
    identityObservations.splice(4, 0, ['title', identity.title], ['profileUrls', profileUrls]);
  }
  if (identity.email) identityObservations.splice(3, 0, ['email', identity.email]);

  const observations: ObservationInput[] = includeIdentityEnrichment
    ? identityObservations.map(([field, value]) => ({
        entityType: 'user',
        entityKey: `netid:${netid}`,
        field: String(field),
        value,
        sourceUrl: identity.canonicalUrl,
        confidenceOverride: 0.95,
      }))
    : [];

  if (includeProfileEnrichment) {
    const derivedBio = derivedBioFromOfficialProfile(identity);
    const cleanedIdentityBio = identity.bio
      ? cleanPublicProfileBio({
          ...identity,
          bio: identity.bio,
          fname: first,
          lname: last,
          websiteUrl: identity.canonicalUrl,
          profileUrls: {
            medicine: identity.fetchedUrl,
            official: identity.canonicalUrl,
          },
        })
      : '';
    const shouldUseDerivedBio =
      Boolean(derivedBio) && (!cleanedIdentityBio || cleanedIdentityBio.length < PROFILE_BIO_MIN_LENGTH);
    const rawBio = shouldUseDerivedBio ? derivedBio : cleanedIdentityBio || derivedBio;
    const bioCandidate = hasExternalScholarProfileCallout(rawBio) ? '' : rawBio;
    const bio = cleanPublicProfileBio({
      ...identity,
      bio: bioCandidate,
      fname: first,
      lname: last,
      websiteUrl: identity.canonicalUrl,
      profileUrls: {
        medicine: identity.fetchedUrl,
        official: identity.canonicalUrl,
      },
    });
    if (bio && bio.length >= PROFILE_BIO_MIN_LENGTH && !isSemicolonDelimitedProfileTopicList(bio)) {
      observations.push({
        entityType: 'user',
        entityKey: `netid:${netid}`,
        field: 'bio',
        value: bio,
        sourceUrl: identity.canonicalUrl,
        confidenceOverride: shouldUseDerivedBio || !cleanedIdentityBio ? 0.86 : 0.85,
      });
    }
    if (identity.imageUrl) {
      observations.push({
        entityType: 'user',
        entityKey: `netid:${netid}`,
        field: 'imageUrl',
        value: identity.imageUrl,
        sourceUrl: identity.canonicalUrl,
        confidenceOverride: 0.9,
      });
    }
    const researchInterests = publicProfileResearchTerms(identity.researchInterests);
    if (researchInterests.length > 0) {
      observations.push({
        entityType: 'user',
        entityKey: `netid:${netid}`,
        field: 'researchInterests',
        value: researchInterests,
        sourceUrl: identity.canonicalUrl,
        confidenceOverride: 0.85,
      });
      observations.push({
        entityType: 'user',
        entityKey: `netid:${netid}`,
        field: 'topics',
        value: researchInterests,
        sourceUrl: identity.canonicalUrl,
        confidenceOverride: 0.8,
      });
    }
    if (identity.orcid) {
      observations.push({
        entityType: 'user',
        entityKey: `netid:${netid}`,
        field: 'orcid',
        value: identity.orcid,
        sourceUrl: identity.canonicalUrl,
        confidenceOverride: 0.9,
      });
    }
  }
  return observations;
}

function shortOfficialProfileBio(value: string): string {
  const text = textValue(value);
  const primaryGoal = text.match(
    /\bprimary\s+goal\s+in\s+(?:his|her|their)\s+research(?:\s+and\s+teaching)?\s+is\s+to\s+(.+?)(?:[.!?]|$)/i,
  );
  if (primaryGoal?.[1]) {
    return `Research aims to ${primaryGoal[1].replace(/[.!?]+$/g, '').trim()}.`;
  }

  const researchRevolves = text.match(
    /\b(?:his|her|their|my)\s+research\s+(revolves around|centers? (?:on|in)|focuses on|examines|explores)\s+(.+?)(?:[.!?]|$)/i,
  );
  if (researchRevolves?.[1] && researchRevolves?.[2]) {
    return `Research ${researchRevolves[1].toLowerCase()} ${researchRevolves[2]
      .replace(/[.!?]+$/g, '')
      .trim()}.`;
  }

  const specializes = text.match(/\bspecializes\s+in\s+(.+?)(?:[.!?]|$)/i);
  if (specializes?.[1]) {
    return `Specializes in ${specializes[1].replace(/[.!?]+$/g, '').trim()}.`;
  }

  const authorOfTopics = text.match(
    /\b(?:is|was)\s+(?:the\s+|an?\s+)?(?:[\w-]+\s+){0,4}author\s+of\s+(?:many\s+)?(?:articles|books|articles\s+and\s+books)\s+on\s+(.+?)(?:[.!?]|$)/i,
  );
  if (authorOfTopics?.[1]) {
    return `Publishes on ${authorOfTopics[1].replace(/[.!?]+$/g, '').trim()}.`;
  }

  const authorOf = text.match(
    /\b(?:is|was)\s+(?:the\s+|an?\s+)?author\s+of\s+(.+?)(?:[.!?]|$)/i,
  );
  if (authorOf?.[1]) {
    if (/^(?:many\s+)?(?:articles|books|articles\s+and\s+books)\b/i.test(authorOf[1])) {
      return '';
    }
    return `Publishes on ${authorOf[1].replace(/[.!?]+$/g, '').trim()}.`;
  }

  const nameLedResearch = text.match(
    /^[\p{L}\p{M} .,'’-]{2,100}?\s+(stud(?:y|ies)|research(?:es)?|investigates?|develops?|focuses\s+on|works\s+on|uses?|explores?)\s+(.+?)(?:[.!?]|$)/u,
  );
  if (nameLedResearch?.[1] && nameLedResearch?.[2]) {
    const verb = nameLedResearch[1].toLowerCase();
    const rest = nameLedResearch[2].replace(/[.!?]+$/g, '').trim();
    const normalizedVerb = verb === 'studies' ? 'Studies' : `${verb.charAt(0).toUpperCase()}${verb.slice(1)}`;
    return `${normalizedVerb} ${rest}.`;
  }

  const situatedResearch = text.match(
    /\bresearch,\s+writing,\s+and\s+teaching\s+are\s+situated\s+at\s+(.+?)(?:[.!?]|$)/i,
  );
  if (situatedResearch?.[1]) {
    return `Research spans ${situatedResearch[1].replace(/[.!?]+$/g, '').trim()}.`;
  }

  const scholarOf = text.match(
    /\bis\s+(?:an?\s+)?scholar\s+of\s+(.+?)(?:\s+with\s+interest\s+in\s+(.+?))?(?:[.!?]|$)/i,
  );
  if (scholarOf?.[1]) {
    const focus = [scholarOf[1], scholarOf[2] ? `including ${scholarOf[2]}` : '']
      .map((part) => part.replace(/[.!?]+$/g, '').trim())
      .filter(Boolean)
      .join(', ');
    return `Studies ${focus}.`;
  }

  const listParts = text
    .split(',')
    .map((part) => textValue(part).replace(/[.;:]+$/g, ''))
    .filter((part) => part.length >= 8);
  if (!/[.!?]/.test(text) && listParts.length >= 3) {
    const lead = listParts.slice(0, 3);
    return `Studies ${lead.slice(0, -1).join(', ')}, and ${lead.at(-1)}.`;
  }

  const derived = deriveShortDescriptionFromFullDescription(text);
  if (derived) return derived;
  if (text.length <= 220) return text;
  const prefix = text.slice(0, 220).trim();
  const sentenceEnds = Array.from(prefix.matchAll(/[.!?](?=\s|$)/g));
  const lastSentenceEnd = sentenceEnds.at(-1);
  if (lastSentenceEnd && typeof lastSentenceEnd.index === 'number' && lastSentenceEnd.index >= 80) {
    return prefix.slice(0, lastSentenceEnd.index + 1).trim();
  }
  return `${prefix.replace(/\s+\S*$/, '').replace(/[,;:\-–—]+$/g, '').trim()}.`;
}

export function shouldEmitProfileDescriptionBackfillForEntity(entity: Record<string, any>): boolean {
  const suppressedBy = entity[PROFILE_DESCRIPTION_SUPPRESSED_BY_PREFERRED_SOURCE_NAMES_FIELD];
  return !(Array.isArray(suppressedBy) && suppressedBy.length > 0);
}

export function identityToResearchEntityDescriptionObservations(
  identity: OfficialProfileIdentity,
  entity: Record<string, any>,
): ObservationInput[] {
  const { first, last } = splitName(identity.displayName);
  const bio =
    cleanPublicProfileBio({
      ...identity,
      bio: identity.bio,
      fname: first,
      lname: last,
      websiteUrl: identity.canonicalUrl,
      profileUrls: {
        medicine: identity.fetchedUrl,
        official: identity.canonicalUrl,
      },
    }) || derivedBioFromOfficialProfile(identity);
  if (!bio) return [];
  const entityId = idValue(entity._id || entity.id);
  const entityKey = textValue(entity.slug || entity._id);
  const sourceUrls = uniqueStrings([
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
    identity.canonicalUrl,
  ]);
  const shortDescription = shortOfficialProfileBio(bio);
  const fallbackShortDescription = derivedBioFromOfficialProfile(identity);
  const quality = assessResearchEntityDescriptionQuality({
    fullDescription: bio,
    shortDescription,
    sourceUrls,
  });
  const fallbackShortQuality = fallbackShortDescription
    ? assessResearchEntityDescriptionQuality({
        fullDescription: bio,
        shortDescription: fallbackShortDescription,
        sourceUrls,
      }).short
    : undefined;
  const base = {
    entityType: 'researchEntity' as const,
    ...(entityId ? { entityId } : {}),
    ...(entityKey ? { entityKey } : {}),
    sourceUrl: identity.canonicalUrl,
    confidenceOverride: 0.78,
  };

  const observations: ObservationInput[] = [{ ...base, field: 'sourceUrls', value: sourceUrls }];
  if (quality.full.isUseful) observations.push({ ...base, field: 'fullDescription', value: bio });
  if (quality.short.isUseful) {
    observations.push({ ...base, field: 'shortDescription', value: shortDescription });
  } else if (fallbackShortDescription && fallbackShortQuality?.isUseful) {
    observations.push({ ...base, field: 'shortDescription', value: fallbackShortDescription });
  }
  return observations;
}

export function identityToResearchEntityPiObservations(
  identity: OfficialProfileIdentity,
  existingUser: ExistingProfileUser,
  entity: Record<string, any>,
): ObservationInput[] {
  const userId = idValue(existingUser._id);
  if (!userId) return [];
  const entityId = idValue(entity._id || entity.id);
  const entityKey = textValue(entity.slug || entity._id);
  const base = {
    entityType: 'researchEntity' as const,
    ...(entityId ? { entityId } : {}),
    ...(entityKey ? { entityKey } : {}),
    sourceUrl: identity.canonicalUrl,
    confidenceOverride: 0.88,
  };

  return [{ ...base, field: 'inferredPiUserId', value: userId }];
}

export function identityToResearchEntityPiKeyObservations(
  identity: OfficialProfileIdentity,
  userKey: string,
  entity: Record<string, any>,
): ObservationInput[] {
  const lookupKey = textValue(userKey);
  if (!lookupKey) return [];
  const entityId = idValue(entity._id || entity.id);
  const entityKey = textValue(entity.slug || entity._id);
  const base = {
    entityType: 'researchEntity' as const,
    ...(entityId ? { entityId } : {}),
    ...(entityKey ? { entityKey } : {}),
    sourceUrl: identity.canonicalUrl,
    confidenceOverride: 0.88,
  };

  return [{ ...base, field: 'inferredPiUserKey', value: lookupKey }];
}

async function fetchHtml(url: string, useCache: boolean, sourceName: string): Promise<string> {
  const cacheKey = `official-profile-pi-backfill:${url}`;
  if (useCache) {
    const cached = await getCached<string>(sourceName, cacheKey);
    if (cached) return cached;
  }
  const res = await axios.get(url, {
    timeout: FETCH_TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
  });
  const html = String(res.data || '');
  if (useCache) await setCached(sourceName, cacheKey, html);
  return html;
}

async function selectQueuedEntities(limit: number): Promise<Array<Record<string, any>>> {
  const queueItems = await VisibilityReleaseQueueItem.find({
    collection: 'research',
    status: 'open',
    repairStage: 'pi_identity',
    blockerReasons: 'missing_lead',
  })
    .sort({ lastSeenAt: -1 })
    .limit(Math.max(limit * 10, 100))
    .lean();
  const entityIds = uniqueStrings(queueItems.map((item: any) => String(item.recordId || '')));
  if (entityIds.length === 0) return [];

  const [entities, leadMembers] = await Promise.all([
    ResearchEntity.find({ _id: { $in: entityIds }, archived: { $ne: true } })
      .select('_id slug name displayName website websiteUrl sourceUrls')
      .lean(),
    ResearchGroupMember.find({
      researchEntityId: { $in: entityIds },
      isCurrentMember: { $ne: false },
      role: { $in: ['pi', 'co-pi', 'director', 'co-director'] },
    })
      .select('researchEntityId')
      .lean(),
  ]);
  const entitiesById = new Map((entities as any[]).map((entity) => [String(entity._id), entity]));
  const hasLead = new Set((leadMembers as any[]).map((member) => String(member.researchEntityId)));

  const annotatedEntities = await annotateEntitiesWithSourceObservationUrls(
    entityIds
      .map((id) => entitiesById.get(id))
      .filter((entity): entity is Record<string, any> => !!entity && !hasLead.has(String(entity._id))),
  );

  return annotatedEntities
    .filter(shouldQueueEntityForPiBackfill)
    .slice(0, limit);
}

async function selectDirectVisibleProfileBioUserTargets(
  limit: number,
  excludedUserIds: Set<string>,
): Promise<Array<Record<string, any>>> {
  if (limit <= 0) return [];

  const users = await User.find({
    archived: { $ne: true },
    userType: 'faculty',
    netid: { $exists: true, $ne: '' },
    $or: [
      { profileUrls: { $exists: true, $ne: null } },
      { website: /yale\.edu/i },
      { websiteUrl: /yale\.edu/i },
    ],
  })
    .select('_id netid email fname lname userType title bio website websiteUrl profileUrls')
    .sort({ updatedAt: 1 })
    .limit(Math.max(limit * 4, 50))
    .lean();

  return (users as any[])
    .filter((user) => user.netid && !excludedUserIds.has(idValue(user._id)) && publicBioNeedsBackfill(user))
    .map((user) => {
      const urls = visibleBioProfileUrlsForUser(user);
      return urls.length > 0 ? userIdentityMatchEntity(user, urls) : null;
    })
    .filter((entity): entity is Record<string, any> => !!entity)
    .slice(0, limit);
}

export async function selectVisibleProfileBioTargets(limit: number): Promise<Array<Record<string, any>>> {
  const entities = await ResearchEntity.find({
    archived: { $ne: true },
    studentVisibilityTier: { $in: publicStudentVisibilityTiers },
  })
    .select('_id website websiteUrl sourceUrls')
    .lean();
  const entitiesById = new Map((entities as any[]).map((entity) => [idValue(entity._id), entity]));

  const members =
    entities.length > 0
      ? await ResearchGroupMember.find({
          researchEntityId: { $in: entities.map((entity: any) => entity._id) },
          archived: { $ne: true },
          isCurrentMember: { $ne: false },
          role: { $in: VISIBLE_PROFILE_MEMBER_ROLES },
          userId: { $exists: true, $ne: null },
        })
          .select('researchEntityId userId sourceUrl')
          .lean()
      : [];
  const userIds = uniqueStrings(members.map((member: any) => String(member.userId || '')));

  const users =
    userIds.length > 0
      ? await User.find({ _id: { $in: userIds } })
          .select('_id netid email fname lname userType title bio website websiteUrl profileUrls')
          .sort({ updatedAt: 1 })
          .lean()
      : [];

  const memberTargets = (users as any[])
    .filter((user) => user.netid && publicBioNeedsBackfill(user))
    .map((user) => {
      const attachedUrls = (members as any[])
        .filter((member) => idValue(member.userId) === idValue(user._id))
        .flatMap((member) => {
          const entity = entitiesById.get(idValue(member.researchEntityId));
          return [
            entity?.websiteUrl,
            entity?.website,
            ...(Array.isArray(entity?.sourceUrls) ? entity.sourceUrls : []),
            member.sourceUrl,
          ];
        })
        .filter((url) => visibleBioProfileUrlMatchesUser(textValue(url), user));
      return userIdentityMatchEntity(user, uniqueStrings(attachedUrls));
    })
    .filter((entity) => visibleBioProfileUrlsForUser(entity).length > 0)
    .slice(0, limit);

  const excludedUserIds = new Set(memberTargets.map((target) => idValue(target._id)));
  return [
    ...memberTargets,
    ...(await selectDirectVisibleProfileBioUserTargets(limit - memberTargets.length, excludedUserIds)),
  ].slice(0, limit);
}

const sourceDescriptionProfileBlockers = [
  'missing_description',
  'thin_description',
  'profile_fallback_only',
  'missing_card_description',
];

function targetKeyFilter(targetKeys: string[]): Record<string, unknown> {
  const objectIds = targetKeys.filter((value) => /^[a-f0-9]{24}$/i.test(value));
  return {
    $or: [
      ...(objectIds.length ? [{ _id: { $in: objectIds } }] : []),
      { slug: { $in: targetKeys } },
      { name: { $in: targetKeys } },
      { displayName: { $in: targetKeys } },
    ],
  };
}

async function selectProfileDescriptionTargets(
  limit: number,
  targetKeys: string[] = [],
): Promise<Array<Record<string, any>>> {
  const identityFilter =
    targetKeys.length > 0
      ? targetKeyFilter(targetKeys)
      : {
          _id: {
            $in: uniqueStrings(
              (
                await VisibilityReleaseQueueItem.find({
                  collection: 'research',
                  status: 'open',
                  repairStage: 'source_description',
                  blockerReasons: { $in: sourceDescriptionProfileBlockers },
                })
                  .sort({ lastSeenAt: -1, _id: 1 })
                  .limit(Math.max(limit * 20, 100))
                  .select('recordId')
                  .lean()
              ).map((item: any) => String(item.recordId || '')),
            ),
          },
        };

  const entities = (await ResearchEntity.find({
    archived: { $ne: true },
    ...identityFilter,
  })
    .select('_id slug name displayName website websiteUrl sourceUrls')
    .sort({ lastObservedAt: -1, _id: 1 })
    .limit(Math.max(limit * 20, 100))
    .lean()) as Array<Record<string, any>>;

  const entitiesWithLeadUsers = await annotateEntitiesWithLeadUsers(entities);
  const entitiesWithObservationUrls = await annotateEntitiesWithSourceObservationUrls(
    entitiesWithLeadUsers,
  );
  const candidates = entitiesWithObservationUrls.filter(
    (entity) => officialProfileUrlsForEntity(entity).length > 0,
  );
  const annotated = await annotateProfileDescriptionPreferredSourceEvidence(candidates);

  const filtered =
    targetKeys.length > 0
      ? annotated
      : annotated.filter(shouldEmitProfileDescriptionBackfillForEntity);
  return filtered.slice(0, limit);
}

async function annotateEntitiesWithLeadUsers(
  entities: Array<Record<string, any>>,
): Promise<Array<Record<string, any>>> {
  if (entities.length === 0) return entities;
  const entityIds = uniqueStrings(entities.map((entity) => idValue(entity._id || entity.id))).filter(
    (id) => /^[a-f0-9]{24}$/i.test(id),
  );
  if (entityIds.length === 0) return entities;

  const members = (await ResearchGroupMember.find({
    researchEntityId: { $in: entityIds },
    archived: { $ne: true },
    isCurrentMember: { $ne: false },
    role: { $in: VISIBLE_PROFILE_MEMBER_ROLES },
  })
    .select('researchEntityId userId fname lname name email')
    .lean()) as Array<Record<string, any>>;
  const userIds = uniqueStrings(members.map((member) => idValue(member.userId))).filter((id) =>
    /^[a-f0-9]{24}$/i.test(id),
  );
  const users = userIds.length
    ? ((await User.find({ _id: { $in: userIds } })
        .select('_id fname lname name displayName email')
        .lean()) as Array<Record<string, any>>)
    : [];
  const usersById = new Map(users.map((user) => [idValue(user._id), user]));
  const leadUsersByEntity = new Map<string, Array<Record<string, any>>>();
  const generatedProfileUrlsByEntity = new Map<string, string[]>();

  for (const member of members) {
    const user = usersById.get(idValue(member.userId)) || member;
    const lead = {
      fname: user.fname,
      lname: user.lname,
      name: user.name || user.displayName || member.name,
      displayName: user.displayName || user.name || member.name,
      email: user.email || member.email,
    };
    const entityId = idValue(member.researchEntityId);
    leadUsersByEntity.set(entityId, [...(leadUsersByEntity.get(entityId) || []), lead]);
    generatedProfileUrlsByEntity.set(entityId, [
      ...(generatedProfileUrlsByEntity.get(entityId) || []),
      ...generatedOfficialProfileUrlCandidatesForPerson(lead),
    ]);
  }

  return entities.map((entity) => ({
    ...entity,
    leadUsers: [
      ...(Array.isArray(entity.leadUsers) ? entity.leadUsers : []),
      ...(leadUsersByEntity.get(idValue(entity._id || entity.id)) || []),
    ],
    leadUserProfileUrls: uniqueStrings([
      ...objectStringValues(entity.leadUserProfileUrls),
      ...(generatedProfileUrlsByEntity.get(idValue(entity._id || entity.id)) || []),
    ]),
  }));
}

async function annotateEntitiesWithSourceObservationUrls(
  entities: Array<Record<string, any>>,
): Promise<Array<Record<string, any>>> {
  if (entities.length === 0) return entities;

  const entityIds = uniqueStrings(entities.map((entity) => idValue(entity._id || entity.id))).filter(
    (id) => /^[a-f0-9]{24}$/i.test(id),
  );
  const entityKeys = uniqueStrings(entities.map((entity) => textValue(entity.slug)));
  if (entityIds.length === 0 && entityKeys.length === 0) return entities;

  const rows = await Observation.find({
    entityType: 'researchEntity',
    superseded: { $ne: true },
    sourceUrl: /^https?:\/\//i,
    $or: [
      ...(entityIds.length ? [{ entityId: { $in: entityIds } }] : []),
      ...(entityKeys.length ? [{ entityKey: { $in: entityKeys } }] : []),
    ],
  })
    .select('entityId entityKey sourceUrl observedAt')
    .sort({ observedAt: -1 })
    .limit(Math.max(entities.length * 20, 200))
    .lean();

  const urlsByEntity = new Map<string, string[]>();
  for (const row of rows as Array<Record<string, any>>) {
    const sourceUrl = textValue(row.sourceUrl);
    if (!sourceUrl) continue;
    for (const key of [idValue(row.entityId), textValue(row.entityKey)].filter(Boolean)) {
      urlsByEntity.set(key, [...(urlsByEntity.get(key) || []), sourceUrl]);
    }
  }

  return entities.map((entity) => ({
    ...entity,
    sourceObservationUrls: uniqueStrings([
      ...objectStringValues(entity.sourceObservationUrls),
      ...(urlsByEntity.get(idValue(entity._id || entity.id)) || []),
      ...(urlsByEntity.get(textValue(entity.slug)) || []),
    ]),
  }));
}

async function annotateProfileDescriptionPreferredSourceEvidence(
  entities: Array<Record<string, any>>,
): Promise<Array<Record<string, any>>> {
  if (entities.length === 0) return entities;

  const entityIds = uniqueStrings(entities.map((entity) => idValue(entity._id || entity.id))).filter(
    (id) => /^[a-f0-9]{24}$/i.test(id),
  );
  const entityKeys = uniqueStrings(entities.map((entity) => textValue(entity.slug)));
  if (entityIds.length === 0 && entityKeys.length === 0) return entities;

  const evidenceRows = await Observation.find({
    entityType: 'researchEntity',
    superseded: { $ne: true },
    sourceName: { $in: PROFILE_DESCRIPTION_PREFERRED_SOURCE_NAMES },
    field: { $in: PROFILE_DESCRIPTION_FIELDS },
    $or: [
      ...(entityIds.length ? [{ entityId: { $in: entityIds } }] : []),
      ...(entityKeys.length ? [{ entityKey: { $in: entityKeys } }] : []),
    ],
  })
    .select('entityId entityKey sourceName')
    .lean();

  const sourceNamesByEntity = new Map<string, Set<string>>();
  for (const row of evidenceRows as Array<Record<string, any>>) {
    const sourceName = textValue(row.sourceName);
    if (!sourceName) continue;
    for (const key of [idValue(row.entityId), textValue(row.entityKey)].filter(Boolean)) {
      if (!sourceNamesByEntity.has(key)) sourceNamesByEntity.set(key, new Set());
      sourceNamesByEntity.get(key)!.add(sourceName);
    }
  }

  return entities.map((entity) => {
    const sourceNames = uniqueStrings([
      ...Array.from(sourceNamesByEntity.get(idValue(entity._id || entity.id)) || []),
      ...Array.from(sourceNamesByEntity.get(textValue(entity.slug)) || []),
    ]);
    if (sourceNames.length === 0) return entity;
    return {
      ...entity,
      [PROFILE_DESCRIPTION_SUPPRESSED_BY_PREFERRED_SOURCE_NAMES_FIELD]: sourceNames,
    };
  });
}

async function selectResearchHomeProfileTargets(
  limit: number,
  targetKeys: string[] = [],
): Promise<Array<Record<string, any>>> {
  const targetFilter =
    targetKeys.length > 0
      ? targetKeyFilter(targetKeys)
      : {
          $and: [
            {
              $or: [{ websiteUrl: { $exists: false } }, { websiteUrl: null }, { websiteUrl: '' }],
            },
            {
              $or: [{ website: { $exists: false } }, { website: null }, { website: '' }],
            },
          ],
        };

  const entities = (await ResearchEntity.find({
    archived: { $ne: true },
    ...targetFilter,
  })
    .select('_id slug name displayName website websiteUrl sourceUrls')
    .sort({ lastObservedAt: -1, _id: 1 })
    .limit(Math.max(limit * 20, 100))
    .lean()) as Array<Record<string, any>>;
  if (entities.length === 0) return [];

  const members = (await ResearchGroupMember.find({
    researchEntityId: { $in: entities.map((entity) => entity._id) },
    archived: { $ne: true },
    isCurrentMember: { $ne: false },
    role: { $in: VISIBLE_PROFILE_MEMBER_ROLES },
    userId: { $exists: true, $ne: null },
  })
    .select('researchEntityId userId')
    .lean()) as Array<Record<string, any>>;
  const userIds = uniqueStrings(members.map((member) => idValue(member.userId)));
  if (userIds.length === 0) return [];

  const users = (await User.find({ _id: { $in: userIds } })
    .select('_id fname lname email website websiteUrl profileUrls')
    .lean()) as Array<Record<string, any>>;
  const usersById = new Map(users.map((user) => [idValue(user._id), user]));
  const profileUrlsByEntity = new Map<string, string[]>();
  const leadUsersByEntity = new Map<string, Array<Record<string, any>>>();

  for (const member of members) {
    const user = usersById.get(idValue(member.userId));
    if (!user) continue;
    const urls = uniqueStrings([
      user.website,
      user.websiteUrl,
      ...objectStringValues(user.profileUrls),
    ]);
    if (urls.length === 0) continue;
    const entityId = idValue(member.researchEntityId);
    profileUrlsByEntity.set(entityId, [
      ...(profileUrlsByEntity.get(entityId) || []),
      ...urls,
    ]);
    leadUsersByEntity.set(entityId, [
      ...(leadUsersByEntity.get(entityId) || []),
      {
        fname: user.fname,
        lname: user.lname,
        email: user.email,
      },
    ]);
  }

  const entitiesWithLeadUrls = entities
    .map((entity) => ({
      ...entity,
      leadUserProfileUrls: uniqueStrings(profileUrlsByEntity.get(idValue(entity._id)) || []),
      leadUsers: leadUsersByEntity.get(idValue(entity._id)) || [],
    }));
  const entitiesWithObservationUrls = await annotateEntitiesWithSourceObservationUrls(entitiesWithLeadUrls);

  return entitiesWithObservationUrls
    .filter((entity) => officialProfileUrlsForEntity(entity).length > 0)
    .slice(0, limit);
}

async function selectLeadDirectWebsiteTargets(
  limit: number,
  targetKeys: string[] = [],
): Promise<Array<Record<string, any>>> {
  const targetFilter =
    targetKeys.length > 0
      ? targetKeyFilter(targetKeys)
      : {
          $and: [
            {
              $or: [{ websiteUrl: { $exists: false } }, { websiteUrl: null }, { websiteUrl: '' }],
            },
            {
              $or: [{ website: { $exists: false } }, { website: null }, { website: '' }],
            },
          ],
          studentVisibilityTier: { $ne: 'suppressed' },
        };

  const entities = (await ResearchEntity.find({
    archived: { $ne: true },
    ...targetFilter,
  })
    .select('_id slug name displayName website websiteUrl sourceUrls')
    .sort({ lastObservedAt: -1, _id: 1 })
    .limit(Math.max(limit * 20, 100))
    .lean()) as Array<Record<string, any>>;
  if (entities.length === 0) return [];

  const members = (await ResearchGroupMember.find({
    researchEntityId: { $in: entities.map((entity) => entity._id) },
    archived: { $ne: true },
    isCurrentMember: { $ne: false },
    role: { $in: VISIBLE_PROFILE_MEMBER_ROLES },
    userId: { $exists: true, $ne: null },
  })
    .select('researchEntityId userId')
    .lean()) as Array<Record<string, any>>;
  const userIds = uniqueStrings(members.map((member) => idValue(member.userId)));
  const users =
    userIds.length > 0
      ? ((await User.find({ _id: { $in: userIds } })
          .select('_id website websiteUrl profileUrls')
          .lean()) as Array<Record<string, any>>)
      : [];
  const usersById = new Map(users.map((user) => [idValue(user._id), user]));

  const urlsByEntity = new Map<string, string[]>();
  for (const member of members) {
    const user = usersById.get(idValue(member.userId));
    if (!user) continue;
    const urls = leadDirectResearchHomeUrlsForUser(user);
    if (urls.length === 0) continue;
    const entityId = idValue(member.researchEntityId);
    urlsByEntity.set(entityId, uniqueStrings([...(urlsByEntity.get(entityId) || []), ...urls]));
  }
  const candidateUrls = uniqueStrings(Array.from(urlsByEntity.values()).flat());
  const candidateEntityIds = new Set(entities.map((entity) => idValue(entity._id)));
  const duplicateWebsiteUrls = new Set<string>();
  if (candidateUrls.length > 0) {
    const duplicateLookupUrls = uniqueStrings(candidateUrls.flatMap(websiteDuplicateLookupUrls));
    const existingWebsiteRows = (await ResearchEntity.find({
      archived: { $ne: true },
      $or: [{ websiteUrl: { $in: duplicateLookupUrls } }, { website: { $in: duplicateLookupUrls } }],
    })
      .select('_id website websiteUrl')
      .lean()) as Array<Record<string, any>>;
    for (const row of existingWebsiteRows) {
      if (candidateEntityIds.has(idValue(row._id))) continue;
      for (const url of [textValue(row.websiteUrl), textValue(row.website)]) {
        if (url) duplicateWebsiteUrls.add(url);
      }
    }
  }

  return entities
    .map((entity) => ({
      ...entity,
      leadDirectWebsiteUrl: firstNonDuplicateLeadDirectWebsiteUrl(
        urlsByEntity.get(idValue(entity._id)) || [],
        duplicateWebsiteUrls,
      ),
    }))
    .filter((entity) => textValue(entity.leadDirectWebsiteUrl))
    .slice(0, limit);
}

async function selectSourceUrlWebsiteTargets(
  limit: number,
  targetKeys: string[] = [],
): Promise<Array<Record<string, any>>> {
  const targetFilter =
    targetKeys.length > 0
      ? targetKeyFilter(targetKeys)
      : {
          $and: [
            {
              $or: [{ websiteUrl: { $exists: false } }, { websiteUrl: null }, { websiteUrl: '' }],
            },
            {
              $or: [{ website: { $exists: false } }, { website: null }, { website: '' }],
            },
          ],
          studentVisibilityTier: { $ne: 'suppressed' },
        };

  const entities = (await ResearchEntity.find({
    archived: { $ne: true },
    ...targetFilter,
  })
    .select('_id slug name displayName website websiteUrl sourceUrls sourceObservationUrls')
    .sort({ lastObservedAt: -1, _id: 1 })
    .limit(Math.max(limit * 20, 100))
    .lean()) as Array<Record<string, any>>;
  if (entities.length === 0) return [];

  const entitiesWithObservationUrls = await annotateEntitiesWithSourceObservationUrls(entities);
  const urlsByEntity = new Map<string, string[]>();
  for (const entity of entitiesWithObservationUrls) {
    const urls = sourceUrlResearchHomeUrlsForEntity(entity);
    if (urls.length === 0) continue;
    urlsByEntity.set(idValue(entity._id), urls);
  }

  const candidateUrls = uniqueStrings(Array.from(urlsByEntity.values()).flat());
  const candidateEntityIds = new Set(entities.map((entity) => idValue(entity._id)));
  const duplicateWebsiteUrls = new Set<string>();
  if (candidateUrls.length > 0) {
    const duplicateLookupUrls = uniqueStrings(candidateUrls.flatMap(websiteDuplicateLookupUrls));
    const existingWebsiteRows = (await ResearchEntity.find({
      archived: { $ne: true },
      $or: [{ websiteUrl: { $in: duplicateLookupUrls } }, { website: { $in: duplicateLookupUrls } }],
    })
      .select('_id website websiteUrl')
      .lean()) as Array<Record<string, any>>;
    for (const row of existingWebsiteRows) {
      if (candidateEntityIds.has(idValue(row._id))) continue;
      for (const url of [textValue(row.websiteUrl), textValue(row.website)]) {
        if (url) duplicateWebsiteUrls.add(url);
      }
    }
  }

  return entitiesWithObservationUrls
    .map((entity) => ({
      ...entity,
      sourceUrlWebsiteUrl: firstNonDuplicateLeadDirectWebsiteUrl(
        urlsByEntity.get(idValue(entity._id)) || [],
        duplicateWebsiteUrls,
      ),
    }))
    .filter((entity) => textValue(entity.sourceUrlWebsiteUrl))
    .slice(0, limit);
}

export async function resolveExistingUserForIdentity(
  identity: OfficialProfileIdentity,
): Promise<ExistingProfileUser | null> {
  const urls = uniqueStrings([identity.fetchedUrl, identity.canonicalUrl]);
  const email = textValue(identity.email).toLowerCase();
  const orFilters = [
    ...(email ? [{ email }] : []),
    ...(urls.length
      ? [
          { website: { $in: urls } },
          { websiteUrl: { $in: urls } },
          { 'profileUrls.medicine': { $in: urls } },
          { 'profileUrls.official': { $in: urls } },
          { 'profileUrls.ysm': { $in: urls } },
        ]
      : []),
  ];
  if (orFilters.length === 0) return null;
  const candidates = await User.find({
    $or: orFilters,
  })
    .select('netid email fname lname name displayName website websiteUrl profileUrls')
    .limit(10)
    .lean();

  const matchingCandidates =
    candidates.length <= 1 ? candidates : candidates.filter((candidate: any) => {
      const candidateEmail = textValue(candidate.email).toLowerCase();
      if (email && candidateEmail === email) return true;

      const identitySplit = splitName(identity.displayName);
      const candidateSplit = splitName(
        textValue(candidate.name || candidate.displayName) ||
          textValue(`${textValue(candidate.fname)} ${textValue(candidate.lname)}`),
      );
      const candidateFirst = slugify(normalizeName(textValue(candidate.fname) || candidateSplit.first));
      const candidateLast = slugify(normalizeName(textValue(candidate.lname) || candidateSplit.last));
      const identityFirst = slugify(normalizeName(identitySplit.first));
      const identityLast = slugify(normalizeName(identitySplit.last));
      const exactNameMatch =
        candidateFirst &&
        candidateLast &&
        identityFirst &&
        identityLast &&
        candidateFirst === identityFirst &&
        candidateLast === identityLast;
      if (exactNameMatch) return true;

      return urls.some((url) => personPageUrlMatchesUser(url, candidate));
    });

  if (matchingCandidates.length !== 1) return null;
  const user = matchingCandidates[0] as any;
  const netid = textValue(user.netid);
  return netid ? { _id: idValue(user._id), netid, email: textValue(user.email) } : null;
}

async function websiteUrlOwnedByAnotherEntity(
  websiteUrl: string,
  entity: Record<string, any>,
): Promise<boolean> {
  const lookupUrls = websiteDuplicateLookupUrls(websiteUrl);
  if (lookupUrls.length === 0) return false;
  const owner = (await ResearchEntity.findOne({
    archived: { $ne: true },
    $or: [{ websiteUrl: { $in: lookupUrls } }, { website: { $in: lookupUrls } }],
  })
    .select('_id')
    .lean()) as { _id?: unknown } | Array<{ _id?: unknown }> | null;
  const ownerRecord = Array.isArray(owner) ? owner[0] : owner;
  return Boolean(ownerRecord && idValue(ownerRecord._id) !== idValue(entity._id || entity.id));
}

export class OfficialProfilePiBackfillScraper implements IScraper {
  readonly name = SOURCE_NAME;
  readonly displayName = 'Official profile PI backfill';

  constructor(
    private readonly htmlFetcher: (
      url: string,
      useCache: boolean,
      sourceName: string,
    ) => Promise<string> = fetchHtml,
    private readonly entitySelector: (limit: number) => Promise<Array<Record<string, any>>> = selectQueuedEntities,
    private readonly userResolver: (
      identity: OfficialProfileIdentity,
    ) => Promise<ExistingProfileUser | null> = resolveExistingUserForIdentity,
    private readonly visibleProfileSelector: (
      limit: number,
    ) => Promise<Array<Record<string, any>>> = selectVisibleProfileBioTargets,
    private readonly researchHomeProfileSelector: (
      limit: number,
      targetKeys?: string[],
    ) => Promise<Array<Record<string, any>>> = selectResearchHomeProfileTargets,
    private readonly profileDescriptionSelector: (
      limit: number,
      targetKeys?: string[],
    ) => Promise<Array<Record<string, any>>> = selectProfileDescriptionTargets,
    private readonly profileFetchThrottleMs: number = PROFILE_FETCH_THROTTLE_MS,
    private readonly delay: (ms: number) => Promise<void> = sleep,
    private readonly leadDirectWebsiteSelector: (
      limit: number,
      targetKeys?: string[],
    ) => Promise<Array<Record<string, any>>> = selectLeadDirectWebsiteTargets,
    private readonly sourceUrlWebsiteSelector: (
      limit: number,
      targetKeys?: string[],
    ) => Promise<Array<Record<string, any>>> = selectSourceUrlWebsiteTargets,
  ) {}

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const onlyValues = (ctx.options.only || [])
      .map((value) => value.toLowerCase().trim())
      .filter(Boolean);
    const only = new Set(onlyValues);
    const targetKeys = onlyValues.filter((value) => !OFFICIAL_PROFILE_MODE_KEYS.has(value));
    const hasExplicitMode = onlyValues.some((value) => OFFICIAL_PROFILE_MODE_KEYS.has(value));
    const runQueuedPiBackfill =
      targetKeys.length === 0 && (only.size === 0 || only.has(QUEUED_PI_BACKFILL_KEY));
    const runVisibleProfileBioBackfill =
      targetKeys.length === 0 && only.has(VISIBLE_PROFILE_BIO_BACKFILL_KEY);
    const runProfileDescriptionBackfill =
      only.has(PROFILE_DESCRIPTION_BACKFILL_KEY);
    const runLeadDirectWebsiteBackfill =
      only.has(LEAD_DIRECT_WEBSITE_BACKFILL_KEY);
    const runSourceUrlWebsiteBackfill =
      only.has(SOURCE_URL_WEBSITE_BACKFILL_KEY);
    const runProfileResearchHomeBackfill =
      only.size === 0 ||
      only.has(PROFILE_RESEARCH_HOME_BACKFILL_KEY) ||
      (targetKeys.length > 0 && !hasExplicitMode);
    const runOnlyWebsiteObservationBackfill =
      (runLeadDirectWebsiteBackfill || runSourceUrlWebsiteBackfill) &&
      !runQueuedPiBackfill &&
      !runVisibleProfileBioBackfill &&
      !runProfileDescriptionBackfill &&
      !runProfileResearchHomeBackfill;
    const runOnlyVisibleProfileBioBackfill =
      runVisibleProfileBioBackfill &&
      !runQueuedPiBackfill &&
      !runProfileDescriptionBackfill &&
      !runProfileResearchHomeBackfill &&
      !runLeadDirectWebsiteBackfill &&
      !runSourceUrlWebsiteBackfill;
    if (
      !runQueuedPiBackfill &&
      !runVisibleProfileBioBackfill &&
      !runProfileDescriptionBackfill &&
      !runProfileResearchHomeBackfill &&
      !runLeadDirectWebsiteBackfill &&
      !runSourceUrlWebsiteBackfill
    ) {
      ctx.log(
        `No matching --only key; expected ${QUEUED_PI_BACKFILL_KEY}, ${VISIBLE_PROFILE_BIO_BACKFILL_KEY}, ${PROFILE_DESCRIPTION_BACKFILL_KEY}, ${PROFILE_RESEARCH_HOME_BACKFILL_KEY}, ${LEAD_DIRECT_WEBSITE_BACKFILL_KEY}, ${SOURCE_URL_WEBSITE_BACKFILL_KEY}, or entity keys.`,
      );
      return { observationCount: 0, entitiesObserved: 0, notes: 'Skipped by --only filter.' };
    }

    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }
    const limit = limitOption ?? 25;
    const selectedEntities = [
      ...(runQueuedPiBackfill ? await this.entitySelector(limit) : []),
      ...(runVisibleProfileBioBackfill ? await this.visibleProfileSelector(limit) : []),
      ...(runProfileDescriptionBackfill
        ? await this.profileDescriptionSelector(limit, targetKeys)
        : []),
      ...(runProfileResearchHomeBackfill
        ? await this.researchHomeProfileSelector(limit, targetKeys)
        : []),
      ...(runLeadDirectWebsiteBackfill
        ? await this.leadDirectWebsiteSelector(limit, targetKeys)
        : []),
      ...(runSourceUrlWebsiteBackfill
        ? await this.sourceUrlWebsiteSelector(limit, targetKeys)
        : []),
    ];
    const seenEntities = new Set<string>();
    const entities = selectedEntities
      .filter((entity) => {
        const key = idValue(entity._id) || textValue(entity.slug);
        if (!key || seenEntities.has(key)) return false;
        seenEntities.add(key);
        return true;
      })
      .slice(0, limit);
    let emitted = 0;
    let observed = 0;
    let fetchAttempts = 0;

    for (const entity of entities) {
      if (runOnlyWebsiteObservationBackfill) {
        const observations = entityLeadDirectWebsiteToObservations(
          entity,
          textValue(entity.leadDirectWebsiteUrl || entity.sourceUrlWebsiteUrl),
        );
        if (observations.length === 0) continue;
        await ctx.emit(observations);
        emitted += observations.length;
        observed += 1;
        continue;
      }

      const candidates = runOnlyVisibleProfileBioBackfill
        ? visibleBioProfileUrlsForUser(entity)
        : uniqueStrings([
            ...officialProfileUrlsForEntity(entity),
            ...officialProfileUrlsForUser(entity),
          ]);
      if (candidates.length === 0) continue;

      try {
        let profileUrl = '';
        let html = '';
        for (const candidateProfileUrl of orderedProfileFetchCandidates(candidates)) {
          try {
            if (fetchAttempts > 0 && this.profileFetchThrottleMs > 0) {
              await this.delay(this.profileFetchThrottleMs);
            }
            fetchAttempts += 1;
            html = await this.htmlFetcher(candidateProfileUrl, ctx.options.useCache, this.name);
            profileUrl = candidateProfileUrl;
            break;
          } catch (err: any) {
            ctx.log('Profile fetch failed', {
              entityId: String(entity._id),
              profileUrl: candidateProfileUrl,
              error: err?.message || String(err),
            });
          }
        }
        if (!profileUrl) continue;
        const observations: ObservationInput[] = [];
        let profileIdentity: OfficialProfileIdentity | null | undefined;
        let resolvedExistingUser: ExistingProfileUser | null | undefined;

        const identityForProfile = (options?: OfficialProfileIdentityOptions) => {
          if (!options && profileIdentity !== undefined) return profileIdentity;
          const identity = extractOfficialProfileIdentity(html, profileUrl, entity, options);
          if (!options) profileIdentity = identity;
          return identity;
        };

        const existingUserForIdentity = async (identity: OfficialProfileIdentity) => {
          if (resolvedExistingUser !== undefined) return resolvedExistingUser;
          resolvedExistingUser = await this.userResolver(identity);
          return resolvedExistingUser;
        };

        if (runQueuedPiBackfill || runVisibleProfileBioBackfill) {
          const visibleExistingUser =
            runVisibleProfileBioBackfill && textValue(entity.netid)
              ? {
                  _id: idValue(entity._id),
                  netid: textValue(entity.netid),
                  email: textValue(entity.email),
                }
              : null;
          const identity = identityForProfile({
            requireEmail: false,
          });
          if (identity) {
            const existingUser = visibleExistingUser || (await existingUserForIdentity(identity));
            if (existingUser) {
              observations.push(
                ...identityToUserObservations(identity, existingUser, {
                  includeProfileEnrichment: runVisibleProfileBioBackfill,
                  includeIdentityEnrichment: !runVisibleProfileBioBackfill,
                }),
              );
              if (runQueuedPiBackfill) {
                observations.push(
                  ...identityToResearchEntityPiObservations(identity, existingUser, entity),
                );
              }
            } else if (runQueuedPiBackfill) {
              const inferredNetid = yaleNetidFromEmail(identity.email);
              if (inferredNetid) {
                const inferredUser = {
                  netid: inferredNetid,
                  email: identity.email.toLowerCase(),
                };
                observations.push(
                  ...identityToUserObservations(identity, inferredUser, {
                    includeProfileEnrichment: true,
                    includeIdentityEnrichment: true,
                  }),
                  ...identityToResearchEntityPiKeyObservations(identity, inferredNetid, entity),
                );
              }
            }
          }
        }

        if (runProfileDescriptionBackfill) {
          const identity = identityForProfile({
            requireEmail: false,
            expectedPeople: entity.leadUsers,
          });
          if (identity) {
            if (shouldEmitProfileDescriptionBackfillForEntity(entity)) {
              observations.push(...identityToResearchEntityDescriptionObservations(identity, entity));
            }
            const existingUser = await existingUserForIdentity(identity);
            if (existingUser) {
              observations.push(
                ...identityToResearchEntityPiObservations(identity, existingUser, entity),
              );
            } else {
              const inferredNetid = yaleNetidFromEmail(identity.email);
              if (inferredNetid) {
                const inferredUser = {
                  netid: inferredNetid,
                  email: identity.email.toLowerCase(),
                };
                observations.push(
                  ...identityToUserObservations(identity, inferredUser, {
                    includeProfileEnrichment: true,
                    includeIdentityEnrichment: true,
                  }),
                  ...identityToResearchEntityPiKeyObservations(identity, inferredNetid, entity),
                );
              }
            }
          }
        }

        if (runProfileResearchHomeBackfill) {
          const identity = extractOfficialProfileIdentity(html, profileUrl, entity, {
            requireEmail: false,
            expectedPeople: entity.leadUsers,
          });
          if (!identity) continue;
          const [home] = extractOfficialProfileResearchHomes(html, profileUrl);
          if (home && (await websiteUrlOwnedByAnotherEntity(home.url, entity))) continue;
          observations.push(...entityResearchHomeToObservations(entity, home, profileUrl));
        }

        if (observations.length === 0) continue;
        await ctx.emit(observations);
        emitted += observations.length;
        observed += 1;
      } catch (err: any) {
        ctx.log('Profile fetch failed', {
          entityId: String(entity._id),
          profileUrl: preferredOfficialProfileUrl(candidates),
          error: err?.message || String(err),
        });
      }
    }

    return {
      observationCount: emitted,
      entitiesObserved: observed,
      notes: `Processed ${entities.length} official profile records.`,
    };
  }
}
