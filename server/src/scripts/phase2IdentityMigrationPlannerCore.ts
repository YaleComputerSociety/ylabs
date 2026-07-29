import {
  normalizePhase0IdentityValue,
  normalizePhase0PersonName,
  type Phase0IdentityField,
} from './phase0IdentityCollisionAuditCore';
import type {
  RoleAssignmentReviewStatus,
  RoleAssignmentRole,
  RoleAssignmentState,
} from '../models/roleAssignment';

export interface LegacyIdentityUser {
  id: string;
  netid?: string;
  email?: string;
  userType?: string;
  fname?: string;
  lname?: string;
  userConfirmed?: boolean;
  /** Legacy record-wide flag. It never qualifies a URL as reviewed person-profile evidence. */
  profileVerified?: boolean;
  loginCount?: number;
  lastLogin?: Date | string | null;
  lastLoginAt?: Date | string | null;
  lastActive?: Date | string | null;
  website?: string;
  profileUrls?: unknown;
  orcid?: string;
  googleScholarId?: string;
  facultyMemberId?: string;
  archived?: boolean;
}

export interface LegacyIdentityFacultyMember {
  id: string;
  userId?: string;
  netid?: string;
  email?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  websiteUrl?: string;
  profileUrls?: unknown;
  orcidId?: string;
  googleScholarId?: string;
  archived?: boolean;
}

export interface LegacyIdentityMembership {
  id: string;
  researchEntityId?: string;
  researchGroupId?: string;
  userId?: string;
  facultyMemberId?: string;
  name?: string;
  email?: string;
  profileUrl?: string;
  role?: string;
  isCurrentMember?: boolean;
  archived?: boolean;
  evidenceStatus?: string;
  confidence?: number;
  joinedAt?: Date | string | null;
  leftAt?: Date | string | null;
  startedAt?: Date | string | null;
  endedAt?: Date | string | null;
}

export interface Phase2IdentityMigrationPlannerInput {
  users: LegacyIdentityUser[];
  facultyMembers: LegacyIdentityFacultyMember[];
  memberships: LegacyIdentityMembership[];
  knownResearchEntityIds: string[];
  environment: 'development' | 'beta' | 'production-copy';
  databaseName: string;
  sourceCommit: string;
  limits: {
    documentsPerCollection: number;
    quarantineRecords: number;
  };
  truncation: {
    users: boolean;
    facultyMembers: boolean;
    memberships: boolean;
    researchEntities: boolean;
  };
  generatedAt?: string;
}

export type Phase2QuarantineReason =
  | 'account_missing_cas_evidence'
  | 'account_missing_identity'
  | 'duplicate_account_email'
  | 'duplicate_account_netid'
  | 'conflicting_email'
  | 'conflicting_google_scholar_id'
  | 'conflicting_name'
  | 'conflicting_netid'
  | 'conflicting_orcid'
  | 'dangling_explicit_identity_reference'
  | 'external_identity_only'
  | 'missing_display_name'
  | 'name_only_identity'
  | 'same_name_distinct_identity'
  | 'membership_ambiguous_person'
  | 'membership_conflicting_identity'
  | 'membership_missing_person'
  | 'membership_missing_research_entity'
  | 'membership_conflicting_research_entity'
  | 'membership_research_entity_existence_inconclusive'
  | 'membership_unsupported_role'
  | 'membership_archived_without_historical_evidence'
  | 'membership_current_with_archived_person'
  | 'profile_url_traversal_truncated';

export interface Phase2QuarantineRecord {
  subjectType: 'user' | 'faculty_member' | 'identity_component' | 'membership';
  subjectIds: string[];
  reasons: Phase2QuarantineReason[];
  reviewHints?: {
    unverifiedYaleProfileUrls: string[];
  };
}

export interface PlannedAccount {
  accountKey: string;
  sourceUserId: string;
  netid: string;
  email: string;
  status: 'ACTIVE';
}

export interface PlannedPerson {
  personKey: string;
  sourceUserIds: string[];
  sourceFacultyMemberIds: string[];
  displayName: string;
  accountKey?: string;
  yaleEvidence: Array<'NETID' | 'YALE_EMAIL'>;
  externalIdentityHints: Array<'ORCID' | 'GOOGLE_SCHOLAR'>;
  unverifiedYaleProfileHints?: string[];
}

export interface PlannedRoleAssignment {
  roleAssignmentKey: string;
  sourceMembershipId: string;
  personKey: string;
  researchEntityId: string;
  role: RoleAssignmentRole;
  state: RoleAssignmentState;
  startedAt?: string;
  endedAt?: string;
  confidence: number;
  reviewStatus: RoleAssignmentReviewStatus;
  resolution: 'CANONICAL_SOURCE_REFERENCE';
}

