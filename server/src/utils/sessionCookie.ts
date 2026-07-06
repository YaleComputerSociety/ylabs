import { requiresDeployedRuntimeSecurity } from './environment';

export const sessionCookieName = (env: NodeJS.ProcessEnv = process.env): string =>
  requiresDeployedRuntimeSecurity(env) ? '__Host-session' : 'session';
