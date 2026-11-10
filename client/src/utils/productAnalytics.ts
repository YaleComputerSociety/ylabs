import type {
  CapturedNetworkRequest,
  CaptureResult,
  PostHog,
  PostHogConfig,
  Properties,
} from 'posthog-js';

export const POSTHOG_INGEST_ORIGIN = 'https://us.i.posthog.com';

const POSTHOG_PROJECT_KEY = /^phc_[A-Za-z0-9]{20,64}$/;
const REDACTED = '[redacted]';

const TEXT_BEARING_ATTRIBUTES = [
  'aria-label',
  'aria-description',
  'aria-valuetext',
  'aria-placeholder',
  'title',
  'alt',
  'placeholder',
  'value',
  'data-value',
];

type PostHogEnv = {
  production: boolean;
  key?: string;
  host?: string;
};

export type PostHogTarget = { key: string; host: string };

const readPostHogEnv = (): PostHogEnv => ({
  production: import.meta.env.PROD,
  key: import.meta.env.VITE_POSTHOG_KEY,
  host: import.meta.env.VITE_POSTHOG_HOST,
});

export const resolvePostHogTarget = (env: PostHogEnv): PostHogTarget | null => {
  const key = (env.key || '').trim();
  const host = (env.host || '').trim();
  if (!env.production || !POSTHOG_PROJECT_KEY.test(key) || host !== POSTHOG_INGEST_ORIGIN) {
    return null;
  }
  return { key, host };
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const URL_QUERY_OR_FRAGMENT = /((?:[a-z][a-z0-9+.-]*:)?\/[^\s"'<>?#]*)[?#][^\s"'<>]*/gi;

export const createRedactor = (netId?: string) => {
  const trimmedNetId = netId?.trim();
  const netIdPattern = trimmedNetId
    ? new RegExp(`(^|[^A-Za-z0-9])${escapeRegex(trimmedNetId)}(?=$|[^A-Za-z0-9])`, 'gi')
    : null;

  const redactString = (value: string) => {
    const withoutQueries = value.replace(URL_QUERY_OR_FRAGMENT, '$1');
    return netIdPattern
      ? withoutQueries.replace(netIdPattern, (_match, lead: string) => `${lead}${REDACTED}`)
      : withoutQueries;
  };

  const redactValue = (value: unknown): unknown => {
    if (typeof value === 'string') return redactString(value);
    if (Array.isArray(value)) return value.map(redactValue);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
          redactString(key),
          redactValue(entry),
        ]),
      );
    }
    return value;
  };

  return { redactString, redactValue };
};

export const createProductAnalyticsGate = () => {
  let open = true;
  return {
    isOpen: () => open,
    close: () => {
      open = false;
    },
  };
};

const PERSON_EVENTS = new Set(['$identify', '$create_alias', '$groupidentify']);
const PERSON_PROPERTY_EVENT = '$set';
const USER_TYPE_BUCKETS = new Set([
  'undergraduate',
  'graduate',
  'student',
  'faculty',
  'professor',
  'staff',
]);

export const userTypeBucket = (userType: unknown): string => {
  const normalized = typeof userType === 'string' ? userType.trim().toLowerCase() : '';
  return USER_TYPE_BUCKETS.has(normalized) ? normalized : 'other';
};

const allowedPersonProperties = (value: unknown): Properties | undefined => {
  const userType = (value as Properties | undefined)?.user_type;
  return typeof userType === 'string' && userTypeBucket(userType) === userType
    ? { user_type: userType }
    : undefined;
};
const PERSON_PROPERTY_KEYS = ['$set', '$set_once', '$unset'];
const TEXT_ATTRIBUTE_KEYS = new Set(TEXT_BEARING_ATTRIBUTES.map((name) => `attr__${name}`));
const TEXT_ATTRIBUTE_IN_CHAIN = new RegExp(
  `attr__(?:${TEXT_BEARING_ATTRIBUTES.map(escapeRegex).join('|')})="(?:[^"\\\\]|\\\\.)*"`,
  'g',
);

