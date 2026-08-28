import { isInvalidOptionalEmail } from './betaDataQualityCore';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

export const SUSPICIOUS_USER_EMAIL_PATTERN =
  /(^test(?:\d+|[+@.])|@example\.|placeholder|unknown|invalid|dummy|no-?reply|^none@|^na@)/i;

export interface UserEmailHygieneInputUser {
  id?: string;
  netid?: string;
  fname?: string;
  lname?: string;
  email?: string;
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

export function isExcludedByLaneAProductionCopy(user: UserEmailHygieneInputUser): boolean {
  const netid = String(user.netid || '')
    .trim()
    .toLowerCase();
  const email = String(user.email || '').trim();
  return (
    netid === 'devadmin' ||
    netid === 'test123' ||
    /@example\.invalid$/i.test(email) ||
    /^test[+@.]/i.test(email)
  );
}
