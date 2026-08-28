import { describe, expect, it } from 'vitest';
import {
  buildSecurityHeaderChecks,
  containsInternalLabels,
  createSmokeReport,
  deploymentFingerprintCheck,
  deploymentFingerprintCheckFromSmokeConfig,
  parseSmokeConfig,
  shouldSendSmokeOrigin,
  smokeBrowserOrigin,
  summarizeSmokeReport,
  validateSmokeConfig,
} from '../../../scripts/productionPromotionSmokeCore.mjs';

describe('production promotion smoke core', () => {
  it('parses CLI/env config without printing or exposing the smoke cookie', () => {
    const config = parseSmokeConfig(
      [
        '--api-base',
        'https://example.test/api/',
        '--app-base=https://app.example.test/',
        '--ui=false',
        '--out',
        'tmp/custom-smoke',
        '--expect-commit',
        '852f4a0',
      ],
      {
        SMOKE_COOKIE: 'sid=secret',
        SMOKE_OPPORTUNITY_ID: 'opp-123',
      },
    );

    expect(config).toMatchObject({
      apiBase: 'https://example.test/api',
      appBase: 'https://app.example.test',
      rawOutDir: 'tmp/custom-smoke',
      runUi: false,
      explicitOpportunityId: 'opp-123',
      smokeCookie: 'sid=secret',
      expectedCommit: '852f4a0',
    });

    const report = createSmokeReport(config, new Date('2026-05-29T00:00:00.000Z'));
    expect(JSON.stringify(report)).not.toContain('sid=secret');
    expect(report.mode).toMatchObject({
      writes: false,
      usesDevLogin: false,
      usesSmokeCookie: true,
      uiAuth: 'route-interception-only',
    });
    expect(report.expected).toEqual({ gitCommit: '852f4a0' });
  });

  it('checks deployed config fingerprints against an expected commit prefix', () => {
    expect(
      deploymentFingerprintCheck(
        {
          deployment: {
            provider: 'render',
            gitCommit: '852f4a05355bb17dbfce9d1197f4693ddf2ccb2a',
            gitBranch: 'main',
          },
        },
        '852f4a0',
      ),
    ).toEqual({
      status: 'pass',
      expectedCommit: '852f4a0',
      actualCommit: '852f4a05355bb17dbfce9d1197f4693ddf2ccb2a',
      provider: 'render',
      gitBranch: 'main',
    });

    expect(
      deploymentFingerprintCheck(
        {
          deployment: {
            gitCommit: '1111111111111111111111111111111111111111',
          },
        },
        '852f4a0',
      ),
    ).toMatchObject({
      status: 'fail',
      expectedCommit: '852f4a0',
      actualCommit: '1111111111111111111111111111111111111111',
    });

    expect(deploymentFingerprintCheck({}, '852f4a0')).toMatchObject({
      status: 'fail',
      expectedCommit: '852f4a0',
      actualCommit: '',
    });
  });

  it('uses the smoke config expected commit when checking deployment fingerprints', () => {
    const smokeConfig = parseSmokeConfig(['--expect-commit', '852f4a0'], {});

    expect(deploymentFingerprintCheckFromSmokeConfig(smokeConfig, {})).toMatchObject({
      status: 'fail',
      expectedCommit: '852f4a0',
      actualCommit: '',
    });
  });

  it('detects internal labels while allowing Operator Board only where explicit', () => {
    const payload = {
      title: 'Operator Board',
      visibility: 'operator_review',
      tierField: 'studentVisibilityTier',
    };

    expect(containsInternalLabels(payload)).toEqual([
      'operator_review',
      'studentVisibilityTier',
      'Operator Board',
    ]);
    expect(containsInternalLabels(payload, { allowOperatorBoard: true })).toEqual([
      'operator_review',
      'studentVisibilityTier',
    ]);
  });

  it('flags placeholder or malformed smoke targets before network calls', () => {
    const placeholder = parseSmokeConfig(
      ['--api-base', 'https://<host>/api', '--app-base', 'https://app.example.test'],
      {},
    );
    expect(validateSmokeConfig(placeholder)).toEqual([
      'apiBase must replace the runbook placeholder <host> before smoke execution.',
    ]);

    const malformed = parseSmokeConfig(
      ['--api-base', 'localhost:4000/api', '--app-base', 'app.example.test'],
      {},
    );
    expect(validateSmokeConfig(malformed)).toEqual([
      'apiBase must be an absolute http(s) URL.',
      'appBase must be an absolute http(s) URL.',
    ]);
  });

  it('rejects credentialed smoke target URLs before they can be written to reports', () => {
    const credentialed = parseSmokeConfig(
      [
        '--api-base',
        'https://operator:secret@example.test/api',
        '--app-base',
        'https://viewer:secret@app.example.test',
      ],
      {},
    );

    expect(validateSmokeConfig(credentialed)).toEqual([
      'apiBase must not include username or password credentials.',
      'appBase must not include username or password credentials.',
    ]);

    const report = createSmokeReport(credentialed, new Date('2026-05-29T00:00:00.000Z'));
    expect(JSON.stringify(report)).not.toContain('operator:secret');
    expect(JSON.stringify(report)).not.toContain('viewer:secret');
    expect(report.apiBase).toBe('https://example.test/api');
    expect(report.appBase).toBe('https://app.example.test');
  });

  it('rejects ambiguous smoke CLI arguments', () => {
    expect(() => parseSmokeConfig(['prod'], {})).toThrow(
      /Unknown production promotion smoke argument: prod/,
    );
    expect(() => parseSmokeConfig(['--api-base'], {})).toThrow(/--api-base requires a value/);
  });

  it('derives browser origins and only sends them for unsafe API methods', () => {
    expect(smokeBrowserOrigin('https://yalelabs.io/research')).toBe('https://yalelabs.io');
    expect(smokeBrowserOrigin('not a url')).toBe('');

    expect(shouldSendSmokeOrigin('POST')).toBe(true);
    expect(shouldSendSmokeOrigin('put')).toBe(true);
    expect(shouldSendSmokeOrigin()).toBe(false);
    expect(shouldSendSmokeOrigin('GET')).toBe(false);
    expect(shouldSendSmokeOrigin('OPTIONS')).toBe(false);
  });

  it('summarizes fail and warn check names for CLI output', () => {
    const report = createSmokeReport(
      parseSmokeConfig([], {}),
      new Date('2026-05-29T00:00:00.000Z'),
    );
    (report.checks as Array<{ name: string; status: string }>).push(
      { name: 'api.config.200', status: 'pass' },
      { name: 'api.opportunity.explicitPublicId', status: 'warn' },
      { name: 'api.admin.operatorBoard.requiresAuth', status: 'fail' },
    );

    expect(summarizeSmokeReport(report, '/tmp/report.json')).toEqual({
      status: 'fail',
      failures: ['api.admin.operatorBoard.requiresAuth'],
      warnings: ['api.opportunity.explicitPublicId'],
      reportPath: '/tmp/report.json',
    });
  });

  it('turns missing browser security headers into smoke failures', () => {
    const goodHeaders = new Headers({
      'content-security-policy': "default-src 'self'; object-src 'none'; frame-ancestors 'none'",
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
      'x-frame-options': 'DENY',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'cross-origin-opener-policy': 'same-origin',
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
    });
    expect(
      buildSecurityHeaderChecks('api.config.headers', goodHeaders).map((check) => check.status),
    ).toEqual(['pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass']);

    const missingHeaders = new Headers({
      'x-frame-options': 'DENY',
      'x-content-type-options': 'nosniff',
    });
    expect(buildSecurityHeaderChecks('api.config.headers', missingHeaders)).toEqual([
      expect.objectContaining({
        name: 'api.config.headers.contentSecurityPolicy',
        status: 'fail',
      }),
      expect.objectContaining({
        name: 'api.config.headers.permissionsPolicy',
        status: 'fail',
      }),
      expect.objectContaining({
        name: 'api.config.headers.xFrameOptions',
        status: 'pass',
      }),
      expect.objectContaining({
        name: 'api.config.headers.xContentTypeOptions',
        status: 'pass',
      }),
      expect.objectContaining({
        name: 'api.config.headers.referrerPolicy',
        status: 'fail',
      }),
      expect.objectContaining({
        name: 'api.config.headers.crossOriginOpenerPolicy',
        status: 'fail',
      }),
      expect.objectContaining({
        name: 'api.config.headers.strictTransportSecurity',
        status: 'fail',
      }),
    ]);
  });
});
