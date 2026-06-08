import { describe, expect, it } from 'vitest';
import { CorsOriginError, createCorsOriginHandler, isAllowedCorsOrigin } from '../corsOrigin';

const allowedOrigins = new Set([
  'https://yalelabs.io',
  'https://ylabs-gr4v.onrender.com',
]);

type HandlerResult = {
  callbackError: Error | null;
  callbackAllow: boolean | undefined;
};

const runOriginHandler = (origin: string | undefined, bypassCors: boolean): HandlerResult => {
  const handler = createCorsOriginHandler(allowedOrigins, bypassCors);
  let callbackError: Error | null = null;
  let callbackAllow: boolean | undefined;

  handler(origin, (error, allow) => {
    callbackError = error;
    callbackAllow = allow;
  });

  return { callbackError, callbackAllow };
};

describe('corsOrigin', () => {
  it('allows trusted browser origins in production', () => {
    expect(
      isAllowedCorsOrigin({
        allowedOrigins,
        bypassCors: false,
        origin: 'https://yalelabs.io',
      }),
    ).toBe(true);

    expect(runOriginHandler('https://ylabs-gr4v.onrender.com', false)).toEqual({
      callbackError: null,
      callbackAllow: true,
    });
  });

  it('leaves missing origins unblocked while omitting production CORS headers', () => {
    expect(
      isAllowedCorsOrigin({
        allowedOrigins,
        bypassCors: false,
        origin: undefined,
      }),
    ).toBe(false);

    expect(runOriginHandler(undefined, false)).toEqual({
      callbackError: null,
      callbackAllow: false,
    });
  });

  it('allows local and test bypass traffic without an origin header', () => {
    expect(runOriginHandler(undefined, true)).toEqual({
      callbackError: null,
      callbackAllow: true,
    });
  });

  it('rejects untrusted origins with a 403-tagged error', () => {
    const { callbackError, callbackAllow } = runOriginHandler('https://evil.example', false);

    expect(callbackAllow).toBeUndefined();
    expect(callbackError).toBeInstanceOf(CorsOriginError);
    const corsError = callbackError as unknown as CorsOriginError;
    expect(corsError.status).toBe(403);
    expect(corsError.message).toBe('Not allowed by CORS');
  });
});
