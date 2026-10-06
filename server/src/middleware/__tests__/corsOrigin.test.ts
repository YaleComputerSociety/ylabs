import { describe, expect, it } from 'vitest';
import {
  CorsOriginError,
  createCorsOriginHandler,
  isAllowedCorsOrigin,
  renderServiceOwnOrigin,
} from '../corsOrigin';

const allowedOrigins = new Set(['https://yalelabs.io', 'https://ylabs-gr4v.onrender.com']);

type HandlerResult = {
  callbackError: Error | null;
  callbackAllow: boolean | undefined;
};

const runOriginHandler = (
  origin: string | undefined,
  allowLoopbackOrigins: boolean,
): HandlerResult => {
  const handler = createCorsOriginHandler(allowedOrigins, allowLoopbackOrigins);
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
        allowLoopbackOrigins: false,
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
        allowLoopbackOrigins: false,
        origin: undefined,
      }),
    ).toBe(false);

    expect(runOriginHandler(undefined, false)).toEqual({
      callbackError: null,
      callbackAllow: false,
    });
  });

  it('allows local and test traffic without an origin header', () => {
    expect(runOriginHandler(undefined, true)).toEqual({
      callbackError: null,
      callbackAllow: true,
    });
  });

  it('allows the local client dev server on any loopback port in development', () => {
    for (const origin of [
      'http://localhost:3000',
      'http://localhost:3010',
      'http://127.0.0.1:5173',
    ]) {
      expect(isAllowedCorsOrigin({ allowedOrigins, allowLoopbackOrigins: true, origin })).toBe(
        true,
      );
      expect(runOriginHandler(origin, true)).toEqual({
        callbackError: null,
        callbackAllow: true,
      });
    }
  });

  it('refuses a non-loopback caller in development instead of reflecting its origin', () => {
    for (const origin of [
      'https://evil.example',
      'http://evil.example',
      'https://localhost.evil.example',
      'http://203.0.113.5:3000',
    ]) {
      expect(isAllowedCorsOrigin({ allowedOrigins, allowLoopbackOrigins: true, origin })).toBe(
        false,
      );

      const { callbackError, callbackAllow } = runOriginHandler(origin, true);
      expect(callbackAllow).toBeUndefined();
      expect(callbackError).toBeInstanceOf(CorsOriginError);
    }
  });

  it('keeps the deployed allowlist unchanged when loopback origins are not allowed', () => {
    expect(
      isAllowedCorsOrigin({
        allowedOrigins,
        allowLoopbackOrigins: false,
        origin: 'http://localhost:3000',
      }),
    ).toBe(false);
    expect(
      isAllowedCorsOrigin({
        allowedOrigins,
        allowLoopbackOrigins: false,
        origin: 'https://yalelabs.io',
      }),
    ).toBe(true);
  });

  it('rejects untrusted origins with a 403-tagged error', () => {
    const { callbackError, callbackAllow } = runOriginHandler('https://evil.example', false);

    expect(callbackAllow).toBeUndefined();
    expect(callbackError).toBeInstanceOf(CorsOriginError);
    const corsError = callbackError as unknown as CorsOriginError;
    expect(corsError.status).toBe(403);
    expect(corsError.message).toBe('Not allowed by CORS');
  });

  it('rejects oversized origins before allowlist comparison', () => {
    const oversizedOrigin = `https://yalelabs.io/${'a'.repeat(2049)}`;
    const { callbackError, callbackAllow } = runOriginHandler(oversizedOrigin, true);

    expect(
      isAllowedCorsOrigin({
        allowedOrigins,
        allowLoopbackOrigins: true,
        origin: oversizedOrigin,
      }),
    ).toBe(false);
    expect(callbackAllow).toBeUndefined();
    expect(callbackError).toBeInstanceOf(CorsOriginError);
  });

  it('rejects malformed origins before allowlist or local bypass decisions', () => {
    for (const origin of [
      'https://attacker:secret@yalelabs.io',
      ' https://yalelabs.io',
      'https://yalelabs.io/path',
      'https:\\\\yalelabs.io',
      'null',
    ]) {
      expect(
        isAllowedCorsOrigin({
          allowedOrigins,
          allowLoopbackOrigins: true,
          origin,
        }),
      ).toBe(false);

      const { callbackError, callbackAllow } = runOriginHandler(origin, true);
      expect(callbackAllow).toBeUndefined();
      expect(callbackError).toBeInstanceOf(CorsOriginError);
    }
  });

  describe('renderServiceOwnOrigin', () => {
    const ownOrigin = (value: string | undefined) =>
      renderServiceOwnOrigin({ RENDER_EXTERNAL_URL: value } as NodeJS.ProcessEnv);

    it('trusts the https onrender.com origin the platform assigns to this service', () => {
      expect(ownOrigin('https://yalelabs-beta-pr-1.onrender.com')).toBe(
        'https://yalelabs-beta-pr-1.onrender.com',
      );
    });

    it('trusts nothing when the variable is absent or not a Render service origin', () => {
      expect(ownOrigin(undefined)).toBeUndefined();
      expect(ownOrigin('')).toBeUndefined();
      expect(ownOrigin('http://yalelabs-beta-pr-1.onrender.com')).toBeUndefined();
      expect(ownOrigin('https://yalelabs-beta-pr-1.onrender.com:8443')).toBeUndefined();
      expect(ownOrigin('https://example.com')).toBeUndefined();
      expect(ownOrigin('https://onrender.com.example.com')).toBeUndefined();
      expect(ownOrigin('https://user:pass@yalelabs-beta-pr-1.onrender.com')).toBeUndefined();
      expect(ownOrigin('https://yalelabs-beta-pr-1.onrender.com/')).toBeUndefined();
      expect(ownOrigin('https://yalelabs-beta-pr-1.onrender.com/path')).toBeUndefined();
      expect(ownOrigin('not a url')).toBeUndefined();
    });
  });
});
