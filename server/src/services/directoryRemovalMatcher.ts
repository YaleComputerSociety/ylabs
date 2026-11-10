import { DirectoryRemoval } from '../models/directoryRemoval';
import {
  directoryRemovalDigest,
  readDirectoryRemovalKey,
  type DirectoryRemovalKind,
} from '../utils/directoryRemovalDigest';
import { requiresDeployedRuntimeSecurity } from '../utils/environment';

export type DirectoryRemovalState =
  'inert' | 'active' | 'withholding_every_name' | 'unfiltered_local';

export interface DirectoryRemovalPerson {
  displayName?: string;
  identifiers?: { netid?: string; email?: string; orcid?: string };
  profileLinks?: Array<{ url?: string }>;
}

export interface DirectoryRemovalMatcher {
  state: DirectoryRemovalState;
  isRemovedPerson(person: DirectoryRemovalPerson | null | undefined): boolean;
  isRemovedName(name: unknown): boolean;
}

export class DirectoryRemovalUnavailableError extends Error {}

const personIdentityValues = (
  person: DirectoryRemovalPerson,
): Array<[DirectoryRemovalKind, unknown]> => [
  ['netid', person.identifiers?.netid],
  ['email', person.identifiers?.email],
  ['orcid', person.identifiers?.orcid],
  ...(person.profileLinks ?? []).map((link): [DirectoryRemovalKind, unknown] => [
    'profile_url',
    link?.url,
  ]),
];

const matcherThatRemoves = (
  state: DirectoryRemovalState,
  removesEveryone: boolean,
): DirectoryRemovalMatcher => ({
  state,
  isRemovedPerson: () => removesEveryone,
  isRemovedName: () => removesEveryone,
});

export function keylessDirectoryRemovalState(
  env: NodeJS.ProcessEnv = process.env,
): Extract<DirectoryRemovalState, 'withholding_every_name' | 'unfiltered_local'> {
  return requiresDeployedRuntimeSecurity(env) ? 'withholding_every_name' : 'unfiltered_local';
}

export function buildDirectoryRemovalMatcher(args: {
  key: string | undefined;
  activeDigests: readonly string[];
  env?: NodeJS.ProcessEnv;
}): DirectoryRemovalMatcher {
  if (args.activeDigests.length === 0) return matcherThatRemoves('inert', false);
  if (!args.key) {
    const state = keylessDirectoryRemovalState(args.env);
    return matcherThatRemoves(state, state === 'withholding_every_name');
  }
  const key = args.key;
  const digests = new Set(args.activeDigests);
  const matches = (kind: DirectoryRemovalKind, value: unknown) => {
    const digest = directoryRemovalDigest(key, kind, value);
    return digest !== undefined && digests.has(digest);
  };
  return {
    state: 'active',
    isRemovedPerson: (person) =>
      Boolean(person) &&
      personIdentityValues(person!).some(([kind, value]) => matches(kind, value)),
    isRemovedName: (name) => matches('name', name),
  };
}

export async function activeDirectoryRemovalDigests(): Promise<string[]> {
  const rows = await DirectoryRemoval.find({ withdrawnAt: { $exists: false } })
    .select('digest -_id')
    .lean<Array<{ digest: string }>>();
  return rows.map((row) => row.digest);
}

export async function loadDirectoryRemovalMatcher(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DirectoryRemovalMatcher> {
  return buildDirectoryRemovalMatcher({
    key: readDirectoryRemovalKey(env),
    activeDigests: await activeDirectoryRemovalDigests(),
    env,
  });
}

export function assertDirectoryRemovalMatchable(matcher: DirectoryRemovalMatcher): void {
  if (matcher.state === 'withholding_every_name' || matcher.state === 'unfiltered_local') {
    throw new DirectoryRemovalUnavailableError(
      'Directory removal entries exist but no key is configured, so a removed person cannot be told apart from anyone else.',
    );
  }
}

const SERVE_CACHE_TTL_MS = 60_000;
let cachedMatcher: { matcher: Promise<DirectoryRemovalMatcher>; loadedAt: number } | undefined;

export function directoryRemovalMatcherForServing(
  now: number = Date.now(),
): Promise<DirectoryRemovalMatcher> {
  if (!cachedMatcher || now - cachedMatcher.loadedAt >= SERVE_CACHE_TTL_MS) {
    const matcher = loadDirectoryRemovalMatcher();
    cachedMatcher = { matcher, loadedAt: now };
    matcher.catch(() => {
      if (cachedMatcher?.matcher === matcher) cachedMatcher = undefined;
    });
  }
  return cachedMatcher.matcher;
}

export function resetDirectoryRemovalMatcherCache(): void {
  cachedMatcher = undefined;
}
