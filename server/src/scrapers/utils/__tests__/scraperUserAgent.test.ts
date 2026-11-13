import axios, { AxiosHeaders, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/ssrfGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/ssrfGuard')>()),
  assertPublicHttpUrl: async (url: string) => new URL(url),
}));

import { checkSourceLinkHealth, probeSourceLink } from '../../../services/sourceLinkHealth';
import { fetchRecheckPage } from '../../../scripts/recheckDescriptionGrounding';
import { resolveFinalUrls } from '../../../scripts/retireOrganizationIdentityWebsiteGrafts';
import { readPageOverHttp } from '../../../scripts/retypeFromDeclaredPageType';
import { fetchPageWithPolicy, fetchPublicHttpUrl } from '../httpFetch';
import {
  SCRAPER_UA_CONTACT,
  SCRAPER_UA_INFO_URL,
  SCRAPER_USER_AGENT,
  withScraperUserAgent,
} from '../scraperUserAgent';

const sent: InternalAxiosRequestConfig[] = [];

const stubNetwork: AxiosAdapter = async (config) => {
  sent.push(config);
  return {
    data: '<html><head><title>synthetic</title></head><body>synthetic page</body></html>',
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'text/html' },
    config,
    request: {},
  };
};

const userAgentsSent = (): unknown[] =>
  sent.map((config) => AxiosHeaders.from(config.headers).get('User-Agent'));

const FIXTURE_URL = 'https://ua-fixture.invalid/page';

beforeEach(() => {
  sent.length = 0;
  axios.defaults.adapter = stubNetwork;
});

describe('SCRAPER_USER_AGENT', () => {
  it('names the scraper, its information page and a contact, and claims no browser or Yale domain', () => {
    expect(SCRAPER_USER_AGENT).toBe(
      `ylabs-scraper/1.0 (+${SCRAPER_UA_INFO_URL}; ${SCRAPER_UA_CONTACT})`,
    );
    expect(SCRAPER_USER_AGENT).not.toMatch(/Mozilla|Chrome|Safari|yale\.edu/i);
  });

  it("replaces a caller's User-Agent in any letter case and keeps its other headers", () => {
    expect(
      withScraperUserAgent({ 'user-agent': 'Mozilla/5.0 (fixture)', Accept: 'text/html' }),
    ).toEqual({ Accept: 'text/html', 'User-Agent': SCRAPER_USER_AGENT });
  });
});

describe('every fetch path sends exactly SCRAPER_USER_AGENT without the fetch hooks installed', () => {
  it('fetchPageWithPolicy, even when the caller passes its own', async () => {
    await fetchPageWithPolicy(FIXTURE_URL);
    await fetchPageWithPolicy(FIXTURE_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (fixture)' } });

    expect(userAgentsSent()).toEqual([SCRAPER_USER_AGENT, SCRAPER_USER_AGENT]);
  });

  it('fetchPublicHttpUrl', async () => {
    await fetchPublicHttpUrl(FIXTURE_URL, { headers: { 'user-agent': 'Mozilla/5.0 (fixture)' } });

    expect(userAgentsSent()).toEqual([SCRAPER_USER_AGENT]);
  });

  it('the link-health probe, which used to send the HTTP library default', async () => {
    await probeSourceLink(FIXTURE_URL);
    await checkSourceLinkHealth(`${FIXTURE_URL}?via=health`);

    expect(sent.length).toBeGreaterThanOrEqual(2);
    expect(new Set(userAgentsSent())).toEqual(new Set([SCRAPER_USER_AGENT]));
  });

  it('the three scripts that used to present themselves as a desktop browser', async () => {
    await readPageOverHttp(`${FIXTURE_URL}?script=retype`);
    await resolveFinalUrls([`${FIXTURE_URL}?script=retire`]);
    await fetchRecheckPage(`${FIXTURE_URL}?script=recheck`);

    expect(sent.map((config) => new URL(axios.getUri(config)).searchParams.get('script'))).toEqual([
      'retype',
      'retire',
      'recheck',
    ]);
    expect(userAgentsSent()).toEqual([SCRAPER_USER_AGENT, SCRAPER_USER_AGENT, SCRAPER_USER_AGENT]);
  });
});
