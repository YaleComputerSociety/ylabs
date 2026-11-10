import mongoose from 'mongoose';
import { Researcher } from '../models/researcher';
import {
  assertDirectoryRemovalMatchable,
  loadDirectoryRemovalMatcher,
  type DirectoryRemovalMatcher,
  type DirectoryRemovalPerson,
} from '../services/directoryRemovalMatcher';
import type { ObservationInput } from './types';

/**
 * The ingest half of the directory removal refusal (#4160): no lane stores a new observation
 * about a person who asked to be removed, so the next sweep cannot re-create what the purge
 * deleted. Only a stable identifier refuses an observation. A name alone never does, so a
 * namesake keeps every observation it had.
 */
const PERSON_SUBJECT_TYPES: ReadonlySet<string> = new Set(['user', 'researchGroupMember']);
const ROW_SUBJECT_TYPES: ReadonlySet<string> = new Set(['researchEntity', 'researchGroup']);
const ROW_POINTER_FIELDS: ReadonlySet<string> = new Set([
  'inferredPiUserKey',
  'inferredPiUserId',
  'inferredDirectorProfileUrl',
  'contactEmail',
]);

type IdentityClaim = {
  kind: 'netid' | 'email' | 'orcid' | 'profile_url' | 'researcher_id';
  value: string;
};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const stringsIn = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).flatMap((entry) => asString(entry) ?? []);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const PERSON_KEY_PREFIX = /^([a-z][a-z-]*):(.+)$/i;
const PREFIXED_KINDS: Record<string, IdentityClaim['kind']> = {
  netid: 'netid',
  email: 'email',
  orcid: 'orcid',
};

function claimsFromPersonKey(key: string): IdentityClaim[] {
  const prefixed = PERSON_KEY_PREFIX.exec(key);
  if (!prefixed) return [{ kind: key.includes('@') ? 'email' : 'netid', value: key }];
  const [, prefix, rest] = prefixed;
  const kind = PREFIXED_KINDS[prefix.toLowerCase()];
  if (kind) return [{ kind, value: rest }];
  return /^https?:\/\//i.test(rest) ? [{ kind: 'profile_url', value: rest }] : [];
}

function claimsFromPersonField(entityType: string, field: string, value: unknown): IdentityClaim[] {
  if (field === 'netid' || field === 'email' || field === 'orcid') {
    return stringsIn(value).map((entry) => ({ kind: field, value: entry }));
  }
  if (field === 'profileUrl') {
    return stringsIn(value).map((url) => ({ kind: 'profile_url', value: url }));
  }
  if (entityType === 'user' && field === 'profileUrls') {
    const links = isPlainObject(value) ? Object.entries(value) : [['', value] as const];
    return links.flatMap(([label, link]) =>
      stringsIn(link).flatMap((url): IdentityClaim[] => [
        { kind: 'profile_url', value: url },
        ...(label === 'orcid' ? [{ kind: 'orcid' as const, value: url }] : []),
      ]),
    );
  }
  if (
    entityType === 'researchGroupMember' &&
    (field === 'identityKey' || field === 'membershipKey')
  ) {
    return stringsIn(value).flatMap(claimsFromPersonKey);
  }
  if (entityType === 'researchGroupMember' && field === 'member' && isPlainObject(value)) {
    const userId = value.userId === undefined || value.userId === null ? '' : String(value.userId);
    return userId ? [{ kind: 'researcher_id', value: userId }] : [];
  }
  return [];
}

function claimsFromRowPointer(field: string, value: unknown): IdentityClaim[] {
  if (field === 'inferredPiUserId') {
    return value === undefined || value === null
      ? []
      : [{ kind: 'researcher_id', value: String(value) }];
  }
  const text = asString(value);
  if (!text) return [];
  if (field === 'inferredPiUserKey') return claimsFromPersonKey(text);
  if (field === 'inferredDirectorProfileUrl') return [{ kind: 'profile_url', value: text }];
  return [{ kind: 'email', value: text }];
}

