const TRANSIENT_ERROR_LABELS = ['RetryableWriteError', 'TransientTransactionError'] as const;

const TRANSIENT_ERROR_NAMES = new Set([
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoServerSelectionError',
  'MongoPoolClearedError',
  'MongoPoolClosedError',
  'MongoWaitQueueTimeoutError',
]);

const TRANSIENT_SERVER_CODES = new Set([
  6, 7, 89, 91, 189, 262, 9001, 10107, 11600, 11602, 13435, 13436,
]);

const DUPLICATE_KEY_CODE = 11000;
const DOCUMENT_VALIDATION_FAILURE_CODE = 121;

export const TRANSIENT_MONGO_FAILURE_PATTERNS: readonly RegExp[] = [
  /\bMongoNetwork(?:Timeout)?Error\b/,
  /\bMongoServerSelectionError\b/,
  /\bMongoPool(?:Cleared|Closed)Error\b/,
  /\bMongoWaitQueueTimeoutError\b/,
  /\b(?:RetryableWriteError|TransientTransactionError)\b/,
  /closed connection pool/i,
  /error computing current atlas size/i,
  /internal atlas error/i,
  /error determining if update will go over space quota/i,
  /\bbuffering timed out after \d+ms/i,
  /\b(?:NotWritablePrimary|PrimarySteppedDown|InterruptedAtShutdown|InterruptedDueToReplStateChange|ShutdownInProgress)\b/,
];

export const DETERMINISTIC_MONGO_FAILURE_PATTERNS: readonly RegExp[] = [
  /you are over your space quota/i,
  /\bE11000 duplicate key\b/,
  /\bDocument failed validation\b/,
];

export interface MongoWriteErrorFields {
  index?: number;
  code?: number;
  message: string;
  keyPattern?: Record<string, unknown>;
}

type ErrorLike = Record<string, any>;

function asErrorLike(value: unknown): ErrorLike | undefined {
  return value && typeof value === 'object' ? (value as ErrorLike) : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function messageOf(error: ErrorLike): string {
  const parts = [error.message, error.errmsg, error.err?.errmsg].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );
  return parts.join(' ');
}

export function mongoWriteErrorFields(writeError: unknown): MongoWriteErrorFields {
  const error = asErrorLike(writeError) ?? {};
  return {
    index: numberOrUndefined(error.index) ?? numberOrUndefined(error.err?.index),
    code: numberOrUndefined(error.code) ?? numberOrUndefined(error.err?.code),
    message: messageOf(error),
    keyPattern: asErrorLike(
      error.keyPattern ?? error.err?.keyPattern ?? error.err?.errInfo?.keyPattern,
    ),
  };
}

export function mongoWriteErrorsOf(error: unknown): MongoWriteErrorFields[] {
  const writeErrors = asErrorLike(error)?.writeErrors;
  if (Array.isArray(writeErrors)) return writeErrors.map(mongoWriteErrorFields);
  return writeErrors ? [mongoWriteErrorFields(writeErrors)] : [];
}

export function isDuplicateIdWriteError(writeError: MongoWriteErrorFields): boolean {
  if (writeError.code !== DUPLICATE_KEY_CODE) return false;
  if (writeError.keyPattern) return Object.keys(writeError.keyPattern).join(',') === '_id';
  return /index: _id_ dup key/.test(writeError.message);
}

function hasTransientLabel(error: ErrorLike): boolean {
  const labels = new Set<string>([
    ...(Array.isArray(error.errorLabels) ? error.errorLabels : []),
    ...(error.errorLabelSet instanceof Set ? [...error.errorLabelSet] : []),
  ]);
  if (typeof error.hasErrorLabel === 'function') {
    for (const label of TRANSIENT_ERROR_LABELS) if (error.hasErrorLabel(label)) return true;
  }
  return TRANSIENT_ERROR_LABELS.some((label) => labels.has(label));
}

function isDeterministicFailure(code: number | undefined, message: string): boolean {
  if (code === DUPLICATE_KEY_CODE || code === DOCUMENT_VALIDATION_FAILURE_CODE) return true;
  return DETERMINISTIC_MONGO_FAILURE_PATTERNS.some((pattern) => pattern.test(message));
}

function isTransientFailure(name: unknown, code: number | undefined, message: string): boolean {
  if (typeof name === 'string' && TRANSIENT_ERROR_NAMES.has(name)) return true;
  if (code !== undefined && TRANSIENT_SERVER_CODES.has(code)) return true;
  return TRANSIENT_MONGO_FAILURE_PATTERNS.some((pattern) => pattern.test(message));
}

export interface TransientMongoErrorOptions {
  /** A write error the caller can reconcile itself, so a failure made only of these is retried. */
  ignoreWriteError?: (writeError: MongoWriteErrorFields) => boolean;
}

/**
 * Whether a MongoDB failure is an infrastructure blip worth retrying. A write error that is
 * deterministic (a duplicate key, a validation failure, a real quota refusal) makes the whole
 * failure deterministic, because retrying would only repeat it.
 */
export function isTransientMongoError(
  error: unknown,
  options: TransientMongoErrorOptions = {},
): boolean {
  const record = asErrorLike(error);
  if (!record) return false;
  if (record.name === 'ValidationError' || record.name === 'CastError') return false;
  const allWriteErrors = mongoWriteErrorsOf(record);
  const writeErrors = allWriteErrors.filter(
    (writeError) => !options.ignoreWriteError?.(writeError),
  );
  if (allWriteErrors.length > 0 && writeErrors.length === 0) return true;
  if (
    writeErrors.some((writeError) => isDeterministicFailure(writeError.code, writeError.message))
  ) {
    return false;
  }
  const code = numberOrUndefined(record.code);
  const message = messageOf(record);
  if (allWriteErrors.length === 0 && isDeterministicFailure(code, message)) return false;
  if (hasTransientLabel(record)) return true;
  if (isTransientFailure(record.name, code, message)) return true;
  if (
    writeErrors.some((writeError) =>
      isTransientFailure(undefined, writeError.code, writeError.message),
    )
  ) {
    return true;
  }
  const cause = asErrorLike(record.cause);
  return cause !== undefined && cause !== record && isTransientMongoError(cause, options);
}

export function matchesTransientMongoFailureText(text: string | undefined): boolean {
  if (!text) return false;
  if (DETERMINISTIC_MONGO_FAILURE_PATTERNS.some((pattern) => pattern.test(text))) return false;
  return TRANSIENT_MONGO_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}
