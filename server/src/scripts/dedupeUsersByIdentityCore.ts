import type { DuplicatePersonGroup } from '../scrapers/integrityGate';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

export type UserIdentityField = DuplicatePersonGroup['identityField'];

export interface DedupeUsersByIdentityArgs {
  apply: boolean;
  confirmUserIdentityDedupe: boolean;
  limit: number;
  limitProvided: boolean;
  identityField?: UserIdentityField;
  output?: string;
  sampleSize: number;
  maxApplyGroups?: number;
}

export interface UserIdentityDedupeUser {
  id: string;
  netid?: string;
  email?: string;
  fname?: string;
  lname?: string;
  userConfirmed?: boolean;
  lastLogin?: Date | string | null;
  lastLoginAt?: Date | string | null;
  lastActive?: Date | string | null;
  loginCount?: number;
  departments?: string[];
  primaryDepartment?: string;
  orcid?: string;
  openAlexId?: string;
  googleScholarId?: string;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface UserIdentityCollision {
  identityField: UserIdentityField;
  identityValue: string;
  users: UserIdentityDedupeUser[];
}

export interface PlannedUserIdentityDedupeGroup {
  identityField: UserIdentityField;
  identityValue: string;
  canonicalUserId: string;
  duplicateUserIds: string[];
  normalizedName: string;
}

export interface UserIdentityDedupeWarningGroup {
  identityField: UserIdentityField;
  identityValue: string;
  reason: 'identity-shared-by-different-names' | 'email-not-person-specific';
  normalizedNames: string[];
  userIds: string[];
}

export interface UserIdentityDedupePlan {
  candidateGroups: number;
  groups: PlannedUserIdentityDedupeGroup[];
  duplicateUsers: number;
  warningGroups: UserIdentityDedupeWarningGroup[];
}

export interface UserIdentityDedupeSummary {
  mode: 'apply' | 'dry-run';
  candidateGroups: number;
  plannedGroups: number;
  duplicateUsers: number;
  warningGroups: number;
  plan: PlannedUserIdentityDedupeGroup[];
  warnings: UserIdentityDedupeWarningGroup[];
  applied: Record<string, unknown>[];
}

const IDENTITY_FIELDS: UserIdentityField[] = [
  'netid',
  'email',
  'orcid',
  'openAlexId',
  'googleScholarId',
];

function valueAfterEquals(arg: string, flag: string): string | undefined {
  return arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : undefined;
}

function consumeValue(argv: string[], index: number, flag: string): { value: string; nextIndex: number } {
  const arg = argv[index];
  const inline = valueAfterEquals(arg, flag);
  const value = inline !== undefined ? inline : arg === flag ? argv[index + 1] : undefined;
  if (value === undefined || value.trim() === '' || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return { value, nextIndex: inline !== undefined ? index : index + 1 };
}

export function parseDedupeUsersByIdentityArgs(argv: string[]): DedupeUsersByIdentityArgs {
  let apply = false;
  let confirmUserIdentityDedupe = false;
  let limit = 100;
  let limitProvided = false;
  let identityField: UserIdentityField | undefined;
  let output: string | undefined;
  let sampleSize = 25;
  let maxApplyGroups: number | undefined;

  const parsePositiveInteger = (value: string, flag: string): number => {
    if (!/^[1-9]\d*$/.test(value)) {
      throw new Error(`${flag} must be a positive integer`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      throw new Error(`${flag} must be a positive integer`);
    }
    return parsed;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--confirm-user-identity-dedupe') {
      confirmUserIdentityDedupe = true;
      continue;
    }
    if (arg.startsWith('--confirm-user-identity-dedupe=')) {
      throw new Error('--confirm-user-identity-dedupe does not accept a value');
    }
    if (arg === '--dry-run') {
      apply = false;
      continue;
    }

    if (arg === '--limit' || arg.startsWith('--limit=')) {
      const { value: limitValue, nextIndex } = consumeValue(argv, index, '--limit');
      limit = parsePositiveInteger(limitValue, '--limit');
      limitProvided = true;
      index = nextIndex;
      continue;
    }

    if (arg === '--identity-field' || arg.startsWith('--identity-field=')) {
      const { value: fieldValue, nextIndex } = consumeValue(argv, index, '--identity-field');
      if (!IDENTITY_FIELDS.includes(fieldValue as UserIdentityField)) {
        throw new Error(`--identity-field must be one of: ${IDENTITY_FIELDS.join(', ')}`);
      }
      identityField = fieldValue as UserIdentityField;
      index = nextIndex;
      continue;
    }

    if (arg === '--output' || arg.startsWith('--output=')) {
      const { value: outputValue, nextIndex } = consumeValue(argv, index, '--output');
      output = resolveSafeJsonReportOutputPath(outputValue);
      index = nextIndex;
      continue;
    }

    if (arg === '--sample-size' || arg.startsWith('--sample-size=')) {
      const { value: sampleSizeValue, nextIndex } = consumeValue(argv, index, '--sample-size');
      sampleSize = parsePositiveInteger(sampleSizeValue, '--sample-size');
      index = nextIndex;
      continue;
    }

    if (arg === '--max-apply-groups' || arg.startsWith('--max-apply-groups=')) {
      const { value: maxApplyGroupsValue, nextIndex } = consumeValue(
        argv,
        index,
        '--max-apply-groups',
      );
      maxApplyGroups = parsePositiveInteger(maxApplyGroupsValue, '--max-apply-groups');
      index = nextIndex;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    apply,
    confirmUserIdentityDedupe,
    limit,
    limitProvided,
    ...(identityField ? { identityField } : {}),
    ...(output ? { output } : {}),
    sampleSize,
    ...(maxApplyGroups ? { maxApplyGroups } : {}),
  };
}

function timeValue(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function isRealNetid(value?: string): boolean {
  return /^[a-z]{2,6}\d{1,5}$/i.test((value || '').trim());
}

function hasExternalIdentity(user: UserIdentityDedupeUser): boolean {
  return Boolean(user.orcid || user.openAlexId || user.googleScholarId);
}

function isExternalIdentityField(field: UserIdentityField): boolean {
  return field === 'orcid' || field === 'openAlexId' || field === 'googleScholarId';
}

function canonicalScore(user: UserIdentityDedupeUser): number {
  return (
    Number(Boolean(user.userConfirmed)) * 1000 +
    Number(isRealNetid(user.netid)) * 500 +
    Number(hasExternalIdentity(user)) * 120 +
    (user.departments?.length || 0) * 10 +
    Number(Boolean(user.primaryDepartment)) * 10 +
    (Number(user.loginCount) || 0) * 3 +
    Math.min(timeValue(user.lastLoginAt || user.lastLogin || user.lastActive) / 1_000_000_000, 50) +
    Math.min(timeValue(user.updatedAt) / 1_000_000_000_000, 5)
  );
}

export function chooseCanonicalUser(users: UserIdentityDedupeUser[]): UserIdentityDedupeUser {
  const sorted = [...users].sort((a, b) => {
    const byScore = canonicalScore(b) - canonicalScore(a);
    if (byScore !== 0) return byScore;
    const byCreated = timeValue(a.createdAt) - timeValue(b.createdAt);
    if (byCreated !== 0) return byCreated;
    return a.id.localeCompare(b.id);
  });
  return sorted[0];
}

export function normalizePersonName(user: Pick<UserIdentityDedupeUser, 'fname' | 'lname'>): string {
  return `${user.fname || ''} ${user.lname || ''}`
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function nameTokens(user: Pick<UserIdentityDedupeUser, 'fname' | 'lname'>): string[] {
  return normalizePersonName(user)
    .split(/\s+/)
    .filter((token) => token && !/^\d{4}$/.test(token));
}

function givenNameCompatible(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length === 1 && b.startsWith(a)) return true;
  if (b.length === 1 && a.startsWith(b)) return true;
  return a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a));
}

function samePersonNameVariant(
  a: Pick<UserIdentityDedupeUser, 'fname' | 'lname'>,
  b: Pick<UserIdentityDedupeUser, 'fname' | 'lname'>,
): boolean {
  const aTokens = nameTokens(a);
  const bTokens = nameTokens(b);
  const aLast = aTokens.at(-1);
  const bLast = bTokens.at(-1);
  if (!aLast || !bLast || aLast !== bLast) return false;

  const aGiven = aTokens.slice(0, -1);
  const bGiven = bTokens.slice(0, -1);
  if (aGiven.length === 0 || bGiven.length === 0) return false;

  return aGiven.some((left) => bGiven.some((right) => givenNameCompatible(left, right)));
}

function emailTokens(identityValue: string): string[] {
  const localPart = identityValue.split('@')[0] || '';
  return localPart
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.toLowerCase())
    .filter((token) => token && !/^\d+$/.test(token));
}

function emailLooksPersonSpecific(identityValue: string, normalizedName: string): boolean {
  const tokens = emailTokens(identityValue);
  const nameTokens = normalizedName.split(/\s+/).filter(Boolean);
  const lastName = nameTokens.at(-1) || '';
  const givenNames = nameTokens.slice(0, -1);
  if (!tokens.length || !lastName || givenNames.length === 0) return false;

  const tokenText = tokens.join(' ');
  const compactTokenText = tokens.join('');
  const reversedCompact = [lastName, ...givenNames].join('');
  const normalCompact = [...givenNames, lastName].join('');

  if (compactTokenText.includes(normalCompact) || compactTokenText.includes(reversedCompact)) {
    return true;
  }

  if (!tokens.some((token) => token === lastName || token.includes(lastName))) return false;

  return givenNames.some((given) =>
    tokens.some(
      (token) =>
        token === given ||
        token.startsWith(given) ||
        given.startsWith(token) ||
        (token.length === 1 && given.startsWith(token)),
    ),
  );
}

function clusterUsersByCompatibleName(users: UserIdentityDedupeUser[]): Array<{
  normalizedName: string;
  users: UserIdentityDedupeUser[];
}> {
  const validUsers = users.filter((user) => user.id && normalizePersonName(user));
  const parent = new Map<string, string>();
  for (const user of validUsers) parent.set(user.id, user.id);

  const find = (id: string): string => {
    const current = parent.get(id) || id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };

  for (let i = 0; i < validUsers.length; i += 1) {
    for (let j = i + 1; j < validUsers.length; j += 1) {
      if (samePersonNameVariant(validUsers[i], validUsers[j])) {
        union(validUsers[i].id, validUsers[j].id);
      }
    }
  }

  const clusters = new Map<string, UserIdentityDedupeUser[]>();
  for (const user of validUsers) {
    const root = find(user.id);
    clusters.set(root, [...(clusters.get(root) || []), user]);
  }

  return Array.from(clusters.values()).map((cluster) => {
    const normalizedName = cluster
      .map((user) => normalizePersonName(user))
      .sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
    return { normalizedName, users: cluster };
  });
}

export function buildUserIdentityDedupePlan(
  collisions: UserIdentityCollision[],
): UserIdentityDedupePlan {
  const groups: PlannedUserIdentityDedupeGroup[] = [];
  const warningGroups: UserIdentityDedupeWarningGroup[] = [];

  for (const collision of collisions) {
    const byName = clusterUsersByCompatibleName(collision.users);

    if (byName.length > 1) {
      warningGroups.push({
        identityField: collision.identityField,
        identityValue: collision.identityValue,
        reason: 'identity-shared-by-different-names',
        normalizedNames: byName.map((group) => group.normalizedName).sort(),
        userIds: collision.users
          .map((user) => user.id)
          .filter(Boolean)
          .sort(),
      });

      if (isExternalIdentityField(collision.identityField)) continue;
    }

    for (const { normalizedName, users } of byName) {
      if (users.length <= 1) continue;
      if (
        collision.identityField === 'email' &&
        !emailLooksPersonSpecific(collision.identityValue, normalizedName)
      ) {
        warningGroups.push({
          identityField: collision.identityField,
          identityValue: collision.identityValue,
          reason: 'email-not-person-specific',
          normalizedNames: [normalizedName],
          userIds: users
            .map((user) => user.id)
            .filter(Boolean)
            .sort(),
        });
        continue;
      }
      const canonical = chooseCanonicalUser(users);
      groups.push({
        identityField: collision.identityField,
        identityValue: collision.identityValue,
        canonicalUserId: canonical.id,
        duplicateUserIds: users
          .map((user) => user.id)
          .filter((userId) => userId && userId !== canonical.id)
          .sort(),
        normalizedName,
      });
    }
  }

  const plannedGroups = groups
    .filter((group) => group.duplicateUserIds.length > 0)
    .sort(comparePlannedGroups);
  const sortedWarnings = warningGroups.sort(compareWarningGroups);

  return {
    candidateGroups: collisions.length,
    groups: plannedGroups,
    duplicateUsers: plannedGroups.reduce((count, group) => count + group.duplicateUserIds.length, 0),
    warningGroups: sortedWarnings,
  };
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

function comparePlannedGroups(
  a: PlannedUserIdentityDedupeGroup,
  b: PlannedUserIdentityDedupeGroup,
): number {
  return (
    compareStrings(a.identityField, b.identityField) ||
    compareStrings(a.identityValue, b.identityValue) ||
    compareStrings(a.normalizedName, b.normalizedName) ||
    compareStrings(a.canonicalUserId, b.canonicalUserId) ||
    compareStrings(a.duplicateUserIds.join('\0'), b.duplicateUserIds.join('\0'))
  );
}

function compareWarningGroups(
  a: UserIdentityDedupeWarningGroup,
  b: UserIdentityDedupeWarningGroup,
): number {
  return (
    compareStrings(a.identityField, b.identityField) ||
    compareStrings(a.identityValue, b.identityValue) ||
    compareStrings(a.normalizedNames.join('\0'), b.normalizedNames.join('\0')) ||
    compareStrings(a.userIds.join('\0'), b.userIds.join('\0'))
  );
}

export function uniquePlannedUserIdentityDedupeGroups(
  groups: PlannedUserIdentityDedupeGroup[],
): PlannedUserIdentityDedupeGroup[] {
  const seenUserIds = new Set<string>();
  return [...groups].sort(comparePlannedGroups).filter((group) => {
    const groupUserIds = [group.canonicalUserId, ...group.duplicateUserIds];
    if (groupUserIds.some((userId) => seenUserIds.has(userId))) return false;
    groupUserIds.forEach((userId) => seenUserIds.add(userId));
    return true;
  });
}

export function buildUserIdentityDedupeSummary(input: {
  apply: boolean;
  plan: UserIdentityDedupePlan;
  sampleSize: number;
  maxApplyGroups?: number;
  applied: Record<string, unknown>[];
}): UserIdentityDedupeSummary {
  const uniqueGroups = uniquePlannedUserIdentityDedupeGroups(input.plan.groups);
  const plannedGroups = input.maxApplyGroups
    ? uniqueGroups.slice(0, input.maxApplyGroups)
    : uniqueGroups;
  const warnings = [...input.plan.warningGroups].sort(compareWarningGroups);

  return {
    mode: input.apply ? 'apply' : 'dry-run',
    candidateGroups: input.plan.candidateGroups,
    plannedGroups: plannedGroups.length,
    duplicateUsers: plannedGroups.reduce((count, group) => count + group.duplicateUserIds.length, 0),
    warningGroups: warnings.length,
    plan: plannedGroups.slice(0, input.sampleSize),
    warnings: warnings.slice(0, input.sampleSize),
    applied: input.applied,
  };
}
