/**
 * Passport.js configuration for Yale CAS authentication.
 */
import express from 'express';
import passport from 'passport';
import { Strategy } from 'passport-cas';
import { validateUser, createUser, updateUser } from './services/userService';
import { fetchYalie } from './services/yaliesService';
import { fetchFromDirectory, isFacultyTitle } from './services/directoryService';
import { logEvent } from './services/analyticsService';
import { AnalyticsEventType } from './models/index';
import {
  isLocalDevelopmentRuntime as isLocalDevelopmentEnvironment,
  requiresDeployedRuntimeSecurity,
} from './utils/environment';
import { isPrivateOrLocalHostname } from './utils/urlSafety';
import {
  allowsLegacyAdminUserType,
  hasActiveAdminGrant,
} from './services/adminGrantService';
import { sanitizeLogValue } from './utils/logSanitizer';
import { triggerReconnect } from './db/connections';

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

const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;
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
  if (/[\u0000-\u0020\u007f\\]/.test(value)) return '';
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

function normalizeDevUserType(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ['admin', 'student', 'professor', 'faculty', 'unknown'].includes(normalized)
    ? normalized
    : 'student';
}

function normalizeSessionUserType(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ['admin', 'student', 'professor', 'faculty', 'unknown'].includes(normalized)
    ? normalized
    : 'unknown';
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

function shouldSkipLocalAuthBypass(path: string): boolean {
  return ['/cas', '/logout', '/dev-login'].some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

function placeholderYaleEmail(netid: string): string {
  return `${netid.trim().toLowerCase()}@yale.edu`;
}

async function ensureDevLoginUser(userType: unknown) {
  if (!isDevLoginAllowed()) {
    throw new Error('Dev login is disabled for this environment');
  }

  const normalizedUserType = normalizeDevUserType(userType) === 'admin' ? 'admin' : 'student';
  const netId = normalizedUserType === 'admin' ? 'devadmin' : 'test123';
  const userData = {
    netid: netId,
    email: `${netId}@example.invalid`,
    fname: normalizedUserType === 'admin' ? 'Dev' : 'Test',
    lname: normalizedUserType === 'admin' ? 'Admin' : 'Student',
    userType: normalizedUserType,
    userConfirmed: true,
    profileVerified: true,
  };
  const existing = await validateUser(netId);
  const user = existing ? await updateUser(netId, userData) : await createUser(userData);

  return {
    netId,
    userType: user.userType || normalizedUserType,
    userConfirmed: user.userConfirmed !== false,
    profileVerified: user.profileVerified || false,
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
 * Build an update object from directory data (only non-empty fields).
 */
function buildDirectoryUpdate(
  dirPerson: NonNullable<Awaited<ReturnType<typeof fetchFromDirectory>>>,
) {
  const update: Record<string, any> = {};
  if (dirPerson.firstName) update.fname = dirPerson.firstName;
  if (dirPerson.lastName) update.lname = dirPerson.lastName;
  if (dirPerson.email) update.email = dirPerson.email;
  if (dirPerson.department) update.departments = [dirPerson.department];
  if (dirPerson.title) update.title = dirPerson.title;
  if (dirPerson.phone) update.phone = dirPerson.phone;
  if (dirPerson.upi) update.upi = dirPerson.upi;
  if (dirPerson.unit) update.unit = dirPerson.unit;
  if (dirPerson.physicalLocation) update.physicalLocation = dirPerson.physicalLocation;
  if (dirPerson.buildingDesk) update.buildingDesk = dirPerson.buildingDesk;
  if (dirPerson.mailingAddress) update.mailingAddress = dirPerson.mailingAddress;
  return update;
}

/**
 * Shared helper: find or create a user by netid.
 * 1. Check if user already exists in DB (refresh from directory if stale)
 * 2. Try Yalies API (undergrad/grad detection)
 * 3. If Yalies fails, try Yale Directory (faculty detection)
 * 4. Fallback: create a default user
 */
async function findOrCreateUser(netid: string) {
  const safeNetid = normalizeAuthNetId(netid);
  if (!safeNetid) {
    throw new Error('Invalid authentication principal');
  }

  netid = safeNetid;
  let user = await validateUser(netid);
  if (user) {
    const updatedAt = user.updatedAt ? new Date(user.updatedAt).getTime() : 0;
    const isStale = Date.now() - updatedAt > STALE_THRESHOLD_MS;

    if (isStale) {
      authDebug(
        `findOrCreateUser: refreshing stale data (last updated: ${user.updatedAt || 'never'})`,
      );
      try {
        const dirPerson = await fetchFromDirectory(netid, 'netid');
        if (dirPerson && dirPerson.name) {
          const dirUpdate = buildDirectoryUpdate(dirPerson);
          if (user.userType === 'unknown' && isFacultyTitle(dirPerson.title)) {
            dirUpdate.userType = 'professor';
            dirUpdate.userConfirmed = true;
          }
          user = await updateUser(netid, dirUpdate);
          authDebug('findOrCreateUser: refreshed directory data');
        }
      } catch {
        authDebug('findOrCreateUser: directory refresh failed, using cached data');
      }
    } else {
      authDebug('findOrCreateUser: existing user cache hit');
    }
    return user;
  }

  authDebug('findOrCreateUser: trying Yalies API lookup');
  user = await fetchYalie(netid);
  if (user) {
    authDebug(`findOrCreateUser: Yalies success, type=${user.userType}`);
    return user;
  }

  authDebug('findOrCreateUser: Yalies failed, trying Yale Directory');
  const dirPerson = await fetchFromDirectory(netid, 'netid');
  if (dirPerson && dirPerson.name) {
    authDebug('findOrCreateUser: Directory record found');

    const userType = isFacultyTitle(dirPerson.title) ? 'professor' : 'unknown';
    const dirFields = buildDirectoryUpdate(dirPerson);
    user = await createUser({
      netid,
      fname: dirPerson.firstName || dirPerson.name.split(' ')[0] || 'NA',
      lname: dirPerson.lastName || dirPerson.name.split(' ').slice(1).join(' ') || 'NA',
      email: dirPerson.email || `${netid}@yale.edu`,
      departments: dirPerson.department ? [dirPerson.department] : [],
      userType,
      userConfirmed: userType === 'professor',
      ...dirFields,
    });
    authDebug(`findOrCreateUser: Directory user created, type=${userType}`);
    return user;
  }

  authDebug('findOrCreateUser: Directory also failed, creating default user');
  user = await createUser({
    netid,
    fname: netid,
    lname: netid,
    email: placeholderYaleEmail(netid),
  });
  return user;
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
        const user = await findOrCreateUser(profile.user);
        done(null, await buildAuthenticatedSessionUser(user, profile.user));
      } catch (error) {
        console.log('Error in CAS login');
        done(error);
      }
    },
  ),
);

passport.serializeUser(function (user: any, done) {
  authDebug('Serializing user');
  const safeNetId = normalizeAuthNetId(user?.netId);
  if (!safeNetId) {
    done(new Error('Invalid authentication principal'));
    return;
  }
  done(null, safeNetId);
});

// Runs on every authenticated request, so it must stay a plain read:
// the find-or-create cascade (user creation, Yalies/Directory refresh)
// belongs at login time only. A missing user doc means the session
// references someone we no longer know — treat as unauthenticated.
passport.deserializeUser(async (netId: string, done) => {
  try {
    authDebug('Deserializing user');
    const safeNetId = normalizeAuthNetId(netId);
    if (!safeNetId) {
      done(null, null);
      return;
    }
    const user = await validateUser(safeNetId);
    if (!user) {
      done(null, null);
      return;
    }
    done(null, await buildAuthenticatedSessionUser(user, safeNetId));
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
  passport.authenticate('cas', function (
    err: Error | null,
    user: AuthenticatedSessionUser | false | null | undefined,
    info: PassportAuthInfo = {},
  ) {
    if (err) {
      console.log('Error in authenticate function');
      console.error('Authentication error details:', sanitizeLogValue(err));

      const errorRedirect = safeRedirectTarget(req.query?.error);
      if (errorRedirect) {
        return res.redirect(errorRedirect);
      }

      // VError 1.x exposes cause as .cause() method, not a property.
      // Walk the chain via both APIs to catch the wrapped MongoNotConnectedError.
      const isInfraError = (function checkInfra(e: any): boolean {
        if (!e) return false;
        if (e.name === 'MongoNotConnectedError') return true;
        if (typeof e.message === 'string' && e.message.includes('Client must be connected before running operations')) return true;
        const cause = typeof e.cause === 'function' ? e.cause() : e.cause;
        return checkInfra(cause);
      })(err);
      if (isInfraError) {
        triggerReconnect();
        return res.status(503).json({ error: 'Service temporarily unavailable, please try again' });
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

      const defaultRedirect =
        isLocalDevelopmentRuntime() ? 'http://localhost:3000' : '/';
      return res.redirect(defaultRedirect);
    });
  })(req, res, next);
};

const router = express.Router();

router.use(async (req, res, next) => {
  if (!req.user && isLocalAuthBypassAllowed() && !shouldSkipLocalAuthBypass(req.path)) {
    req.user = localAuthBypassUser(process.env, req.headers) as Express.User;
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

router.get('/cas', casLogin);

const logoutRouteHandler: express.RequestHandler = async (req, res, next) => {
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

router.get('/logout', logoutRouteHandler);

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
          console.error('Error logging dev login analytics event:', sanitizeLogValue(analyticsError));
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
