import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const analyticsTagSource = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/analytics.js'),
  'utf8',
);

const SEARCH_TEXT = 'zzsynthetictopic';
const COLLECT_ENDPOINT = 'https://www.google-analytics.com/g/collect';
const REGIONAL_COLLECT_ENDPOINT = 'https://region1.google-analytics.com/g/collect';

type SentRequest = { url: string; body?: unknown };

const sent: SentRequest[] = [];

const recordFetch = (resource: unknown, options?: { body?: unknown }) => {
  sent.push({ url: String(resource), body: options?.body });
  return Promise.resolve({ status: 204 });
};

const recordSendBeacon = (resource: unknown, body?: unknown) => {
  sent.push({ url: String(resource), body });
  return true;
};

const runAnalyticsTag = () => {
  new Function(analyticsTagSource)();
};

const parametersOfLastRequest = (): URLSearchParams =>
  new URL(sent[sent.length - 1].url).searchParams;

const originalFetch = window.fetch;
const originalSendBeacon = navigator.sendBeacon;
const originalOpen = XMLHttpRequest.prototype.open;
const originalSend = XMLHttpRequest.prototype.send;

describe('no research search text reaches the Google Analytics collect endpoint', () => {
  beforeEach(() => {
    sent.length = 0;
    delete (window as unknown as { dataLayer?: unknown }).dataLayer;
    delete (window as unknown as { gtag?: unknown }).gtag;
    window.fetch = recordFetch as unknown as typeof window.fetch;
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      writable: true,
      value: recordSendBeacon,
    });
    XMLHttpRequest.prototype.open = originalOpen;
    XMLHttpRequest.prototype.send = originalSend;
  });

  afterEach(() => {
    window.fetch = originalFetch;
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      writable: true,
      value: originalSendBeacon,
    });
    XMLHttpRequest.prototype.open = originalOpen;
    XMLHttpRequest.prototype.send = originalSend;
  });

  it('drops the site-search term the tag lifts out of the address bar', () => {
    runAnalyticsTag();

    void window.fetch(
      `${COLLECT_ENDPOINT}?v=2&en=view_search_results&ep.search_term=${SEARCH_TEXT}`,
      { keepalive: true },
    );

    expect(sent).toHaveLength(1);
    expect(parametersOfLastRequest().has('ep.search_term')).toBe(false);
    expect(parametersOfLastRequest().get('en')).toBe('view_search_results');
    expect(sent[0].url).not.toContain(SEARCH_TEXT);
  });

  it('reduces the reported page location to origin and path', () => {
    runAnalyticsTag();
    const location = `https://yalelabs.io/research?q=${SEARCH_TEXT}&dept=Anthropology#results`;

    void window.fetch(`${COLLECT_ENDPOINT}?v=2&en=page_view&dl=${encodeURIComponent(location)}`, {
      keepalive: true,
    });

    expect(parametersOfLastRequest().get('dl')).toBe('https://yalelabs.io/research');
    expect(sent[0].url).not.toContain(SEARCH_TEXT);
    expect(sent[0].url).not.toContain('Anthropology');
  });

  it('reduces the reported referrer to origin and path', () => {
    runAnalyticsTag();
    const referrer = `https://yalelabs.io/research?q=${SEARCH_TEXT}`;

    void window.fetch(
      `${REGIONAL_COLLECT_ENDPOINT}?v=2&en=page_view&dr=${encodeURIComponent(referrer)}`,
      { keepalive: true },
    );

    expect(parametersOfLastRequest().get('dr')).toBe('https://yalelabs.io/research');
    expect(sent[0].url).not.toContain(SEARCH_TEXT);
  });

  it('redacts a batched hit sent as a request body', () => {
    runAnalyticsTag();
    const location = `https://yalelabs.io/research?q=${SEARCH_TEXT}`;

    void window.fetch(`${COLLECT_ENDPOINT}?v=2`, {
      keepalive: true,
      body: [
        `en=page_view&dl=${encodeURIComponent(location)}`,
        `en=view_search_results&ep.search_term=${SEARCH_TEXT}`,
      ].join('\n'),
    });

    expect(String(sent[0].body)).not.toContain(SEARCH_TEXT);
    expect(String(sent[0].body)).toContain('en=page_view');
  });

  it('redacts a hit sent through the beacon transport', () => {
    runAnalyticsTag();

    navigator.sendBeacon(`${COLLECT_ENDPOINT}?v=2&ep.search_term=${SEARCH_TEXT}`);

    expect(sent).toHaveLength(1);
    expect(sent[0].url).not.toContain(SEARCH_TEXT);
  });

  it('sends no hit at all when its payload cannot be read', () => {
    runAnalyticsTag();

    void window.fetch(`${COLLECT_ENDPOINT}?v=2`, {
      keepalive: true,
      body: new Blob([`ep.search_term=${SEARCH_TEXT}`]),
    } as RequestInit);

    expect(sent).toHaveLength(0);
  });

  it('leaves a first-party request and its query string untouched', () => {
    runAnalyticsTag();
    const apiCall = `https://yalelabs.io/api/research/search?q=${SEARCH_TEXT}`;

    void window.fetch(apiCall);

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(apiCall);
  });
});
