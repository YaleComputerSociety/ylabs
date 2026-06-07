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

export interface DuplicateProfileImageFinding {
  imageUrl: string;
  count: number;
  distinctNameCount: number;
  users: ProfileImageIssueSample[];
}

export interface ProfileImageQualitySummary {
  userCount: number;
  usersWithImageCount: number;
  nonPersonImageCount: number;
  duplicateImageGroupCount: number;
  duplicateImageUserCount: number;
  nonPersonImages: ProfileImageIssueSample[];
  duplicateImages: DuplicateProfileImageFinding[];
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
  normalizedName(user) || textValue(user.netid).toLowerCase() || textValue(user.email).toLowerCase();

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
  ].some((pattern) => pattern.test(normalized));
}

function isTrustedPublicProfileImageHost(value: unknown): boolean {
  const normalized = normalizedProfileImageUrl(value);
  try {
    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:') return false;
    if (hostname === 'yale.edu' || hostname.endsWith('.yale.edu')) return true;
    if (hostname === 'yalies.io') return true;
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
  const imageUrl = normalizedProfileImageUrl(currentUser.imageUrl);
  const currentName = normalizedName(currentUser);
  if (!imageUrl || !currentName) return false;

  const currentIdentity = normalizedIdentityKey(currentUser);
  return candidates.some((candidate) => {
    if (normalizedProfileImageUrl(candidate.imageUrl) !== imageUrl) return false;
    if (normalizedIdentityKey(candidate) === currentIdentity) return false;
    const candidateName = normalizedName(candidate);
    return Boolean(candidateName && candidateName !== currentName);
  });
}

const sampleForUser = (user: ProfileImageAuditUser): ProfileImageIssueSample => ({
  id: user.id,
  netid: user.netid,
  name: userName(user),
  email: user.email,
  title: user.title,
  imageUrl: textValue(user.imageUrl),
  profileUrls: user.profileUrls,
});

export function buildProfileImageQualitySummary(
  users: ProfileImageAuditUser[],
  options: { sampleLimit?: number } = {},
): ProfileImageQualitySummary {
  const sampleLimit = options.sampleLimit ?? 25;
  const usersWithImage = users.filter((user) => textValue(user.imageUrl));
  const nonPersonImages = usersWithImage
    .filter((user) => isNonPersonProfileImageUrl(user.imageUrl))
    .map(sampleForUser)
    .slice(0, sampleLimit);

  const grouped = new Map<string, ProfileImageAuditUser[]>();
  for (const user of usersWithImage) {
    if (!isLikelyPublicProfileImageUrl(user.imageUrl)) continue;
    const key = normalizedProfileImageUrl(user.imageUrl);
    grouped.set(key, [...(grouped.get(key) || []), user]);
  }

  const duplicateImages = Array.from(grouped.entries())
    .flatMap(([imageUrl, groupedUsers]) => {
      if (groupedUsers.length <= 1) return [];
      const distinctNames = new Set(groupedUsers.map(normalizedName).filter(Boolean));
      if (distinctNames.size <= 1) return [];
      return [
        {
          imageUrl,
          count: groupedUsers.length,
          distinctNameCount: distinctNames.size,
          users: groupedUsers.map(sampleForUser).slice(0, sampleLimit),
        },
      ];
    })
    .sort((a, b) => b.count - a.count || a.imageUrl.localeCompare(b.imageUrl));

  return {
    userCount: users.length,
    usersWithImageCount: usersWithImage.length,
    nonPersonImageCount: usersWithImage.filter((user) => isNonPersonProfileImageUrl(user.imageUrl)).length,
    duplicateImageGroupCount: duplicateImages.length,
    duplicateImageUserCount: duplicateImages.reduce((sum, finding) => sum + finding.count, 0),
    nonPersonImages,
    duplicateImages: duplicateImages.slice(0, sampleLimit),
  };
}
