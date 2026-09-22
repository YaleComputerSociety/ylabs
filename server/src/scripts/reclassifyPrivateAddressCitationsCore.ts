import type { HostnameResolution } from '../utils/ssrfGuard';
import { sourceLinkHealthKey } from '../services/sourceLinkHealth';
import {
  collectSourceLinkHealthCandidates,
  type SourceLinkHealthCandidateEntity,
  type StoredSourceLinkHealthEntry,
} from './backfillSourceLinkHealthCore';

export type HostResolutionKind = HostnameResolution['kind'];

export interface PrivateAddressRoutingEntity extends SourceLinkHealthCandidateEntity {
  slug?: unknown;
  studentVisibilityTier?: unknown;
  sourceLinkHealth?: unknown;
}

export interface PrivateAddressRoutingPlan {
  entitySlug: string;
  studentVisibilityTier: string;
  addedEntries: string[];
  flaggedUrls: string[];
  releasedUrls: string[];
  sourceLinkHealth: StoredSourceLinkHealthEntry[];
}

export const citedHostnames = (entity: PrivateAddressRoutingEntity): string[] => {
  const hosts = new Set<string>();
  for (const url of collectSourceLinkHealthCandidates(entity)) {
    try {
      hosts.add(new URL(url).hostname.toLowerCase());
    } catch {
      continue;
    }
  }
  return [...hosts];
};

const hostnameOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const storedEntries = (entity: PrivateAddressRoutingEntity): StoredSourceLinkHealthEntry[] =>
  Array.isArray(entity.sourceLinkHealth)
    ? (entity.sourceLinkHealth.filter(
        (entry) => typeof (entry as { url?: unknown })?.url === 'string',
      ) as StoredSourceLinkHealthEntry[])
    : [];

/**
 * What one row's routing flags should say, given a live resolution verdict per
 * cited host.
 *
 * Only a verdict of `public` releases a flagged URL. `unresolvable` and
 * `resolver-failure` leave it exactly as it stands, because neither is evidence
 * that the public internet can now reach the host, and releasing on a failed
 * lookup would hand a student back a link they cannot open (#2556).
 *
 * `healthStatus` is never touched. A private-address host tells us nothing about
 * whether its page exists, so asserting anything on that axis here would be
 * inventing a measurement nobody took.
 */
export function planPrivateAddressRouting(
  entity: PrivateAddressRoutingEntity,
  hostResolutions: Map<string, HostResolutionKind>,
  now: Date,
): PrivateAddressRoutingPlan | null {
  const candidates = collectSourceLinkHealthCandidates(entity);
  const entries = storedEntries(entity);
  const entryByKey = new Map<string, StoredSourceLinkHealthEntry>();
  for (const entry of entries) {
    const key = sourceLinkHealthKey(entry.url);
    if (key) entryByKey.set(key, entry);
  }

  const addedEntries: string[] = [];
  const flaggedUrls: string[] = [];
  const releasedUrls: string[] = [];
  const patched = new Map<string, StoredSourceLinkHealthEntry>();

  for (const url of candidates) {
    const host = hostnameOf(url);
    const key = sourceLinkHealthKey(url);
    if (!host || !key) continue;
    const resolution = hostResolutions.get(host);
    if (!resolution) continue;
    const existing = entryByKey.get(key);

    if (resolution === 'private-address') {
      if (existing?.privateAddressHost === true) continue;
      if (existing) {
        patched.set(key, { ...existing, privateAddressHost: true, lastAttemptedAt: now });
        flaggedUrls.push(url);
      } else {
        patched.set(key, {
          url,
          healthStatus: 'UNKNOWN',
          privateAddressHost: true,
          lastAttemptedAt: now,
        });
        addedEntries.push(url);
      }
      continue;
    }

    if (resolution === 'public' && existing?.privateAddressHost === true) {
      const released = { ...existing, lastAttemptedAt: now };
      delete released.privateAddressHost;
      patched.set(key, released);
      releasedUrls.push(url);
    }
  }

  if (patched.size === 0) return null;

  const sourceLinkHealth = entries.map((entry) => {
    const key = sourceLinkHealthKey(entry.url);
    const replacement = key ? patched.get(key) : undefined;
    if (replacement) patched.delete(key as string);
    return replacement ?? entry;
  });
  sourceLinkHealth.push(...patched.values());

  return {
    entitySlug: typeof entity.slug === 'string' ? entity.slug : '',
    studentVisibilityTier:
      typeof entity.studentVisibilityTier === 'string' ? entity.studentVisibilityTier : '',
    addedEntries,
    flaggedUrls,
    releasedUrls,
    sourceLinkHealth,
  };
}
