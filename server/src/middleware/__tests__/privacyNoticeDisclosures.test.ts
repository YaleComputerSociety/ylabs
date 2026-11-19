import { afterEach, describe, expect, it } from 'vitest';

import {
  ACTIVITY_RECORD_RETENTION_DAYS,
  ACTIVITY_RECORD_RETENTION_DAYS_LABEL,
  PRIVACY_NOTICE_DISCLOSED_ORIGINS,
  SESSION_COOKIE_LIFETIME_DAYS,
} from '../../../../client/src/utils/privacyNotice';
import { AnalyticsEvent } from '../../models/analytics';
import { POSTHOG_ASSETS_ORIGIN, POSTHOG_INGEST_ORIGIN } from '../../utils/posthogConfig';
import { SESSION_LIFETIME_MS } from '../../utils/sessionClaim';
import { buildContentSecurityPolicy } from '../securityHeaders';

const MS_PER_DAY = 86_400_000;

const FIRST_PARTY_HOSTS = new Set([
  'yalelabs.io',
  'www.yalelabs.io',
  'yalelabs.onrender.com',
  'ylabs-gr4v.onrender.com',
]);

const disclosedOrigins = (): readonly string[] => PRIVACY_NOTICE_DISCLOSED_ORIGINS;

const hostOf = (origin: string): string => origin.replace(/^https:\/\//, '').replace(/\/.*$/, '');

const isCoveredBy = (host: string, disclosed: string): boolean => {
  const disclosedHost = hostOf(disclosed);
  return disclosedHost.startsWith('*.')
    ? host.endsWith(disclosedHost.slice(1))
    : host === disclosedHost;
};

const thirdPartyHostsIn = (policy: string): string[] =>
  [
    ...new Set(
      policy
        .split(/[;\s]+/)
        .filter((token) => token.startsWith('https://'))
        .map(hostOf),
    ),
  ].filter((host) => !FIRST_PARTY_HOSTS.has(host));

const originalSentryDsn = process.env.VITE_SENTRY_DSN;

afterEach(() => {
  if (originalSentryDsn === undefined) delete process.env.VITE_SENTRY_DSN;
  else process.env.VITE_SENTRY_DSN = originalSentryDsn;
});

describe('privacy notice disclosures (#4157)', () => {
  it('names every third-party origin the Content-Security-Policy allows', () => {
    process.env.VITE_SENTRY_DSN = 'https://synthetic@o1.ingest.us.sentry.io/1';
    const disclosed = disclosedOrigins();

    const undisclosed = thirdPartyHostsIn(buildContentSecurityPolicy(false)).filter(
      (host) => !disclosed.some((origin) => isCoveredBy(host, origin)),
    );

    expect(disclosed.length).toBeGreaterThan(0);
    expect(undisclosed).toEqual([]);
  });

  it('names the PostHog origins the Production policy opens', () => {
    const disclosed = disclosedOrigins();

    for (const origin of [POSTHOG_INGEST_ORIGIN, POSTHOG_ASSETS_ORIGIN]) {
      expect(disclosed.some((entry) => isCoveredBy(hostOf(origin), entry))).toBe(true);
    }
  });

  it('fails for an origin the notice does not name', () => {
    const disclosed = disclosedOrigins();
    const policy = `${buildContentSecurityPolicy(false)}; connect-src https://synthetic-tracker.example`;

    const undisclosed = thirdPartyHostsIn(policy).filter(
      (host) => !disclosed.some((origin) => isCoveredBy(host, origin)),
    );

    expect(undisclosed).toEqual(['synthetic-tracker.example']);
  });

  it('states the same activity retention as the analytics TTL index', () => {
    const ttlSeconds = AnalyticsEvent.schema
      .indexes()
      .map(([, options]) => options?.expireAfterSeconds)
      .filter((seconds): seconds is number => typeof seconds === 'number');

    expect(ttlSeconds).toEqual([ACTIVITY_RECORD_RETENTION_DAYS * 86_400]);
    expect(ACTIVITY_RECORD_RETENTION_DAYS_LABEL).toBe('1,095');
  });

  it('states the same cookie lifetime as the session cookie', () => {
    expect(SESSION_COOKIE_LIFETIME_DAYS * MS_PER_DAY).toBe(SESSION_LIFETIME_MS);
  });
});
