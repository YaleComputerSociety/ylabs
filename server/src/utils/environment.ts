/**
 * Environment variable configuration and validation.
 */
export const nodeEnvValue = (env: NodeJS.ProcessEnv = process.env) =>
  String(env.NODE_ENV || '')
    .trim()
    .toLowerCase();

export const isCI = (env: NodeJS.ProcessEnv = process.env) => nodeEnvValue(env) === 'ci';
export const isDevelopment = (env: NodeJS.ProcessEnv = process.env) =>
  nodeEnvValue(env) === 'development' || nodeEnvValue(env) === 'dev';
export const isTest = (env: NodeJS.ProcessEnv = process.env) => nodeEnvValue(env) === 'test';
export const isProduction = (env: NodeJS.ProcessEnv = process.env) =>
  nodeEnvValue(env) === 'production' || nodeEnvValue(env) === 'prod';

const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const unquoteEnvValue = (value: string | undefined) =>
  String(value || '')
    .trim()
    .replace(/^['"]|['"]$/g, '');

export const isLocalHostValue = (value: string | undefined): boolean => {
  const raw = unquoteEnvValue(value);
  if (!raw) return false;

  try {
    const url = new URL(raw.includes('://') ? raw : `http://${raw}`);
    const hostname = url.hostname.toLowerCase();
    return LOCAL_DEV_HOSTS.has(hostname) || hostname.endsWith('.localhost');
  } catch {
    return false;
  }
};

export const isLocalDevelopmentRuntime = (env: NodeJS.ProcessEnv = process.env): boolean =>
  isDevelopment(env) && isLocalHostValue(env.SERVER_BASE_URL);

export const allowsNonProductionSecurityBypass = (env: NodeJS.ProcessEnv = process.env): boolean =>
  isCI(env) || isTest(env) || isLocalDevelopmentRuntime(env);

export const requiresDeployedRuntimeSecurity = (env: NodeJS.ProcessEnv = process.env): boolean =>
  isProduction(env) || !allowsNonProductionSecurityBypass(env);

export const requiresSecureSessionCookie = (env: NodeJS.ProcessEnv = process.env): boolean =>
  requiresDeployedRuntimeSecurity(env);

export const DEPLOYED_LISTEN_HOST = '0.0.0.0';
export const LOCAL_LISTEN_HOST = '127.0.0.1';

/**
 * A deployed runtime must accept connections on every interface, because the
 * hosting platform reaches the process from outside its network namespace.
 * A local run needs no interface beyond loopback.
 */
export const serverListenHost = (env: NodeJS.ProcessEnv = process.env): string =>
  requiresDeployedRuntimeSecurity(env) ? DEPLOYED_LISTEN_HOST : LOCAL_LISTEN_HOST;
