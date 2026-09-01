import { createHmac } from 'crypto';
import { normalizeOrcid } from '../utils/orcid';
import type { Phase0SummaryOnlyEnvironment } from './phase0SummaryOnlyAudit';

export const PHASE0_IDENTITY_FIELDS = [
  'netid',
  'email',
  'orcid',
  'openAlexId',
  'googleScholarId',
] as const;

export type Phase0IdentityField = (typeof PHASE0_IDENTITY_FIELDS)[number];

export type Phase0IdentityCollisionClass =
  | 'shared_netid'
  | 'shared_email'
  | 'shared_orcid'
  | 'shared_openalex_id'
  | 'shared_google_scholar_id'
  | 'same_name_only'
  | 'same_name_mixed_identity_components';

export interface Phase0IdentityAuditUser {
  id: string;
  fname?: string;
  lname?: string;
  netid?: string;
  email?: string;
  orcid?: string;
  openAlexId?: string;
  googleScholarId?: string;
  userConfirmed?: boolean;
  archived?: boolean;
}

export interface Phase0IdentityCollisionAuditArgs {
  environment: Phase0SummaryOnlyEnvironment;
  documentLimit: number;
  groupLimit: number;
  groupMemberLimit: number;
  maxTimeMs: number;
  strict: boolean;
  output: string;
}

export interface Phase0IdentityAuditReviewMember {
  recordId: string;
  recordFingerprint: string;
  normalizedName: string;
  userConfirmed: boolean;
  identityFingerprints: Partial<Record<Phase0IdentityField, string>>;
  strongIdentityComponent?: number;
}

export interface Phase0IdentityCollisionGroup {
  identityField: Phase0IdentityField;
  identityValue: string;
  memberCount: number;
  memberDetailsTruncated: boolean;
  members: Phase0IdentityAuditReviewMember[];
}

export interface Phase0SameNameOnlyGroup {
  normalizedName: string;
  strongIdentityComponentCount: number;
  memberCount: number;
  memberDetailsTruncated: boolean;
  members: Phase0IdentityAuditReviewMember[];
}

export interface Phase0MixedNameIdentityGroup extends Phase0SameNameOnlyGroup {
  classification: 'same_name_mixed_identity_components';
}

export interface Phase0IdentityCollisionClassReview {
  collisionClass: Phase0IdentityCollisionClass;
  count: number;
  reviewRequired: true;
  owner: null;
  disposition: null;
}

export interface Phase0IdentityCollisionAuditReport {
  generatedAt: string;
  environment: Phase0SummaryOnlyEnvironment;
  db: string;
  sourceCommit: string;
  mode: 'read-only';
  summary: {
    documentsScanned: number;
    identityCollisionGroupsByField: Record<Phase0IdentityField, number>;
    sameNameOnlyGroups: number;
    mixedNameIdentityGroups: number;
  };
  scan: {
    documentLimit: number;
    groupLimitPerClass: number;
    groupMemberLimit: number;
    maxTimeMs: number;
    strict: boolean;
    readConcern: 'snapshot';
    readPreference: 'secondaryPreferred';
    possibleDocumentTruncation: boolean;
    possibleIdentityGroupTruncation: boolean;
    possibleSameNameGroupTruncation: boolean;
    possibleGroupMemberTruncation: boolean;
    countSemantics: 'complete-within-document-scan' | 'bounded-lower-bound';
  };
  collisionClassReview: Phase0IdentityCollisionClassReview[];
  identityCollisionGroups: Phase0IdentityCollisionGroup[];
  sameNameOnlyGroups: Phase0SameNameOnlyGroup[];
  mixedNameIdentityGroups: Phase0MixedNameIdentityGroup[];
}

interface GroupAccumulator {
  count: number;
  members: Phase0IdentityAuditUser[];
}

interface NameGroupAccumulator {
  members: Phase0IdentityAuditUser[];
}

const COLLISION_CLASS_BY_FIELD: Record<
  Phase0IdentityField,
  Exclude<Phase0IdentityCollisionClass, 'same_name_only' | 'same_name_mixed_identity_components'>
> = {
  netid: 'shared_netid',
  email: 'shared_email',
  orcid: 'shared_orcid',
  openAlexId: 'shared_openalex_id',
  googleScholarId: 'shared_google_scholar_id',
};

