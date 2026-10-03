import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createReadinessRouter } from '../ready';
import { READINESS_PROBE_TIMEOUT_MS, type ReadinessProbes } from '../../services/readinessService';

const servers: Server[] = [];

const startReadinessServer = async (probes: ReadinessProbes): Promise<string> => {
  const app = express().use('/api/ready', createReadinessRouter(probes));
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/ready`;
};

const succeeds = async () => undefined;
const failsWithInternals = async () => {
  throw new Error('connect ECONNREFUSED mongodb://user:pass@db.internal:27017');
};
const neverAnswers = () => new Promise<never>(() => undefined);

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

describe('GET /api/ready', () => {
  it('answers 200 with exactly two true booleans and an uncacheable response when both datastores answer', async () => {
    const response = await fetch(await startReadinessServer({ mongo: succeeds, search: succeeds }));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toStrictEqual({ mongo: true, search: true });
  });

  it('answers 503 naming MongoDB when its ping fails, without echoing the failure', async () => {
    const response = await fetch(
      await startReadinessServer({ mongo: failsWithInternals, search: succeeds }),
    );
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(JSON.parse(body)).toStrictEqual({ mongo: false, search: true });
    expect(body).not.toMatch(/ECONNREFUSED|user:pass|internal|27017/);
  });

  it('answers 503 naming search when Meilisearch health fails', async () => {
    const response = await fetch(
      await startReadinessServer({ mongo: succeeds, search: failsWithInternals }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toStrictEqual({ mongo: true, search: false });
  });

  it('answers 503 within the probe deadline when a datastore never answers', async () => {
    const url = await startReadinessServer({ mongo: neverAnswers, search: neverAnswers });
    const startedAt = Date.now();

    const response = await fetch(url);

    expect(response.status).toBe(503);
    expect(await response.json()).toStrictEqual({ mongo: false, search: false });
    expect(Date.now() - startedAt).toBeLessThan(READINESS_PROBE_TIMEOUT_MS + 1_500);
  });
});
