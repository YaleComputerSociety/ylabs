/**
 * Passport.js configuration for Yale CAS authentication.
 */
import express from 'express';
import passport from 'passport';
import { Strategy } from 'passport-cas';
import { recordAccountLogin, validateAccount } from './services/accountService';
import { classifyYalieByNetid } from './services/yaliesService';
import { fetchFromDirectory, isFacultyTitle } from './services/directoryService';
import { logEvent } from './services/analyticsService';
import { AnalyticsEventType } from './models/index';
import {
  isLocalDevelopmentRuntime as isLocalDevelopmentEnvironment,
  requiresDeployedRuntimeSecurity,
} from './utils/environment';
import { isPrivateOrLocalHostname } from './utils/urlSafety';
import { allowsLegacyAdminUserType, hasActiveAdminGrant } from './services/adminGrantService';
import { sanitizeLogValue } from './utils/logSanitizer';
import { triggerReconnect, isTopologyLostError, withMongoReconnect } from './db/connections';
import { authLimiter } from './middleware/rateLimiters';

/**
 * Verbose auth tracing. These logs (per-request deserialization, the
 * find-or-create source cascade, analytics-event confirmations) are useful
 * when debugging an auth issue but are pure noise in steady state — many fire
 * on every authenticated request. Off by default; set `AUTH_DEBUG=true` to
 * enable. Genuine errors and anomalies stay on unconditional console.error/log.
 */
const authDebug = (...args: unknown[]) => {
  if (process.env.AUTH_DEBUG === 'true') console.log(...args.map((arg) => sanitizeLogValue(arg)));
};

const AUTH_NETID_RE = /^[A-Za-z0-9]{2,12}$/;
const MAX_AUTH_REDIRECT_LENGTH = 2048;
const MAX_AUTH_ORIGIN_HEADER_LENGTH = 2048;
const RELATIVE_REDIRECT_BASE = 'https://redirect.local';
type AuthenticatedSessionUser = {
  netId: string;
  userType?: string;
  userConfirmed?: boolean;
  profileVerified?: boolean;
};

type PassportAuthInfo = {
  message?: string;
};

type PersistedUser = {
  netid?: string;
  userType?: string;
  userConfirmed?: boolean;
  profileVerified?: boolean;
};

/**
 * Resolve a caller-supplied redirect to a safe same-origin target.
 * Accepts only relative paths ("/foo") or absolute URLs whose origin matches
 * SERVER_BASE_URL. Anything else returns null.
 */
function safeRedirectTarget(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (raw.length > MAX_AUTH_REDIRECT_LENGTH) return null;
  // Reject backslashes and control/whitespace chars before the checks below:
  // browsers normalize "\" to "/", so "/\evil.com" would otherwise slip past
  // the "//" guard and become a protocol-relative open redirect.
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code <= 0x20 || code === 0x5c) return null;
  }
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    try {
      const target = new URL(raw, RELATIVE_REDIRECT_BASE);
      if (target.origin !== RELATIVE_REDIRECT_BASE) return null;
      const path = `${target.pathname}${target.search}${target.hash}`;
      if (!path.startsWith('/') || path.startsWith('//')) return null;
      if (/^\/%(?:2f|5c)/i.test(path) || /%(?:0a|0d)/i.test(path)) return null;
      return path;
    } catch {
      return null;
    }
  }
  try {
    const base = unquoteEnvValue(process.env.SERVER_BASE_URL);
    const target = new URL(raw);
    if (target.username || target.password) return null;
    if (isLocalDevelopmentRuntime() && target.origin === 'http://localhost:3000') {
      return target.toString();
    }
    if (!base) return null;
    const baseOrigin = new URL(base).origin;
    if (target.origin === baseOrigin) return target.toString();
  } catch {
    return null;
  }
  return null;
}

function originFromUrl(value: string | undefined): string {
  if (!value) return '';
  if (value.length > MAX_AUTH_ORIGIN_HEADER_LENGTH) return '';
  if (
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return isAsciiControlCode(code) || code === 0x20 || character === '\\';
    })
  )
    return '';
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

function unquoteEnvValue(value: string | undefined): string {
  return String(value || '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
}

function isLocalDevelopmentRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return isLocalDevelopmentEnvironment(env);
}

function isDevLoginAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return isLocalDevelopmentRuntime(env);
}

function isTruthyEnvFlag(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(unquoteEnvValue(value).toLowerCase());
}

function isLocalAuthBypassAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return isLocalDevelopmentRuntime(env) && isTruthyEnvFlag(env.LOCAL_AUTH_BYPASS);
}