const subjectNodes = (obs: ObservationInput): string[] => [
  ...(obs.entityKey ? [`${obs.entityType}|k|${obs.entityKey}`] : []),
  ...(obs.entityId ? [`${obs.entityType}|i|${String(obs.entityId)}`] : []),
];

const isPersonSubject = (obs: ObservationInput) => PERSON_SUBJECT_TYPES.has(obs.entityType);
const isRowPointer = (obs: ObservationInput) =>
  ROW_SUBJECT_TYPES.has(obs.entityType) && ROW_POINTER_FIELDS.has(obs.field);
const declaresAFacultyResearchProfile = (obs: ObservationInput) =>
  ROW_SUBJECT_TYPES.has(obs.entityType) &&
  obs.field === 'entityType' &&
  obs.value === 'FACULTY_RESEARCH_AREA';

export function batchMayNameARemovablePerson(inputs: readonly ObservationInput[]): boolean {
  return inputs.some((obs) => isPersonSubject(obs) || isRowPointer(obs));
}

export interface DirectoryRemovalObservationGuard {
  readonly active: boolean;
  readonly removedByRequest: number;
  withoutRemovedPeople(
    inputs: readonly ObservationInput[],
  ): Promise<{ kept: ObservationInput[]; refused: ObservationInput[] }>;
}

