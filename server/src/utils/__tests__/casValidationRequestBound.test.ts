import axios from 'axios';
import { describe, expect, it } from 'vitest';
import {
  boundCasServerRequests,
  casStrategyHttpClient,
  isCasServerRequest,
} from '../casValidationRequestBound';

const CAS_BASE = 'https://cas.example.test/cas';

const runRequestInterceptors = async (client: ReturnType<typeof axios.create>, url: string) => {
  let config: any = { url, headers: new axios.AxiosHeaders(), timeout: 0 };
  const handlers = (client.interceptors.request as any).handlers.filter(Boolean);
  for (const handler of handlers) config = await handler.fulfilled(config);
  return config;
};

describe('CAS validation request bound (#4190)', () => {
  it('matches only requests to the configured CAS server', () => {
    expect(isCasServerRequest(`${CAS_BASE}/validate`, CAS_BASE)).toBe(true);
    expect(isCasServerRequest(`${CAS_BASE}/validate`, `${CAS_BASE}/`)).toBe(true);
    expect(isCasServerRequest('https://cas.example.test/casual/validate', CAS_BASE)).toBe(false);
    expect(isCasServerRequest('https://other.example.test/cas/validate', CAS_BASE)).toBe(false);
    expect(isCasServerRequest(`${CAS_BASE}/validate`, '')).toBe(false);
    expect(isCasServerRequest(undefined, CAS_BASE)).toBe(false);
  });

  it('gives a CAS request a timeout and a deadline signal and leaves other requests alone', async () => {
    const client = axios.create();
    boundCasServerRequests(client, CAS_BASE, 1_500);

    const cas = await runRequestInterceptors(client, `${CAS_BASE}/validate`);
    expect(cas.timeout).toBe(1_500);
    expect(cas.signal).toBeInstanceOf(AbortSignal);

    const other = await runRequestInterceptors(client, 'https://api.example.test/data');
    expect(other.timeout).toBe(0);
    expect(other.signal).toBeUndefined();
  });

  it('installs one interceptor however many times the strategy module loads', () => {
    const client = axios.create();
    boundCasServerRequests(client, CAS_BASE, 1_000);
    boundCasServerRequests(client, CAS_BASE, 1_000);

    const installed = (client.interceptors.request as any).handlers.filter(Boolean);
    expect(installed).toHaveLength(1);
  });

  it('bounds the axios instance the CAS strategy itself requires', () => {
    const strategyClient = casStrategyHttpClient();
    expect(typeof strategyClient.get).toBe('function');
    expect(typeof strategyClient.interceptors.request.use).toBe('function');
  });
});
