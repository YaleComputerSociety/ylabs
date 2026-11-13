import { isExcludedHostRedirectError, EXCLUDED_HOST_ERROR_CODE } from '../../utils/excludedHosts';
import { isSsrfGuardRefusal, SsrfBlockedError } from '../../utils/ssrfGuard';
import { isRefusedBeforeSending } from './httpFetch';

/**
 * Transport codes that say something about the host itself, so a lane may treat them as evidence
 * under its own confirmation rule: a DNS record confirmed absent, or a host that refused or could
 * not route a connection. link-health records these only after a second attempt agrees (#2725,
 * #6116). Changing this list also changes which link-health failures can retire a link.
 */
export const HOST_LEVEL_OBSERVED_ERROR_CODES: ReadonlySet<string> = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

const TLS_OBSERVED_ERROR_CODE = /^(?:ERR_TLS_|CERT_|DEPTH_ZERO_|SELF_SIGNED_|UNABLE_TO_|ERR_SSL_)/;

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

/**
 * Whether a failed fetch observed nothing about the page, so no lane may turn it into a verdict,
 * an absence, a retraction or a lowered confidence (#6258). True for a request our own code
 * refused before sending (a host pause, the SSRF guard, the request budget, an excluded host, a
 * write lease) and for a failure that carries neither an HTTP status nor a host-level code: a
 * timeout, a reset, a temporary DNS failure, an abort, or a plain error. An HTTP status, 404 and
 * 410 included, a host-level code (`HOST_LEVEL_OBSERVED_ERROR_CODES`) or a TLS verification code
 * is an observation, still subject to each lane's own confirmation rule.
 */
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
      (HOST_LEVEL_OBSERVED_ERROR_CODES.has(code) || TLS_OBSERVED_ERROR_CODE.test(code))
    );
  });
}