function isTrustedLogoutRequest(req: express.Request): boolean {
  if (!requiresDeployedRuntimeSecurity()) return true;

  // Sec-Fetch-Site is set by the browser and cannot be forged by JavaScript.
  // Referrer-Policy: no-referrer strips Referer on navigation, but Sec-Fetch-Site
  // is always present for same-origin navigations (e.g. window.location.href).
  const secFetchSite = req.get('sec-fetch-site');
  if (secFetchSite === 'same-origin') return true;

  const allowedOrigin = originFromUrl(authConfig.serverBaseURL);
  if (!allowedOrigin) return false;

  if (req.get('origin') !== undefined) {
    const origin = originFromUrl(req.get('origin'));
    return Boolean(origin && origin === allowedOrigin);
  }

  const refererOrigin = originFromUrl(req.get('referer'));
  return refererOrigin === allowedOrigin;
}

function requireProductionHttpsUrl(
  env: NodeJS.ProcessEnv,
  name: 'SSOBASEURL' | 'SERVER_BASE_URL',
): string {
  const raw = unquoteEnvValue(env[name]);
  if (!raw) {
    throw new Error(`${name} must be set in deployed runtimes.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL in deployed runtimes.`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`${name} must use HTTPS in deployed runtimes.`);
  }

  if (parsed.username || parsed.password) {
    throw new Error(`${name} must not include credentials in deployed runtimes.`);
  }

  if (parsed.search || parsed.hash) {
    throw new Error(`${name} must not include query strings or fragments in deployed runtimes.`);
  }

  if (isPrivateOrLocalHostname(parsed.hostname)) {
    throw new Error(`${name} must not point to a private or local host in deployed runtimes.`);
  }

  return raw.replace(/\/+$/g, '');
}

function resolveAuthConfig(env: NodeJS.ProcessEnv = process.env) {
  if (requiresDeployedRuntimeSecurity(env)) {
    return {
      ssoBaseURL: requireProductionHttpsUrl(env, 'SSOBASEURL'),
      serverBaseURL: requireProductionHttpsUrl(env, 'SERVER_BASE_URL'),
    };
  }

  return {
    ssoBaseURL: unquoteEnvValue(env.SSOBASEURL),
    serverBaseURL: unquoteEnvValue(env.SERVER_BASE_URL),
  };
}

function validateProductionAuthConfig(env: NodeJS.ProcessEnv = process.env): void {
  resolveAuthConfig(env);
}

function normalizedHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

// Every real account in the database is 'undergraduate' or 'graduate' —
// bare 'student' is never actually assigned (Yalies and the /unknown
// bootstrap form both only ever produce undergraduate/graduate) — so
// dev/local-bypass tooling defaults to 'undergraduate' to match reality.
function normalizeDevUserType(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ['admin', 'undergraduate', 'graduate', 'professor', 'faculty', 'unknown'].includes(
    normalized,
  )
    ? normalized
    : 'undergraduate';
}

// Mirrors the full User schema userType enum (models/user.ts). Unlike
// normalizeDevUserType (a narrow allowlist for the dev-login query param),
// this runs on an already-persisted user's real userType for the client-
// facing /check payload, so it must accept every value the schema can
// actually store — 'undergraduate'/'graduate' most of all, since that's
// nearly every real account. Missing one here silently reports every such
// user as 'unknown' to the client on every request, regardless of what's
// in the database.
const SESSION_USER_TYPES = [
  'admin',
  'professor',
  'faculty',
  'student',
  'undergraduate',
  'graduate',
  'staff',
  'unknown',
];

function normalizeSessionUserType(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return SESSION_USER_TYPES.includes(normalized) ? normalized : 'unknown';
}

function normalizeAuthNetId(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return AUTH_NETID_RE.test(normalized) ? normalized : undefined;
}

function publicAuthSessionUser(user: unknown): AuthenticatedSessionUser | null {
  const source = user && typeof user === 'object' ? (user as Record<string, unknown>) : {};
  const netId = normalizeAuthNetId(source.netId);
  if (!netId) return null;

  return {
    netId,
    userType: normalizeSessionUserType(source.userType),
    userConfirmed: source.userConfirmed === true,
    profileVerified: source.profileVerified === true,
  };
}

function coerceStoredSessionPrincipal(stored: unknown): AuthenticatedSessionUser | null {
  if (typeof stored === 'string') {
    const netId = normalizeAuthNetId(stored);
    return netId
      ? { netId, userType: 'unknown', userConfirmed: false, profileVerified: false }
      : null;
  }
  return publicAuthSessionUser(stored);
}

