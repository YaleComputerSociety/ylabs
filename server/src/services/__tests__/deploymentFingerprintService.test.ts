import { describe, expect, it } from 'vitest';

import {
  buildOperatorDeploymentFingerprint,
  isAuthorizedFingerprintToken,
} from '../deploymentFingerprintService';

describe('deploymentFingerprintService', () => {
  it('exposes the commit and branch for operator callers', () => {
    expect(
      buildOperatorDeploymentFingerprint({
        RENDER: 'true',
        RENDER_GIT_COMMIT: '852f4a05355bb17dbfce9d1197f4693ddf2ccb2a',
        RENDER_GIT_BRANCH: 'main',
      }),
    ).toEqual({
      provider: 'render',
      gitCommit: '852f4a05355bb17dbfce9d1197f4693ddf2ccb2a',
      gitBranch: 'main',
    });
  });

  it('reports unknown provider and empty fingerprint off Render', () => {
    expect(buildOperatorDeploymentFingerprint({})).toEqual({
      provider: 'unknown',
      gitCommit: '',
      gitBranch: '',
    });
  });

  it('never echoes unrelated environment values', () => {
    const fingerprint = buildOperatorDeploymentFingerprint({
      RENDER: 'true',
      RENDER_GIT_COMMIT: 'aaaaaaa',
      RENDER_SERVICE_ID: 'srv-private-id',
      SESSION_SECRET: 'do-not-expose',
      MONGODBURL: 'redacted-database-connection-string',
    });

    const serialized = JSON.stringify(fingerprint);
    expect(serialized).not.toContain('srv-private-id');
    expect(serialized).not.toContain('do-not-expose');
    expect(serialized).not.toContain('redacted-database-connection-string');
  });

  it('bounds and strips hostile fingerprint values', () => {
    const fingerprint = buildOperatorDeploymentFingerprint({
      RENDER: 'true',
      RENDER_GIT_COMMIT: `<script>alert(1)</script>${'a'.repeat(400)}`,
      RENDER_GIT_BRANCH: 'feature/branch name\nInjected: header',
    });

    expect(fingerprint.gitCommit).not.toContain('<');
    expect(fingerprint.gitCommit.length).toBeLessThanOrEqual(100);
    expect(fingerprint.gitBranch).toBe('feature/branchnameInjectedheader');
  });

  it('fails closed when no operator token is configured', () => {
    expect(isAuthorizedFingerprintToken('anything', {})).toBe(false);
    expect(isAuthorizedFingerprintToken('', {})).toBe(false);
    expect(isAuthorizedFingerprintToken(undefined, { DEPLOYMENT_FINGERPRINT_TOKEN: '   ' })).toBe(
      false,
    );
  });

  it('authorizes only an exact token match', () => {
    const env = { DEPLOYMENT_FINGERPRINT_TOKEN: 'ops-token-value' };

    expect(isAuthorizedFingerprintToken('ops-token-value', env)).toBe(true);
    expect(isAuthorizedFingerprintToken('ops-token-valu', env)).toBe(false);
    expect(isAuthorizedFingerprintToken('ops-token-value-extra', env)).toBe(false);
    expect(isAuthorizedFingerprintToken('OPS-TOKEN-VALUE', env)).toBe(false);
    expect(isAuthorizedFingerprintToken(undefined, env)).toBe(false);
    expect(isAuthorizedFingerprintToken(12345, env)).toBe(false);
  });
});
