import { getCached, setCached } from '../snapshotCache';
import { fetchPageWithPolicy } from './httpFetch';
import { mapWithConcurrency } from './mapWithConcurrency';
import {
  extractRosterMemberIdentityEvidence,
  isYaleHostedUrl,
  ROSTER_MEMBER_IDENTITY_EVIDENCE_EXTRACTOR_VERSION,
  type RosterMemberIdentityEvidence,
} from './rosterMemberIdentityEvidence';

export type MemberPageFetcher = (url: string) => Promise<string>;

export const MEMBER_IDENTITY_EVIDENCE_CACHE_PREFIX = `member-identity-evidence:v${ROSTER_MEMBER_IDENTITY_EVIDENCE_EXTRACTOR_VERSION}:`;

const MEMBER_PROFILE_FETCH_CONCURRENCY = 4;
const MEMBER_PROFILE_FETCH_TIMEOUT_MS = 30_000;

export function memberIdentityEvidenceCacheKey(profileUrl: string, memberName: string): string {
  return `${MEMBER_IDENTITY_EVIDENCE_CACHE_PREFIX}${profileUrl}#${memberName}`;
}

// medicine.yale.edu answers a burst of member pages with 403, so these go through the shared
// per-host limiter and its 403/429/5xx backoff rather than a roster page fetch.
export async function fetchMemberProfilePage(url: string): Promise<string> {
  return (await fetchPageWithPolicy(url, { timeoutMs: MEMBER_PROFILE_FETCH_TIMEOUT_MS })).html;
}

export interface RosterMemberToRead {
  name: string;
  profileUrl?: string;
}

export interface RosterMemberEvidenceReadOptions {
  sourceName: string;
  useCache: boolean;
  fetchPage: MemberPageFetcher;
}

/**
 * Reads each Yale-hosted member profile page once and returns the identity evidence its own
 * page states, keyed by profile URL and listed name, so a roster lane can let the
 * materializer join the listing through evidence rather than mint by name (#5927). Only the
 * extracted evidence is cached, never the page, because member pages run to hundreds of
 * megabytes per roster.
 */
export async function readRosterMemberIdentityEvidence(
  members: readonly RosterMemberToRead[],
  options: RosterMemberEvidenceReadOptions,
): Promise<Map<string, RosterMemberIdentityEvidence>> {
  const seen = new Set<string>();
  const toRead = members
    .filter((member) => member.name && isYaleHostedUrl(member.profileUrl))
    .filter((member) => {
      const key = memberIdentityEvidenceCacheKey(member.profileUrl as string, member.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const evidenceByKey = new Map<string, RosterMemberIdentityEvidence>();
  await mapWithConcurrency(toRead, MEMBER_PROFILE_FETCH_CONCURRENCY, async (member) => {
    const profileUrl = member.profileUrl as string;
    const key = memberIdentityEvidenceCacheKey(profileUrl, member.name);
    if (options.useCache) {
      const cached = await getCached<RosterMemberIdentityEvidence>(options.sourceName, key);
      if (cached) {
        evidenceByKey.set(key, cached);
        return;
      }
    }
    let html: string;
    try {
      html = await options.fetchPage(profileUrl);
    } catch {
      return;
    }
    if (typeof html !== 'string' || !html) return;
    const evidence = extractRosterMemberIdentityEvidence(html, profileUrl, member.name);
    if (options.useCache) await setCached(options.sourceName, key, evidence);
    evidenceByKey.set(key, evidence);
  });
  return evidenceByKey;
}

export function memberIdentityEvidenceFor(
  evidenceByKey: ReadonlyMap<string, RosterMemberIdentityEvidence>,
  member: RosterMemberToRead,
): RosterMemberIdentityEvidence | undefined {
  if (!member.profileUrl || !member.name) return undefined;
  return evidenceByKey.get(memberIdentityEvidenceCacheKey(member.profileUrl, member.name));
}
