import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fetchOnce } from '../attachDirectoryNamedLeads';
import { httpStatus } from '../clearDeadLabResearchHomes';
import { classifyLabHome, SSRF_REFUSED_PROBE } from '../clearDeadLabResearchHomesCore';
import { fetchPage } from '../findLabWebsites';
import { probe } from '../repairLegacyPersonPageUrls';
import { followHttpRedirects } from '../repairVanityHostCitations';

describe('operator script probes refuse a private destination', () => {
  let server: http.Server;
  let hits: string[];
  let origin: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(req.url ?? '');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><title>Internal service</title><h1>Internal service</h1></html>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    hits = [];
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('the legacy person-page probe reads nothing from a loopback host', async () => {
    await expect(probe(`${origin}/people/example`)).resolves.toEqual({ status: 0, title: '' });
    expect(hits).toEqual([]);
  });

  it('the directory-lead probe reads nothing from a loopback host', async () => {
    await expect(fetchOnce(`${origin}/profile/example`)).resolves.toEqual({
      status: 0,
      headingName: '',
    });
    expect(hits).toEqual([]);
  });

  it('the lab-site discovery probe reads nothing from a loopback host', async () => {
    await expect(fetchPage(`${origin}/`)).resolves.toEqual({ status: 0, title: '', text: '' });
    expect(hits).toEqual([]);
  });

  it('the vanity-host follower settles no destination for a loopback host', async () => {
    await expect(followHttpRedirects(`https://127.0.0.1/lab`)).resolves.toEqual({ hops: 1 });
    expect(hits).toEqual([]);
  });

  it('the dead lab-home probe reports a refusal that clears nothing', async () => {
    const status = await httpStatus(`${origin}/lab/example/`);

    expect(status).toBe(SSRF_REFUSED_PROBE);
    expect(hits).toEqual([]);
    expect(
      classifyLabHome(
        { websiteUrl: 'https://medicine.yale.edu/lab/example/' },
        new Set(['another-lab']),
        status,
      ),
    ).toBe('address-refused');
  });
});
