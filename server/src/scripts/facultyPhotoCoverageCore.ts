import * as cheerio from 'cheerio';

export interface FacultyPhotoCoverageOptions {
  apply: boolean;
  limit: number;
  concurrency: number;
  netids: string[];
}

export interface FacultyPhotoUser {
  _id: unknown;
  netid?: string | null;
  fname?: string | null;
  lname?: string | null;
  imageUrl?: string | null;
  profileUrls?: Record<string, unknown> | null;
  dataSources?: string[];
}

export interface FacultyPhotoUpdatePlan {
  userId: string;
  netid: string;
  name: string;
  profileUrl: string;
  imageUrl: string;
  update: {
    $set: {
      imageUrl: string;
    };
    $addToSet: {
      dataSources: 'official-profile-photo-repair';
    };
  };
}

export interface OfficialProfileMetadata {
  imageUrl?: string;
  profileName?: string;
}

const PROFILE_OWNER_USER_TYPES = ['professor', 'faculty'];
const SOCIAL_MEDIA_IMAGE_URL_RE = /\/styles\/social_media\//i;

export function parseFacultyPhotoCoverageArgs(argv: string[]): FacultyPhotoCoverageOptions {
  const options: FacultyPhotoCoverageOptions = {
    apply: false,
    limit: 100,
    concurrency: 5,
    netids: [],
  };

  for (const arg of argv) {
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.apply = false;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      const parsed = Number(arg.slice('--limit='.length));
      if (Number.isFinite(parsed) && parsed > 0) options.limit = Math.floor(parsed);
      continue;
    }
    if (arg.startsWith('--concurrency=')) {
      const parsed = Number(arg.slice('--concurrency='.length));
      if (Number.isFinite(parsed) && parsed > 0) {
        options.concurrency = Math.min(10, Math.floor(parsed));
      }
      continue;
    }
    if (arg.startsWith('--netid=')) {
      options.netids.push(
        ...arg
          .slice('--netid='.length)
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      );
    }
  }

  return options;
}

export function buildFacultyPhotoCoverageUserQuery(options: Pick<FacultyPhotoCoverageOptions, 'netids'>): Record<string, unknown> {
  const socialMediaImage = { imageUrl: SOCIAL_MEDIA_IMAGE_URL_RE };
  const query: Record<string, unknown> = {
    profileUrls: { $exists: true, $ne: {} },
  };

  if (options.netids.length > 0) {
    query.netid = { $in: options.netids };
    query.$or = [
      { userType: { $in: PROFILE_OWNER_USER_TYPES } },
      socialMediaImage,
    ];
    return query;
  }

  query.$or = [
    { userType: { $in: PROFILE_OWNER_USER_TYPES }, imageUrl: { $exists: false } },
    { userType: { $in: PROFILE_OWNER_USER_TYPES }, imageUrl: null },
    { userType: { $in: PROFILE_OWNER_USER_TYPES }, imageUrl: '' },
    socialMediaImage,
  ];
  return query;
}

function absolutize(rawUrl: string, baseUrl: string): string {
  try {
    return new URL(rawUrl, baseUrl).toString();
  } catch {
    return rawUrl;
  }
}

function isHttpImageUrl(value: unknown, baseUrl: string): string {
  const raw = String(value || '').trim();
  if (!raw || /^data:/i.test(raw)) return '';
  const absolute = absolutize(raw, baseUrl);

  try {
    const parsed = new URL(absolute);
    if (!/^https?:$/i.test(parsed.protocol)) return '';
    if (parsed.hostname.toLowerCase() === 'api.mapbox.com') return '';
    if (/\.(svg|gif)(?:$|\?)/i.test(parsed.pathname)) return '';
    if (/\b(?:logo|favicon|sprite|icon)\b/i.test(parsed.pathname)) return '';
    if (
      /blank[-_]?profile[-_]?picture|placeholder[-_]?profile|default[-_]?profile|no[-_]?image[-_]?available/i.test(
        parsed.pathname,
      )
    ) {
      return '';
    }
    if (/\/YDS_0\.png$/i.test(parsed.pathname)) return '';
    return absolute;
  } catch {
    return '';
  }
}

