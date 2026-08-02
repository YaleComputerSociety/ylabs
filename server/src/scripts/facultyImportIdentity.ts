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
    const orcid = normalizedText(entry.orcid);
    if (!orcid) continue;
    const ownerKey = normalizedNetid(entry.netid) || facultyImportDisplayName(entry).toLowerCase();
    if (!ownerKey) continue;
    const values = owners.get(orcid) || new Set<string>();
    values.add(ownerKey);
    owners.set(orcid, values);
  }
  return new Set([...owners].filter(([, values]) => values.size > 1).map(([orcid]) => orcid));
}

export function safeFacultyImportExternalIdentity(
  entry: FacultyImportIdentityInput,
  collidingOrcids: Set<string>,
): { orcid?: string; profileUrls: Record<string, string> } {
  const orcid = normalizedText(entry.orcid);
  const profileUrls = { ...(entry.profileUrls || {}) };
  const profileOrcid = normalizedText(profileUrls.orcid).replace(/^https?:\/\/orcid\.org\//i, '');
  if ((orcid && collidingOrcids.has(orcid)) || (profileOrcid && collidingOrcids.has(profileOrcid))) {
    delete profileUrls.orcid;
    return { profileUrls };
  }
  return { ...(orcid ? { orcid } : {}), profileUrls };
}
