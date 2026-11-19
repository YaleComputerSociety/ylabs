import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createReadinessRouter } from '../ready';
import { READINESS_PROBE_TIMEOUT_MS, type ReadinessProbes } from '../../services/readinessService';

const servers: Server[] = [];
const DELETION_OFF = { status: 'off', missingSettings: [] };
const SYNTHETIC_AUDIT_KEY = 'synthetic-readiness-audit-key-0123456789';

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

beforeEach(() => {
  vi.stubEnv('FEATURE_ACCOUNT_DATA_CONTROLS', '');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

describe('GET /api/ready', () => {
  it('answers 200 with two true booleans, deletion off, and an uncacheable response when both datastores answer', async () => {
    const response = await fetch(await startReadinessServer({ mongo: succeeds, search: succeeds }));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toStrictEqual({
      mongo: true,
      search: true,
      accountDeletion: DELETION_OFF,
    });
  });

  it('answers 503 naming MongoDB when its ping fails, without echoing the failure', async () => {
    const response = await fetch(
      await startReadinessServer({ mongo: failsWithInternals, search: succeeds }),
    );
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(JSON.parse(body)).toStrictEqual({
      mongo: false,
      search: true,
      accountDeletion: DELETION_OFF,
    });
    expect(body).not.toMatch(/ECONNREFUSED|user:pass|internal|27017/);
  });

  it('answers 503 naming search when Meilisearch health fails', async () => {
    const response = await fetch(
      await startReadinessServer({ mongo: succeeds, search: failsWithInternals }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toStrictEqual({
      mongo: true,
      search: false,
      accountDeletion: DELETION_OFF,
    });
  });

  it('answers 503 within the probe deadline when a datastore never answers', async () => {
    const url = await startReadinessServer({ mongo: neverAnswers, search: neverAnswers });
    const startedAt = Date.now();

    const response = await fetch(url);

    expect(response.status).toBe(503);
    expect(await response.json()).toStrictEqual({
      mongo: false,
      search: false,
      accountDeletion: DELETION_OFF,
    });
    expect(Date.now() - startedAt).toBeLessThan(READINESS_PROBE_TIMEOUT_MS + 1_500);
  });

  it('stays 200 while naming, never echoing, the settings an enabled deletion is missing', async () => {
    vi.stubEnv('FEATURE_ACCOUNT_DATA_CONTROLS', 'true');
    vi.stubEnv('MONGODBURL', 'mongodb://127.0.0.1:1/Prod');
    vi.stubEnv('POSTHOG_PERSONAL_API_KEY', `phx_${'r'.repeat(40)}`);
    vi.stubEnv('POSTHOG_PROJECT_ID', '');
    vi.stubEnv('ACCOUNT_DELETION_AUDIT_HMAC_KEY', SYNTHETIC_AUDIT_KEY);

    const response = await fetch(await startReadinessServer({ mongo: succeeds, search: succeeds }));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(body)).toStrictEqual({
      mongo: true,
      search: true,
      accountDeletion: { status: 'unavailable', missingSettings: ['POSTHOG_PROJECT_ID'] },
    });
    expect(body).not.toContain('phx_');
    expect(body).not.toContain(SYNTHETIC_AUDIT_KEY);
  });
});
