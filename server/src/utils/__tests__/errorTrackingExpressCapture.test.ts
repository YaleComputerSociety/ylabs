import { AddressInfo } from 'net';
import { Server } from 'http';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import * as Sentry from '@sentry/node';

import { buildErrorTrackingOptions, captureServerError } from '../errorTracking';

const SYNTHETIC_NETID = 'zz9993';

const sentEnvelopes: string[] = [];

const capturingTransport: Sentry.NodeOptions['transport'] = (options) =>
  Sentry.createTransport(options, async (request) => {
    sentEnvelopes.push(
      typeof request.body === 'string' ? request.body : new TextDecoder().decode(request.body),
    );
    return { statusCode: 200 };
  });

let server: Server | undefined;

afterEach(async () => {
  delete process.env.SENTRY_DSN;
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
  await Sentry.close();
  sentEnvelopes.length = 0;
});

describe('server error report capture path', () => {
  it('keeps the route-template report when express loads after the SDK', async () => {
    Sentry.init({
      ...buildErrorTrackingOptions({ dsn: 'https://public@example.com/1', environment: 'test' }),
      transport: capturingTransport,
    });
    process.env.SENTRY_DSN = 'https://public@example.com/1';

    // Loaded after init so the SDK instruments it, which is the only way its
    // automatic capture runs and races the global error handler's report.
    const { default: express } = await import('express');
    const app = express();
    app.get('/api/users/:netid', () => {
      throw new Error('synthetic failure');
    });
    app.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
      captureServerError(error, req);
      res.status(500).json({ error: 'Internal server error' });
    });

    const origin = await new Promise<string>((resolve) => {
      server = app.listen(0, () => {
        const { port } = server?.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}`);
      });
    });
    const response = await fetch(`${origin}/api/users/${SYNTHETIC_NETID}`);
    expect(response.status).toBe(500);
    await Sentry.flush(2000);

    const events = sentEnvelopes.filter((envelope) => envelope.includes('"type":"event"'));
    expect(events).toHaveLength(1);
    expect(events[0]).toContain('/api/users/:netid');
    expect(events[0]).not.toContain('auto.http.express');
    expect(events[0]).not.toContain(SYNTHETIC_NETID);
  });

  it('reports a rejected async handler on a mounted router exactly once', async () => {
    Sentry.init({
      ...buildErrorTrackingOptions({ dsn: 'https://public@example.com/1', environment: 'test' }),
      transport: capturingTransport,
    });
    process.env.SENTRY_DSN = 'https://public@example.com/1';

    const { default: express } = await import('express');
    const app = express();
    const router = express.Router();
    router.get('/:netid', async () => {
      throw new Error('synthetic async failure');
    });
    app.use('/api/users', router);
    app.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
      captureServerError(error, req);
      res.status(500).json({ error: 'Internal server error' });
    });

    const origin = await new Promise<string>((resolve) => {
      server = app.listen(0, () => {
        const { port } = server?.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}`);
      });
    });
    const response = await fetch(`${origin}/api/users/${SYNTHETIC_NETID}`);
    expect(response.status).toBe(500);
    await Sentry.flush(2000);

    const events = sentEnvelopes.filter((envelope) => envelope.includes('"type":"event"'));
    expect(events).toHaveLength(1);
    expect(events[0]).toContain('synthetic async failure');
    expect(events[0]).toContain('/api/users/:netid');
    expect(events[0]).not.toContain('auto.http.express');
    expect(events[0]).not.toContain(SYNTHETIC_NETID);
  });
});
