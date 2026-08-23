import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

export interface RepairFusedIdentityArtifactsArgs {
  apply: boolean;
  confirmFusedIdentityArchive: boolean;
  limit: number;
  limitProvided: boolean;
  maxApply?: number;
  output?: string;
}

export interface FusedIdentityArtifactInputUser {
  id: string;
  netid?: string;
  fname?: string;
  lname?: string;
  email?: string;
}

export interface FusedIdentityArchivePlan {
  userId: string;
  name: string;
  netid: string;
  email: string;
  canonicalUserId: string;
  reason: 'fused-identity-conflation';
}

export interface FusedIdentitySkippedPlan {
  userId: string;
  name: string;
  netid: string;
  email: string;
  reason: 'no-canonical-email-owner' | 'login-capable-account-present';
}

export interface FusedIdentityArtifactPlanSummary {
  candidateUsers: number;
  archivableUsers: number;
  skippedUsers: number;
  archives: FusedIdentityArchivePlan[];
  skipped: FusedIdentitySkippedPlan[];
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

export function parseRepairFusedIdentityArtifactsArgs(
  argv: string[],
): RepairFusedIdentityArtifactsArgs {
  let apply = false;
  let confirmFusedIdentityArchive = false;
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
    if (arg === '--confirm-fused-identity-archive') {
      confirmFusedIdentityArchive = true;
      continue;
    }
    if (arg.startsWith('--confirm-fused-identity-archive=')) {
      throw new Error('--confirm-fused-identity-archive does not accept a value');
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
      output = resolveSafeJsonReportOutputPath(value);
      index = nextIndex;
      continue;
    }
    throw new Error(`Unknown users:repair-fused-identity-artifacts option: ${arg}`);
  }

  return {
    apply,
    confirmFusedIdentityArchive,
    limit,
    limitProvided,
    ...(maxApply ? { maxApply } : {}),
    ...(output ? { output } : {}),
  };
}

function normalizedEmail(value?: string): string {
  return String(value || '').trim().toLowerCase();
}

function displayName(user: FusedIdentityArtifactInputUser): string {
  return [user.fname, user.lname].filter(Boolean).join(' ').trim();
}

function identityTokens(value?: string): string[] {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function isFusedNetid(netid?: string): boolean {
  return /^[a-z]+(?:\.[a-z]+)+\.[a-z]{2,6}\d{1,5}$/i.test(String(netid || '').trim());
}

function emailLocalPart(email: string): string {
  return email.split('@')[0] || '';
}

function netidSharesEmailIdentity(netid: string, email: string): boolean {
  const netidTokenSet = new Set(identityTokens(netid));
  return identityTokens(emailLocalPart(email)).some((token) => netidTokenSet.has(token));
}

export function buildFusedIdentityArtifactPlan(input: {
  users: FusedIdentityArtifactInputUser[];
  activeEmailsByUserId: Map<string, string>;
  netidsWithLoginAccounts: Set<string>;
}): FusedIdentityArtifactPlanSummary {
  const emailOwnerIds = new Map<string, string[]>();
  for (const [userId, email] of input.activeEmailsByUserId) {
    const cleaned = normalizedEmail(email);
    if (!cleaned) continue;
    emailOwnerIds.set(cleaned, [...(emailOwnerIds.get(cleaned) || []), userId]);
  }

  const usersById = new Map(input.users.map((user) => [user.id, user]));
  const archives: FusedIdentityArchivePlan[] = [];
  const skipped: FusedIdentitySkippedPlan[] = [];

  for (const user of input.users) {
    const netid = String(user.netid || '').trim().toLowerCase();
    const email = normalizedEmail(user.email);
    if (!isFusedNetid(netid)) continue;
    if (!/@yale\.edu$/.test(email)) continue;
    if (netidSharesEmailIdentity(netid, email)) continue;

    const name = displayName(user);
    if (input.netidsWithLoginAccounts.has(netid)) {
      skipped.push({ userId: user.id, name, netid, email, reason: 'login-capable-account-present' });
      continue;
    }

    const otherOwnerIds = (emailOwnerIds.get(email) || []).filter((id) => id !== user.id);
    if (otherOwnerIds.length === 0) {
      skipped.push({ userId: user.id, name, netid, email, reason: 'no-canonical-email-owner' });
      continue;
    }

    const canonicalUserId = [...otherOwnerIds].sort((a, b) => {
      const aMatches = netidSharesEmailIdentity(String(usersById.get(a)?.netid || ''), email) ? 0 : 1;
      const bMatches = netidSharesEmailIdentity(String(usersById.get(b)?.netid || ''), email) ? 0 : 1;
      return aMatches - bMatches || a.localeCompare(b);
    })[0];

    archives.push({
      userId: user.id,
      name,
      netid,
      email,
      canonicalUserId,
      reason: 'fused-identity-conflation',
    });
  }

  archives.sort((a, b) => a.email.localeCompare(b.email) || a.userId.localeCompare(b.userId));
  skipped.sort((a, b) => a.email.localeCompare(b.email) || a.userId.localeCompare(b.userId));

  return {
    candidateUsers: archives.length + skipped.length,
    archivableUsers: archives.length,
    skippedUsers: skipped.length,
    archives,
    skipped,
  };
}