export interface Phase2IdentityMigrationPlanReport {
  generatedAt: string;
  environment: Phase2IdentityMigrationPlannerInput['environment'];
  databaseName: string;
  sourceCommit: string;
  mode: 'read-only-dry-run';
  writesPerformed: false;
  policy: {
    createsPeopleFromExternalIdentityAlone: false;
    mergesPeopleOnNameAlone: false;
    usesExternalIdentifiersAsMergeKeys: false;
    redirectsRuntimeReaders: false;
    writesCanonicalCollections: false;
  };
  scan: {
    documentsPerCollectionLimit: number;
    quarantineRecordLimit: number;
    documentsScanned: {
      users: number;
      facultyMembers: number;
      memberships: number;
      researchEntities: number;
    };
    possibleTruncation: {
      users: boolean;
      facultyMembers: boolean;
      memberships: boolean;
      researchEntities: boolean;
      quarantineRecords: boolean;
      profileUrlTraversal: boolean;
    };
    complete: boolean;
  };
  summary: {
    plannedAccounts: number;
    plannedPeople: number;
    plannedRoleAssignments: number;
    quarantinedSubjects: number;
  };
  plannedAccounts: PlannedAccount[];
  plannedPeople: PlannedPerson[];
  plannedRoleAssignments: PlannedRoleAssignment[];
  quarantine: Phase2QuarantineRecord[];
}

type IdentityNodeKind = 'user' | 'faculty_member';

interface IdentityNode {
  key: string;
  kind: IdentityNodeKind;
  id: string;
  displayName: string;
  normalizedName: string;
  netids: Set<string>;
  emails: Set<string>;
  unverifiedProfileHints: Set<string>;
  orcids: Set<string>;
  scholarIds: Set<string>;
  relevantForPerson: boolean;
  danglingExplicitReference: boolean;
  archived: boolean;
  explicitReferenceKey?: string;
  profileTraversalTruncated: boolean;
}

export const MAX_PHASE2_PROFILE_URL_STRINGS = 100;
export const MAX_PHASE2_PROFILE_URL_NODES = 500;
export const MAX_PHASE2_PROFILE_URL_QUEUE = 500;
export const MAX_PHASE2_PROFILE_URL_DEPTH = 4;
const MAX_PHASE2_PROFILE_URL_CHILDREN_PER_NODE = 100;

const PLACEHOLDER_TEXT = new Set(['', 'na', 'n/a', 'none', 'null', 'unknown', 'undefined']);
const CANONICAL_ROLE_BY_LEGACY: Readonly<Record<string, RoleAssignmentRole>> = Object.freeze({
  pi: 'PI',
  'co-pi': 'CO_PI',
  director: 'DIRECTOR',
  'co-director': 'CO_DIRECTOR',
  'core-faculty': 'CORE_FACULTY',
  affiliated: 'AFFILIATED',
  affiliate: 'AFFILIATED',
  alumni: 'AFFILIATED',
  staff: 'STAFF',
  postdoc: 'POSTDOC',
  'grad-student': 'GRADUATE_STUDENT',
  undergrad: 'UNDERGRADUATE',
});

function compareCodePoints(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function nonemptyText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && !PLACEHOLDER_TEXT.has(trimmed.toLowerCase()) ? trimmed : undefined;
}

function normalizeNetid(value: unknown): string | undefined {
  const normalized = normalizePhase0IdentityValue('netid', value);
  return normalized && /^[a-z0-9][a-z0-9._-]{1,63}$/.test(normalized) ? normalized : undefined;
}

function normalizeEmail(value: unknown): string | undefined {
  const normalized = normalizePhase0IdentityValue('email', value);
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined;
}

function isYaleEmail(value: string): boolean {
  const domain = value.split('@').at(-1);
  return domain === 'yale.edu' || Boolean(domain?.endsWith('.yale.edu'));
}

export interface Phase2ProfileUrlTraversalResult {
  values: string[];
  truncated: boolean;
  nodesVisited: number;
}

