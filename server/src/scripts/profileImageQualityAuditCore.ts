export interface ProfileImageAuditUser {
  id?: string;
  netid?: string;
  fname?: string;
  lname?: string;
  email?: string;
  title?: string;
  imageUrl?: string;
  profileUrls?: Record<string, string>;
}

export interface ProfileImageIssueSample {
  id?: string;
  netid?: string;
  name: string;
  email?: string;
  title?: string;
  imageUrl: string;
  profileUrls?: Record<string, string>;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const userName = (user: ProfileImageAuditUser): string =>
  [user.fname, user.lname].map(textValue).filter(Boolean).join(' ').trim();

const normalizedName = (user: ProfileImageAuditUser): string =>
  userName(user)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const normalizedIdentityKey = (user: ProfileImageAuditUser): string =>
  normalizedName(user) ||
  textValue(user.netid).toLowerCase() ||
  textValue(user.email).toLowerCase();

export function normalizedProfileImageUrl(value: unknown): string {
  const raw = textValue(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return raw;
  }
}

export function isNonPersonProfileImageUrl(value: unknown): boolean {
  const normalized = normalizedProfileImageUrl(value).toLowerCase();
  if (!normalized) return false;
  return [
    /badge\.dimensions\.ai\/badge\b/,
    /badges\.altmetric\.com\//,
    /\/favicon(?:[-_.]|\b)/,
    /\/icons?\//,
    /\/logos?\//,
    /(?:^|[/?&])score=\d+/,
    /\/starterkit\//,
    /\/default_images\//,
    /\/no[-_]?image[-_]?available[^/]*$/,
    /\/facultyblank\.[a-z0-9]+$/,
    /\/blank-profile-picture[^/]*$/,
    /\/[^/]*placeholder[^/]*$/,
    /\/campus[-_]\d{4}[^/]*$/,
    /\/[^/]*-logo-[^/]*$/,
  ].some((pattern) => pattern.test(normalized));
}

const CLOUDINARY_VERSION_SEGMENT = /^v\d+$/;
const DRUPAL_STYLE_PREFIX = /\/styles\/[^/]+\/public\//;
const DRUPAL_USER_PICTURE = /^picture-(\d+)-\d+\.[a-z0-9]+$/i;

/**
 * The identity of the picture a profile image URL shows, ignoring the parts a site varies
 * between uploads and renditions of one picture: a Cloudinary transform, a Drupal image
 * style, a Drupal user-picture upload timestamp, or a query (#5640). Keyed on the host,
 * because a Drupal `picture-<uid>` is unique only within one site, and on the directory,
 * because one site can reuse a uid across directories for different uploads.
 */
export function profileImagePictureKey(value: unknown): string {
  const normalized = normalizedProfileImageUrl(value);
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return normalized;
  }
  const host = url.hostname;
  const segments = url.pathname.split('/').filter(Boolean);
  if (host.endsWith('cloudinary.com')) {
    const version = segments.findIndex((segment) => CLOUDINARY_VERSION_SEGMENT.test(segment));
    const publicId = version >= 0 ? segments.slice(version + 1) : segments.slice(-1);
    return `${host}/${publicId.join('/').replace(/\.[a-z0-9]+$/i, '')}`;
  }
  const path = url.pathname.replace(DRUPAL_STYLE_PREFIX, '/');
  const directory = path.slice(0, path.lastIndexOf('/'));
  const basename = path.slice(path.lastIndexOf('/') + 1);
  const picture = DRUPAL_USER_PICTURE.exec(basename);
  if (picture) return `${host}${directory}/picture-${picture[1]}`;
  return `${host}${path}`;
}

function isTrustedPublicProfileImageHost(value: unknown): boolean {
  const normalized = normalizedProfileImageUrl(value);
  try {
    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:') return false;
    if (hostname === 'yale.edu' || hostname.endsWith('.yale.edu')) return true;
    // Yalies serves photos from subdomains (e.g. images.yalies.io); an
    // exact-host match would silently strip every Yalies-hosted photo.
    if (hostname === 'yalies.io' || hostname.endsWith('.yalies.io')) return true;
    if (hostname === 'ysm-res.cloudinary.com') return true;
  } catch {
    return false;
  }
  return false;
}

export function isLikelyPublicProfileImageUrl(value: unknown): boolean {
  const normalized = normalizedProfileImageUrl(value);
  if (!isTrustedPublicProfileImageHost(normalized)) return false;
  return !isNonPersonProfileImageUrl(normalized);
}

export function isSharedProfileImageAcrossDifferentNames(
  currentUser: ProfileImageAuditUser,
  candidates: ProfileImageAuditUser[],
): boolean {
  const pictureKey = profileImagePictureKey(currentUser.imageUrl);
  const currentName = normalizedName(currentUser);
  if (!pictureKey || !currentName) return false;

  const currentIdentity = normalizedIdentityKey(currentUser);
  return candidates.some((candidate) => {
    if (profileImagePictureKey(candidate.imageUrl) !== pictureKey) return false;
    if (normalizedIdentityKey(candidate) === currentIdentity) return false;
    const candidateName = normalizedName(candidate);
    return Boolean(candidateName && candidateName !== currentName);
  });
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A query pattern that finds every stored image URL which could share this URL's picture key:
 * same host, and the picture's distinctive name somewhere in the path. Candidates are then
 * compared by `profileImagePictureKey`, so the pattern only has to be broad enough.
 */
export function profileImagePictureSearchPattern(value: unknown): RegExp | null {
  const key = profileImagePictureKey(value);
  const slash = key.indexOf('/');
  if (slash <= 0) return null;
  const host = key.slice(0, slash);
  const token = key.slice(key.lastIndexOf('/') + 1).replace(/\.[a-z0-9]+$/i, '');
  if (!token) return null;
  return new RegExp(`^https?://(?:www\\.)?${escapeRegex(host)}/.*${escapeRegex(token)}`, 'i');
}
