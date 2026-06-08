import { isInvalidOptionalEmail } from './betaDataQualityCore';

export const SUSPICIOUS_USER_EMAIL_PATTERN =
  /(^test(?:\d+|[+@.])|@example\.|placeholder|unknown|invalid|dummy|no-?reply|^none@|^na@)/i;

export interface UserEmailHygieneArgs {
  apply: boolean;
  limit: number;
  sampleSize: number;
  output?: string;
}

export interface UserEmailHygieneInputUser {
  id?: string;
  netid?: string;
  fname?: string;
  lname?: string;
  email?: string;
}

export interface UserEmailHygieneSample {
  id: string;
  netid?: string;
  name: string;
  email: string;
  reason: string;
  productionCopyExcludedByDefault: boolean;
  productionCopyDisposition:
    | 'excluded_from_lane_a_users_copy'
    | 'review_before_lane_a_copy';
  recommendedDisposition: string;
}

export interface UserEmailHygieneProductionCopyExclusion {
  lane: 'Lane A accepted Beta copy';
  strategy: string;
  sampledExcludedByDefault: number;
  sampledNeedsReviewBeforeCopy: number;
  sampledCoverageComplete: boolean;
  nextAction: string;
}

export interface UserEmailHygieneSummary {
  mode: 'dry-run';
  suspiciousUserEmailCount: number;
  sampledUsers: number;
  promotionReady: boolean;
  applyBlocked: boolean;
  productionCopyExclusion: UserEmailHygieneProductionCopyExclusion;
  nextAction: string;
  samples: UserEmailHygieneSample[];
}

function consumeValue(
  argv: string[],
  index: number,
  flag: string,
  noun: 'number' | 'path',
): { value: string; nextIndex: number } {
  const value = argv[index + 1];
  if (value === undefined || value.trim() === '' || value.startsWith('--')) {
    throw new Error(`${flag} requires a ${noun}`);
  }
  return { value, nextIndex: index + 1 };
}

function consumeInlineValue(arg: string, flag: string, noun: 'number' | 'path'): string {
  const value = arg.slice(`${flag}=`.length);
  if (value.trim() === '' || value.startsWith('--')) {
    throw new Error(`${flag} requires a ${noun}`);
  }
  return value;
}

export function parseUserEmailHygieneArgs(argv: string[]): UserEmailHygieneArgs {
  const args: UserEmailHygieneArgs = {
    apply: false,
    limit: 1000,
    sampleSize: 25,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--apply') {
      args.apply = true;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      args.limit = parsePositiveIntegerValue(consumeInlineValue(arg, '--limit', 'number'), '--limit');
      continue;
    }
    if (arg === '--limit') {
      const { value, nextIndex } = consumeValue(argv, index, '--limit', 'number');
      args.limit = parsePositiveIntegerValue(value, '--limit');
      index = nextIndex;
      continue;
    }
    if (arg.startsWith('--sample-size=')) {
      args.sampleSize = parsePositiveIntegerValue(
        consumeInlineValue(arg, '--sample-size', 'number'),
        '--sample-size',
      );
      continue;
    }
    if (arg === '--sample-size') {
      const { value, nextIndex } = consumeValue(argv, index, '--sample-size', 'number');
      args.sampleSize = parsePositiveIntegerValue(value, '--sample-size');
      index = nextIndex;
      continue;
    }
    if (arg === '--output') {
      const { value, nextIndex } = consumeValue(argv, index, '--output', 'path');
      args.output = value;
      index = nextIndex;
      continue;
    }
    if (arg.startsWith('--output=')) {
      args.output = consumeInlineValue(arg, '--output', 'path');
      continue;
    }

    throw new Error(`Unknown users:email-hygiene option: ${arg}`);
  }

  return args;
}

export function getSuspiciousUserEmailReason(email: string): string | undefined {
  const trimmed = email.trim();
  if (!trimmed || isInvalidOptionalEmail(trimmed)) {
    return undefined;
  }
  return SUSPICIOUS_USER_EMAIL_PATTERN.test(trimmed)
    ? 'placeholder-or-synthetic-pattern'
    : undefined;
}

export function isSuspiciousUserEmail(email: string): boolean {
  return getSuspiciousUserEmailReason(email) !== undefined;
}

export function isExcludedByLaneAProductionCopy(
  user: UserEmailHygieneInputUser,
): boolean {
  const netid = String(user.netid || '').trim().toLowerCase();
  const email = String(user.email || '').trim();
  return (
    netid === 'devadmin' ||
    netid === 'test123' ||
    /@example\.invalid$/i.test(email) ||
    /^test[+@.]/i.test(email)
  );
}

export function buildUserEmailHygieneSummary(input: {
  totalCount: number;
  sampleSize: number;
  users: UserEmailHygieneInputUser[];
}): UserEmailHygieneSummary {
  const suspiciousUsers = input.users.flatMap((user): UserEmailHygieneSample[] => {
    const email = String(user.email || '').trim();
    const reason = getSuspiciousUserEmailReason(email);
    if (!email || !reason) {
      return [];
    }
    const productionCopyExcludedByDefault = isExcludedByLaneAProductionCopy(user);
    return [
      {
        id: String(user.id || ''),
        netid: user.netid || undefined,
        name: [user.fname, user.lname].filter(Boolean).join(' '),
        email,
        reason,
        productionCopyExcludedByDefault,
        productionCopyDisposition: productionCopyExcludedByDefault
          ? 'excluded_from_lane_a_users_copy'
          : 'review_before_lane_a_copy',
        recommendedDisposition:
          'Review as synthetic or placeholder account before production promotion; exclude from copy path unless confirmed real.',
      },
    ];
  });
  const sampledExcludedByDefault = suspiciousUsers.filter(
    (user) => user.productionCopyExcludedByDefault,
  ).length;
  const sampledNeedsReviewBeforeCopy =
    suspiciousUsers.length - sampledExcludedByDefault;
  const samples = suspiciousUsers.slice(0, input.sampleSize);

  return {
    mode: 'dry-run',
    suspiciousUserEmailCount: Math.max(0, input.totalCount),
    sampledUsers: samples.length,
    promotionReady: input.totalCount === 0,
    applyBlocked: true,
    productionCopyExclusion: {
      lane: 'Lane A accepted Beta copy',
      strategy:
        'The guarded Lane A copy excludes known dev/test users from the users collection and separately blocks copied records that still reference excluded users.',
      sampledExcludedByDefault,
      sampledNeedsReviewBeforeCopy,
      sampledCoverageComplete: sampledNeedsReviewBeforeCopy === 0,
      nextAction:
        'Review any sampled users not covered by the Lane A copy filter before production copy; do not delete users as part of this hygiene command.',
    },
    nextAction:
      'Review suspicious user emails as synthetic or placeholder accounts before production promotion; this command does not delete or modify users.',
    samples,
  };
}

function parsePositiveIntegerValue(raw: string, flagName: string): number {
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  return value;
}
