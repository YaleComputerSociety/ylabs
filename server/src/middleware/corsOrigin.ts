const CORS_ORIGIN_ERROR_MESSAGE = 'Not allowed by CORS';
const MAX_CORS_ORIGIN_LENGTH = 2048;
const hasUnsafeCorsOriginCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return isAsciiControlCode(code) || code === 0x20 || character === '\\';
  });

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
  if (hasUnsafeCorsOriginCharacter(origin)) return '';

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
  allowLoopbackOrigins,
  origin,
}: {
  allowedOrigins: ReadonlySet<string>;
  allowLoopbackOrigins: boolean;
  origin: string | undefined;
}): boolean => {
  if (origin === undefined) {
    return allowLoopbackOrigins;
  }

  const normalizedOrigin = normalizeCorsOrigin(origin);
  if (!normalizedOrigin) return false;

  if (allowedOrigins.has(normalizedOrigin)) return true;

  return allowLoopbackOrigins && isLoopbackHttpOrigin(normalizedOrigin);
};

const RENDER_SERVICE_HOST_SUFFIX = '.onrender.com';

export const renderServiceOwnOrigin = (
  env: NodeJS.ProcessEnv = process.env,
): string | undefined => {
  const origin = normalizeCorsOrigin(env.RENDER_EXTERNAL_URL?.trim().replace(/\/$/, ''));
  if (!origin) return undefined;

  const { protocol, hostname, port } = new URL(origin);
  const isRenderServiceHost =
    protocol === 'https:' && !port && hostname.endsWith(RENDER_SERVICE_HOST_SUFFIX);
  return isRenderServiceHost ? origin : undefined;
};

export const createCorsOriginHandler = (
  allowedOrigins: ReadonlySet<string>,
  allowLoopbackOrigins: boolean,
) => {
  return (origin: string | undefined, callback: CorsOriginCallback) => {
    if (origin === undefined) {
      callback(null, allowLoopbackOrigins);
      return;
    }

    if (isAllowedCorsOrigin({ allowedOrigins, allowLoopbackOrigins, origin })) {
      callback(null, true);
      return;
    }

    callback(new CorsOriginError());
  };
};
import { isAsciiControlCode } from '../utils/asciiControl';
import { isLoopbackHttpOrigin } from '../utils/loopbackAccess';