function localAuthBypassUser(
  env: NodeJS.ProcessEnv = process.env,
  headers: express.Request['headers'] = {},
) {
  const netId =
    normalizeAuthNetId(normalizedHeaderValue(headers['x-dev-netid'])) ||
    normalizeAuthNetId(unquoteEnvValue(env.LOCAL_AUTH_BYPASS_NETID)) ||
    'devadmin';
  const userType = normalizeDevUserType(
    normalizedHeaderValue(headers['x-dev-user-type']) ||
      unquoteEnvValue(env.LOCAL_AUTH_BYPASS_USER_TYPE) ||
      'admin',
  );

  return {
    netId,
    userType,
    userConfirmed: true,
    profileVerified: true,
  };
}

async function ensureLocalAuthBypassUser(
  env: NodeJS.ProcessEnv = process.env,
  headers: express.Request['headers'] = {},
): Promise<AuthenticatedSessionUser> {
  if (!isLocalAuthBypassAllowed(env)) {
    throw new Error('Local auth bypass is disabled for this environment');
  }

  const bypassUser = localAuthBypassUser(env, headers);
  await recordAccountLogin({
    netid: bypassUser.netId,
    email: `${bypassUser.netId.toLowerCase()}@example.invalid`,
  });

  return bypassUser;
}