const PLACEHOLDER_IDENTITIES = new Set(['', 'na', 'n/a', 'unknown', 'null', 'undefined']);

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function normalizePhase0PersonName(
  user: Pick<Phase0IdentityAuditUser, 'fname' | 'lname'>,
): string {
  return `${user.fname || ''} ${user.lname || ''}`
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizePhase0IdentityValue(
  field: Phase0IdentityField,
  value: unknown,
): string | undefined {
  let normalized = text(value)?.toLowerCase();
  if (!normalized || PLACEHOLDER_IDENTITIES.has(normalized)) return undefined;

  if (field === 'orcid') {
    normalized = normalized.replace(/^orcid:\s*/i, '');
    try {
      const url = new URL(normalized);
      if (url.hostname === 'orcid.org' || url.hostname === 'www.orcid.org') {
        normalized = url.pathname.split('/').filter(Boolean)[0] || '';
      }
    } catch {
      normalized = normalized.replace(/^(?:https?:\/\/)?(?:www\.)?orcid\.org\//i, '');
    }
    return normalizeOrcid(normalized.split(/[/?#]/)[0] || '') || undefined;
  }

  if (field === 'openAlexId') {
    normalized = normalized.replace(/^openalex:\s*/i, '');
    try {
      const url = new URL(normalized);
      if (url.hostname === 'openalex.org' || url.hostname === 'api.openalex.org') {
        normalized = url.pathname.split('/').filter(Boolean).at(-1) || '';
      }
    } catch {
      normalized = normalized.replace(
        /^(?:https?:\/\/)?(?:api\.)?openalex\.org\/(?:authors\/)?/i,
        '',
      );
    }
    normalized = normalized.split(/[/?#]/)[0]?.toLowerCase() || '';
  }

  if (field === 'googleScholarId') {
    normalized = normalized.replace(/^(?:google[-_ ]?scholar|scholar):\s*/i, '');
    try {
      const url = new URL(normalized);
      if (url.hostname === 'scholar.google.com') {
        normalized = url.searchParams.get('user') || '';
      }
    } catch {
      normalized = normalized.replace(
        /^(?:https?:\/\/)?scholar\.google\.com\/citations\?(?:[^#]*&)?user=/i,
        '',
      );
    }
    normalized = normalized.split(/[&#]/)[0]?.toLowerCase() || '';
  }

  return normalized && !PLACEHOLDER_IDENTITIES.has(normalized) ? normalized : undefined;
}

function normalizedIdentityEntries(
  user: Phase0IdentityAuditUser,
): Array<[Phase0IdentityField, string]> {
  return PHASE0_IDENTITY_FIELDS.flatMap((field) => {
    const value = normalizePhase0IdentityValue(field, user[field]);
    return value ? [[field, value] as [Phase0IdentityField, string]] : [];
  });
}

function compareCodePoints(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareIdentityGroups(
  left: Phase0IdentityCollisionGroup,
  right: Phase0IdentityCollisionGroup,
): number {
  return (
    PHASE0_IDENTITY_FIELDS.indexOf(left.identityField) -
      PHASE0_IDENTITY_FIELDS.indexOf(right.identityField) ||
    compareCodePoints(left.identityValue, right.identityValue)
  );
}

function compareSameNameGroups(
  left: Phase0SameNameOnlyGroup,
  right: Phase0SameNameOnlyGroup,
): number {
  return compareCodePoints(left.normalizedName, right.normalizedName);
}

function collisionClassReview(
  identityCounts: Record<Phase0IdentityField, number>,
  sameNameOnlyCount: number,
  mixedNameIdentityCount: number,
): Phase0IdentityCollisionClassReview[] {
  return [
    ...PHASE0_IDENTITY_FIELDS.map(
      (field): Phase0IdentityCollisionClassReview => ({
        collisionClass: COLLISION_CLASS_BY_FIELD[field],
        count: identityCounts[field],
        reviewRequired: true,
        owner: null,
        disposition: null,
      }),
    ),
    {
      collisionClass: 'same_name_only',
      count: sameNameOnlyCount,
      reviewRequired: true,
      owner: null,
      disposition: null,
    },
    {
      collisionClass: 'same_name_mixed_identity_components',
      count: mixedNameIdentityCount,
      reviewRequired: true,
      owner: null,
      disposition: null,
    },
  ];
}

function fingerprint(salt: string, kind: string, value: string): string {
  return createHmac('sha256', salt).update(`${kind}\0${value}`).digest('hex');
}

function reviewMember(
  user: Phase0IdentityAuditUser,
  salt: string,
  strongIdentityComponent?: number,
): Phase0IdentityAuditReviewMember {
  return {
    recordId: user.id,
    recordFingerprint: fingerprint(salt, 'user-record', user.id),
    normalizedName: normalizePhase0PersonName(user),
    userConfirmed: Boolean(user.userConfirmed),
    identityFingerprints: Object.fromEntries(
      normalizedIdentityEntries(user).map(([field, value]) => [
        field,
        fingerprint(salt, `identity:${field}`, value),
      ]),
    ),
    ...(strongIdentityComponent !== undefined ? { strongIdentityComponent } : {}),
  };
}

export function buildStrongIdentityComponents(
  users: Phase0IdentityAuditUser[],
): Phase0IdentityAuditUser[][] {
  const parent = users.map((_, index) => index);
  const size = users.map(() => 1);
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
  const union = (left: number, right: number): void => {
    let leftRoot = find(left);
    let rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    if (size[leftRoot] < size[rightRoot]) {
      [leftRoot, rightRoot] = [rightRoot, leftRoot];
    }
    parent[rightRoot] = leftRoot;
    size[leftRoot] += size[rightRoot];
  };
  const identityOwner = new Map<string, number>();
  users.forEach((user, index) => {
    for (const [field, value] of normalizedIdentityEntries(user)) {
      const key = `${field}:${value}`;
      const existing = identityOwner.get(key);
      if (existing !== undefined) union(index, existing);
      else identityOwner.set(key, index);
    }
  });
  const components = new Map<number, Phase0IdentityAuditUser[]>();
  users.forEach((user, index) => {
    const root = find(index);
    const component = components.get(root);
    if (component) component.push(user);
    else components.set(root, [user]);
  });
  return Array.from(components.values())
    .map((component) => [...component].sort((left, right) => compareCodePoints(left.id, right.id)))
    .sort((left, right) => compareCodePoints(left[0]?.id || '', right[0]?.id || ''));
}

function boundedComponentReviewMembers(
  components: Phase0IdentityAuditUser[][],
  limit: number,
  salt: string,
): Phase0IdentityAuditReviewMember[] {
  const selected: Array<{ user: Phase0IdentityAuditUser; component: number }> = [];
  let memberIndex = 0;
  while (selected.length < limit) {
    let added = false;
    components.forEach((component, componentIndex) => {
      const user = component[memberIndex];
      if (user && selected.length < limit) {
        selected.push({ user, component: componentIndex + 1 });
        added = true;
      }
    });
    if (!added) break;
    memberIndex += 1;
  }
  return selected.map(({ user, component }) => reviewMember(user, salt, component));
}

export function buildPhase0IdentityCollisionAuditReport(input: {
  users: Phase0IdentityAuditUser[];
  environment: Phase0SummaryOnlyEnvironment;
  db: string;
  sourceCommit: string;
  documentLimit: number;
  groupLimit: number;
  groupMemberLimit: number;
  maxTimeMs: number;
  strict: boolean;
  possibleDocumentTruncation: boolean;
  fingerprintSalt: string;
  generatedAt?: string;
}): Phase0IdentityCollisionAuditReport {
  const identityGroups = new Map<Phase0IdentityField, Map<string, GroupAccumulator>>(
    PHASE0_IDENTITY_FIELDS.map((field) => [field, new Map()]),
  );
  const nameGroups = new Map<string, NameGroupAccumulator>();

  for (const rawUser of input.users) {
    const user: Phase0IdentityAuditUser = {
      id: String(rawUser.id),
      ...(text(rawUser.fname) ? { fname: text(rawUser.fname) } : {}),
      ...(text(rawUser.lname) ? { lname: text(rawUser.lname) } : {}),
      ...(text(rawUser.netid) ? { netid: text(rawUser.netid) } : {}),
      ...(text(rawUser.email) ? { email: text(rawUser.email) } : {}),
      ...(text(rawUser.orcid) ? { orcid: text(rawUser.orcid) } : {}),
      ...(text(rawUser.openAlexId) ? { openAlexId: text(rawUser.openAlexId) } : {}),
      ...(text(rawUser.googleScholarId) ? { googleScholarId: text(rawUser.googleScholarId) } : {}),
      ...(rawUser.userConfirmed !== undefined
        ? { userConfirmed: Boolean(rawUser.userConfirmed) }
        : {}),
      ...(rawUser.archived !== undefined ? { archived: Boolean(rawUser.archived) } : {}),
    };
    const identities = normalizedIdentityEntries(user);

    for (const [field, value] of identities) {
      const groupsForField = identityGroups.get(field);
      if (!groupsForField) continue;
      const group = groupsForField.get(value) || { count: 0, members: [] };
      group.count += 1;
      if (group.members.length < input.groupMemberLimit) group.members.push(user);
      groupsForField.set(value, group);
    }

    const normalizedName = normalizePhase0PersonName(user);
    if (!normalizedName) continue;
    const nameGroup = nameGroups.get(normalizedName) || { members: [] };
    nameGroup.members.push(user);
    nameGroups.set(normalizedName, nameGroup);
  }

  const allIdentityCollisionGroups = PHASE0_IDENTITY_FIELDS.flatMap((field) =>
    Array.from(identityGroups.get(field)?.entries() || [])
      .filter(([, group]) => group.count > 1)
      .map(
        ([identityValue, group]): Phase0IdentityCollisionGroup => ({
          identityField: field,
          identityValue,
          memberCount: group.count,
          memberDetailsTruncated: group.count > group.members.length,
          members: group.members.map((member) => reviewMember(member, input.fingerprintSalt)),
        }),
      ),
  ).sort(compareIdentityGroups);

  const nameAmbiguityGroups = Array.from(nameGroups.entries())
    .flatMap(([normalizedName, group]) => {
      if (group.members.length <= 1) return [];
      const components = buildStrongIdentityComponents(group.members);
      if (components.length <= 1) return [];
      const base = {
        normalizedName,
        strongIdentityComponentCount: components.length,
        memberCount: group.members.length,
        memberDetailsTruncated: group.members.length > input.groupMemberLimit,
        members: boundedComponentReviewMembers(
          components,
          input.groupMemberLimit,
          input.fingerprintSalt,
        ),
      };
      return [
        components.every((component) => component.length === 1)
          ? { kind: 'same-name-only' as const, group: base }
          : {
              kind: 'mixed' as const,
              group: {
                ...base,
                classification: 'same_name_mixed_identity_components' as const,
              },
            },
      ];
    })
    .sort((left, right) => compareSameNameGroups(left.group, right.group));
  const allSameNameOnlyGroups = nameAmbiguityGroups
    .filter((item) => item.kind === 'same-name-only')
    .map((item) => item.group);
  const allMixedNameIdentityGroups = nameAmbiguityGroups
    .filter((item) => item.kind === 'mixed')
    .map((item) => item.group);

  const identityCollisionGroups = PHASE0_IDENTITY_FIELDS.flatMap((field) =>
    allIdentityCollisionGroups
      .filter((group) => group.identityField === field)
      .slice(0, input.groupLimit),
  );
  const sameNameOnlyGroups = allSameNameOnlyGroups.slice(0, input.groupLimit);
  const mixedNameIdentityGroups = allMixedNameIdentityGroups.slice(0, input.groupLimit);
  const identityCollisionGroupsByField = Object.fromEntries(
    PHASE0_IDENTITY_FIELDS.map((field) => [
      field,
      allIdentityCollisionGroups.filter((group) => group.identityField === field).length,
    ]),
  ) as Record<Phase0IdentityField, number>;
  const possibleIdentityGroupTruncation = PHASE0_IDENTITY_FIELDS.some(
    (field) => identityCollisionGroupsByField[field] > input.groupLimit,
  );
  const possibleSameNameGroupTruncation =
    allSameNameOnlyGroups.length > input.groupLimit ||
    allMixedNameIdentityGroups.length > input.groupLimit;
  const possibleGroupMemberTruncation = [
    ...allIdentityCollisionGroups,
    ...allSameNameOnlyGroups,
    ...allMixedNameIdentityGroups,
  ].some((group) => group.memberDetailsTruncated);
  const bounded =
    input.possibleDocumentTruncation ||
    possibleIdentityGroupTruncation ||
    possibleSameNameGroupTruncation ||
    possibleGroupMemberTruncation;

  return {
    generatedAt: input.generatedAt || new Date().toISOString(),
    environment: input.environment,
    db: input.db,
    sourceCommit: input.sourceCommit,
    mode: 'read-only',
    summary: {
      documentsScanned: input.users.length,
      identityCollisionGroupsByField,
      sameNameOnlyGroups: allSameNameOnlyGroups.length,
      mixedNameIdentityGroups: allMixedNameIdentityGroups.length,
    },
    scan: {
      documentLimit: input.documentLimit,
      groupLimitPerClass: input.groupLimit,
      groupMemberLimit: input.groupMemberLimit,
      maxTimeMs: input.maxTimeMs,
      strict: input.strict,
      readConcern: 'snapshot',
      readPreference: 'secondaryPreferred',
      possibleDocumentTruncation: input.possibleDocumentTruncation,
      possibleIdentityGroupTruncation,
      possibleSameNameGroupTruncation,
      possibleGroupMemberTruncation,
      countSemantics: bounded ? 'bounded-lower-bound' : 'complete-within-document-scan',
    },
    collisionClassReview: collisionClassReview(
      identityCollisionGroupsByField,
      allSameNameOnlyGroups.length,
      allMixedNameIdentityGroups.length,
    ),
    identityCollisionGroups,
    sameNameOnlyGroups,
    mixedNameIdentityGroups,
  };
}