export function collectPhase2ProfileUrlValues(
  ...values: unknown[]
): Phase2ProfileUrlTraversalResult {
  const output: string[] = [];
  const queue: Array<{ value: unknown; depth: number }> = [];
  let truncated = values.length > MAX_PHASE2_PROFILE_URL_QUEUE;
  values.slice(0, MAX_PHASE2_PROFILE_URL_QUEUE).forEach((value) => {
    queue.push({ value, depth: 0 });
  });
  const visited = new Set<object>();
  let cursor = 0;
  let nodesVisited = 0;
  while (
    cursor < queue.length &&
    output.length < MAX_PHASE2_PROFILE_URL_STRINGS &&
    nodesVisited < MAX_PHASE2_PROFILE_URL_NODES
  ) {
    const current = queue[cursor];
    cursor += 1;
    nodesVisited += 1;
    if (typeof current.value === 'string') {
      output.push(current.value);
      continue;
    }
    if (!current.value || typeof current.value !== 'object') continue;
    if (current.depth >= MAX_PHASE2_PROFILE_URL_DEPTH) {
      truncated = true;
      continue;
    }
    if (visited.has(current.value)) continue;
    visited.add(current.value);
    let childrenVisited = 0;
    const appendChild = (child: unknown): boolean => {
      if (
        childrenVisited >= MAX_PHASE2_PROFILE_URL_CHILDREN_PER_NODE ||
        queue.length >= MAX_PHASE2_PROFILE_URL_QUEUE
      ) {
        truncated = true;
        return false;
      }
      childrenVisited += 1;
      queue.push({ value: child, depth: current.depth + 1 });
      return true;
    };

    if (Array.isArray(current.value)) {
      for (let index = 0; index < current.value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current.value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
          truncated = true;
          break;
        }
        if (!appendChild(descriptor.value)) break;
      }
      continue;
    }

    for (const key in current.value as Record<string, unknown>) {
      if (!Object.hasOwn(current.value, key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(current.value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        truncated = true;
        break;
      }
      if (!appendChild(descriptor.value)) break;
    }
  }
  if (cursor < queue.length) truncated = true;
  return { values: output, truncated, nodesVisited };
}

function normalizeOfficialYaleUrl(value: unknown): string | undefined {
  const text = nonemptyText(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (url.hostname !== 'yale.edu' && !url.hostname.endsWith('.yale.edu'))
    ) {
      return undefined;
    }
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch {
    return undefined;
  }
}

function normalizedProfiles(...values: unknown[]): {
  profiles: Set<string>;
  truncated: boolean;
} {
  const traversal = collectPhase2ProfileUrlValues(...values);
  return {
    profiles: new Set(
      traversal.values
        .map(normalizeOfficialYaleUrl)
        .filter((value): value is string => Boolean(value)),
    ),
    truncated: traversal.truncated,
  };
}

function normalizedIdentitySet(field: Phase0IdentityField, ...values: unknown[]): Set<string> {
  return new Set(
    values
      .map((value) => normalizePhase0IdentityValue(field, value))
      .filter((value): value is string => Boolean(value)),
  );
}

function normalizedUserName(user: LegacyIdentityUser): { display: string; normalized: string } {
  const display = [nonemptyText(user.fname), nonemptyText(user.lname)].filter(Boolean).join(' ');
  return {
    display,
    normalized: normalizePhase0PersonName({ fname: user.fname, lname: user.lname }),
  };
}

function normalizedFacultyName(facultyMember: LegacyIdentityFacultyMember): {
  display: string;
  normalized: string;
} {
  const display =
    nonemptyText(facultyMember.name) ||
    [nonemptyText(facultyMember.firstName), nonemptyText(facultyMember.lastName)]
      .filter(Boolean)
      .join(' ');
  const pieces = display.trim().split(/\s+/);
  return {
    display,
    normalized: normalizePhase0PersonName({
      fname: pieces.slice(0, -1).join(' '),
      lname: pieces.at(-1),
    }),
  };
}

function hasLoginEvidence(user: LegacyIdentityUser): boolean {
  return (
    Number(user.loginCount || 0) > 0 ||
    Boolean(user.lastLogin || user.lastLoginAt || user.lastActive || user.userConfirmed)
  );
}

function activeUser(user: LegacyIdentityUser): boolean {
  return !user.archived;
}

function activeFacultyMember(facultyMember: LegacyIdentityFacultyMember): boolean {
  return !facultyMember.archived;
}

function historicalMembership(membership: LegacyIdentityMembership): boolean {
  return (
    (membership.evidenceStatus || '').trim().toLowerCase() === 'historical' ||
    membership.isCurrentMember === false ||
    (membership.role || '').trim().toLowerCase() === 'alumni' ||
    Boolean(membership.endedAt || membership.leftAt)
  );
}

function membershipInIdentityScope(membership: LegacyIdentityMembership): boolean {
  return !membership.archived || historicalMembership(membership);
}

function scopedIdentityRows(
  users: LegacyIdentityUser[],
  facultyMembers: LegacyIdentityFacultyMember[],
  memberships: LegacyIdentityMembership[],
): {
  users: LegacyIdentityUser[];
  facultyMembers: LegacyIdentityFacultyMember[];
} {
  const usersById = new Map(users.map((user) => [user.id, user]));
  const facultyById = new Map(
    facultyMembers.map((facultyMember) => [facultyMember.id, facultyMember]),
  );
  const includedUserIds = new Set(users.filter(activeUser).map(({ id }) => id));
  const includedFacultyIds = new Set(
    facultyMembers.filter(activeFacultyMember).map(({ id }) => id),
  );
  const queue: Array<{ kind: IdentityNodeKind; id: string }> = [
    ...[...includedUserIds].map((id) => ({ kind: 'user' as const, id })),
    ...[...includedFacultyIds].map((id) => ({ kind: 'faculty_member' as const, id })),
  ];

  memberships.filter(membershipInIdentityScope).forEach((membership) => {
    if (membership.userId && !includedUserIds.has(membership.userId)) {
      includedUserIds.add(membership.userId);
      queue.push({ kind: 'user', id: membership.userId });
    }
    if (membership.facultyMemberId && !includedFacultyIds.has(membership.facultyMemberId)) {
      includedFacultyIds.add(membership.facultyMemberId);
      queue.push({ kind: 'faculty_member', id: membership.facultyMemberId });
    }
  });

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current.kind === 'user') {
      const facultyMemberId = usersById.get(current.id)?.facultyMemberId;
      if (facultyMemberId && !includedFacultyIds.has(facultyMemberId)) {
        includedFacultyIds.add(facultyMemberId);
        queue.push({ kind: 'faculty_member', id: facultyMemberId });
      }
      continue;
    }
    const userId = facultyById.get(current.id)?.userId;
    if (userId && !includedUserIds.has(userId)) {
      includedUserIds.add(userId);
      queue.push({ kind: 'user', id: userId });
    }
  }

  return {
    users: users.filter(({ id }) => includedUserIds.has(id)),
    facultyMembers: facultyMembers.filter(({ id }) => includedFacultyIds.has(id)),
  };
}

