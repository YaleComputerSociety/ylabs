import { isLikelyPersonSpecificYaleEmail } from '../scrapers/utils/scraperHelpers';

export interface RepairMismatchedPersonEmailsArgs {
  apply: boolean;
  confirmMismatchedEmailRepair: boolean;
  limit: number;
  limitProvided: boolean;
  maxApply?: number;
  output?: string;
}

export interface MismatchedPersonEmailInputUser {
  id: string;
  netid?: string;
  fname?: string;
  lname?: string;
  email?: string;
  orcid?: string;
  profileUrls?: Record<string, string>;
}

export interface MismatchedPersonEmailRepairPlan {
  userId: string;
  name: string;
  netid: string;
  currentEmail: string;
  repairEmail: string;
  reason: 'email-does-not-match-person-name';
}

export interface MismatchedExternalIdentityRepairPlan {
  userId: string;
  name: string;
  identityField: 'orcid';
  identityValue: string;
  clearOrcid: boolean;
  removeProfileUrlKeys: string[];
  canonicalUserIds: string[];
  reason: 'orcid-shared-by-different-name-with-official-profile-owner';
}

export interface MismatchedPersonEmailSkippedPlan {
  userId: string;
  name: string;
  netid?: string;
  currentEmail: string;
  reason: 'missing-real-netid' | 'repair-email-already-used';
}

export interface MismatchedPersonEmailPlanSummary {
  candidateUsers: number;
  repairableUsers: number;
  skippedUsers: number;
  repairs: MismatchedPersonEmailRepairPlan[];
  externalIdentityRepairs: MismatchedExternalIdentityRepairPlan[];
  skipped: MismatchedPersonEmailSkippedPlan[];
}

function valueAfterEquals(arg: string, flag: string): string | undefined {
  return arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : undefined;
}

function consumeValue(argv: string[], index: number, flag: string): { value: string; nextIndex: number } {
  const inline = valueAfterEquals(argv[index], flag);
  const value = inline !== undefined ? inline : argv[index] === flag ? argv[index + 1] : undefined;
  if (value === undefined || value.trim() === '' || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return { value, nextIndex: inline !== undefined ? index : index + 1 };
}

function parsePositiveInteger(value: string, flag: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

export function parseRepairMismatchedPersonEmailsArgs(
  argv: string[],
): RepairMismatchedPersonEmailsArgs {
  let apply = false;
  let confirmMismatchedEmailRepair = false;
  let limit = 100;
  let limitProvided = false;
  let maxApply: number | undefined;
  let output: string | undefined;

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
    if (arg === '--confirm-mismatched-email-repair') {
      confirmMismatchedEmailRepair = true;
      continue;
    }
    if (arg.startsWith('--confirm-mismatched-email-repair=')) {
      throw new Error('--confirm-mismatched-email-repair does not accept a value');
    }
    if (arg === '--limit' || arg.startsWith('--limit=')) {
      const { value, nextIndex } = consumeValue(argv, index, '--limit');
      limit = parsePositiveInteger(value, '--limit');
      limitProvided = true;
      index = nextIndex;
      continue;
    }
    if (arg === '--max-apply' || arg.startsWith('--max-apply=')) {
      const { value, nextIndex } = consumeValue(argv, index, '--max-apply');
      maxApply = parsePositiveInteger(value, '--max-apply');
      index = nextIndex;
      continue;
    }
    if (arg === '--output' || arg.startsWith('--output=')) {
      const { value, nextIndex } = consumeValue(argv, index, '--output');
      output = value;
      index = nextIndex;
      continue;
    }
    throw new Error(`Unknown users:repair-mismatched-emails option: ${arg}`);
  }

  return {
    apply,
    confirmMismatchedEmailRepair,
    limit,
    limitProvided,
    ...(maxApply ? { maxApply } : {}),
    ...(output ? { output } : {}),
  };
}

function isRealNetid(value?: string): boolean {
  return /^[a-z]{2,6}\d{1,5}$/i.test(String(value || '').trim());
}

function normalizedEmail(value?: string): string {
  return String(value || '').trim().toLowerCase();
}

function displayName(user: MismatchedPersonEmailInputUser): string {
  return [user.fname, user.lname].filter(Boolean).join(' ').trim();
}

function normalizedName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameTokens(value: string): string[] {
  return normalizedName(value)
    .split(/\s+/)
    .filter(Boolean);
}

function personProfileUrlMatchesName(url: string | undefined, name: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'yale.edu' && !host.endsWith('.yale.edu')) return false;
    if (!/\/(?:profile|people|faculty|directory)\//i.test(parsed.pathname)) return false;
    const tokens = nameTokens(name);
    if (tokens.length < 2) return false;
    const pathTokens = new Set(nameTokens(decodeURIComponent(parsed.pathname)));
    const firstName = tokens[0];
    const lastName = tokens[tokens.length - 1];
    return pathTokens.has(lastName) && (pathTokens.has(firstName) || pathTokens.has(firstName[0]));
  } catch {
    return false;
  }
}