const withoutElementText = (properties: Properties): Properties => {
  const cleaned: Properties = { ...properties };
  delete cleaned.$el_text;
  PERSON_PROPERTY_KEYS.forEach((key) => delete cleaned[key]);
  if (Array.isArray(cleaned.$elements)) {
    cleaned.$elements = cleaned.$elements.map((element: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(element).filter(
          ([key]) => key !== '$el_text' && !TEXT_ATTRIBUTE_KEYS.has(key),
        ),
      ),
    );
  }
  if (typeof cleaned.$elements_chain === 'string') {
    cleaned.$elements_chain = cleaned.$elements_chain
      .replace(TEXT_ATTRIBUTE_IN_CHAIN, '')
      .replace(/(^|[:"])text="(?:[^"\\]|\\.)*"/g, '$1');
  }
  return cleaned;
};

const PRODUCT_ANALYTICS_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const opaqueProductAnalyticsId = (value: unknown): string | undefined =>
  typeof value === 'string' && PRODUCT_ANALYTICS_ID.test(value) ? value : undefined;

type PostHogConfigInput = {
  host: string;
  netId?: string;
  distinctId?: string;
  isOpen: () => boolean;
};

export const buildPostHogConfig = ({
  host,
  netId,
  distinctId,
  isOpen,
}: PostHogConfigInput): Partial<PostHogConfig> => {
  const { redactString, redactValue } = createRedactor(netId);
  const identifiedAs = opaqueProductAnalyticsId(distinctId);

  const beforeSend = (event: CaptureResult | null): CaptureResult | null => {
    if (!event || !isOpen() || PERSON_EVENTS.has(event.event)) return null;
    if (event.event === '$snapshot') return event;
    const personProperties =
      event.event === PERSON_PROPERTY_EVENT && identifiedAs
        ? allowedPersonProperties(event.$set ?? event.properties?.$set)
        : undefined;
    if (event.event === PERSON_PROPERTY_EVENT && !personProperties) return null;
    const sanitized: CaptureResult = {
      ...event,
      properties: redactValue(withoutElementText(event.properties)) as Properties,
    };
    delete sanitized.$set;
    delete sanitized.$set_once;
    delete sanitized.$unset;
    if (personProperties) {
      sanitized.$set = personProperties;
      sanitized.properties.$set = personProperties;
    }
    return sanitized;
  };

  const maskCapturedNetworkRequest = (
    request: CapturedNetworkRequest,
  ): CapturedNetworkRequest | null => {
    const masked: CapturedNetworkRequest = {
      ...request,
      name: redactString(String(request.name ?? '')),
    };
    delete masked.requestBody;
    delete masked.responseBody;
    delete masked.requestHeaders;
    delete masked.responseHeaders;
    return masked;
  };

  const maskAttribute = (name: string, value: string) => {
    const attribute = name.toLowerCase();
    if (TEXT_BEARING_ATTRIBUTES.includes(attribute)) return value ? '*' : value;
    return redactString(value);
  };

  return {
    api_host: host,
    defaults: '2026-08-30',
    persistence: 'memory',
    person_profiles: 'identified_only',
    respect_dnt: true,
    internal_or_test_user_hostname: null,
    save_campaign_params: false,
    mask_personal_data_properties: true,
    disable_capture_url_hashes: true,
    mask_all_text: true,
    mask_all_element_attributes: false,
    autocapture: {
      capture_copied_text: false,
      capture_value_css_selector_allowlist: [],
      element_attribute_ignorelist: [...TEXT_BEARING_ATTRIBUTES],
    },
    capture_pageview: 'history_change',
    capture_pageleave: true,
    rageclick: true,
    capture_dead_clicks: true,
    capture_heatmaps: true,
    capture_performance: { network_timing: true, web_vitals: true },
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },
    enable_recording_console_log: false,
    disable_session_recording: false,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '*',
      recordHeaders: false,
      recordBody: false,
      captureJsonLd: false,
      recordCrossOriginIframes: false,
      collectFonts: false,
      maskAttributeFn: maskAttribute,
      maskCapturedNetworkRequestFn: maskCapturedNetworkRequest,
    },
    disable_external_dependency_loading: true,
    disable_surveys: true,
    disable_product_tours: true,
    disable_conversations: true,
    disable_web_experiments: true,
    advanced_disable_feature_flags: true,
    opt_in_site_apps: false,
    before_send: beforeSend,
    ...(identifiedAs ? { bootstrap: { distinctID: identifiedAs, isIdentifiedID: true } } : {}),
  };
};

export const loadPostHog = async (): Promise<PostHog> => {
  const [{ default: posthog }] = await Promise.all([
    import('posthog-js/no-external'),
    import('posthog-js/dist/lazy-recorder'),
    import('posthog-js/dist/dead-clicks-autocapture'),
    import('posthog-js/dist/web-vitals'),
    import('posthog-js/dist/exception-autocapture'),
  ]);
  return posthog;
};

type ProductAnalyticsSession = {
  allowed: boolean;
  netId?: string;
  distinctId?: string;
  userType?: string;
};

export type JourneyEvent = {
  eventType: string;
  entityType?: string;
  entityId?: string;
  entityIds?: string[];
  payload?: Record<string, unknown>;
};

const JOURNEY_EVENT_NAME = /^[a-z][a-z_]{2,40}$/;
const JOURNEY_PROPERTY_KEY = /^[A-Za-z][A-Za-z0-9]{0,40}$/;
const JOURNEY_PROPERTY_VALUE = /^[a-z0-9][a-z0-9_+-]{0,40}$/;
const ENTITY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;
const MAX_ENTITY_IDS = 50;
const MAX_PENDING_JOURNEY_EVENTS = 50;

export const journeyEventProperties = (event: JourneyEvent): Properties | null => {
  if (!JOURNEY_EVENT_NAME.test(event.eventType)) return null;
  const properties: Properties = {};
  for (const [key, value] of Object.entries(event.payload ?? {})) {
    if (
      JOURNEY_PROPERTY_KEY.test(key) &&
      typeof value === 'string' &&
      JOURNEY_PROPERTY_VALUE.test(value)
    ) {
      properties[key] = value;
    }
  }
  if (event.entityType && JOURNEY_PROPERTY_VALUE.test(event.entityType)) {
    properties.entityType = event.entityType;
  }
  if (event.entityId && ENTITY_ID.test(event.entityId)) properties.entityId = event.entityId;
  const entityIds = (event.entityIds ?? []).filter((id) => ENTITY_ID.test(id));
  if (entityIds.length > 0) {
    properties.entityIds = entityIds.slice(0, MAX_ENTITY_IDS);
    properties.entityCount = entityIds.length;
  }
  return properties;
};

let productAnalyticsDeclined = false;
let pendingJourneyEvents: { name: string; properties: Properties }[] = [];

let running: {
  gate: ReturnType<typeof createProductAnalyticsGate>;
  posthog: Promise<PostHog | null>;
} | null = null;

export const startProductAnalytics = (
  session: ProductAnalyticsSession,
  target: PostHogTarget | null = resolvePostHogTarget(readPostHogEnv()),
  load: () => Promise<PostHog> = loadPostHog,
): boolean => {
  if (!session.allowed || !target) {
    stopProductAnalytics();
    return false;
  }
  if (running) return running.gate.isOpen();

  const gate = createProductAnalyticsGate();
  const posthog = load()
    .then((instance) => {
      if (!gate.isOpen()) return null;
      instance.init(
        target.key,
        buildPostHogConfig({
          host: target.host,
          netId: session.netId,
          distinctId: session.distinctId,
          isOpen: gate.isOpen,
        }),
      );
      if (opaqueProductAnalyticsId(session.distinctId)) {
        instance.setPersonProperties({ user_type: userTypeBucket(session.userType) });
      }
      const queued = pendingJourneyEvents;
      pendingJourneyEvents = [];
      queued.forEach(({ name, properties }) => instance.capture(name, properties));
      return instance;
    })
    .catch(() => null);
  running = { gate, posthog };
  return true;
};

export const captureJourneyEvent = (event: JourneyEvent): void => {
  if (running && !running.gate.isOpen()) return;
  const properties = journeyEventProperties(event);
  if (!properties) return;
  if (!running) {
    if (!productAnalyticsDeclined && pendingJourneyEvents.length < MAX_PENDING_JOURNEY_EVENTS) {
      pendingJourneyEvents.push({ name: event.eventType, properties });
    }
    return;
  }
  const { gate, posthog } = running;
  void posthog.then((instance) => {
    if (instance && gate.isOpen()) instance.capture(event.eventType, properties);
  });
};

export const stopProductAnalytics = () => {
  pendingJourneyEvents = [];
  productAnalyticsDeclined = true;
  if (!running) return;
  const { gate, posthog } = running;
  gate.close();
  void posthog.then((instance) => instance?.stopSessionRecording());
};
