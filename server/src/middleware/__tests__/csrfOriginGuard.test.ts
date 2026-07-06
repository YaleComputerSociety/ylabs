import { afterEach, describe, expect, it, vi } from 'vitest';
import { csrfOriginGuard, isTrustedUnsafeRequestOrigin } from '../csrfOriginGuard';

const allowedOrigins = new Set(['https://yalelabs.io', 'https://ylabs-gr4v.onrender.com']);
const ORIGINAL_ENV = { ...process.env };

const makeUnsafeRequest = (origin = 'https://evil.example') => ({
  method: 'POST',
  get: vi.fn((header: string) => (header.toLowerCase() === 'origin' ? origin : undefined)),
});

const makeResponse = () => ({
  status: vi.fn().mockReturnThis(),
  json: vi.fn().mockReturnThis(),
});

describe('csrfOriginGuard', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('allows safe methods without browser origin headers', () => {
    expect(
      isTrustedUnsafeRequestOrigin({
        method: 'GET',
        allowedOrigins,
        production: true,
      }),
    ).toBe(true);
  });

  it('treats configured safe-method paths as unsafe state changes', () => {
    const writeLikeSafeMethodPaths = new Set(['/logout']);

    expect(
      isTrustedUnsafeRequestOrigin({
        method: 'GET',
        path: '/logout',
        allowedOrigins,
        production: true,
        writeLikeSafeMethodPaths,
      }),
    ).toBe(false);

    expect(
      isTrustedUnsafeRequestOrigin({
        method: 'GET',
        path: '/logout',
        referer: 'https://yalelabs.io/account',
        allowedOrigins,
        production: true,
        writeLikeSafeMethodPaths,
      }),
    ).toBe(true);

    expect(
      isTrustedUnsafeRequestOrigin({
        method: 'GET',
        path: '/check',
        allowedOrigins,
        production: true,
        writeLikeSafeMethodPaths,
      }),
    ).toBe(true);
  });

  it('allows unsafe methods outside production for local development tools', () => {
    expect(
      isTrustedUnsafeRequestOrigin({
        method: 'POST',
        allowedOrigins,
        production: false,
      }),
    ).toBe(true);
  });

  it('allows production unsafe methods from trusted origins or referers', () => {
    expect(
      isTrustedUnsafeRequestOrigin({
        method: 'PUT',
        origin: 'https://yalelabs.io',
        allowedOrigins,
        production: true,
      }),
    ).toBe(true);
    expect(
      isTrustedUnsafeRequestOrigin({
        method: 'DELETE',
        referer: 'https://ylabs-gr4v.onrender.com/admin',
        allowedOrigins,
        production: true,
      }),
    ).toBe(true);
  });

  it('blocks production unsafe methods from untrusted or missing origins', () => {
    expect(
      isTrustedUnsafeRequestOrigin({
        method: 'POST',
        origin: 'https://evil.example',
        allowedOrigins,
        production: true,
      }),
    ).toBe(false);
    expect(
      isTrustedUnsafeRequestOrigin({
        method: 'POST',
        allowedOrigins,
      production: true,
    }),
  ).toBe(false);
});

  it('blocks oversized production origin headers before URL parsing', () => {
    expect(
      isTrustedUnsafeRequestOrigin({
        method: 'POST',
        origin: `https://yalelabs.io/${'a'.repeat(2049)}`,
        allowedOrigins,
        production: true,
      }),
    ).toBe(false);
  });

  it('blocks credentialed or whitespace-padded unsafe origin headers before trusting parsed origins', () => {
    expect(
      isTrustedUnsafeRequestOrigin({
        method: 'POST',
        origin: 'https://attacker:secret@yalelabs.io',
        allowedOrigins,
        production: true,
      }),
    ).toBe(false);
    expect(
      isTrustedUnsafeRequestOrigin({
        method: 'POST',
        origin: ' https://yalelabs.io',
        allowedOrigins,
        production: true,
      }),
    ).toBe(false);
    expect(
      isTrustedUnsafeRequestOrigin({
        method: 'POST',
        referer: 'https://attacker:secret@yalelabs.io/admin',
        allowedOrigins,
        production: true,
      }),
    ).toBe(false);
  });

  it('does not fall back to referer when an unsafe origin header is present and untrusted', () => {
    expect(
      isTrustedUnsafeRequestOrigin({
        method: 'POST',
        origin: 'null',
        referer: 'https://yalelabs.io/admin',
        allowedOrigins,
        production: true,
      }),
    ).toBe(false);
    expect(
      isTrustedUnsafeRequestOrigin({
        method: 'POST',
        origin: 'https://evil.example',
        referer: 'https://yalelabs.io/admin',
        allowedOrigins,
        production: true,
      }),
    ).toBe(false);
  });

  it('blocks unsafe methods from untrusted origins when runtime security bypasses are disabled', () => {
    const guard = csrfOriginGuard(allowedOrigins, { allowUnsafeOriginBypass: false });
    const req = makeUnsafeRequest();
    const res = makeResponse();
    const next = vi.fn();

    guard(req as any, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Cross-site request blocked' });
  });

  it('blocks write-like GET route paths without trusted origins', () => {
    const guard = csrfOriginGuard(allowedOrigins, {
      allowUnsafeOriginBypass: false,
      writeLikeSafeMethodPaths: new Set(['/logout']),
    });
    const req = {
      method: 'GET',
      path: '/logout',
      get: vi.fn(() => undefined),
    };
    const res = makeResponse();
    const next = vi.fn();

    guard(req as any, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Cross-site request blocked' });
  });

  it('enforces origin checks by default for remote development-labelled runtimes', () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'development',
      SERVER_BASE_URL: 'https://yalelabs.io',
    };
    const guard = csrfOriginGuard(allowedOrigins);
    const req = makeUnsafeRequest();
    const res = makeResponse();
    const next = vi.fn();

    guard(req as any, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