function sameOrSubdomain(hostname: string, rootHostname: string): boolean {
  return hostname === rootHostname || hostname.endsWith(`.${rootHostname}`);
}

function isOfficialYaleUrl(value: string): boolean {
  try {
    return sameOrSubdomain(new URL(value).hostname.toLowerCase(), 'yale.edu');
  } catch {
    return false;
  }
}

function looksLikeProfileUrl(value: string): boolean {
  try {
    const pathname = new URL(value).pathname.toLowerCase();
    if (/\/lab\//i.test(pathname)) return false;
    return /\/(profile|people|person|faculty|directory)(?:\/|$)/i.test(pathname);
  } catch {
    return false;
  }
}

export function officialYaleProfileUrlsForUser(user: Pick<FacultyPhotoUser, 'profileUrls'>): string[] {
  const urls = Object.values(user.profileUrls || {})
    .map((value) => String(value || '').trim())
    .filter((value) => value && isOfficialYaleUrl(value) && looksLikeProfileUrl(value));

  return Array.from(new Set(urls));
}

function imageValueFromJsonLd(value: unknown, baseUrl: string): string {
  if (!value) return '';
  if (typeof value === 'string') return isHttpImageUrl(value, baseUrl);
  if (Array.isArray(value)) {
    for (const item of value) {
      const imageUrl = imageValueFromJsonLd(item, baseUrl);
      if (imageUrl) return imageUrl;
    }
    return '';
  }
  if (typeof value !== 'object') return '';

  const record = value as Record<string, unknown>;
  return (
    isHttpImageUrl(record.url, baseUrl) ||
    isHttpImageUrl(record.contentUrl, baseUrl) ||
    isHttpImageUrl(record['@id'], baseUrl)
  );
}

function personMetadataFromJsonLd(value: unknown, baseUrl: string): OfficialProfileMetadata {
  if (!value) return {};
  if (Array.isArray(value)) {
    for (const item of value) {
      const metadata = personMetadataFromJsonLd(item, baseUrl);
      if (metadata.imageUrl || metadata.profileName) return metadata;
    }
    return {};
  }
  if (typeof value !== 'object') return {};

  const record = value as Record<string, unknown>;
  const typeValues = Array.isArray(record['@type']) ? record['@type'] : [record['@type']];
  const isPerson = typeValues.some((type) => String(type || '').toLowerCase() === 'person');
  if (isPerson) {
    const metadata = {
      profileName: String(record.name || '').trim() || undefined,
      imageUrl: imageValueFromJsonLd(record.image, baseUrl) || undefined,
    };
    if (metadata.imageUrl || metadata.profileName) return metadata;
  }

  for (const key of ['mainEntity', 'author', 'about', '@graph']) {
    const metadata = personMetadataFromJsonLd(record[key], baseUrl);
    if (metadata.imageUrl || metadata.profileName) return metadata;
  }

  return {};
}

function imageFromElement($: cheerio.CheerioAPI, el: any, baseUrl: string): string {
  const node = $(el);
  const src =
    node.attr('src') ||
    node.attr('data-src') ||
    node.attr('data-lazy-src') ||
    node.attr('data-original') ||
    '';
  const srcset = node.attr('srcset') || node.attr('data-srcset') || '';
  const raw = src || srcset.split(',')[0]?.trim().split(/\s+/)[0] || '';
  return isHttpImageUrl(raw, baseUrl);
}

function visibleProfileName($: cheerio.CheerioAPI): string | undefined {
  const jsonTitle =
    $('meta[property="og:title"]').first().attr('content') ||
    $('meta[name="twitter:title"]').first().attr('content') ||
    '';
  const candidates = [
    $('[class*="profile"] h1').first().text(),
    $('[class*="person"] h1').first().text(),
    $('h1').first().text(),
    jsonTitle,
    $('title').first().text(),
  ];

  for (const candidate of candidates) {
    const cleaned = candidate
      .replace(/\s*\|\s*.*$/, '')
      .replace(/,\s*(?:PhD|MD|ScD|MPH|MBA|MA|MS|MHS|FAAP|FRCP|FAHA).*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned) return cleaned;
  }
  return undefined;
}

export function extractOfficialProfileMetadata(
  html: string,
  profileUrl: string,
): OfficialProfileMetadata {
  const $ = cheerio.load(html);
  let profileName: string | undefined;

  for (const script of $('script[type="application/ld+json"]').toArray()) {
    const raw = $(script).contents().text().trim();
    if (!raw) continue;
    try {
      const metadata = personMetadataFromJsonLd(JSON.parse(raw), profileUrl);
      profileName ||= metadata.profileName;
      if (metadata.imageUrl) {
        return { profileName, imageUrl: metadata.imageUrl };
      }
    } catch {
      // Some Yale pages include unrelated script blocks; keep scanning.
    }
  }
  profileName ||= visibleProfileName($);

  const visibleProfileSelectors = [
    '[class*="headshot"] img',
    'img[class*="headshot"]',
    '[class*="profile"] img',
    '[class*="person"] img',
    '[class*="photo"] img',
    'img[class*="profile"]',
    'img[class*="person"]',
    'img[class*="photo"]',
  ];

  for (const selector of visibleProfileSelectors) {
    const imageUrl = $(selector)
      .toArray()
      .map((el) => imageFromElement($, el, profileUrl))
      .find(Boolean);
    if (imageUrl) return { profileName, imageUrl };
  }

  const metaImage =
    $('meta[property="og:image"]').first().attr('content') ||
    $('meta[name="twitter:image"]').first().attr('content') ||
    $('link[rel="image_src"]').first().attr('href') ||
    '';
  const normalizedMetaImage = isHttpImageUrl(metaImage, profileUrl);
  if (normalizedMetaImage) return { profileName, imageUrl: normalizedMetaImage };

  for (const selector of ['main img', 'article img']) {
    const imageUrl = $(selector)
      .toArray()
      .map((el) => imageFromElement($, el, profileUrl))
      .find(Boolean);
    if (imageUrl) return { profileName, imageUrl };
  }

  return { profileName };
}

export function extractOfficialProfileImageUrl(html: string, profileUrl: string): string | undefined {
  return extractOfficialProfileMetadata(html, profileUrl).imageUrl;
}

function normalizeNamePart(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function profileNameMatchesUser(
  user: Pick<FacultyPhotoUser, 'fname' | 'lname'>,
  profileName: string | undefined,
): boolean {
  const first = normalizeNamePart(user.fname).split(' ')[0] || '';
  const last = normalizeNamePart(user.lname).split(' ').filter(Boolean).pop() || '';
  const profileParts = normalizeNamePart(profileName).split(' ').filter(Boolean);
  if (!first || !last || profileParts.length === 0) return false;

  const profileFirst = profileParts[0] || '';
  const profileLast = profileParts[profileParts.length - 1] || '';
  if (last !== profileLast) return false;
  return first === profileFirst;
}

export function validateProfileImageForUser(
  user: Pick<FacultyPhotoUser, 'fname' | 'lname'>,
  metadata: OfficialProfileMetadata,
): string | undefined {
  if (!metadata.imageUrl) return undefined;
  if (!profileNameMatchesUser(user, metadata.profileName)) return undefined;
  return metadata.imageUrl;
}

export function isReplaceableProfileImageUrl(value: unknown): boolean {
  const imageUrl = String(value || '').trim();
  if (!imageUrl) return true;
  try {
    return SOCIAL_MEDIA_IMAGE_URL_RE.test(new URL(imageUrl).pathname);
  } catch {
    return false;
  }
}

export function buildFacultyPhotoUpdate(
  user: FacultyPhotoUser,
  profileUrl: string,
  imageUrl: string,
): FacultyPhotoUpdatePlan | null {
  if (!isReplaceableProfileImageUrl(user.imageUrl)) return null;
  const userId = String(user._id || '').trim();
  if (!userId || !imageUrl) return null;

  return {
    userId,
    netid: String(user.netid || ''),
    name: [user.fname, user.lname].map((value) => String(value || '').trim()).filter(Boolean).join(' '),
    profileUrl,
    imageUrl,
    update: {
      $set: {
        imageUrl,
      },
      $addToSet: {
        dataSources: 'official-profile-photo-repair',
      },
    },
  };
}