function isOrcidProfileUrl(url: string | undefined, orcid: string): boolean {
  try {
    const parsed = new URL(url || '');
    return parsed.hostname.toLowerCase() === 'orcid.org' && parsed.pathname.includes(orcid);
  } catch {
    return false;
  }
}

function buildMismatchedExternalIdentityRepairs(
  users: MismatchedPersonEmailInputUser[],
): MismatchedExternalIdentityRepairPlan[] {
  const usersByOrcid = new Map<string, MismatchedPersonEmailInputUser[]>();
  for (const user of users) {
    const orcid = String(user.orcid || '').trim();
    if (!orcid) continue;
    usersByOrcid.set(orcid, [...(usersByOrcid.get(orcid) || []), user]);
  }

  const repairs: MismatchedExternalIdentityRepairPlan[] = [];
  for (const [orcid, collisionUsers] of usersByOrcid) {
    if (collisionUsers.length <= 1) continue;
    const normalizedNames = new Set(collisionUsers.map((user) => normalizedName(displayName(user))));
    if (normalizedNames.size <= 1) continue;

    const officialProfileOwners = collisionUsers.filter((user) =>
      Object.entries(user.profileUrls || {}).some(
        ([key, url]) =>
          key !== 'orcid' && personProfileUrlMatchesName(String(url || ''), displayName(user)),
      ),
    );
    if (officialProfileOwners.length === 0) continue;

    const canonicalUserIds = officialProfileOwners.map((user) => user.id).sort();
    for (const user of collisionUsers) {
      if (canonicalUserIds.includes(user.id)) continue;
      const profileEntries = Object.entries(user.profileUrls || {});
      const removeProfileUrlKeys = profileEntries
        .filter(([key, url]) => {
          const value = String(url || '');
          if (isOrcidProfileUrl(value, orcid)) return true;
          if (/\/(?:profile|people|faculty|directory)\//i.test(value)) {
            return !personProfileUrlMatchesName(value, displayName(user));
          }
          return key === 'orcid';
        })
        .map(([key]) => key)
        .sort();

      if (!removeProfileUrlKeys.length && !user.orcid) continue;

      repairs.push({
        userId: user.id,
        name: displayName(user),
        identityField: 'orcid',
        identityValue: orcid,
        clearOrcid: true,
        removeProfileUrlKeys,
        canonicalUserIds,
        reason: 'orcid-shared-by-different-name-with-official-profile-owner',
      });
    }
  }

  return repairs.sort(
    (a, b) =>
      a.identityValue.localeCompare(b.identityValue) ||
      a.name.localeCompare(b.name) ||
      a.userId.localeCompare(b.userId),
  );
}

export function buildMismatchedPersonEmailRepairPlan(input: {
  users: MismatchedPersonEmailInputUser[];
  activeEmailsByUserId: Map<string, string>;
}): MismatchedPersonEmailPlanSummary {
  const activeEmailOwners = new Map<string, Set<string>>();
  for (const [userId, email] of input.activeEmailsByUserId) {
    const cleaned = normalizedEmail(email);
    if (!cleaned) continue;
    activeEmailOwners.set(cleaned, new Set([...(activeEmailOwners.get(cleaned) || []), userId]));
  }

  const repairs: MismatchedPersonEmailRepairPlan[] = [];
  const skipped: MismatchedPersonEmailSkippedPlan[] = [];

  for (const user of input.users) {
    const currentEmail = normalizedEmail(user.email);
    const name = displayName(user);
    if (!currentEmail || isLikelyPersonSpecificYaleEmail(currentEmail, name)) continue;

    const currentEmailOwners = activeEmailOwners.get(currentEmail) || new Set<string>();
    if (currentEmailOwners.size <= 1) continue;

    const netid = String(user.netid || '').trim().toLowerCase();
    if (!isRealNetid(netid)) {
      skipped.push({
        userId: user.id,
        name,
        ...(netid ? { netid } : {}),
        currentEmail,
        reason: 'missing-real-netid',
      });
      continue;
    }

    const repairEmail = `${netid}@yale.edu`;
    const owners = activeEmailOwners.get(repairEmail) || new Set<string>();
    if ([...owners].some((ownerId) => ownerId !== user.id)) {
      skipped.push({
        userId: user.id,
        name,
        netid,
        currentEmail,
        reason: 'repair-email-already-used',
      });
      continue;
    }

    repairs.push({
      userId: user.id,
      name,
      netid,
      currentEmail,
      repairEmail,
      reason: 'email-does-not-match-person-name',
    });
  }

  const externalIdentityRepairs = buildMismatchedExternalIdentityRepairs(input.users);

  return {
    candidateUsers: repairs.length + externalIdentityRepairs.length + skipped.length,
    repairableUsers: repairs.length + externalIdentityRepairs.length,
    skippedUsers: skipped.length,
    repairs,
    externalIdentityRepairs,
    skipped,
  };
}
