import { AsyncLocalStorage } from 'node:async_hooks';
import mongoose from 'mongoose';
import { Researcher } from '../models/researcher';
import {
  assertDirectoryRemovalMatchable,
  loadDirectoryRemovalMatcher,
  type DirectoryRemovalMatcher,
  type DirectoryRemovalPerson,
} from './directoryRemovalMatcher';

export const REMOVED_BY_REQUEST = 'removed_by_request' as const;

/**
 * The refusal every mint and attach path consults (#4160): a person on the directory removal
 * list gets no new role edge and no new researcher on any pass. It is read on every run and
 * writes nothing, so it is a refusal the lanes respect rather than a per-row lock.
 */
export interface DirectoryRemovalMintGuard {
  readonly active: boolean;
  refusesIdentifiedPerson(person: DirectoryRemovalPerson | null | undefined): boolean;
  refusesPerson(person: DirectoryRemovalPerson | null | undefined): boolean;
  recordRefusal(): void;
  readonly refusals: number;
}

export function createDirectoryRemovalMintGuard(
  matcher: DirectoryRemovalMatcher,
): DirectoryRemovalMintGuard {
  assertDirectoryRemovalMatchable(matcher);
  const active = matcher.state !== 'inert';
  let refusals = 0;
  return {
    active,
    refusesIdentifiedPerson(person) {
      return active && matcher.isRemovedPerson(person);
    },
    refusesPerson(person) {
      return active && Boolean(person) && matcher.isRemovedPerson(person);
    },
    recordRefusal() {
      refusals += 1;
    },
    get refusals() {
      return refusals;
    },
  };
}

export async function loadDirectoryRemovalMintGuard(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DirectoryRemovalMintGuard> {
  return createDirectoryRemovalMintGuard(await loadDirectoryRemovalMatcher(env));
}

interface GuardScope {
  loaded?: Promise<DirectoryRemovalMintGuard>;
}

const guardScope = new AsyncLocalStorage<GuardScope>();

/**
 * Runs `work` with one guard for the whole pass, so the list is read at most once per run
 * rather than once per row. Without an explicit guard the list is read on the first check, so
 * a pass that mints nothing reads nothing. A nested call reuses the guard already in scope.
 */
export async function withDirectoryRemovalMintGuard<T>(
  work: () => Promise<T>,
  guard?: DirectoryRemovalMintGuard,
): Promise<T> {
  if (!guard && guardScope.getStore()) return work();
  return guardScope.run({ loaded: guard ? Promise.resolve(guard) : undefined }, work);
}

export async function currentDirectoryRemovalMintGuard(): Promise<DirectoryRemovalMintGuard> {
  const scope = guardScope.getStore();
  if (!scope) return loadDirectoryRemovalMintGuard();
  scope.loaded ??= loadDirectoryRemovalMintGuard();
  return scope.loaded;
}

export async function researcherIsRemovedByRequest(
  guard: DirectoryRemovalMintGuard,
  researcherId: mongoose.Types.ObjectId | string | undefined,
  listedProfileUrl?: string,
): Promise<boolean> {
  if (!guard.active || !researcherId) return false;
  const researcher = await Researcher.findById(researcherId)
    .select('displayName identifiers profileLinks')
    .lean<DirectoryRemovalPerson | null>();
  if (!researcher || !listedProfileUrl) return guard.refusesPerson(researcher);
  return guard.refusesPerson({
    ...researcher,
    profileLinks: [...(researcher.profileLinks ?? []), { url: listedProfileUrl }],
  });
}