function appendQuarantine(values: Phase2QuarantineRecord[], record: Phase2QuarantineRecord): void {
  const reasons = [...new Set(record.reasons)].sort(compareCodePoints);
  if (reasons.length === 0) return;
  values.push({
    ...record,
    subjectIds: [...new Set(record.subjectIds)].sort(compareCodePoints),
    reasons,
  });
}

function accountPlans(
  users: LegacyIdentityUser[],
  quarantine: Phase2QuarantineRecord[],
): { plans: PlannedAccount[]; byUserId: Map<string, PlannedAccount> } {
  const candidates = users.filter(activeUser).map((user) => {
    const netid = normalizeNetid(user.netid);
    const email = normalizeEmail(user.email);
    return { user, netid, email };
  });
  const duplicateNetids = new Set<string>();
  const duplicateEmails = new Set<string>();
  const collectDuplicates = (
    values: Array<{ user: LegacyIdentityUser; value?: string }>,
    target: Set<string>,
  ) => {
    const counts = new Map<string, number>();
    values.forEach(({ value }) => {
      if (value) counts.set(value, (counts.get(value) || 0) + 1);
    });
    counts.forEach((count, value) => {
      if (count > 1) target.add(value);
    });
  };
  collectDuplicates(
    candidates.map(({ user, netid }) => ({ user, value: netid })),
    duplicateNetids,
  );
  collectDuplicates(
    candidates.map(({ user, email }) => ({ user, value: email })),
    duplicateEmails,
  );

  const plans: PlannedAccount[] = [];
  for (const { user, netid, email } of candidates) {
    const reasons: Phase2QuarantineReason[] = [];
    if (!netid || !email || !isYaleEmail(email)) reasons.push('account_missing_identity');
    if (!hasLoginEvidence(user)) reasons.push('account_missing_cas_evidence');
    if (netid && duplicateNetids.has(netid)) reasons.push('duplicate_account_netid');
    if (email && duplicateEmails.has(email)) reasons.push('duplicate_account_email');
    if (reasons.length > 0) {
      appendQuarantine(quarantine, {
        subjectType: 'user',
        subjectIds: [user.id],
        reasons,
      });
      continue;
    }
    plans.push({
      accountKey: `account:user:${user.id}`,
      sourceUserId: user.id,
      netid: netid as string,
      email: email as string,
      status: 'ACTIVE',
    });
  }
  plans.sort((left, right) => compareCodePoints(left.sourceUserId, right.sourceUserId));
  return { plans, byUserId: new Map(plans.map((plan) => [plan.sourceUserId, plan])) };
}

