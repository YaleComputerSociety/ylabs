import { afterEach, describe, expect, it } from 'vitest';
import * as Sentry from '@sentry/react';

import { buildErrorTrackingOptions } from '../errorTracking';

const SYNTHETIC_KEY = 'synthkey-0000';
const SYNTHETIC_QUERY = 'synthetic-query-value';

const sentEnvelopes: string[] = [];

const capturingTransport: Sentry.BrowserOptions['transport'] = (options) =>
  Sentry.createTransport(options, async (request) => {
    sentEnvelopes.push(
      typeof request.body === 'string' ? request.body : new TextDecoder().decode(request.body),
    );
    return { statusCode: 200 };
  });

afterEach(async () => {
  await Sentry.close();
  sentEnvelopes.length = 0;
  window.history.replaceState({}, '', '/');
});

describe('client error report payload', () => {
  it('sends no person key or query value through the SDK default integrations', async () => {
    window.history.replaceState({}, '', '/research');
    Sentry.init({
      ...buildErrorTrackingOptions({ dsn: 'https://public@example.com/1', environment: 'test' }),
      transport: capturingTransport,
    });

    window.history.pushState({}, '', `/research/person/${SYNTHETIC_KEY}?q=${SYNTHETIC_QUERY}`);
    console.info(`viewing ${SYNTHETIC_KEY}`);
    Sentry.captureException(new Error('synthetic failure'));
    await Sentry.flush(2000);

    const payload = sentEnvelopes.join('\n');
    expect(payload).toContain('synthetic failure');
    expect(payload).toContain('/research/person/:param');
    expect(payload).not.toContain(SYNTHETIC_KEY);
    expect(payload).not.toContain(SYNTHETIC_QUERY);
  });
});