export function createDirectoryRemovalObservationGuard(
  matcher: DirectoryRemovalMatcher,
): DirectoryRemovalObservationGuard {
  assertDirectoryRemovalMatchable(matcher);
  const active = matcher.state !== 'inert';
  const removedSubjectNodes = new Set<string>();
  const removedUserKeys = new Set<string>();
  const researcherVerdicts = new Map<string, Promise<boolean>>();
  let removedByRequest = 0;

  const researcherIsRemoved = (id: string): Promise<boolean> => {
    if (!mongoose.Types.ObjectId.isValid(id)) return Promise.resolve(false);
    if (!researcherVerdicts.has(id)) {
      researcherVerdicts.set(
        id,
        Researcher.findById(id)
          .select('identifiers profileLinks')
          .lean<DirectoryRemovalPerson | null>()
          .then((researcher) => matcher.isRemovedPerson(researcher)),
      );
    }
    return researcherVerdicts.get(id)!;
  };

  const claimMatches = async (claim: IdentityClaim): Promise<boolean> => {
    if (claim.kind === 'researcher_id') return researcherIsRemoved(claim.value);
    if (claim.kind === 'profile_url') {
      return matcher.isRemovedPerson({ profileLinks: [{ url: claim.value }] });
    }
    return matcher.isRemovedPerson({ identifiers: { [claim.kind]: claim.value } });
  };

  const anyClaimMatches = async (claims: readonly IdentityClaim[]): Promise<boolean> => {
    for (const claim of claims) if (await claimMatches(claim)) return true;
    return false;
  };

  const removedPersonSubjectNodes = async (
    people: readonly ObservationInput[],
  ): Promise<Set<string>> => {
    const parent = new Map<string, string>();
    const find = (node: string): string => {
      if (!parent.has(node)) parent.set(node, node);
      let root = node;
      while (parent.get(root) !== root) root = parent.get(root)!;
      parent.set(node, root);
      return root;
    };
    for (const obs of people) {
      const [first, second] = subjectNodes(obs);
      if (first) find(first);
      if (first && second) parent.set(find(second), find(first));
    }
    const claimsByRoot = new Map<string, IdentityClaim[]>();
    const claimsFor = (node: string) => {
      const root = find(node);
      if (!claimsByRoot.has(root)) claimsByRoot.set(root, []);
      return claimsByRoot.get(root)!;
    };
    for (const node of parent.keys()) {
      const [entityType, form, ...rest] = node.split('|');
      if (entityType === 'user' && form === 'k')
        claimsFor(node).push(...claimsFromPersonKey(rest.join('|')));
    }
    for (const obs of people) {
      const [node] = subjectNodes(obs);
      if (node)
        claimsFor(node).push(...claimsFromPersonField(obs.entityType, obs.field, obs.value));
    }
    const removedRoots = new Set<string>();
    for (const node of parent.keys()) {
      if (removedSubjectNodes.has(node)) removedRoots.add(find(node));
    }
    for (const [root, claims] of claimsByRoot) {
      if (!removedRoots.has(root) && (await anyClaimMatches(claims))) removedRoots.add(root);
    }
    const removedNodes = new Set<string>();
    for (const node of parent.keys()) {
      if (!removedRoots.has(find(node))) continue;
      removedNodes.add(node);
      removedSubjectNodes.add(node);
      const [entityType, form, ...rest] = node.split('|');
      if (entityType === 'user' && form === 'k') removedUserKeys.add(rest.join('|'));
    }
    return removedNodes;
  };

  const rowPointerNamesARemovedPerson = async (obs: ObservationInput): Promise<boolean> => {
    if (obs.field === 'inferredPiUserKey' && removedUserKeys.has(asString(obs.value) ?? '')) {
      return true;
    }
    return anyClaimMatches(claimsFromRowPointer(obs.field, obs.value));
  };

  return {
    active,
    get removedByRequest() {
      return removedByRequest;
    },
    async withoutRemovedPeople(inputs) {
      if (!active) return { kept: [...inputs], refused: [] };
      const removedNodes = await removedPersonSubjectNodes(inputs.filter(isPersonSubject));
      const profileRowNodes = new Set(
        inputs.filter(declaresAFacultyResearchProfile).flatMap(subjectNodes),
      );
      const refusedPointers = new Set<ObservationInput>();
      const removedProfileRowNodes = new Set<string>();
      for (const obs of inputs) {
        if (!isRowPointer(obs) || !(await rowPointerNamesARemovedPerson(obs))) continue;
        refusedPointers.add(obs);
        const nodes = subjectNodes(obs);
        if (nodes.some((node) => profileRowNodes.has(node))) {
          for (const node of nodes) removedProfileRowNodes.add(node);
        }
      }
      const kept: ObservationInput[] = [];
      const refused: ObservationInput[] = [];
      for (const obs of inputs) {
        const isRefused = isPersonSubject(obs)
          ? subjectNodes(obs).some((node) => removedNodes.has(node))
          : refusedPointers.has(obs) ||
            subjectNodes(obs).some((node) => removedProfileRowNodes.has(node));
        (isRefused ? refused : kept).push(obs);
      }
      removedByRequest += refused.length;
      return { kept, refused };
    },
  };
}

export async function loadDirectoryRemovalObservationGuard(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DirectoryRemovalObservationGuard> {
  return createDirectoryRemovalObservationGuard(await loadDirectoryRemovalMatcher(env));
}

export interface DirectoryRemovalObservationRun {
  guard(): Promise<DirectoryRemovalObservationGuard>;
  removedByRequest(): number;
}

/**
 * One guard for a whole lane run, so the removal list is read at most once per run and a
 * subject refused in one batch stays refused in the next. The list is read on the first batch
 * that could name a person, so a run that names nobody reads nothing.
 */
export function directoryRemovalObservationRun(
  env: NodeJS.ProcessEnv = process.env,
): DirectoryRemovalObservationRun {
  let loaded: Promise<DirectoryRemovalObservationGuard> | undefined;
  let resolved: DirectoryRemovalObservationGuard | undefined;
  return {
    guard() {
      loaded ??= loadDirectoryRemovalObservationGuard(env).then((guard) => (resolved = guard));
      return loaded;
    },
    removedByRequest: () => resolved?.removedByRequest ?? 0,
  };
}