function buildIdentityNodes(
  users: LegacyIdentityUser[],
  facultyMembers: LegacyIdentityFacultyMember[],
  memberships: LegacyIdentityMembership[],
): { nodes: Map<string, IdentityNode>; profileUrlTraversalTruncated: boolean } {
  const scoped = scopedIdentityRows(users, facultyMembers, memberships);
  const referencedUsers = new Set(
    memberships.filter(membershipInIdentityScope).flatMap(({ userId }) => (userId ? [userId] : [])),
  );
  const referencedFacultyMembers = new Set(
    memberships
      .filter(membershipInIdentityScope)
      .flatMap(({ facultyMemberId }) => (facultyMemberId ? [facultyMemberId] : [])),
  );
  const nodes = new Map<string, IdentityNode>();
  const scopedFacultyIds = new Set(scoped.facultyMembers.map(({ id }) => id));
  const scopedUserIds = new Set(scoped.users.map(({ id }) => id));
  let profileUrlTraversalTruncated = false;

  for (const user of scoped.users) {
    const name = normalizedUserName(user);
    const key = `user:${user.id}`;
    const userType = (user.userType || '').trim().toLowerCase();
    const profiles = normalizedProfiles(user.website, user.profileUrls);
    const netids = normalizedIdentitySet('netid', user.netid);
    const emails = normalizedIdentitySet('email', user.email);
    const profileTraversalTruncated = profiles.truncated;
    profileUrlTraversalTruncated ||= profileTraversalTruncated;
    nodes.set(key, {
      key,
      kind: 'user',
      id: user.id,
      displayName: name.display,
      normalizedName: name.normalized,
      netids,
      emails,
      unverifiedProfileHints: profiles.profiles,
      orcids: normalizedIdentitySet('orcid', user.orcid),
      scholarIds: normalizedIdentitySet('googleScholarId', user.googleScholarId),
      relevantForPerson:
        referencedUsers.has(user.id) ||
        (!user.archived &&
          (userType === 'professor' || userType === 'faculty' || userType === 'staff')),
      danglingExplicitReference:
        Boolean(user.facultyMemberId) && !scopedFacultyIds.has(user.facultyMemberId as string),
      archived: user.archived === true,
      ...(user.facultyMemberId
        ? { explicitReferenceKey: `faculty_member:${user.facultyMemberId}` }
        : {}),
      profileTraversalTruncated,
    });
  }

  for (const facultyMember of scoped.facultyMembers) {
    const name = normalizedFacultyName(facultyMember);
    const key = `faculty_member:${facultyMember.id}`;
    const websiteProfile = normalizedProfiles(facultyMember.websiteUrl);
    const nestedProfiles = normalizedProfiles(facultyMember.profileUrls);
    const netids = normalizedIdentitySet('netid', facultyMember.netid);
    const emails = normalizedIdentitySet('email', facultyMember.email);
    const candidateProfiles = new Set<string>([
      ...websiteProfile.profiles,
      ...nestedProfiles.profiles,
    ]);
    const profileTraversalTruncated = websiteProfile.truncated || nestedProfiles.truncated;
    profileUrlTraversalTruncated ||= profileTraversalTruncated;
    nodes.set(key, {
      key,
      kind: 'faculty_member',
      id: facultyMember.id,
      displayName: name.display,
      normalizedName: name.normalized,
      netids,
      emails,
      unverifiedProfileHints: candidateProfiles,
      orcids: normalizedIdentitySet('orcid', facultyMember.orcidId),
      scholarIds: normalizedIdentitySet('googleScholarId', facultyMember.googleScholarId),
      relevantForPerson: !facultyMember.archived || referencedFacultyMembers.has(facultyMember.id),
      danglingExplicitReference:
        Boolean(facultyMember.userId) && !scopedUserIds.has(facultyMember.userId as string),
      archived: facultyMember.archived === true,
      ...(facultyMember.userId ? { explicitReferenceKey: `user:${facultyMember.userId}` } : {}),
      profileTraversalTruncated,
    });
  }
  return { nodes, profileUrlTraversalTruncated };
}

function identityComponents(nodes: Map<string, IdentityNode>): IdentityNode[][] {
  const orderedNodes = [...nodes.values()].sort((left, right) =>
    compareCodePoints(left.key, right.key),
  );
  const indexByKey = new Map(orderedNodes.map((node, index) => [node.key, index]));
  const parent = orderedNodes.map((_, index) => index);
  const size = orderedNodes.map(() => 1);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    let current = index;
    while (parent[current] !== current) {
      const next = parent[current];
      parent[current] = root;
      current = next;
    }
    return root;
  };
  const union = (left: number | undefined, right: number | undefined): void => {
    if (left === undefined || right === undefined) return;
    let leftRoot = find(left);
    let rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    if (size[leftRoot] < size[rightRoot]) [leftRoot, rightRoot] = [rightRoot, leftRoot];
    parent[rightRoot] = leftRoot;
    size[leftRoot] += size[rightRoot];
  };

  orderedNodes.forEach((node) => {
    if (!node.explicitReferenceKey) return;
    union(indexByKey.get(node.key), indexByKey.get(node.explicitReferenceKey));
  });

  const identityOwner = new Map<string, number>();
  orderedNodes.forEach((node, index) => {
    const entries: Array<[string, Set<string>]> = [
      ['netid', node.netids],
      ['email', new Set([...node.emails].filter(isYaleEmail))],
    ];
    entries.forEach(([field, values]) => {
      values.forEach((value) => {
        const key = `${field}:${value}`;
        const existing = identityOwner.get(key);
        if (existing === undefined) identityOwner.set(key, index);
        else union(index, existing);
      });
    });
  });

  const components = new Map<number, IdentityNode[]>();
  orderedNodes.forEach((node, index) => {
    const root = find(index);
    const component = components.get(root);
    if (component) component.push(node);
    else components.set(root, [node]);
  });
  return [...components.values()]
    .map((component) => component.sort((left, right) => compareCodePoints(left.key, right.key)))
    .sort((left, right) => compareCodePoints(left[0]?.key || '', right[0]?.key || ''));
}

function unionValues(component: IdentityNode[], field: keyof IdentityNode): Set<string> {
  const values = new Set<string>();
  component.forEach((node) => {
    const fieldValue = node[field];
    if (fieldValue instanceof Set) fieldValue.forEach((value) => values.add(value));
  });
  return values;
}

