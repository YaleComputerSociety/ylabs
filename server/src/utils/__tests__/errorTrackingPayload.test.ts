import { AddressInfo } from 'net';
import { Server } from 'http';
import express, { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import * as Sentry from '@sentry/node';

import { buildErrorTrackingOptions, captureServerError, scrubServerEvent } from '../errorTracking';

const SYNTHETIC_NETID = 'zz9993';
const SYNTHETIC_QUERY = 'synthetic-query-value';
const SYNTHETIC_HEADER = 'synthetic-header-value';

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

const listen = (app: express.Express): Promise<string> =>
  new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server?.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });

describe('server error report payload', () => {
  it('sends the route template and no netid, query value, or header value', async () => {
    Sentry.init({
      ...buildErrorTrackingOptions({ dsn: 'https://public@example.com/1', environment: 'test' }),
      transport: capturingTransport,
    });
    process.env.SENTRY_DSN = 'https://public@example.com/1';

    const app = express();
    const router = express.Router();
    router.get('/:netid', (req: Request) => {
      const lookedUpNetid = req.params.netid;
      console.log(`looking up ${lookedUpNetid}`);
      throw new Error('synthetic failure');
    });
    app.use('/api/users', router);
    app.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
      captureServerError(error, req);
      res.status(500).json({ error: 'Internal server error' });
    });

    const origin = await listen(app);
    const response = await fetch(`${origin}/api/users/${SYNTHETIC_NETID}?q=${SYNTHETIC_QUERY}`, {
      headers: { 'x-synthetic': SYNTHETIC_HEADER, cookie: `session=${SYNTHETIC_HEADER}` },
    });
    expect(response.status).toBe(500);
    await Sentry.flush(2000);

    const payload = sentEnvelopes.join('\n');
    expect(payload).toContain('synthetic failure');
    expect(payload).toContain('/api/users/:netid');
    expect(payload).not.toContain(SYNTHETIC_NETID);
    expect(payload).not.toContain(SYNTHETIC_QUERY);
    expect(payload).not.toContain(SYNTHETIC_HEADER);
    expect(sentEnvelopes.filter((envelope) => envelope.includes('"type":"event"'))).toHaveLength(1);
  });

  it('resolves every data collection category the SDK knows about to off', () => {
    const client = Sentry.init({
      ...buildErrorTrackingOptions({ dsn: 'https://public@example.com/1', environment: 'test' }),
      transport: capturingTransport,
    });

    expect(client?.getDataCollectionOptions()).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: { request: false, response: false },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: expect.any(Number),
    });
  });

  it('removes credentials from a connection string quoted in an error message', () => {
    const scrubbed = scrubServerEvent({
      type: undefined,
      exception: {
        values: [
          { type: 'Error', value: 'failed to reach mongodb+srv://user:pass@example.invalid/db' },
        ],
      },
    });

    expect(scrubbed.exception?.values?.[0]?.value).toBe(
      'failed to reach mongodb+srv://[Filtered]@example.invalid/db',
    );
  });
});
