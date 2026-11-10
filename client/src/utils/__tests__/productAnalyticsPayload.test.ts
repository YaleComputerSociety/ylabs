import { gunzipSync, strFromU8 } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ProductAnalyticsModule = typeof import('../productAnalytics');

let productAnalytics: ProductAnalyticsModule;

const SYNTHETIC_KEY = 'phc_syntheticTestKey0000000000000000000000';
let sessionKeyIndex = 0;
const freshSessionKey = () => `phc_syntheticSessionKey${String(++sessionKeyIndex).padStart(20, '0')}`;
const SYNTHETIC_NETID = 'zq9999';
const SYNTHETIC_QUERY = 'syntheticquerytext';
const SYNTHETIC_NOTE = 'synthetic private plan note';
const SYNTHETIC_TYPED = 'synthetic typed words';
const SYNTHETIC_LABEL = 'synthetic accessible label';
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
    .filter((request) => request.url.startsWith(POSTHOG_INGEST_ORIGIN))
    .flatMap((request) => {
      const body = request.body as { batch?: SentEvent[] } | SentEvent[];
      return Array.isArray(body) ? body : (body?.batch ?? []);
    });

const everythingSent = () => JSON.stringify(expandCompressedStrings(sent.map((r) => r.body)));

const freshPostHog = async () => {
  await productAnalytics.loadPostHog();
  const { PostHog } = await import('posthog-js/no-external');
  return new PostHog();
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
        { allowed: true, netId: SYNTHETIC_NETID, distinctId },
        { key: freshSessionKey(), host: POSTHOG_INGEST_ORIGIN },
        freshPostHog,
      ),
    ).toBe(true);
    await wait(500);
    interact();
    window.history.pushState({}, '', `/research/person/${SYNTHETIC_NETID}?q=${SYNTHETIC_QUERY}`);
    await wait(4500);
    return sentEvents();
  };

  it('records clicks, pageviews and a replay with all text, inputs, queries and the netid masked', async () => {
    const events = await recordSession(SYNTHETIC_POSTHOG_ID);
    const names = new Set(events.map((event) => event.event));
    expect(names).toContain('$pageview');
    expect(names).toContain('$autocapture');
    expect(names).toContain('$snapshot');

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

    for (const event of events.filter((candidate) => candidate.event !== '$snapshot')) {
      expect(event.properties.distinct_id).toBe(SYNTHETIC_POSTHOG_ID);
      expect(event.properties.$process_person_profile).toBe(true);
      expect(event.$set).toBeUndefined();
      expect(event.$set_once).toBeUndefined();
      expect(event.properties.$el_text).toBeUndefined();
    }
    expect(names).not.toContain('$identify');
    expect(names).not.toContain('$set');

    expect(
      sent.every(
        (request) =>
          request.url.startsWith(`${POSTHOG_INGEST_ORIGIN}/`) ||
          request.url.startsWith(`${POSTHOG_ASSETS_ORIGIN}/array/`),
      ),
    ).toBe(true);
    expect(document.querySelector('script[src*="posthog"]')).toBeNull();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).toBe('');
  }, 20000);

  it('stays anonymous with no person profile when the server gives no opaque ID', async () => {
    const events = await recordSession('test123');

    expect(events.length).toBeGreaterThan(0);
    for (const event of events.filter((candidate) => candidate.event !== '$snapshot')) {
      expect(event.properties.distinct_id).not.toBe('test123');
      expect(event.properties.$process_person_profile).toBe(false);
    }
    expect(everythingSent()).not.toContain(SYNTHETIC_NETID);
  }, 20000);

  it('sends nothing once the session ends', async () => {
    productAnalytics.startProductAnalytics(
      { allowed: true, netId: SYNTHETIC_NETID },
      { key: freshSessionKey(), host: POSTHOG_INGEST_ORIGIN },
      freshPostHog,
    );
    await wait(500);
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
      capture_exceptions: false,
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
