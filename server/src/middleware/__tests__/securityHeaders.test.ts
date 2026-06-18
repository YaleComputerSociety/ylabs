import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CONTENT_SECURITY_POLICY,
  PERMISSIONS_POLICY,
  securityHeaders,
} from '../securityHeaders';

const originalEnv = { ...process.env };

const createResponse = () => {
  const headers = new Map<string, string>();
  const response = {
    setHeader: vi.fn((name: string, value: string) => {
      headers.set(name, value);
    }),
    removeHeader: vi.fn((name: string) => {
      headers.delete(name);
    }),
  } as unknown as Response;

  return { headers, response };
};

const runMiddleware = (request: Partial<Request>) => {
  const { headers, response } = createResponse();
  const next = vi.fn() as NextFunction;

  securityHeaders(request as Request, response, next);

  return { headers, next, response };
};

describe('securityHeaders', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('sets browser hardening headers on every response', () => {
    process.env.NODE_ENV = 'development';
    process.env.SERVER_BASE_URL = 'http://localhost:4000';
    const { headers, next, response } = runMiddleware({
      secure: false,
      headers: {},
    });

    expect(headers.get('Content-Security-Policy')).toBe(CONTENT_SECURITY_POLICY);
    expect(headers.get('Permissions-Policy')).toBe(PERMISSIONS_POLICY);
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('X-XSS-Protection')).toBe('0');
    expect(headers.get('X-Download-Options')).toBe('noopen');
    expect(headers.get('X-Permitted-Cross-Domain-Policies')).toBe('none');
    expect(headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(headers.get('Origin-Agent-Cluster')).toBe('?1');
    expect(headers.get('X-DNS-Prefetch-Control')).toBe('off');
    expect(headers.has('Strict-Transport-Security')).toBe(false);
    expect(response.removeHeader).toHaveBeenCalledWith('X-Powered-By');
    expect(next).toHaveBeenCalledOnce();
  });

  it('keeps CSP script execution restricted to self and the analytics loader', () => {
    const scriptDirective = CONTENT_SECURITY_POLICY.split('; ').find((directive) =>
      directive.startsWith('script-src '),
    );

    expect(scriptDirective).toBe("script-src 'self' https://www.googletagmanager.com");
    expect(CONTENT_SECURITY_POLICY).toContain("base-uri 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(scriptDirective).not.toContain("'unsafe-inline'");
    expect(scriptDirective).not.toContain("'unsafe-eval'");
  });

  it('keeps form submissions restricted to self and Yale CAS', () => {
    const formDirective = CONTENT_SECURITY_POLICY.split('; ').find((directive) =>
      directive.startsWith('form-action '),
    );

    expect(formDirective).toBe(
      "form-action 'self' https://secure.its.yale.edu https://secure.its.yale.edu/cas",
    );
    expect(formDirective).not.toContain('accounts.google.com');
  });

  it('omits local development connect origins from production CSP', () => {
    process.env.NODE_ENV = 'production';
    const { headers } = runMiddleware({
      secure: false,
      headers: {},
    });
    const csp = headers.get('Content-Security-Policy') || '';
    const connectDirective = csp
      .split('; ')
      .find((directive) => directive.startsWith('connect-src '));

    expect(connectDirective).toBe(
      "connect-src 'self' https://yalelabs.io https://www.yalelabs.io https://yalelabs.onrender.com https://ylabs-gr4v.onrender.com https://sheets.googleapis.com https://www.google-analytics.com https://analytics.google.com https://region1.google-analytics.com https://stats.g.doubleclick.net",
    );
    expect(csp).not.toContain('http://localhost:4000');
    expect(connectDirective).not.toMatch(/\shttps:(?:\s|$)/);
    expect(csp).toContain('upgrade-insecure-requests');
  });

  it('limits production image sources to self, local data/blob URLs, and trusted image origins', () => {
    process.env.NODE_ENV = 'production';
    const { headers } = runMiddleware({
      secure: false,
      headers: {},
    });
    const csp = headers.get('Content-Security-Policy') || '';
    const imageDirective = csp
      .split('; ')
      .find((directive) => directive.startsWith('img-src '));

    expect(imageDirective).toBe(
      "img-src 'self' data: blob: https://yale.edu https://*.yale.edu https://ysm-res.cloudinary.com https://yalies.io https://www.google-analytics.com https://stats.g.doubleclick.net",
    );
    expect(imageDirective).not.toMatch(/\shttps:(?:\s|$)/);
  });

  it('omits local development connect origins from remote development-labelled CSP', () => {
    process.env.NODE_ENV = 'development';
    process.env.SERVER_BASE_URL = 'https://yalelabs.io';
    const { headers } = runMiddleware({
      secure: false,
      headers: {},
    });
    const csp = headers.get('Content-Security-Policy') || '';
    const connectDirective = csp
      .split('; ')
      .find((directive) => directive.startsWith('connect-src '));

    expect(connectDirective).not.toContain('http://localhost:4000');
    expect(connectDirective).not.toMatch(/\shttps:(?:\s|$)/);
    expect(csp).not.toContain('http://localhost:4000');
    expect(csp).toContain('upgrade-insecure-requests');
  });

  it('keeps localhost API access only for true local development CSP', () => {
    process.env.NODE_ENV = 'development';
    process.env.SERVER_BASE_URL = 'http://localhost:4000';
    const { headers } = runMiddleware({
      secure: false,
      headers: {},
    });
    const csp = headers.get('Content-Security-Policy') || '';
    const connectDirective = csp
      .split('; ')
      .find((directive) => directive.startsWith('connect-src '));

    expect(connectDirective).toContain('http://localhost:4000');
    expect(connectDirective).not.toMatch(/\shttps:(?:\s|$)/);
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('sets HSTS for direct HTTPS, proxied HTTPS, and deployed runtimes', () => {
    const directHttps = runMiddleware({ secure: true, headers: {} });
    expect(directHttps.headers.get('Strict-Transport-Security')).toBe(
      'max-age=31536000; includeSubDomains',
    );

    const proxiedHttps = runMiddleware({
      secure: false,
      headers: { 'x-forwarded-proto': 'https' },
    });
    expect(proxiedHttps.headers.get('Strict-Transport-Security')).toBe(
      'max-age=31536000; includeSubDomains',
    );

    process.env.NODE_ENV = 'production';
    process.env.SERVER_BASE_URL = 'https://yalelabs.io';
    const deployedHttpShaped = runMiddleware({
      secure: false,
      headers: {},
    });
    expect(deployedHttpShaped.headers.get('Strict-Transport-Security')).toBe(
      'max-age=31536000; includeSubDomains',
    );
  });
});
