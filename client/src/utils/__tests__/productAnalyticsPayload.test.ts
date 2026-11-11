import { gunzipSync, strFromU8 } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ProductAnalyticsModule = typeof import('../productAnalytics');

let productAnalytics: ProductAnalyticsModule;

const SYNTHETIC_KEY = 'phc_syntheticTestKey0000000000000000000000';
let sessionKeyIndex = 0;
let currentSessionKey = '';
const freshSessionKey = () => {
  currentSessionKey = `phc_syntheticSessionKey${String(++sessionKeyIndex).padStart(20, '0')}`;
  return currentSessionKey;
};
const SYNTHETIC_NETID = 'zq9999';
const SYNTHETIC_QUERY = 'syntheticquerytext';
const SYNTHETIC_NOTE = 'synthetic private plan note';
const SYNTHETIC_TYPED = 'synthetic typed words';
const SYNTHETIC_LABEL = 'synthetic accessible label';
const SYNTHETIC_REFERRER_TERM = 'syntheticreferrerterm';
const SYNTHETIC_RELATIVE_TERM = 'syntheticrelativeterm';
const SYNTHETIC_POSTHOG_ID = '3f2b6c1e-8d4a-4f0b-9c7e-2a1d5e6f7a8b';
const POSTHOG_INGEST_ORIGIN = 'https://us.i.posthog.com';
const POSTHOG_ASSETS_ORIGIN = 'https://us-assets.i.posthog.com';

const GZIP_MAGIC = '\u001f\u008b';

const gunzipLatin1 = (value: string) =>
  strFromU8(gunzipSync(Uint8Array.from(value, (char) => char.charCodeAt(0))));

const expandCompressedStrings = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return value.startsWith(GZIP_MAGIC)
      ? expandCompressedStrings(JSON.parse(gunzipLatin1(value)))
      : value;
  }
  if (Array.isArray(value)) return value.map(expandCompressedStrings);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, expandCompressedStrings(entry)]),
    );
  }
  return value;
};

type SentRequest = { url: string; body: unknown };
type SentEvent = {
  event: string;
  properties: Record<string, unknown>;
  $set?: unknown;
  $set_once?: unknown;
};

const sent: SentRequest[] = [];

const remoteConfig = {
  sessionRecording: { endpoint: '/s/', recorderVersion: 'v2' },
  heatmaps: true,
  autocapture_opt_out: false,
  capturePerformance: { network_timing: true, web_vitals: false },
  autocaptureExceptions: true,
  surveys: true,
};

const parseBody = (body: BodyInit | null | undefined): unknown => {
  if (typeof body !== 'string') return body ?? null;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
};

const sentEvents = (): SentEvent[] =>
  sent
    .filter((request) => new URL(request.url).origin === POSTHOG_INGEST_ORIGIN)
    .flatMap((request) => {
      const body = request.body as { batch?: SentEvent[] } | SentEvent[];
      return Array.isArray(body) ? body : (body?.batch ?? []);
    })
    .filter((event) => event.properties.token === currentSessionKey);

const everythingSent = () => JSON.stringify(expandCompressedStrings(sent.map((r) => r.body)));

