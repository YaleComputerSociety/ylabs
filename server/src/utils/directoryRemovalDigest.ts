import { createHmac } from 'node:crypto';
import { normalizedRosterLabel } from '../scrapers/rosterStrikeDigests';

export const DIRECTORY_REMOVAL_KEY_ENV = 'DIRECTORY_REMOVAL_KEY';
export const MIN_DIRECTORY_REMOVAL_KEY_LENGTH = 32;

export const directoryRemovalKinds = ['netid', 'email', 'orcid', 'profile_url', 'name'] as const;
export type DirectoryRemovalKind = (typeof directoryRemovalKinds)[number];

export const DIRECTORY_REMOVAL_DIGEST = /^[0-9a-f]{64}$/;

const ORCID_URL_PREFIX = /^https?:\/\/(www\.)?orcid\.org\//i;

function normalizedProfileUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return '';
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!host) return '';
  parsed.searchParams.sort();
  const query = parsed.searchParams.toString();
  return `${host}${parsed.pathname.replace(/\/+$/, '')}${query ? `?${query}` : ''}`;
}

export function normalizedDirectoryRemovalValue(
  kind: DirectoryRemovalKind,
  value: unknown,
): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  switch (kind) {
    case 'netid':
    case 'email':
      return raw.toLowerCase();
    case 'orcid':
      return raw.replace(ORCID_URL_PREFIX, '').replace(/\/+$/, '').toUpperCase();
    case 'profile_url':
      return normalizedProfileUrl(raw);
    case 'name':
      return normalizedRosterLabel(raw);
  }
}

export function directoryRemovalDigest(
  key: string,
  kind: DirectoryRemovalKind,
  value: unknown,
): string | undefined {
  const normalized = normalizedDirectoryRemovalValue(kind, value);
  if (!normalized) return undefined;
  return createHmac('sha256', key).update(`${kind}:${normalized}`).digest('hex');
}

export class DirectoryRemovalKeyError extends Error {}

export function readDirectoryRemovalKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const key = (env[DIRECTORY_REMOVAL_KEY_ENV] ?? '').trim();
  if (!key) return undefined;
  if (key.length < MIN_DIRECTORY_REMOVAL_KEY_LENGTH) {
    throw new DirectoryRemovalKeyError(
      `The directory removal key must be at least ${MIN_DIRECTORY_REMOVAL_KEY_LENGTH} characters.`,
    );
  }
  return key;
}
