import type { ResearcherEmailSupport } from '../models/researcher';

export type ResearcherEmailSupportVerdict = 'supported' | 'unsupported' | 'unmarked';

const normalizedEmail = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

/**
 * Read from the stored `identifiers.emailSupport` marker alone, never from observations,
 * because Beta and Production carry no observation store (#5627). A marker computed for a
 * different address than the one stored is stale and reads as unmarked.
 */
export function researcherEmailSupportVerdict(
  email: unknown,
  marker: Partial<ResearcherEmailSupport> | null | undefined,
): ResearcherEmailSupportVerdict {
  const stored = normalizedEmail(email);
  if (!stored || !marker || normalizedEmail(marker.computedForEmail) !== stored) return 'unmarked';
  return marker.supported === true ? 'supported' : 'unsupported';
}

export function researcherEmailFailClosed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RESEARCHER_EMAIL_SUPPORT_FAIL_CLOSED === 'true';
}

/**
 * An unmarked address is served while the marker is still being backfilled, and withheld once
 * `RESEARCHER_EMAIL_SUPPORT_FAIL_CLOSED` is on; that flag must stay off in an environment until
 * a count shows every researcher there carries a current marker (`docs/release-process.md`).
 */
export function isServableResearcherEmail(
  email: unknown,
  marker: Partial<ResearcherEmailSupport> | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const verdict = researcherEmailSupportVerdict(email, marker);
  if (verdict === 'supported') return true;
  if (verdict === 'unsupported') return false;
  return !researcherEmailFailClosed(env);
}
