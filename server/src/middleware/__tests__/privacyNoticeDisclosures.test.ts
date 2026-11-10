import { readFileSync } from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { POSTHOG_ASSETS_ORIGIN, POSTHOG_INGEST_ORIGIN } from '../../utils/posthogConfig';
import { buildContentSecurityPolicy } from '../securityHeaders';

const PRIVACY_NOTICE_SOURCE = path.resolve(
  __dirname,
  '../../../../client/src/utils/privacyNotice.ts',
);

const ANALYTICS_MODEL_SOURCE = path.resolve(__dirname, '../../models/analytics.ts');

const FIRST_PARTY_HOSTS = new Set([
  'yalelabs.io',
  'www.yalelabs.io',
  'yalelabs.onrender.com',
  'ylabs-gr4v.onrender.com',
]);

const disclosedOrigins = (): string[] => {
  const source = readFileSync(PRIVACY_NOTICE_SOURCE, 'utf8');
  const list = source.slice(source.indexOf('PRIVACY_NOTICE_DISCLOSED_ORIGINS'));
  return [...list.slice(0, list.indexOf(']')).matchAll(/'(https:\/\/[^']+)'/g)].map(
    (match) => match[1],
  );
};

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
    const ttlSeconds = Number(
      readFileSync(ANALYTICS_MODEL_SOURCE, 'utf8').match(/expireAfterSeconds:\s*(\d+)/)?.[1],
    );
    const statedDays = readFileSync(PRIVACY_NOTICE_SOURCE, 'utf8').match(
      /ACTIVITY_RECORD_RETENTION_DAYS_LABEL = '([\d,]+)'/,
    )?.[1];

    expect(ttlSeconds).toBeGreaterThan(0);
    expect(Number(statedDays?.replace(/,/g, ''))).toBe(ttlSeconds / 86_400);
  });
});
