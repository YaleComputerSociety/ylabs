const CORS_ORIGIN_ERROR_MESSAGE = 'Not allowed by CORS';
const MAX_CORS_ORIGIN_LENGTH = 2048;
const UNSAFE_CORS_ORIGIN_RE = /[\u0000-\u0020\u007f\\]/;

export class CorsOriginError extends Error {
  status = 403;

  constructor() {
    super(CORS_ORIGIN_ERROR_MESSAGE);
    this.name = 'CorsOriginError';
    Object.setPrototypeOf(this, CorsOriginError.prototype);
  }
}

type CorsOriginCallback = (error: Error | null, allow?: boolean) => void;

const normalizeCorsOrigin = (origin: string | undefined): string => {
  if (origin === undefined) return '';
  if (origin.length > MAX_CORS_ORIGIN_LENGTH) return '';
  if (UNSAFE_CORS_ORIGIN_RE.test(origin)) return '';

  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    if (parsed.username || parsed.password) return '';
    if (parsed.origin !== origin) return '';
    return parsed.origin;
  } catch {
    return '';
  }
};

export const isAllowedCorsOrigin = ({
  allowedOrigins,
  bypassCors,
  origin,
}: {
  allowedOrigins: ReadonlySet<string>;
  bypassCors: boolean;
  origin: string | undefined;
}): boolean => {
  if (origin === undefined) {
    return bypassCors;
  }

  const normalizedOrigin = normalizeCorsOrigin(origin);
  if (!normalizedOrigin) return false;

  return bypassCors || allowedOrigins.has(normalizedOrigin);
};

export const createCorsOriginHandler = (
  allowedOrigins: ReadonlySet<string>,
  bypassCors: boolean,
) => {
  return (origin: string | undefined, callback: CorsOriginCallback) => {
    if (origin === undefined) {
      callback(null, bypassCors);
      return;
    }

    if (isAllowedCorsOrigin({ allowedOrigins, bypassCors, origin })) {
      callback(null, true);
      return;
    }

    callback(new CorsOriginError());
  };
};
