import { isExcludedHostRedirectError, EXCLUDED_HOST_ERROR_CODE } from '../../utils/excludedHosts';
import { isSsrfGuardRefusal, SsrfBlockedError } from '../../utils/ssrfGuard';
import { DEAD_LINK_ERROR_CODES } from '../../services/sourceLinkHealth';
import { TLS_VERIFICATION_ERROR_CODES } from '../../utils/tlsVerificationErrors';
import { isRefusedBeforeSending } from './httpFetch';

/**
 * A redirect loop carries no status, but the host answered every hop, so it is an observation
 * that the cited address no longer serves the resource (#3135). `fieldRetraction.ts` reads the
 * same set, so a lane and the retraction probe cannot disagree about it.
 */
export const REDIRECT_LOOP_ERROR_CODES: ReadonlySet<string> = new Set([
  'ERR_FR_TOO_MANY_REDIRECTS',
  'ERR_TOO_MANY_REDIRECTS',
]);

/**
 * `HostPausedBudgetError` is kept beside the current names on ylabs-ae's request (#6168): a stale
 * process still running the pre-#6168 pause code raises it, and it is the same refusal.
 */
const NOT_OBSERVED_ERROR_NAMES: ReadonlySet<string> = new Set([
  'HostPausedError',
  'HostPausedBudgetError',
  'DevWriteLeaseHeldError',
  'DevWriteLeaseStoppedError',
  'DevWriteLeaseTimeoutError',
]);

const MAX_CAUSE_DEPTH = 6;

function errorChain(error: unknown): object[] {
  const chain: object[] = [];
  let current: unknown = error;
  for (
    let depth = 0;
    depth < MAX_CAUSE_DEPTH && current && typeof current === 'object';
    depth += 1
  ) {
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

const httpStatusOf = (link: object): number | undefined => {
  const direct = (link as { status?: unknown }).status;
  if (typeof direct === 'number' && direct >= 100) return direct;
  const response = (link as { response?: { status?: unknown } }).response;
  return typeof response?.status === 'number' ? response.status : undefined;
};

const codeOf = (link: object): string | undefined => {
  const code = (link as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
};

/**
 * The SSRF guard's `unresolvable` refusal is a name the resolver confirmed absent after asking
 * again, the same fact as `ENOTFOUND`, so link-health retires on it (#2709). Every other guard
 * refusal describes our network position or our own rules, not the host.
 */
const isGuardConfirmedAbsentName = (link: object): boolean =>
  link instanceof SsrfBlockedError && link.reason === 'unresolvable';

function refusedByUs(link: object): boolean {
  if (isGuardConfirmedAbsentName(link)) return false;
  return (
    isRefusedBeforeSending(link) ||
    isSsrfGuardRefusal(link) ||
    isExcludedHostRedirectError(link) ||
    codeOf(link) === EXCLUDED_HOST_ERROR_CODE ||
    NOT_OBSERVED_ERROR_NAMES.has((link as Error).name)
  );
}

export function isNotObserved(error: unknown): boolean {
  const chain = errorChain(error);
  if (chain.length === 0) return true;
  if (chain.some(refusedByUs)) return true;
  if (chain.some((link) => httpStatusOf(link) !== undefined)) return false;
  return !chain.some((link) => {
    if (isGuardConfirmedAbsentName(link)) return true;
    const code = codeOf(link);
    return (
      code !== undefined &&
      (DEAD_LINK_ERROR_CODES.has(code) ||
        TLS_VERIFICATION_ERROR_CODES.has(code) ||
        REDIRECT_LOOP_ERROR_CODES.has(code))
    );
  });
}