function identityComponentReasons(component: IdentityNode[]): Phase2QuarantineReason[] {
  const reasons: Phase2QuarantineReason[] = [];
  const netids = unionValues(component, 'netids');
  const emails = unionValues(component, 'emails');
  const orcids = unionValues(component, 'orcids');
  const scholarIds = unionValues(component, 'scholarIds');
  const names = new Set(component.map(({ normalizedName }) => normalizedName).filter(Boolean));
  const yaleEvidence = netids.size > 0 || [...emails].some(isYaleEmail);

  if (netids.size > 1) reasons.push('conflicting_netid');
  if (emails.size > 1) reasons.push('conflicting_email');
  if (orcids.size > 1) reasons.push('conflicting_orcid');
  if (scholarIds.size > 1) reasons.push('conflicting_google_scholar_id');
  if (names.size > 1) reasons.push('conflicting_name');
  if (component.some(({ danglingExplicitReference }) => danglingExplicitReference)) {
    reasons.push('dangling_explicit_identity_reference');
  }
  if (component.some(({ profileTraversalTruncated }) => profileTraversalTruncated)) {
    reasons.push('profile_url_traversal_truncated');
  }
  if (!yaleEvidence) {
    reasons.push(
      orcids.size > 0 || scholarIds.size > 0 ? 'external_identity_only' : 'name_only_identity',
    );
  }
  if (names.size === 0) reasons.push('missing_display_name');
  return reasons;
}

function plannedPeople(
  components: IdentityNode[][],
  accountByUserId: Map<string, PlannedAccount>,
  quarantine: Phase2QuarantineRecord[],
): {
  people: PlannedPerson[];
  personKeyByUserId: Map<string, string>;
  personKeyByFacultyMemberId: Map<string, string>;
  identityByPersonKey: Map<
    string,
    {
      emails: Set<string>;
      hasActiveSource: boolean;
    }
  >;
} {
  const relevantComponents = components.filter((component) =>
    component.some(({ relevantForPerson }) => relevantForPerson),
  );
  const reasonsByComponent = new Map<IdentityNode[], Phase2QuarantineReason[]>(
    relevantComponents.map((component) => [component, identityComponentReasons(component)]),
  );
  const componentsByName = new Map<string, IdentityNode[][]>();
  relevantComponents.forEach((component) => {
    const names = new Set(component.map(({ normalizedName }) => normalizedName).filter(Boolean));
    if (names.size !== 1) return;
    const name = [...names][0];
    const matches = componentsByName.get(name) || [];
    matches.push(component);
    componentsByName.set(name, matches);
  });
  componentsByName.forEach((matches) => {
    if (matches.length <= 1) return;
    matches.forEach((component) => {
      const reasons = reasonsByComponent.get(component) || [];
      reasons.push('same_name_distinct_identity');
      reasonsByComponent.set(component, reasons);
    });
  });

  const people: PlannedPerson[] = [];
  const personKeyByUserId = new Map<string, string>();
  const personKeyByFacultyMemberId = new Map<string, string>();
  const identityByPersonKey = new Map<
    string,
    {
      emails: Set<string>;
      hasActiveSource: boolean;
    }
  >();
  for (const component of relevantComponents) {
    const reasons = reasonsByComponent.get(component) || [];
    if (reasons.length > 0) {
      const unverifiedYaleProfileUrls = [...unionValues(component, 'unverifiedProfileHints')].sort(
        compareCodePoints,
      );
      appendQuarantine(quarantine, {
        subjectType: 'identity_component',
        subjectIds: component.map(({ key }) => key),
        reasons,
        ...(unverifiedYaleProfileUrls.length > 0
          ? { reviewHints: { unverifiedYaleProfileUrls } }
          : {}),
      });
      continue;
    }
    const userIds = component
      .filter(({ kind }) => kind === 'user')
      .map(({ id }) => id)
      .sort(compareCodePoints);
    const facultyMemberIds = component
      .filter(({ kind }) => kind === 'faculty_member')
      .map(({ id }) => id)
      .sort(compareCodePoints);
    const accountCandidates = userIds
      .map((id) => accountByUserId.get(id))
      .filter((value): value is PlannedAccount => Boolean(value));
    if (accountCandidates.length > 1) {
      appendQuarantine(quarantine, {
        subjectType: 'identity_component',
        subjectIds: component.map(({ key }) => key),
        reasons: ['conflicting_netid', 'conflicting_email'],
      });
      continue;
    }
    const preferredNode =
      component.find(({ kind, id }) => kind === 'user' && accountByUserId.has(id)) ||
      component.find(({ kind }) => kind === 'faculty_member') ||
      component[0];
    const personKey = `person:${preferredNode.key}`;
    const netids = unionValues(component, 'netids');
    const emails = unionValues(component, 'emails');
    const unverifiedYaleProfileHints = [...unionValues(component, 'unverifiedProfileHints')].sort(
      compareCodePoints,
    );
    const yaleEvidence: PlannedPerson['yaleEvidence'] = [];
    if (netids.size > 0) yaleEvidence.push('NETID');
    if ([...emails].some(isYaleEmail)) yaleEvidence.push('YALE_EMAIL');
    const externalIdentityHints: PlannedPerson['externalIdentityHints'] = [];
    if (unionValues(component, 'orcids').size > 0) externalIdentityHints.push('ORCID');
    if (unionValues(component, 'scholarIds').size > 0) {
      externalIdentityHints.push('GOOGLE_SCHOLAR');
    }
    const person: PlannedPerson = {
      personKey,
      sourceUserIds: userIds,
      sourceFacultyMemberIds: facultyMemberIds,
      displayName: preferredNode.displayName,
      ...(accountCandidates[0] ? { accountKey: accountCandidates[0].accountKey } : {}),
      yaleEvidence,
      externalIdentityHints,
      ...(unverifiedYaleProfileHints.length > 0 ? { unverifiedYaleProfileHints } : {}),
    };
    people.push(person);
    userIds.forEach((id) => personKeyByUserId.set(id, personKey));
    facultyMemberIds.forEach((id) => personKeyByFacultyMemberId.set(id, personKey));
    identityByPersonKey.set(personKey, {
      emails,
      hasActiveSource: component.some(({ archived }) => !archived),
    });
  }
  people.sort((left, right) => compareCodePoints(left.personKey, right.personKey));
  return {
    people,
    personKeyByUserId,
    personKeyByFacultyMemberId,
    identityByPersonKey,
  };
}

