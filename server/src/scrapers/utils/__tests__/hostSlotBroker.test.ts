import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChainedHostSlotLimiter,
  HostConcurrencyLimiter,
  type HostSlotRelease,
} from '../hostConcurrencyLimiter';
import {
  BrokeredHostSlotLimiter,
  brokerSocketPath,
  fitsUnixSocketPath,
  HostSlotBroker,
  UNIX_SOCKET_PATH_MAX_BYTES,
} from '../hostSlotBroker';
import { resolveScraperHostSlotLimiter } from '../scraperHostSlotLimiter';

const openBrokers: HostSlotBroker[] = [];
const openClients: BrokeredHostSlotLimiter[] = [];

async function startBroker(
  limiter: HostConcurrencyLimiter = new HostConcurrencyLimiter(4),
): Promise<HostSlotBroker> {
  const socketPath = brokerSocketPath(
    `ylabs-host-slots-test-${process.pid}-${Math.random().toString(36).slice(2, 8)}.sock`,
  );
  const broker = await HostSlotBroker.listen(socketPath, limiter);
  openBrokers.push(broker);
  return broker;
}

function client(broker: HostSlotBroker, fallback = new HostConcurrencyLimiter(1)) {
  const limiter = new BrokeredHostSlotLimiter(broker.socketPath, fallback, () => {});
  openClients.push(limiter);
  return limiter;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

async function waitForLength(items: unknown[], length: number): Promise<void> {
  await vi.waitFor(() => expect(items).toHaveLength(length));
}

function virtualClockLimiter(budget: number) {
  let clock = 0;
  const sleeps: number[] = [];
  const limiter = new HostConcurrencyLimiter(budget, {
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
  });
  return { limiter, sleeps };
}

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
    const brokerLimiter = new HostConcurrencyLimiter(4);
    const broker = await startBroker(brokerLimiter);
    const lone = client(broker);
    const granted = track(Array.from({ length: 6 }, () => lone.acquire('example.yale.edu')));
    await waitForLength(granted, 4);
    expect(brokerLimiter.activeCount('example.yale.edu')).toBe(4);
    granted[0]();
    await waitForLength(granted, 5);
    expect(brokerLimiter.activeCount('example.yale.edu')).toBe(4);
  });

  it('holds children that share a host to one budget between them', async () => {
    const brokerLimiter = new HostConcurrencyLimiter(4);
    const broker = await startBroker(brokerLimiter);
    const first = track(Array.from({ length: 3 }, () => client(broker).acquire('shared.yale.edu')));
    const second = track(
      Array.from({ length: 3 }, () => client(broker).acquire('shared.yale.edu')),
    );
    await vi.waitFor(() => expect(first.length + second.length).toBe(4));
    expect(brokerLimiter.activeCount('shared.yale.edu')).toBe(4);
  });

  it('never lifts an overridden host past its override, across processes', async () => {
    const { limiter: brokerLimiter, sleeps } = virtualClockLimiter(4);
    const broker = await startBroker(brokerLimiter);
    const granted = track(
      [client(broker), client(broker), client(broker)].map((limiter) =>
        limiter.acquire('medicine.yale.edu'),
      ),
    );
    await waitForLength(granted, 2);
    expect(brokerLimiter.activeCount('medicine.yale.edu')).toBe(2);
    expect(sleeps).toEqual([400]);
    granted[0]();
    await waitForLength(granted, 3);
    expect(sleeps).toEqual([400, 400]);
  });

  it('returns every slot a child held when its connection closes', async () => {
    const brokerLimiter = new HostConcurrencyLimiter(2);
    const broker = await startBroker(brokerLimiter);
    const crashing = client(broker);
    const held = track([crashing.acquire('a.yale.edu'), crashing.acquire('a.yale.edu')]);
    await waitForLength(held, 2);
    const waiting = track([client(broker).acquire('a.yale.edu')]);
    await settle();
    expect(waiting).toHaveLength(0);
    crashing.close();
    await waitForLength(waiting, 1);
    expect(brokerLimiter.activeCount('a.yale.edu')).toBe(1);
  });

  it('falls back to the local cap when the broker is unreachable', async () => {
    const reasons: string[] = [];
    const fallback = new HostConcurrencyLimiter(1);
    const limiter = new BrokeredHostSlotLimiter(
      brokerSocketPath(`ylabs-host-slots-missing-${process.pid}.sock`),
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

  it('uses the sweep broker only when the sweep names one, and the machine-wide one otherwise', async () => {
    const local = new HostConcurrencyLimiter(1);
    const machineGrants: string[] = [];
    const machine = {
      acquire: async (host: string) => {
        machineGrants.push(host);
        return () => {};
      },
    };
    const standalone = resolveScraperHostSlotLimiter({}, local, machine);
    expect(standalone).toBeInstanceOf(ChainedHostSlotLimiter);
    const release = await standalone.acquire('a.yale.edu');
    expect(local.activeCount('a.yale.edu')).toBe(1);
    expect(machineGrants).toEqual(['a.yale.edu']);
    release();
    expect(local.activeCount('a.yale.edu')).toBe(0);
    expect(
      resolveScraperHostSlotLimiter({ SCRAPER_HOST_SLOT_BROKER: '/tmp/x.sock' }, local, machine),
    ).toBeInstanceOf(BrokeredHostSlotLimiter);
  });

  it('keeps a broker socket under the Unix path limit when the temp directory is deep', async () => {
    const deepDirectory = `/tmp/${'d'.repeat(UNIX_SOCKET_PATH_MAX_BYTES)}`;
    const fileName = `ylabs-host-slots-deep-${process.pid}.sock`;
    const socketPath = brokerSocketPath(fileName, deepDirectory);
    expect(fitsUnixSocketPath(socketPath)).toBe(true);
    expect(socketPath.endsWith(fileName)).toBe(true);
    const broker = await HostSlotBroker.listen(socketPath, new HostConcurrencyLimiter(1));
    openBrokers.push(broker);
    const release = await client(broker).acquire('c.yale.edu');
    release();
  });

  it('prefers the requested directory when the socket fits there', () => {
    expect(brokerSocketPath('broker.sock', '/tmp/short')).toBe('/tmp/short/broker.sock');
  });

  it('refuses a socket path past the Unix limit instead of listening on a truncated name', async () => {
    const tooLong = `/tmp/${'x'.repeat(UNIX_SOCKET_PATH_MAX_BYTES)}.sock`;
    await expect(HostSlotBroker.listen(tooLong, new HostConcurrencyLimiter(1))).rejects.toThrow(
      /Unix socket limit/,
    );
  });
});