const freshPostHog = async () => {
  await productAnalytics.loadPostHog();
  const { PostHog } = await import('posthog-js/no-external');
  return new PostHog();
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The SDK flushes on its own timers, so a fixed sleep raced the session-replay batch under CI
// load (#5570). Wait for what the assertion needs, with a ceiling well inside the test timeout.
const WAIT_FOR_SDK = { timeout: 15000, interval: 50 } as const;
const LATE_BATCH_SETTLE_MS = 2500;

const sentEventNames = () => new Set(sentEvents().map((event) => event.event));

const untilRemoteConfigLoaded = () =>
  vi.waitFor(() => {
    expect(sent.some((request) => new URL(request.url).pathname.includes('config'))).toBe(true);
  }, WAIT_FOR_SDK);

const untilSent = (eventNames: readonly string[]) =>
  vi.waitFor(() => {
    const names = sentEventNames();
    for (const name of eventNames) expect(names).toContain(name);
  }, WAIT_FOR_SDK);

beforeEach(async () => {
  vi.resetModules();
  productAnalytics = await import('../productAnalytics');
  sent.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      sent.push({ url, body: parseBody(init?.body) });
      return new Response(JSON.stringify(url.includes('/config') ? remoteConfig : { status: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  window.history.replaceState({}, '', `/research?q=${SYNTHETIC_QUERY}`);
  document.body.innerHTML = `
    <main>
      <p class="plan-note">${SYNTHETIC_NOTE}</p>
      <a id="lab-link" href="/research/lab-slug?q=${SYNTHETIC_QUERY}&owner=${SYNTHETIC_NETID}" aria-label="${SYNTHETIC_LABEL}">Open lab</a>
      <input id="search" type="text" value="" />
      <button id="save" title="${SYNTHETIC_LABEL}">Save ${SYNTHETIC_NOTE}</button>
    </main>`;
  document.getElementById('lab-link')!.addEventListener('click', (event) => event.preventDefault());
});

afterEach(() => {
  productAnalytics.stopProductAnalytics();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/');
});

const interact = () => {
  const input = document.getElementById('search') as HTMLInputElement;
  input.value = SYNTHETIC_TYPED;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('save')!.click();
  document.getElementById('lab-link')!.click();
};

describe('PostHog payload through the real SDK', () => {
  const recordSession = async (distinctId?: string) => {
    expect(
      productAnalytics.startProductAnalytics(
        { allowed: true, netId: SYNTHETIC_NETID, distinctId, userType: 'undergraduate' },
        { key: freshSessionKey(), host: POSTHOG_INGEST_ORIGIN },
        freshPostHog,
      ),
    ).toBe(true);
    await untilRemoteConfigLoaded();
    interact();
    productAnalytics.captureJourneyEvent({
      eventType: 'research_search',
      payload: {
        outcome: 'results',
        resultCountBucket: '6-20',
        searchKind: 'query',
        filterCountBucket: '0',
        query: SYNTHETIC_QUERY.toUpperCase() + ' ' + SYNTHETIC_TYPED,
      },
    });
    productAnalytics.captureJourneyEvent({
      eventType: 'research_profile_open',
      entityType: 'research_entity',
      entityId: 'entity0001',
      payload: { source: 'search' },
    });
    window.history.pushState({}, '', `/research/person/${SYNTHETIC_NETID}?q=${SYNTHETIC_QUERY}`);
    await untilSent([
      '$pageview',
      '$autocapture',
      '$snapshot',
      'research_search',
      'research_profile_open',
    ]);
    await vi.waitFor(() => {
      expect(everythingSent()).toContain('/research/person/[redacted]');
    }, WAIT_FOR_SDK);
    await wait(LATE_BATCH_SETTLE_MS);
    return sentEvents();
  };

  it('records clicks, pageviews and a replay with all text, inputs, queries and the netid masked', async () => {
    const events = await recordSession(SYNTHETIC_POSTHOG_ID);
    const names = new Set(events.map((event) => event.event));
    expect(names).toContain('$pageview');
    expect(names).toContain('$autocapture');
    expect(names).toContain('$snapshot');

    const search = events.find((event) => event.event === 'research_search')!;
    expect(search.properties).toMatchObject({
      outcome: 'results',
      resultCountBucket: '6-20',
      searchKind: 'query',
      filterCountBucket: '0',
    });
    expect(search.properties).not.toHaveProperty('query');
    expect(
      events.find((event) => event.event === 'research_profile_open')!.properties,
    ).toMatchObject({ source: 'search', entityType: 'research_entity', entityId: 'entity0001' });

    const personUpdates = events.filter((event) => event.event === '$set');
    expect(personUpdates.length).toBeGreaterThan(0);
    for (const update of personUpdates) {
      expect(update.$set).toEqual({ user_type: 'undergraduate' });
    }

    const payload = everythingSent();
    expect(payload).toContain('"maskAllInputs":true');
    expect(payload).toContain('"maskTextSelector":"*"');
    expect(payload).toContain('/research/person/[redacted]');
    expect(payload).not.toContain(SYNTHETIC_NETID);
    expect(payload).not.toContain(SYNTHETIC_QUERY);
    expect(payload).not.toContain(SYNTHETIC_NOTE);
    expect(payload).not.toContain(SYNTHETIC_TYPED);
    expect(payload).not.toContain(SYNTHETIC_LABEL);
    expect(payload).not.toContain('$input_value');
    expect(payload).not.toContain('requestBody');
    expect(payload).not.toContain('responseBody');

    for (const event of events.filter(
      (candidate) => candidate.event !== '$snapshot' && candidate.event !== '$set',
    )) {
      expect(event.properties.distinct_id).toBe(SYNTHETIC_POSTHOG_ID);
      expect(event.properties.$process_person_profile).toBe(true);
      expect(event.$set).toBeUndefined();
      expect(event.$set_once).toBeUndefined();
      expect(event.properties.$el_text).toBeUndefined();
    }
    expect(names).not.toContain('$identify');

    expect(
      sent.every((request) => {
        const { origin, pathname } = new URL(request.url);
        return (
          origin === POSTHOG_INGEST_ORIGIN ||
          (origin === POSTHOG_ASSETS_ORIGIN && pathname.startsWith('/array/'))
        );
      }),
    ).toBe(true);
    expect(document.querySelector('script[src*="posthog"]')).toBeNull();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).toBe('');
  }, 20000);

  it('loads and sends nothing when the server gives no opaque ID (#5621)', async () => {
    const load = vi.fn(freshPostHog);

    expect(
      productAnalytics.startProductAnalytics(
        { allowed: true, netId: SYNTHETIC_NETID, distinctId: 'test123', userType: 'undergraduate' },
        { key: freshSessionKey(), host: POSTHOG_INGEST_ORIGIN },
        load,
      ),
    ).toBe(false);
    expect(
      productAnalytics.startProductAnalytics(
        { allowed: true, netId: SYNTHETIC_NETID, userType: 'undergraduate' },
        { key: freshSessionKey(), host: POSTHOG_INGEST_ORIGIN },
        load,
      ),
    ).toBe(false);
    await wait(200);
    expect(load).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it('never sends a search-engine referrer keyword, a relative query link or a query in replay data (#5621)', async () => {
    Object.defineProperty(document, 'referrer', {
      value: `https://www.google.com/search?q=${SYNTHETIC_REFERRER_TERM}`,
      configurable: true,
    });
    document.querySelector('main')!.insertAdjacentHTML(
      'beforeend',
      `<a id="relative-query" href="?q=${SYNTHETIC_RELATIVE_TERM}">Relative</a>
       <a id="pathless-query" href="search?q=${SYNTHETIC_RELATIVE_TERM}">Pathless</a>
       <img alt="" src="/image.png?owner=${SYNTHETIC_RELATIVE_TERM}" />`,
    );
    for (const id of ['relative-query', 'pathless-query']) {
      document.getElementById(id)!.addEventListener('click', (event) => event.preventDefault());
    }
    try {
      const events = await recordSession(SYNTHETIC_POSTHOG_ID);
      document.getElementById('relative-query')!.click();
      document.getElementById('pathless-query')!.click();
      await wait(LATE_BATCH_SETTLE_MS);

      const payload = everythingSent();
      expect(events.map((event) => event.event)).toContain('$snapshot');
      expect(payload).not.toContain(SYNTHETIC_REFERRER_TERM);
      expect(payload).not.toContain(SYNTHETIC_RELATIVE_TERM);
      for (const event of sentEvents()) {
        expect(
          Object.keys(event.properties).filter((key) => /ph_keyword|search_engine/.test(key)),
        ).toEqual([]);
      }
    } finally {
      Object.defineProperty(document, 'referrer', { value: '', configurable: true });
    }
  }, 30000);

  it('delivers journey events emitted before the session check and drops them when PostHog is off', async () => {
    productAnalytics.captureJourneyEvent({
      eventType: 'research_compare',
      payload: { entityCountBucket: '2' },
    });
    productAnalytics.startProductAnalytics(
      { allowed: true, netId: SYNTHETIC_NETID, distinctId: SYNTHETIC_POSTHOG_ID },
      { key: freshSessionKey(), host: POSTHOG_INGEST_ORIGIN },
      freshPostHog,
    );
    await untilSent(['research_compare']);

    expect(sentEvents().map((event) => event.event)).toContain('research_compare');
  }, 20000);

  it('never queues or sends a journey event once PostHog is declined', async () => {
    const load = vi.fn();
    productAnalytics.startProductAnalytics({ allowed: false }, null, load);
    productAnalytics.captureJourneyEvent({
      eventType: 'research_compare',
      payload: { entityCountBucket: '2' },
    });
    await wait(200);

    expect(load).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it('sends nothing once the session ends', async () => {
    productAnalytics.startProductAnalytics(
      { allowed: true, netId: SYNTHETIC_NETID, distinctId: SYNTHETIC_POSTHOG_ID },
      { key: freshSessionKey(), host: POSTHOG_INGEST_ORIGIN },
      freshPostHog,
    );
    await vi.waitFor(() => expect(sentEvents().length).toBeGreaterThan(0), WAIT_FOR_SDK);
    productAnalytics.stopProductAnalytics();
    await wait(4000);
    const sentBeforeStop = sentEvents().length;
    expect(sentBeforeStop).toBeGreaterThan(0);
    interact();
    await wait(4000);

    expect(sentEvents().length).toBe(sentBeforeStop);
  }, 20000);

  it('loads nothing and sends nothing when the session is not allowed', async () => {
    const load = vi.fn();
    expect(
      productAnalytics.startProductAnalytics(
        { allowed: false, netId: SYNTHETIC_NETID },
        { key: SYNTHETIC_KEY, host: POSTHOG_INGEST_ORIGIN },
        load,
      ),
    ).toBe(false);
    expect(productAnalytics.startProductAnalytics({ allowed: true }, null, load)).toBe(false);
    interact();
    await wait(200);

    expect(load).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });
});

describe('PostHog journey event properties', () => {
  it('keeps only bucketed enum values and well-formed entity ids', () => {
    expect(
      productAnalytics.journeyEventProperties({
        eventType: 'contact_route_click',
        entityType: 'research_entity',
        entityId: 'entity0001',
        entityIds: ['entity0001', 'not an id', 'entity0002'],
        payload: {
          method: 'email',
          surface: 'lead_card',
          address: 'someone@example.test',
          href: 'mailto:someone@example.test',
          note: 'Free Text',
        },
      }),
    ).toEqual({
      method: 'email',
      surface: 'lead_card',
      entityType: 'research_entity',
      entityId: 'entity0001',
      entityIds: ['entity0001', 'entity0002'],
      entityCount: 2,
    });
    expect(productAnalytics.journeyEventProperties({ eventType: 'Bad Name' })).toBeNull();
  });

  it('buckets the person property to a closed set of user types', () => {
    expect(productAnalytics.userTypeBucket('Undergraduate')).toBe('undergraduate');
    expect(productAnalytics.userTypeBucket('admin')).toBe('other');
    expect(productAnalytics.userTypeBucket(SYNTHETIC_NETID)).toBe('other');
  });
});

describe('PostHog configuration', () => {
  const config = () =>
    productAnalytics.buildPostHogConfig({
      host: POSTHOG_INGEST_ORIGIN,
      netId: SYNTHETIC_NETID,
      isOpen: () => true,
    });

  it('pins masking, no input capture, anonymous memory-only identity and no external loading', () => {
    expect(config()).toMatchObject({
      api_host: POSTHOG_INGEST_ORIGIN,
      persistence: 'memory',
      person_profiles: 'identified_only',
      internal_or_test_user_hostname: null,
      mask_all_text: true,
      autocapture: {
        capture_copied_text: false,
        capture_value_css_selector_allowlist: [],
      },
      capture_exceptions: {
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
        capture_console_errors: false,
      },
      capture_pageview: 'history_change',
      capture_pageleave: true,
      capture_performance: { network_timing: true, web_vitals: true },
      enable_recording_console_log: false,
      disable_external_dependency_loading: true,
      disable_surveys: true,
      opt_in_site_apps: false,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: '*',
        recordHeaders: false,
        recordBody: false,
        captureJsonLd: false,
      },
    });
    expect(config().bootstrap).toBeUndefined();
  });

  it('redacts the netid and URL queries from a captured exception', () => {
    const beforeSend = config().before_send as (event: unknown) => { properties: unknown } | null;
    const sentException = beforeSend({
      uuid: 'exception-1',
      event: '$exception',
      properties: {
        $exception_list: [
          {
            type: 'Error',
            value: `synthetic failure for ${SYNTHETIC_NETID}`,
            stacktrace: {
              frames: [{ filename: `https://yalelabs.io/research?q=${SYNTHETIC_QUERY}` }],
            },
          },
        ],
      },
    });

    const serialized = JSON.stringify(sentException);
    expect(serialized).not.toContain('synthetic failure');
    expect(serialized).not.toContain(SYNTHETIC_NETID);
    expect(serialized).not.toContain(SYNTHETIC_QUERY);
  });

  it('sends only the exception type, never a message that could quote a search (#5621)', () => {
    const beforeSend = config().before_send as (event: unknown) => { properties: any } | null;
    const sentException = beforeSend({
      uuid: 'exception-2',
      event: '$exception',
      properties: {
        $exception_message: `No results for ${SYNTHETIC_QUERY}`,
        $exception_list: [{ type: 'TypeError', value: `No results for ${SYNTHETIC_QUERY}` }],
      },
    })!;

    expect(sentException.properties.$exception_list).toEqual([
      { type: 'TypeError', value: 'TypeError' },
    ]);
    expect(sentException.properties).not.toHaveProperty('$exception_message');
    expect(JSON.stringify(sentException)).not.toContain(SYNTHETIC_QUERY);
  });

  it('drops an elements chain whose value boundaries a backslash makes ambiguous (#5621)', () => {
    const beforeSend = config().before_send as (event: never) => unknown;
    for (const chain of [
      `a:attr__href="?q=${SYNTHETIC_QUERY}\\"href="?q=${SYNTHETIC_QUERY}\\"nth-child="1"`,
      `a:href="?q=x\\";img:attr__src="?u=${SYNTHETIC_QUERY}"`,
    ]) {
      const scrubbed = beforeSend({
        uuid: 'synthetic-ambiguous-chain',
        event: '$autocapture',
        properties: { $elements_chain: chain, $event_type: 'click' },
      } as never) as { properties: Record<string, unknown> };

      expect(JSON.stringify(scrubbed)).not.toContain(SYNTHETIC_QUERY);
      expect(scrubbed.properties).not.toHaveProperty('$elements_chain');
      expect(scrubbed.properties.$event_type).toBe('click');
    }
  });

  it('strips a query hidden behind an escaped quote in an elements chain, and from an outbound link (#5621)', () => {
    const beforeSend = config().before_send as (event: never) => unknown;
    const chain = `a:attr__href="?q=a\\"${SYNTHETIC_QUERY}"href="/research?x=\\"${SYNTHETIC_QUERY}"nth-child="1"`;
    const scrubbed = beforeSend({
      uuid: 'synthetic-chain',
      event: '$autocapture',
      properties: {
        $elements_chain: chain,
        $external_click_url: `https://example.edu/lab?ref=${SYNTHETIC_QUERY}`,
      },
    } as never) as { properties: Record<string, unknown> };

    expect(JSON.stringify(scrubbed)).not.toContain(SYNTHETIC_QUERY);
    expect(scrubbed.properties).not.toHaveProperty('$elements_chain');
    expect(scrubbed.properties.$external_click_url).toBe('https://example.edu/lab');
  });

  it('drops network bodies and headers and strips queries and the netid from recorded requests', () => {
    const mask = config().session_recording!.maskCapturedNetworkRequestFn!;
    const masked = mask({
      name: `https://yalelabs.io/api/users/${SYNTHETIC_NETID}?q=${SYNTHETIC_QUERY}`,
      entryType: 'resource',
      startTime: 1,
      duration: 2,
      requestBody: SYNTHETIC_NOTE,
      responseBody: SYNTHETIC_NOTE,
      requestHeaders: { cookie: SYNTHETIC_NOTE },
      responseHeaders: { 'set-cookie': SYNTHETIC_NOTE },
    });

    expect(masked).toEqual({
      name: 'https://yalelabs.io/api/users/[redacted]',
      entryType: 'resource',
      startTime: 1,
      duration: 2,
    });
  });

  it('masks text-bearing attributes and strips queries from URL attributes in replay', () => {
    const maskAttribute = config().session_recording!.maskAttributeFn!;

    expect(maskAttribute('aria-label', SYNTHETIC_LABEL)).toBe('*');
    expect(maskAttribute('title', SYNTHETIC_LABEL)).toBe('*');
    expect(maskAttribute('href', `/research/lab-slug?q=${SYNTHETIC_QUERY}`)).toBe(
      '/research/lab-slug',
    );
    expect(maskAttribute('data-owner', SYNTHETIC_NETID)).toBe('[redacted]');
    expect(maskAttribute('class', 'rounded-md')).toBe('rounded-md');
  });

  it('strips the query from every URL attribute in an elements chain, including adjacent ones (#5621)', () => {
    const beforeSend = config().before_send as (event: never) => unknown;
    const chain = `a:attr__href="?q=${SYNTHETIC_QUERY}"href="?q=${SYNTHETIC_QUERY}"nth-child="1"`;
    const scrubbed = beforeSend({
      uuid: 'synthetic',
      event: '$autocapture',
      properties: { $elements_chain: chain },
    } as never) as { properties: Record<string, unknown> };

    expect(scrubbed.properties.$elements_chain).toBe('a:attr__href=""href=""nth-child="1"');
  });

  it('scrubs replay snapshots itself, so an SDK masking change cannot leak a query or the netid (#5621)', () => {
    const config = productAnalytics.buildPostHogConfig({
      host: POSTHOG_INGEST_ORIGIN,
      netId: SYNTHETIC_NETID,
      distinctId: SYNTHETIC_POSTHOG_ID,
      isOpen: () => true,
    });
    expect(config.session_recording).toMatchObject({ compress_events: false });

    const beforeSend = config.before_send as (event: never) => unknown;
    const scrubbed = beforeSend({
      uuid: 'synthetic',
      event: '$snapshot',
      properties: {
        ph_keyword: SYNTHETIC_QUERY,
        $snapshot_data: [
          {
            type: 4,
            data: { href: `https://yalelabs.io/research?q=${SYNTHETIC_QUERY}`, width: 1 },
          },
          {
            type: 2,
            data: {
              node: {
                childNodes: [
                  {
                    attributes: {
                      href: `?q=${SYNTHETIC_QUERY}`,
                      src: `/i.png?u=${SYNTHETIC_NETID}`,
                    },
                  },
                  { textContent: `/research/person/${SYNTHETIC_NETID}` },
                ],
              },
            },
          },
        ],
      },
    } as never) as { properties: Record<string, unknown> };

    const serialized = JSON.stringify(scrubbed);
    expect(serialized).not.toContain(SYNTHETIC_QUERY);
    expect(serialized).not.toContain(SYNTHETIC_NETID);
    expect(serialized).toContain('https://yalelabs.io/research');
    expect(serialized).toContain('"width":1');
    expect(scrubbed.properties).not.toHaveProperty('ph_keyword');
  });

  it('runs only in a production build with a project key and the US host', () => {
    const target = { key: SYNTHETIC_KEY, host: POSTHOG_INGEST_ORIGIN };
    const { resolvePostHogTarget } = productAnalytics;

    expect(resolvePostHogTarget({ production: true, ...target })).toEqual(target);
    expect(resolvePostHogTarget({ production: false, ...target })).toBeNull();
    expect(resolvePostHogTarget({ production: true, host: POSTHOG_INGEST_ORIGIN })).toBeNull();
    expect(
      resolvePostHogTarget({
        production: true,
        key: 'phx_notAProjectKey000000000000',
        host: POSTHOG_INGEST_ORIGIN,
      }),
    ).toBeNull();
    expect(
      resolvePostHogTarget({
        production: true,
        key: SYNTHETIC_KEY,
        host: 'https://eu.i.posthog.com',
      }),
    ).toBeNull();
    expect(
      resolvePostHogTarget({
        production: true,
        key: SYNTHETIC_KEY,
        host: 'https://collector.example.test',
      }),
    ).toBeNull();
  });
});
