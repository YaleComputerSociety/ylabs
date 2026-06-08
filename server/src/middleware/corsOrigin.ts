const CORS_ORIGIN_ERROR_MESSAGE = 'Not allowed by CORS';

export class CorsOriginError extends Error {
  status = 403;

  constructor() {
    super(CORS_ORIGIN_ERROR_MESSAGE);
    this.name = 'CorsOriginError';
    Object.setPrototypeOf(this, CorsOriginError.prototype);
  }
}

type CorsOriginCallback = (error: Error | null, allow?: boolean) => void;

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

  return bypassCors || allowedOrigins.has(origin);
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
