import { beforeEach, describe, expect, it, vi } from 'vitest';

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));

vi.mock('dns/promises', () => ({
  default: { lookup: (...args: unknown[]) => lookupMock(...args) },
}));

import {
  assertPublicHttpUrl,
  privateAddressRefusalCounts,
  resetPrivateAddressRefusalCounts,
  ssrfSafeLookup,
  SsrfBlockedError,
} from '../../../utils/ssrfGuard';
import {
  probeSplitHorizonNetwork,
  splitHorizonNetworkWarning,
  splitHorizonRefusalReport,
  splitHorizonRefusalWarning,
} from '../splitHorizonRefusals';

const campusHost = 'www.fixture-dept.example.edu';
const internalHost = 'intranet.fixture.example.edu';

describe('split-horizon refusals are reported, never released (#6111)', () => {
  beforeEach(() => {
    lookupMock.mockReset();
    resetPrivateAddressRefusalCounts();
  });

  it('still refuses a host this network resolves privately, and only counts it', async () => {
    lookupMock.mockResolvedValue([{ address: '10.66.3.117', family: 4 }]);
    await expect(assertPublicHttpUrl(`https://${campusHost}/people`)).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    await expect(assertPublicHttpUrl(`https://${campusHost}/alumni`)).rejects.toMatchObject({
      reason: 'private-address',
    });
    expect(privateAddressRefusalCounts().get(campusHost)).toBe(2);
  });

  it('still refuses a private answer at connect time, and counts it', async () => {
    lookupMock.mockResolvedValue([{ address: '10.66.0.155', family: 4 }]);
    const error = await new Promise<NodeJS.ErrnoException | null>((resolve) =>
      ssrfSafeLookup(campusHost, { all: true }, (err) => resolve(err)),
    );
    expect(error?.code).toBe('EHOSTUNREACH');
    expect(privateAddressRefusalCounts().get(campusHost)).toBe(1);
  });

  it('refuses normally whatever the counter makes of an odd or private literal host', async () => {
    lookupMock.mockResolvedValue([{ address: '10.66.3.117', family: 4 }]);
    await expect(assertPublicHttpUrl('http://[fd00::1]/')).rejects.toMatchObject({
      reason: 'private-address',
    });
    await expect(assertPublicHttpUrl('http://10.66.3.117/')).rejects.toMatchObject({
      reason: 'private-address',
    });
    await expect(
      assertPublicHttpUrl(`https://${campusHost.toUpperCase()}./`),
    ).rejects.toMatchObject({ reason: 'private-address' });
    const error = await new Promise<NodeJS.ErrnoException | null>((resolve) =>
      ssrfSafeLookup('', { all: true }, (err) => resolve(err)),
    );
    expect(error?.code).toBe('EHOSTUNREACH');
    expect([...privateAddressRefusalCounts().keys()]).toEqual([`${campusHost}.`]);
  });

  it('keeps refusing once the per-host count is full, and stops adding hosts', async () => {
    lookupMock.mockResolvedValue([{ address: '10.66.3.117', family: 4 }]);
    for (let index = 0; index < 501; index += 1) {
      await expect(
        assertPublicHttpUrl(`https://host-${index}.fixture.example.edu/`),
      ).rejects.toBeInstanceOf(SsrfBlockedError);
    }
    expect(privateAddressRefusalCounts().size).toBe(500);
  });

  it('counts nothing for a public answer or a refusal that is not a private address', async () => {
    lookupMock.mockResolvedValue([{ address: '128.36.0.109', family: 4 }]);
    await expect(assertPublicHttpUrl(`https://${campusHost}/`)).resolves.toBeInstanceOf(URL);
    await expect(assertPublicHttpUrl('ftp://example.edu/')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    expect(privateAddressRefusalCounts().size).toBe(0);
  });

  it('splits refused hosts by what public DNS answers, and warns only about split-horizon ones', async () => {
    const report = await splitHorizonRefusalReport(
      new Map([
        [campusHost, 3],
        [internalHost, 1],
      ]),
      async (host) => (host === campusHost ? 'public' : 'private-address'),
    );
    expect(report).toEqual({
      splitHorizonHosts: [{ host: campusHost, refusals: 3 }],
      privateOnlyHosts: [{ host: internalHost, refusals: 1 }],
      unclassifiedHosts: [],
      splitHorizonRefusals: 3,
      classificationBudgetMs: 60_000,
    });
    expect(splitHorizonRefusalWarning(report)).toContain(`${campusHost} (3)`);
    expect(splitHorizonRefusalWarning(report)).not.toContain(internalHost);
  });

  it('treats a failed public lookup as private, so it is never reported as split-horizon', async () => {
    const report = await splitHorizonRefusalReport(new Map([[campusHost, 1]]), async () => {
      throw new Error('DNS-over-HTTPS unavailable');
    });
    expect(report.splitHorizonHosts).toEqual([]);
    expect(splitHorizonRefusalWarning(report)).toBeNull();
  });

  it('returns within its budget when public DNS never answers, and classifies nothing', async () => {
    const counts = new Map(Array.from({ length: 20 }, (_, i) => [`host-${i}.example.edu`, 1]));
    const started = Date.now();
    const report = await splitHorizonRefusalReport(counts, () => new Promise(() => {}), 50, 8);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(report.splitHorizonHosts).toEqual([]);
    expect(report.privateOnlyHosts).toEqual([]);
    expect(report.unclassifiedHosts).toHaveLength(20);
    expect(splitHorizonRefusalWarning(report)).toContain(
      '20 other refused host(s) were not classified',
    );
    expect(splitHorizonRefusalWarning(report)).toContain('within the 0.05 s budget');
  });

  it('asks at most the concurrency limit at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const counts = new Map(Array.from({ length: 30 }, (_, i) => [`host-${i}.example.edu`, 1]));
    const report = await splitHorizonRefusalReport(
      counts,
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight -= 1;
        return 'public';
      },
      5_000,
      8,
    );
    expect(peak).toBe(8);
    expect(report.splitHorizonHosts).toHaveLength(30);
  });

  it('ends the network probe at its budget when DNS never answers', async () => {
    const started = Date.now();
    const hosts = await probeSplitHorizonNetwork(
      [campusHost],
      () => new Promise(() => {}),
      async () => 'public',
      50,
    );
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(hosts).toEqual([]);
  });

  it('names the probe hosts this network answers privately and public DNS answers publicly', async () => {
    const hosts = await probeSplitHorizonNetwork(
      [campusHost, internalHost, 'www.public.example.edu'],
      async (host) =>
        host === 'www.public.example.edu' ? { kind: 'public' } : { kind: 'private-address' },
      async (host) => (host === campusHost ? 'public' : 'private-address'),
    );
    expect(hosts).toEqual([campusHost]);
    expect(splitHorizonNetworkWarning(hosts)).toContain(campusHost);
    expect(splitHorizonNetworkWarning([])).toBeNull();
  });
});
