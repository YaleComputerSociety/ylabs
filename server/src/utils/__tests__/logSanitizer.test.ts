import { describe, expect, it } from 'vitest';
import { sanitizeLogValue } from '../logSanitizer';

describe('sanitizeLogValue', () => {
  it('redacts camelCase token and secret fields in structured values', () => {
    const logged = sanitizeLogValue({
      accessToken: 'access-token-secret',
      refreshToken: 'refresh-token-secret',
      idToken: 'id-token-secret',
      csrfToken: 'csrf-token-secret',
      clientSecret: 'client-secret-value',
      cookie: 'session=abc123; other=def456',
      setCookie: 'session=abc123; Path=/; HttpOnly',
    });

    expect(logged).toContain('[secret-redacted]');
    expect(logged).not.toContain('access-token-secret');
    expect(logged).not.toContain('refresh-token-secret');
    expect(logged).not.toContain('id-token-secret');
    expect(logged).not.toContain('csrf-token-secret');
    expect(logged).not.toContain('client-secret-value');
    expect(logged).not.toContain('abc123');
    expect(logged).not.toContain('def456');
  });

  it('redacts whole secret-bearing header lines and assignments', () => {
    const logged = sanitizeLogValue(
      [
        'Authorization: Bearer raw-access-token',
        'Set-Cookie: session=abc123; Path=/; HttpOnly',
        'X-Seed-Token: seed-token-secret',
        'clientSecret=client-secret-value',
      ].join('\n'),
    );

    expect(logged).toContain('Authorization: [secret-redacted]');
    expect(logged).toContain('Set-Cookie: [secret-redacted]');
    expect(logged).toContain('X-Seed-Token: [secret-redacted]');
    expect(logged).toContain('clientSecret=[secret-redacted]');
    expect(logged).not.toContain('raw-access-token');
    expect(logged).not.toContain('abc123');
    expect(logged).not.toContain('seed-token-secret');
    expect(logged).not.toContain('client-secret-value');
  });

  it('redacts before bounding oversized log values', () => {
    const logged = sanitizeLogValue(
      `prefix Authorization: Bearer raw-access-token apiKey=raw-api-key ${'x'.repeat(13000)}`,
    );

    expect(logged.length).toBeLessThanOrEqual(12015);
    expect(logged).toContain('[log-truncated]');
    expect(logged).not.toContain('raw-access-token');
    expect(logged).not.toContain('raw-api-key');
  });
});
