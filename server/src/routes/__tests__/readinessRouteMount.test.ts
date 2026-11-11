import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

vi.mock('../../services/readinessService', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  defaultReadinessProbes: { mongo: async () => undefined, search: async () => undefined },
}));

import routes from '../index';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  vi.stubEnv('FEATURE_ACCOUNT_DATA_CONTROLS', '');
  const app = express().use('/api', routes);
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => server.close(resolve));
});

describe('readiness route mount', () => {
  it('serves the readiness JSON under /api/ready from the aggregated API router', async () => {
    const response = await fetch(`${baseUrl}/api/ready`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toStrictEqual({
      mongo: true,
      search: true,
      accountDeletion: { status: 'off', missingSettings: [] },
    });
  });
});