function shouldSkipLocalAuthBypass(path: string): boolean {
  return ['/cas', '/logout', '/dev-login'].some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

function placeholderYaleEmail(netid: string): string {
  return `${netid.trim().toLowerCase()}@yale.edu`;
}

const DEV_LOGIN_PROFILES: Record<string, { netId: string; fname: string; lname: string }> = {
  admin: { netId: 'devadmin', fname: 'Dev', lname: 'Admin' },
  undergraduate: { netId: 'test123', fname: 'Test', lname: 'Student' },
  graduate: { netId: 'devgraduate', fname: 'Dev', lname: 'Graduate' },
  professor: { netId: 'devprofessor', fname: 'Dev', lname: 'Professor' },
  faculty: { netId: 'devprofessor', fname: 'Dev', lname: 'Professor' },
  unknown: { netId: 'devunknown', fname: 'NA', lname: 'NA' },
};

async function ensureDevLoginUser(userType: unknown) {
  if (!isDevLoginAllowed()) {
    throw new Error('Dev login is disabled for this environment');
  }

  const normalizedUserType = normalizeDevUserType(userType);
  const profile = DEV_LOGIN_PROFILES[normalizedUserType] ?? DEV_LOGIN_PROFILES.undergraduate;
  // A real 'unknown' user is unconfirmed/unverified until they complete the
  // /unknown bootstrap form; every other dev role is pre-confirmed so it can
  // exercise the rest of the app immediately.
  const isBootstrappedType = normalizedUserType !== 'unknown';
  const netId = profile.netId;
  await recordAccountLogin({ netid: netId, email: `${netId}@example.invalid` });

  return {
    netId,
    userType: normalizedUserType,
    userConfirmed: isBootstrappedType,
    profileVerified: isBootstrappedType,
  };
}

async function buildAuthenticatedSessionUser(
  user: PersistedUser,
  fallbackNetId: string,
): Promise<AuthenticatedSessionUser> {
  const netId = normalizeAuthNetId(user.netid || fallbackNetId);
  if (!netId) {
    throw new Error('Invalid authentication principal');
  }
  const persistedUserType = user.userType || 'unknown';
  const grantBackedAdmin = await hasActiveAdminGrant(netId);
  const localDevelopmentAdmin =
    persistedUserType === 'admin' && allowsLegacyAdminUserType(process.env);
  const userType =
    grantBackedAdmin || localDevelopmentAdmin
      ? 'admin'
      : persistedUserType === 'admin'
        ? 'unknown'
        : persistedUserType;

  return {
    netId,
    userType,
    userConfirmed: user.userConfirmed,
    profileVerified: user.profileVerified || false,
  };
}

/**
 * Resolve the login principal for a CAS-authenticated netid and ensure the
 * backing Account exists. Classification is derived at login (Yalies for
 * undergrad/grad, Yale Directory for faculty) without persisting a legacy
 * User; only the private Account is written, stamping lastLoginAt.
 */
async function resolveLoginPrincipalForCas(rawNetid: string): Promise<PersistedUser> {
  const netid = normalizeAuthNetId(rawNetid);
  if (!netid) {
    throw new Error('Invalid authentication principal');
  }

  let userType = 'unknown';
  let userConfirmed = false;
  let email: string | undefined;

  const yalie = await classifyYalieByNetid(netid);
  if (yalie) {
    userType = yalie.userType;
    userConfirmed = yalie.userConfirmed;
    email = yalie.email;
    authDebug(`resolveLoginPrincipalForCas: Yalies success, type=${userType}`);
  } else {
    try {
      const dirPerson = await fetchFromDirectory(netid, 'netid');
      if (dirPerson && dirPerson.name) {
        const facultyTitle = isFacultyTitle(dirPerson.title);
        userType = facultyTitle ? 'professor' : 'unknown';
        userConfirmed = facultyTitle;
        email = dirPerson.email || undefined;
        authDebug(`resolveLoginPrincipalForCas: Directory record found, type=${userType}`);
      }
    } catch {
      authDebug('resolveLoginPrincipalForCas: directory lookup failed, using default principal');
    }
  }

  await recordAccountLogin({ netid, email });

  return { netid, userType, userConfirmed, profileVerified: false };
}

const authConfig = resolveAuthConfig();

passport.use(
  new Strategy(
    {
      version: 'CAS1.0',
      ssoBaseURL: authConfig.ssoBaseURL,
      serverBaseURL: authConfig.serverBaseURL,
    },
    async function (profile, done) {
      try {
        const principal = await withMongoReconnect(() =>
          resolveLoginPrincipalForCas(profile.user),
        );
        done(null, await buildAuthenticatedSessionUser(principal, profile.user));
      } catch (error) {
        console.log('Error in CAS login');
        done(error);
      }
    },
  ),
);

passport.serializeUser(function (user: any, done) {
  authDebug('Serializing user');
  const principal = publicAuthSessionUser(user);
  if (!principal) {
    done(new Error('Invalid authentication principal'));
    return;
  }
  done(null, principal);
});

// Runs on every authenticated request, so login-time classification
// (Yalies/Directory) must not run here; the signed session carries the
// classified principal and only the dynamic admin grant is re-applied. A
// missing or archived Account deserializes to unauthenticated.
passport.deserializeUser(async (stored: unknown, done) => {
  try {
    authDebug('Deserializing user');
    const principal = coerceStoredSessionPrincipal(stored);
    if (!principal) {
      done(null, null);
      return;
    }
    const account = await withMongoReconnect(() => validateAccount(principal.netId));
    if (!account || account.archived) {
      done(null, null);
      return;
    }
    done(
      null,
      await buildAuthenticatedSessionUser(
        {
          netid: principal.netId,
          userType: principal.userType,
          userConfirmed: principal.userConfirmed,
          profileVerified: principal.profileVerified,
        },
        principal.netId,
      ),
    );
  } catch (error) {
    console.log('Deserialize: Error');
    done(error, null);
  }
});

const setPrivateAuthResponseHeaders = (res: express.Response): void => {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
};

const casLogin = function (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  setPrivateAuthResponseHeaders(res);
  passport.authenticate(
    'cas',
    function (
      err: Error | null,
      user: AuthenticatedSessionUser | false | null | undefined,
      _info: PassportAuthInfo = {},
    ) {
      if (err) {
        console.log('Error in authenticate function');
        console.error('Authentication error details:', sanitizeLogValue(err));

        const errorRedirect = safeRedirectTarget(req.query?.error);
        if (errorRedirect) {
          return res.redirect(errorRedirect);
        }

        if (isTopologyLostError(err)) {
          void triggerReconnect();
          return res
            .status(503)
            .json({ error: 'Service temporarily unavailable, please try again' });
        }

        return res.status(401).json({ error: 'Error in authentication' });
      }

      if (!user) {
        console.log('CAS auth but no user');
        return res.status(401).json({ error: 'CAS auth but no user' });
      }

      req.logIn(user, async function (err) {
        if (err) {
          console.error('CAS login failed during session creation');
          return next(err);
        }

        try {
          await logEvent({
            eventType: AnalyticsEventType.LOGIN,
            netid: user.netId,
            userType: user.userType || 'unknown',
            metadata: {
              timestamp: new Date(),
              loginMethod: 'CAS',
            },
          });
          authDebug('Login event logged to analytics');
        } catch (analyticsError) {
          console.error('Error logging analytics event:', sanitizeLogValue(analyticsError));
        }

        const safeTarget = safeRedirectTarget(req.query?.redirect);
        if (safeTarget) {
          return res.redirect(safeTarget);
        }

        const defaultRedirect = isLocalDevelopmentRuntime() ? 'http://localhost:3000' : '/';
        return res.redirect(defaultRedirect);
      });
    },
  )(req, res, next);
};

const router = express.Router();

router.use(async (req, res, next) => {
  if (!req.user && isLocalAuthBypassAllowed() && !shouldSkipLocalAuthBypass(req.path)) {
    try {
      req.user = (await ensureLocalAuthBypassUser(process.env, req.headers)) as Express.User;
    } catch (error) {
      next(error);
      return;
    }
  }

  if (req.isAuthenticated() && !req.session!.visitorLogged) {
    const user = req.user as any;
    try {
      await logEvent({
        eventType: AnalyticsEventType.VISITOR,
        netid: user.netId,
        userType: user.userType || 'unknown',
        metadata: {
          timestamp: new Date(),
          loginMethod: 'cookie',
        },
      });
      authDebug('🍪 Visitor event logged to analytics (cookie login)');
      req.session!.visitorLogged = true;
    } catch (analyticsError) {
      console.error('Error logging visitor analytics event:', sanitizeLogValue(analyticsError));
    }
  }
  next();
});

router.get('/check', (req, res) => {
  setPrivateAuthResponseHeaders(res);
  if (req.user) {
    const user = publicAuthSessionUser(req.user);
    if (user) {
      return res.json({ auth: true, user });
    }
  } else {
    return res.json({ auth: false });
  }
  return res.json({ auth: false });
});

router.get('/cas', authLimiter, casLogin);

const logoutRouteHandler = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): Promise<void | express.Response> => {
  setPrivateAuthResponseHeaders(res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('Logging out user');

  if (!isTrustedLogoutRequest(req)) {
    return res.status(403).json({ error: 'Cross-site logout blocked' });
  }

  if (req.user) {
    const user = req.user as any;
    try {
      await logEvent({
        eventType: AnalyticsEventType.LOGOUT,
        netid: user.netId,
        userType: user.userType || 'unknown',
        metadata: {
          timestamp: new Date(),
        },
      });
      authDebug('Logout event logged to analytics');
    } catch (analyticsError) {
      console.error('Error logging analytics event:', sanitizeLogValue(analyticsError));
    }
  }

  const casLogoutUrl = `${authConfig.ssoBaseURL}/logout`;

  let serviceUrl;

  if (isLocalDevelopmentRuntime()) {
    serviceUrl = 'http://localhost:3000/login';
  } else {
    serviceUrl = `${authConfig.serverBaseURL}/login`;
  }

  const fullLogoutUrl = `${casLogoutUrl}?service=${encodeURIComponent(serviceUrl)}`;
  req.logOut((logoutError: Error | null) => {
    if (logoutError) {
      next(logoutError);
      return;
    }

    res.redirect(fullLogoutUrl);
  });
};

router.get('/logout', (req, res, next) => {
  void logoutRouteHandler(req, res, next).catch(next);
});

if (isDevLoginAllowed()) {
  router.get('/dev-login', async (req, res) => {
    setPrivateAuthResponseHeaders(res);
    if (!isDevLoginAllowed()) {
      return res.status(403).json({ error: 'Dev login is disabled for this environment' });
    }

    try {
      const testUser = await ensureDevLoginUser(req.query?.userType);
      authDebug('Dev login user prepared');

      req.logIn(testUser, async (err) => {
        if (err) {
          console.error('Dev login error:', sanitizeLogValue(err));
          return res.status(500).json({ error: 'Dev login failed' });
        }

        try {
          await logEvent({
            eventType: AnalyticsEventType.LOGIN,
            netid: testUser.netId,
            userType: testUser.userType || 'unknown',
            metadata: {
              timestamp: new Date(),
              loginMethod: 'dev-login',
            },
          });
          authDebug('Dev login event logged to analytics');
        } catch (analyticsError) {
          console.error(
            'Error logging dev login analytics event:',
            sanitizeLogValue(analyticsError),
          );
        }

        const redirectUrl = safeRedirectTarget(req.query?.redirect) ?? 'http://localhost:3000';
        res.redirect(redirectUrl);
      });
    } catch (error) {
      console.error('Dev login error:', sanitizeLogValue(error));
      res.status(500).json({ error: 'Dev login failed' });
    }
  });
}

export {
  ensureDevLoginUser,
  ensureLocalAuthBypassUser,
  isDevLoginAllowed,
  isLocalAuthBypassAllowed,
  isLocalDevelopmentRuntime,
  localAuthBypassUser,
  logoutRouteHandler,
  placeholderYaleEmail,
  shouldSkipLocalAuthBypass,
  validateProductionAuthConfig,
};
export { router as passportRoutes };
export default passport;
import { isAsciiControlCode } from './utils/asciiControl';
