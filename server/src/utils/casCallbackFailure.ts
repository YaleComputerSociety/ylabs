import { isMongoUnavailableError } from '../db/connections';

export type CasCallbackFailure = 'rejected' | 'unavailable' | 'server_error';

export const CAS_SIGN_IN_TROUBLE_MESSAGE =
  'Sign-in is having trouble right now. Please try again in a moment.';

const DEFAULT_CAS_VALIDATION_TIMEOUT_MS = 10_000;
const MAX_CAUSE_DEPTH = 8;
const CAS1_REJECTION_MESSAGE = 'Authentication rejected';
const CAS1_MALFORMED_ANSWER_MESSAGE = 'The response from the server was bad';
const REPORTABLE_LABEL = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export class UnusableCasIdentityError extends Error {
  constructor() {
    super('Invalid authentication principal');
    this.name = 'UnusableCasIdentityError';
  }
}

export class CasValidationTimeoutError extends Error {
  constructor() {
    super('CAS ticket validation timed out');
    this.name = 'CasValidationTimeoutError';
  }
}

export class CasLoginServerError extends Error {
  constructor(failure: Exclude<CasCallbackFailure, 'rejected'>, causeLabels: string) {
    super(`CAS login callback failed (${failure}): ${causeLabels}`);
    this.name = 'CasLoginServerError';
  }
}

const causeOf = (error: unknown): unknown => {
  if (!error || typeof error !== 'object') return undefined;
  const cause = (error as { cause?: unknown }).cause;
  return typeof cause === 'function' ? cause.call(error) : cause;
};

const causeChain = (error: unknown): unknown[] => {
  const chain: unknown[] = [];
  let current: unknown = error;
  while (current && chain.length < MAX_CAUSE_DEPTH) {
    chain.push(current);
    current = causeOf(current);
  }
  return chain;
};

const isCasRejection = (error: unknown): boolean =>
  error instanceof UnusableCasIdentityError ||
  (error instanceof Error && error.message === CAS1_REJECTION_MESSAGE);

const isCasUnreachable = (error: unknown): boolean =>
  error instanceof CasValidationTimeoutError ||
  (error instanceof Error && error.message === CAS1_MALFORMED_ANSWER_MESSAGE) ||
  (error as { isAxiosError?: unknown } | null)?.isAxiosError === true;

export const classifyCasCallbackError = (error: unknown): CasCallbackFailure => {
  const chain = causeChain(error);
  if (chain.some(isCasRejection)) return 'rejected';
  if (chain.some(isCasUnreachable) || isMongoUnavailableError(error)) return 'unavailable';
  return 'server_error';
};

export const casCallbackFailureStatus = (failure: CasCallbackFailure): number => {
  if (failure === 'rejected') return 401;
  return failure === 'unavailable' ? 503 : 500;
};

const reportableLabelsOf = (error: unknown): string[] => {
  if (!error || typeof error !== 'object') return [];
  const { name, code } = error as { name?: unknown; code?: unknown };
  return [name, code].filter(
    (label): label is string => typeof label === 'string' && REPORTABLE_LABEL.test(label),
  );
};

// The original error is never reported: a duplicate-key message quotes the
// netid and an axios error carries the validation URL with the ticket in it.
export const reportableCasLoginError = (
  failure: Exclude<CasCallbackFailure, 'rejected'>,
  error: unknown,
): CasLoginServerError => {
  const labels = causeChain(error).flatMap(reportableLabelsOf);
  return new CasLoginServerError(failure, labels.length > 0 ? labels.join(' > ') : 'unknown');
};

export const casValidationTimeoutMs = (env: NodeJS.ProcessEnv = process.env): number => {
  const configured = Number(env.CAS_VALIDATION_TIMEOUT_MS);
  return Number.isInteger(configured) && configured > 0
    ? configured
    : DEFAULT_CAS_VALIDATION_TIMEOUT_MS;
};
