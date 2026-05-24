import type { DuplicatePersonGroup } from '../scrapers/integrityGate';

export type UserIdentityField = DuplicatePersonGroup['identityField'];

export interface DedupeUsersByIdentityArgs {
  apply: boolean;
  limit: number;
  identityField?: UserIdentityField;
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
  reason: 'identity-shared-by-different-names';
  normalizedNames: string[];
  userIds: string[];
}

export interface UserIdentityDedupePlan {
  candidateGroups: number;
  groups: PlannedUserIdentityDedupeGroup[];
  duplicateUsers: number;
  warningGroups: UserIdentityDedupeWarningGroup[];
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

export function parseDedupeUsersByIdentityArgs(argv: string[]): DedupeUsersByIdentityArgs {
  let apply = false;
  let limit = 100;
  let identityField: UserIdentityField | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--dry-run') {
      apply = false;
      continue;
    }

    const limitValue = valueAfterEquals(arg, '--limit') || (arg === '--limit' ? argv[++index] : '');
    if (limitValue) {
      const parsed = Number(limitValue);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error('--limit must be a positive integer');
      }
      limit = parsed;
      continue;
    }

    const fieldValue =
      valueAfterEquals(arg, '--identity-field') ||
      (arg === '--identity-field' ? argv[++index] : '');
    if (fieldValue) {
      if (!IDENTITY_FIELDS.includes(fieldValue as UserIdentityField)) {
        throw new Error(`--identity-field must be one of: ${IDENTITY_FIELDS.join(', ')}`);
      }
      identityField = fieldValue as UserIdentityField;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return identityField ? { apply, limit, identityField } : { apply, limit };
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
        userIds: collision.users.map((user) => user.id).filter(Boolean),
      });
    }

    for (const { normalizedName, users } of byName) {
      if (users.length <= 1) continue;
      const canonical = chooseCanonicalUser(users);
      groups.push({
        identityField: collision.identityField,
        identityValue: collision.identityValue,
        canonicalUserId: canonical.id,
        duplicateUserIds: users
          .map((user) => user.id)
          .filter((userId) => userId && userId !== canonical.id),
        normalizedName,
      });
    }
  }

  return {
    candidateGroups: collisions.length,
    groups: groups.filter((group) => group.duplicateUserIds.length > 0),
    duplicateUsers: groups.reduce((count, group) => count + group.duplicateUserIds.length, 0),
    warningGroups,
  };
}
