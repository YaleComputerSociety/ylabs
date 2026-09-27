import { describe, expect, it } from 'vitest';
import type { Breadcrumb, ErrorEvent } from '@sentry/react';

import { scrubBreadcrumb, scrubErrorEvent, scrubPath, scrubUrl } from '../errorReportScrubbing';

const SYNTHETIC_KEY = 'synthkey-0000';
const SYNTHETIC_SLUG = 'example-person-lab';
const SYNTHETIC_QUERY = 'synthetic-query-value';

const expectNoSyntheticValue = (value: unknown) => {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(SYNTHETIC_KEY);
  expect(serialized).not.toContain(SYNTHETIC_SLUG);
  expect(serialized).not.toContain(SYNTHETIC_QUERY);
};

describe('scrubPath', () => {
  it('keeps static segments and replaces every other segment', () => {
    expect(scrubPath(`/research/person/${SYNTHETIC_KEY}`)).toBe('/research/person/:param');
    expect(scrubPath(`/api/research/${SYNTHETIC_SLUG}/report`)).toBe('/api/research/:param/report');
    expect(scrubPath('/about')).toBe('/about');
    expect(scrubPath('/')).toBe('/');
  });

  it('fails closed on a segment it does not know', () => {
    expect(scrubPath('/unlisted-route')).toBe('/:param');
  });
});

describe('scrubUrl', () => {
  it('keeps the origin and replaces the query and fragment', () => {
    expect(
      scrubUrl(`https://yalelabs.io/research/${SYNTHETIC_SLUG}?q=${SYNTHETIC_QUERY}#top`),
    ).toBe('https://yalelabs.io/research/:param?[Filtered]');
  });

  it('keeps a relative path relative', () => {
    expect(scrubUrl(`/research/person/${SYNTHETIC_KEY}?from=search`)).toBe(
      '/research/person/:param?[Filtered]',
    );
  });
});

describe('scrubBreadcrumb', () => {
  it('scrubs navigation paths', () => {
    const breadcrumb = scrubBreadcrumb({
      category: 'navigation',
      data: { from: `/research/${SYNTHETIC_SLUG}`, to: `/research/person/${SYNTHETIC_KEY}` },
    });

    expect(breadcrumb?.data).toEqual({
      from: '/research/:param',
      to: '/research/person/:param',
    });
  });

  it('keeps only the method, status, and scrubbed url of a request', () => {
    const breadcrumb = scrubBreadcrumb({
      category: 'xhr',
      message: SYNTHETIC_QUERY,
      data: {
        method: 'POST',
        url: `https://yalelabs.io/api/research/${SYNTHETIC_SLUG}/report?q=${SYNTHETIC_QUERY}`,
        status_code: 500,
        request_body: SYNTHETIC_QUERY,
      },
    });

    expect(breadcrumb).toEqual({
      category: 'xhr',
      data: {
        method: 'POST',
        url: 'https://yalelabs.io/api/research/:param/report?[Filtered]',
        status_code: 500,
      },
    });
  });

  it.each(['console', 'ui.click', 'ui.input', undefined])('drops %s breadcrumbs', (category) => {
    expect(scrubBreadcrumb({ category, message: SYNTHETIC_SLUG })).toBeNull();
  });
});

describe('scrubErrorEvent', () => {
  it('leaves no synthetic key, slug, or query value anywhere in the event', () => {
    const breadcrumbs: Breadcrumb[] = [
      { category: 'navigation', data: { from: '/research', to: `/research/${SYNTHETIC_SLUG}` } },
      { category: 'console', message: `loaded ${SYNTHETIC_KEY}` },
      { category: 'fetch', data: { method: 'GET', url: `/api/search?q=${SYNTHETIC_QUERY}` } },
    ];
    const event: ErrorEvent = {
      type: undefined,
      transaction: `/research/person/${SYNTHETIC_KEY}`,
      user: { id: SYNTHETIC_KEY },
      request: {
        url: `https://yalelabs.io/research/person/${SYNTHETIC_KEY}?q=${SYNTHETIC_QUERY}`,
        headers: {
          Referer: `https://yalelabs.io/research/${SYNTHETIC_SLUG}`,
          'User-Agent': 'synthetic-agent',
        },
        query_string: `q=${SYNTHETIC_QUERY}`,
      },
      breadcrumbs,
      exception: {
        values: [
          {
            type: 'Error',
            value: `Failed to load https://yalelabs.io/api/research/${SYNTHETIC_SLUG}`,
          },
        ],
      },
    };

    const scrubbed = scrubErrorEvent(event);

    expectNoSyntheticValue(scrubbed);
    expect(scrubbed.request).toEqual({
      url: 'https://yalelabs.io/research/person/:param?[Filtered]',
      method: undefined,
      headers: { 'User-Agent': 'synthetic-agent' },
    });
    expect(scrubbed.breadcrumbs?.map((breadcrumb) => breadcrumb.category)).toEqual([
      'navigation',
      'fetch',
    ]);
    expect(scrubbed.exception?.values?.[0]?.value).toBe(
      'Failed to load https://yalelabs.io/api/research/:param',
    );
  });

  it('scrubs stack frame locations but keeps bundled asset files for source maps', () => {
    const assetUrl = `${window.location.origin}/assets/index-abc123.js`;
    const pageUrl = `${window.location.origin}/research/person/${SYNTHETIC_KEY}?q=${SYNTHETIC_QUERY}`;
    const event: ErrorEvent = {
      type: undefined,
      exception: {
        values: [
          {
            type: 'Error',
            stacktrace: {
              frames: [
                { filename: assetUrl, abs_path: assetUrl },
                { filename: pageUrl, abs_path: pageUrl },
                { filename: `${assetUrl}?q=${SYNTHETIC_QUERY}` },
              ],
            },
          },
        ],
      },
    };

    const frames = scrubErrorEvent(event).exception?.values?.[0]?.stacktrace?.frames;

    expectNoSyntheticValue(frames);
    expect(frames?.[0]).toEqual({ filename: assetUrl, abs_path: assetUrl });
    expect(frames?.[1]?.filename).toBe(
      `${window.location.origin}/research/person/:param?[Filtered]`,
    );
  });
});
