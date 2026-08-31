import http from 'node:http';
import { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import DeploymentRoutes from '../deployment';

const ORIGINAL_ENV = { ...process.env };

let server: http.Server;
let baseUrl: string;

const startServer = async () => {
  const app = express();
  app.use('/api/deployment', DeploymentRoutes);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/api/deployment`;
};

describe('GET /api/deployment', () => {
  beforeEach(async () => {
    process.env = {
      ...ORIGINAL_ENV,
      RENDER: 'true',
      RENDER_GIT_COMMIT: '852f4a05355bb17dbfce9d1197f4693ddf2ccb2a',
      RENDER_GIT_BRANCH: 'main',
      DEPLOYMENT_FINGERPRINT_TOKEN: 'ops-token-value',
    };
    await startServer();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.env = { ...ORIGINAL_ENV };
  });

  it('serves the fingerprint to a caller presenting the operator token', async () => {
    const response = await fetch(baseUrl, { headers: { 'X-Deployment-Token': 'ops-token-value' } });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      provider: 'render',
      gitCommit: '852f4a05355bb17dbfce9d1197f4693ddf2ccb2a',
      gitBranch: 'main',
    });
  });

  it('reports not found rather than unauthorized for an absent token', async () => {
    const response = await fetch(baseUrl);

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.not.toContain('852f4a05');
  });

  it('reports not found for a wrong token without revealing the endpoint exists', async () => {
    const response = await fetch(baseUrl, { headers: { 'X-Deployment-Token': 'wrong-token' } });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ message: 'Not found' });
  });

  it('stays closed when the deployment is not configured with a token', async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env.DEPLOYMENT_FINGERPRINT_TOKEN;
    await startServer();

    const response = await fetch(baseUrl, { headers: { 'X-Deployment-Token': 'ops-token-value' } });

    expect(response.status).toBe(404);
  });
});
