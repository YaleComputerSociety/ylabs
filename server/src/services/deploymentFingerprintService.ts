/**
 * Operator-only deployment fingerprint, kept out of the public config payload.
 */
import { timingSafeEqual } from 'node:crypto';

export interface DeploymentFingerprint {
  provider: 'render' | 'unknown';
  gitCommit: string;
  gitBranch: string;
}

type FingerprintEnv = {
  [key: string]: string | undefined;
};

const MAX_FINGERPRINT_VALUE_LENGTH = 100;

const fingerprintValue = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._/-]/g, '')
    .slice(0, MAX_FINGERPRINT_VALUE_LENGTH);

export const buildOperatorDeploymentFingerprint = (
  env: FingerprintEnv = process.env,
): DeploymentFingerprint => ({
  provider: env.RENDER === 'true' ? 'render' : 'unknown',
  gitCommit: fingerprintValue(env.RENDER_GIT_COMMIT),
  gitBranch: fingerprintValue(env.RENDER_GIT_BRANCH),
});

export const deploymentFingerprintToken = (env: FingerprintEnv = process.env): string =>
  String(env.DEPLOYMENT_FINGERPRINT_TOKEN ?? '').trim();

export const isAuthorizedFingerprintToken = (
  presented: unknown,
  env: FingerprintEnv = process.env,
): boolean => {
  const expected = deploymentFingerprintToken(env);
  if (!expected) return false;

  const presentedValue = typeof presented === 'string' ? presented.trim() : '';
  if (!presentedValue) return false;

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const presentedBuffer = Buffer.from(presentedValue, 'utf8');
  if (expectedBuffer.length !== presentedBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, presentedBuffer);
};
