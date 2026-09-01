import type { DuplicatePersonGroup } from '../scrapers/integrityGate';

export type UserIdentityField = DuplicatePersonGroup['identityField'];

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

export function samePersonNameVariant(
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

export function emailLooksPersonSpecific(identityValue: string, normalizedName: string): boolean {
  const tokens = emailTokens(identityValue);
  const nameTokens = normalizedName.split(/\s+/).filter(Boolean);
  const lastName = nameTokens.at(-1) || '';
  const givenNames = nameTokens.slice(0, -1);
  if (!tokens.length || !lastName || givenNames.length === 0) return false;

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
