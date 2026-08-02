import { isLikelyPersonSpecificYaleEmail } from '../scrapers/utils/scraperHelpers';

export interface FacultyImportIdentityInput {
  netid: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  orcid?: string | null;
  profileUrls?: Record<string, string>;
}

const normalizedText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const normalizedNetid = (value: string): string => normalizedText(value).toLowerCase();

const normalizedOrcid = (value: unknown): string =>
  normalizedText(value)
    .replace(/^https?:\/\/(?:www\.)?orcid\.org\//i, '')
    .replace(/\/$/, '');

export function facultyImportDisplayName(entry: FacultyImportIdentityInput): string {
  const explicit = normalizedText(entry.name);
  if (explicit) return explicit;
  return [normalizedText(entry.firstName), normalizedText(entry.lastName)].filter(Boolean).join(' ');
}

export function safeFacultyImportEmail(entry: FacultyImportIdentityInput): string {
  const netid = normalizedNetid(entry.netid);
  const fallback = `${netid}@yale.edu`;
  const candidate = normalizedText(entry.email).toLowerCase().replace(/^mailto:/, '');
  if (!candidate) return fallback;
  if (candidate === fallback) return fallback;
  return isLikelyPersonSpecificYaleEmail(candidate, facultyImportDisplayName(entry))
    ? candidate
    : fallback;
}

export function findCollidingFacultyImportOrcids(
  entries: FacultyImportIdentityInput[],
): Set<string> {
  const owners = new Map<string, Set<string>>();
  for (const entry of entries) {
    const ownerKey = normalizedNetid(entry.netid) || facultyImportDisplayName(entry).toLowerCase();
    if (!ownerKey) continue;
    const claimedOrcids = new Set([
      normalizedOrcid(entry.orcid),
      normalizedOrcid(entry.profileUrls?.orcid),
    ]);
    claimedOrcids.delete('');
    for (const orcid of claimedOrcids) {
      const values = owners.get(orcid) || new Set<string>();
      values.add(ownerKey);
      owners.set(orcid, values);
    }
  }
  return new Set([...owners].filter(([, values]) => values.size > 1).map(([orcid]) => orcid));
}

export function safeFacultyImportExternalIdentity(
  entry: FacultyImportIdentityInput,
  collidingOrcids: Set<string>,
): { orcid?: string; profileUrls: Record<string, string>; clearOrcid: boolean } {
  const orcid = normalizedOrcid(entry.orcid);
  const profileUrls = { ...(entry.profileUrls || {}) };
  const profileOrcid = normalizedOrcid(profileUrls.orcid);
  if ((orcid && collidingOrcids.has(orcid)) || (profileOrcid && collidingOrcids.has(profileOrcid))) {
    delete profileUrls.orcid;
    return { profileUrls, clearOrcid: true };
  }
  return { ...(orcid ? { orcid } : {}), profileUrls, clearOrcid: false };
}

export function facultyImportMongoUpdate(
  cleanedData: Record<string, unknown>,
  clearOrcid: boolean,
): { $set: Record<string, unknown>; $unset?: { orcid: 1 } } {
  return {
    $set: cleanedData,
    ...(clearOrcid ? { $unset: { orcid: 1 as const } } : {}),
  };
}