function normalizedIsoDate(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function roleState(membership: LegacyIdentityMembership): RoleAssignmentState {
  if (
    (membership.evidenceStatus || '').trim().toLowerCase() === 'historical' ||
    membership.isCurrentMember === false ||
    (membership.role || '').trim().toLowerCase() === 'alumni' ||
    membership.endedAt ||
    membership.leftAt
  ) {
    return 'HISTORICAL';
  }
  if (membership.evidenceStatus === 'verified' && membership.isCurrentMember === true) {
    return 'CURRENT';
  }
  return 'UNKNOWN';
}

function plannedRoles(args: {
  memberships: LegacyIdentityMembership[];
  knownResearchEntityIds: Set<string>;
  researchEntitySnapshotTruncated: boolean;
  personKeyByUserId: Map<string, string>;
  personKeyByFacultyMemberId: Map<string, string>;
  identityByPersonKey: Map<
    string,
    {
      emails: Set<string>;
      hasActiveSource: boolean;
    }
  >;
  quarantine: Phase2QuarantineRecord[];
}): PlannedRoleAssignment[] {
  const plans: PlannedRoleAssignment[] = [];
  for (const membership of args.memberships) {
    const reasons: Phase2QuarantineReason[] = [];
    const researchEntityId = membership.researchEntityId || membership.researchGroupId;
    if (membership.archived === true && !historicalMembership(membership)) {
      reasons.push('membership_archived_without_historical_evidence');
    }
    if (
      membership.researchEntityId &&
      membership.researchGroupId &&
      membership.researchEntityId !== membership.researchGroupId
    ) {
      reasons.push('membership_conflicting_research_entity');
    } else if (!researchEntityId) {
      reasons.push('membership_missing_research_entity');
    } else if (!args.knownResearchEntityIds.has(researchEntityId)) {
      reasons.push(
        args.researchEntitySnapshotTruncated
          ? 'membership_research_entity_existence_inconclusive'
          : 'membership_missing_research_entity',
      );
    }
    const role = CANONICAL_ROLE_BY_LEGACY[(membership.role || '').trim().toLowerCase()];
    if (!role) reasons.push('membership_unsupported_role');
    const referencedPersonKeys = new Set<string>();
    const explicitReferenceCount =
      Number(Boolean(membership.userId)) + Number(Boolean(membership.facultyMemberId));
    let resolvedReferenceCount = 0;
    if (membership.userId) {
      const personKey = args.personKeyByUserId.get(membership.userId);
      if (personKey) {
        referencedPersonKeys.add(personKey);
        resolvedReferenceCount += 1;
      }
    }
    if (membership.facultyMemberId) {
      const personKey = args.personKeyByFacultyMemberId.get(membership.facultyMemberId);
      if (personKey) {
        referencedPersonKeys.add(personKey);
        resolvedReferenceCount += 1;
      }
    }

    let personKey: string | undefined;
    let resolution: PlannedRoleAssignment['resolution'] | undefined;
    if (explicitReferenceCount > 0 && resolvedReferenceCount !== explicitReferenceCount) {
      reasons.push('membership_missing_person');
    } else if (referencedPersonKeys.size === 1) {
      personKey = [...referencedPersonKeys][0];
      resolution = 'CANONICAL_SOURCE_REFERENCE';
    } else if (referencedPersonKeys.size > 1) {
      reasons.push('membership_ambiguous_person');
    } else if (explicitReferenceCount === 0) {
      reasons.push('membership_missing_person');
    }
    if (personKey) {
      const plannedIdentity = args.identityByPersonKey.get(personKey);
      const membershipEmail = normalizeEmail(membership.email);
      if (
        membershipEmail &&
        plannedIdentity &&
        plannedIdentity.emails.size > 0 &&
        !plannedIdentity.emails.has(membershipEmail)
      ) {
        reasons.push('membership_conflicting_identity');
      }
      if (roleState(membership) !== 'HISTORICAL' && plannedIdentity?.hasActiveSource === false) {
        reasons.push('membership_current_with_archived_person');
      }
    }
    if (reasons.length > 0 || !personKey || !resolution || !role || !researchEntityId) {
      appendQuarantine(args.quarantine, {
        subjectType: 'membership',
        subjectIds: [membership.id],
        reasons,
      });
      continue;
    }
    const state = roleState(membership);
    const startedAt = normalizedIsoDate(membership.startedAt || membership.joinedAt);
    const endedAt = normalizedIsoDate(membership.endedAt || membership.leftAt);
    plans.push({
      roleAssignmentKey: `role_assignment:membership:${membership.id}`,
      sourceMembershipId: membership.id,
      personKey,
      researchEntityId,
      role,
      state,
      ...(startedAt ? { startedAt } : {}),
      ...(state === 'HISTORICAL' && endedAt ? { endedAt } : {}),
      confidence: Math.min(1, Math.max(0, Number(membership.confidence) || 0)),
      reviewStatus:
        membership.archived !== true &&
        state === 'CURRENT' &&
        resolution === 'CANONICAL_SOURCE_REFERENCE' &&
        membership.evidenceStatus === 'verified'
          ? 'APPROVED'
          : 'UNREVIEWED',
      resolution,
    });
  }
  return plans.sort((left, right) =>
    compareCodePoints(left.roleAssignmentKey, right.roleAssignmentKey),
  );
}

export function buildPhase2IdentityMigrationPlan(
  input: Phase2IdentityMigrationPlannerInput,
): Phase2IdentityMigrationPlanReport {
  const generatedAt = normalizedIsoDate(input.generatedAt) || new Date().toISOString();
  const quarantine: Phase2QuarantineRecord[] = [];
  const accounts = accountPlans(input.users, quarantine);
  const identityNodes = buildIdentityNodes(input.users, input.facultyMembers, input.memberships);
  const components = identityComponents(identityNodes.nodes);
  const people = plannedPeople(components, accounts.byUserId, quarantine);
  const roles = plannedRoles({
    memberships: input.memberships,
    knownResearchEntityIds: new Set(input.knownResearchEntityIds),
    researchEntitySnapshotTruncated: input.truncation.researchEntities,
    personKeyByUserId: people.personKeyByUserId,
    personKeyByFacultyMemberId: people.personKeyByFacultyMemberId,
    identityByPersonKey: people.identityByPersonKey,
    quarantine,
  });
  quarantine.sort(
    (left, right) =>
      compareCodePoints(left.subjectType, right.subjectType) ||
      compareCodePoints(left.subjectIds.join('\0'), right.subjectIds.join('\0')) ||
      compareCodePoints(left.reasons.join('\0'), right.reasons.join('\0')),
  );
  const quarantineTruncated = quarantine.length > input.limits.quarantineRecords;
  const boundedQuarantine = quarantine.slice(0, input.limits.quarantineRecords);
  const complete =
    !input.truncation.users &&
    !input.truncation.facultyMembers &&
    !input.truncation.memberships &&
    !input.truncation.researchEntities &&
    !identityNodes.profileUrlTraversalTruncated &&
    !quarantineTruncated;

  return {
    generatedAt,
    environment: input.environment,
    databaseName: input.databaseName,
    sourceCommit: input.sourceCommit,
    mode: 'read-only-dry-run',
    writesPerformed: false,
    policy: {
      createsPeopleFromExternalIdentityAlone: false,
      mergesPeopleOnNameAlone: false,
      usesExternalIdentifiersAsMergeKeys: false,
      redirectsRuntimeReaders: false,
      writesCanonicalCollections: false,
    },
    scan: {
      documentsPerCollectionLimit: input.limits.documentsPerCollection,
      quarantineRecordLimit: input.limits.quarantineRecords,
      documentsScanned: {
        users: input.users.length,
        facultyMembers: input.facultyMembers.length,
        memberships: input.memberships.length,
        researchEntities: input.knownResearchEntityIds.length,
      },
      possibleTruncation: {
        ...input.truncation,
        quarantineRecords: quarantineTruncated,
        profileUrlTraversal: identityNodes.profileUrlTraversalTruncated,
      },
      complete,
    },
    summary: {
      plannedAccounts: accounts.plans.length,
      plannedPeople: people.people.length,
      plannedRoleAssignments: roles.length,
      quarantinedSubjects: quarantine.length,
    },
    plannedAccounts: accounts.plans,
    plannedPeople: people.people,
    plannedRoleAssignments: roles,
    quarantine: boundedQuarantine,
  };
}
