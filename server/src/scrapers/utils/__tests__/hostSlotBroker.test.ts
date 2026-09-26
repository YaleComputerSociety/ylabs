import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { HostConcurrencyLimiter, type HostSlotRelease } from '../hostConcurrencyLimiter';
import { BrokeredHostSlotLimiter, HostSlotBroker } from '../hostSlotBroker';
import { resolveScraperHostSlotLimiter } from '../scraperHostSlotLimiter';

const openBrokers: HostSlotBroker[] = [];
const openClients: BrokeredHostSlotLimiter[] = [];

async function startBroker(budget = 4): Promise<HostSlotBroker> {
  const socketPath = path.join(
    os.tmpdir(),
    `ylabs-host-slots-test-${process.pid}-${Math.random().toString(36).slice(2, 8)}.sock`,
  );
  const broker = await HostSlotBroker.listen(socketPath, new HostConcurrencyLimiter(budget));
  openBrokers.push(broker);
  return broker;
}

function client(broker: HostSlotBroker, fallback = new HostConcurrencyLimiter(1)) {
  const limiter = new BrokeredHostSlotLimiter(broker.socketPath, fallback, () => {});
  openClients.push(limiter);
  return limiter;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

function track(acquisitions: Promise<HostSlotRelease>[]) {
  const granted: HostSlotRelease[] = [];
  for (const acquisition of acquisitions) void acquisition.then((release) => granted.push(release));
  return granted;
}

afterEach(async () => {
  for (const limiter of openClients.splice(0)) limiter.close();
  for (const broker of openBrokers.splice(0)) await broker.close();
});

describe('HostSlotBroker', () => {
  it('gives a child alone on a host the whole host budget, not budget divided by phase size', async () => {
    const broker = await startBroker(4);
    const lone = client(broker);
    const granted = track(Array.from({ length: 6 }, () => lone.acquire('example.yale.edu')));
    await settle();
    expect(granted).toHaveLength(4);
    granted[0]();
    await settle();
    expect(granted).toHaveLength(5);
  });

  it('holds children that share a host to one budget between them', async () => {
    const broker = await startBroker(4);
    const first = track(Array.from({ length: 3 }, () => client(broker).acquire('shared.yale.edu')));
    const second = track(
      Array.from({ length: 3 }, () => client(broker).acquire('shared.yale.edu')),
    );
    await settle();
    expect(first.length + second.length).toBe(4);
  });

  it('never lifts an overridden host past its override, across processes', async () => {
    const broker = await startBroker(4);
    const grantedAt: number[] = [];
    const acquisitions = [client(broker), client(broker), client(broker)].map((limiter) =>
      limiter.acquire('medicine.yale.edu').then((release) => {
        grantedAt.push(Date.now());
        return release;
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(grantedAt).toHaveLength(2);
    expect(grantedAt[1] - grantedAt[0]).toBeGreaterThanOrEqual(380);
    (await acquisitions[0])();
    await Promise.all(acquisitions.slice(1));
    expect(grantedAt).toHaveLength(3);
  });

  it('returns every slot a child held when its connection closes', async () => {
    const broker = await startBroker(2);
    const crashing = client(broker);
    const held = track([crashing.acquire('a.yale.edu'), crashing.acquire('a.yale.edu')]);
    await settle();
    expect(held).toHaveLength(2);
    const waiting = track([client(broker).acquire('a.yale.edu')]);
    await settle();
    expect(waiting).toHaveLength(0);
    crashing.close();
    await settle();
    expect(waiting).toHaveLength(1);
  });

  it('falls back to the local cap when the broker is unreachable', async () => {
    const reasons: string[] = [];
    const fallback = new HostConcurrencyLimiter(1);
    const limiter = new BrokeredHostSlotLimiter(
      path.join(os.tmpdir(), `ylabs-host-slots-missing-${process.pid}.sock`),
      fallback,
      (reason) => reasons.push(reason),
    );
    openClients.push(limiter);
    const release = await limiter.acquire('b.yale.edu');
    expect(fallback.activeCount('b.yale.edu')).toBe(1);
    expect(reasons[0]).toMatch(/unavailable/);
    release();
    expect(fallback.activeCount('b.yale.edu')).toBe(0);
  });

  it('uses the broker only when the sweep names one', () => {
    const local = new HostConcurrencyLimiter(1);
    expect(resolveScraperHostSlotLimiter({}, local)).toBe(local);
    expect(
      resolveScraperHostSlotLimiter({ SCRAPER_HOST_SLOT_BROKER: '/tmp/x.sock' }, local),
    ).toBeInstanceOf(BrokeredHostSlotLimiter);
  });
});
