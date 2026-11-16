import http from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { normalizeExcludedHost } from '../../utils/excludedHosts';
import { ssrfSafeLookup, stripIpv6Brackets } from '../../utils/ssrfGuard';
import { acquireHostSlotWithin, type HostSlotLimiter } from './hostConcurrencyLimiter';
import { activeHostPause, HostPausedError, type HostPause } from './hostPause';
import { HOST_SLOT_WAIT_TIMEOUT_MS } from './hostThrottlePolicy';
import { RobotsDisallowedError } from './robotsDisallowedError';
import { enforceRobotsForPageRead, recordRobotsCrawlDelay } from './robotsFetchHook';
import {
  cachedRobotsPolicy,
  robotsPolicyHostKey,
  type RobotsTxtFetcher,
} from './robotsPolicyCache';
import { robotsAllows } from './robotsTxt';
import { scraperHostSlotLimiter } from './scraperHostSlotLimiter';
import {
  processScraperRequestLog,
  type ScraperRequestLog,
  type ScraperRequestOutcome,
} from './scraperRequestLog';

export type ForwardProxyTargetResolver = (hostname: string) => Promise<string>;

export interface ForwardProxyPacingRefusal {
  host: string;
  error: Error;
}

export interface SsrfGuardedForwardProxy {
  url: string;
  forwardedHosts: () => string[];
  refusedHosts: () => string[];
  pacingRefusals: () => ForwardProxyPacingRefusal[];
  /**
   * Subresource requests refused because the host's robots.txt disallows the path (#6340). Kept
   * apart from `pacingRefusals`, which fail the render: one disallowed asset must not throw away a
   * page whose seed robots.txt allows.
   */
  robotsRefusals: () => RobotsDisallowedError[];
  close: () => Promise<void>;
}

export interface SsrfGuardedForwardProxyOptions {
  resolveTarget?: ForwardProxyTargetResolver;
  forwardablePorts?: ReadonlySet<number>;
  hostSlots?: HostSlotLimiter;
  hostSlotWaitMs?: number;
  /**
   * The host whose slot the caller already holds for this whole proxy's life (a render's seed
   * host). Its requests are charged to that slot: taking a second one would wait on the caller's
   * own slot until the render timed out, where the host's limit is one.
   */
  heldHost?: string;
  hostPause?: (host: string) => HostPause | undefined;
  requestLog?: ScraperRequestLog | null;
  robotsTxtFetcher?: RobotsTxtFetcher;
}

const DEFAULT_FORWARDABLE_PORTS: ReadonlySet<number> = new Set([80, 443]);
const HOP_BY_HOP_REQUEST_HEADERS = ['proxy-connection', 'proxy-authorization', 'connection'];

export const resolvePublicForwardTarget: ForwardProxyTargetResolver = (hostname) =>
  new Promise((resolve, reject) => {
    ssrfSafeLookup(stripIpv6Brackets(hostname), { all: false }, (error, address) => {
      if (error || typeof address !== 'string') reject(error ?? new Error('No address'));
      else resolve(address);
    });
  });

interface ForwardTarget {
  hostname: string;
  port: number;
}

const tunnelTarget = (authority: string | undefined): ForwardTarget | null => {
  if (!authority) return null;
  try {
    const parsed = new URL(`http://${authority}`);
    const port = Number(parsed.port);
    if (!parsed.hostname || !Number.isInteger(port)) return null;
    return { hostname: stripIpv6Brackets(parsed.hostname), port };
  } catch {
    return null;
  }
};

const requestTarget = (rawUrl: string | undefined): (ForwardTarget & { path: string }) | null => {
  try {
    const parsed = new URL(rawUrl ?? '');
    if (parsed.protocol !== 'http:') return null;
    return {
      hostname: stripIpv6Brackets(parsed.hostname),
      port: Number(parsed.port || 80),
      path: `${parsed.pathname}${parsed.search}`,
    };
  } catch {
    return null;
  }
};

export async function startSsrfGuardedForwardProxy(
  options: SsrfGuardedForwardProxyOptions = {},
): Promise<SsrfGuardedForwardProxy> {
  const resolveTarget = options.resolveTarget ?? resolvePublicForwardTarget;
  const forwardablePorts = options.forwardablePorts ?? DEFAULT_FORWARDABLE_PORTS;
  const hostSlots = options.hostSlots ?? scraperHostSlotLimiter();
  const hostSlotWaitMs = options.hostSlotWaitMs ?? HOST_SLOT_WAIT_TIMEOUT_MS;
  const heldHost = options.heldHost ? normalizeExcludedHost(options.heldHost) : undefined;
  const heldRobotsHost = options.heldHost ? robotsPolicyHostKey(options.heldHost) : undefined;
  const isHeldRobotsHost = (host: string) => robotsPolicyHostKey(host) === heldRobotsHost;
  const hostPause = options.hostPause ?? activeHostPause;
  const requestLog =
    options.requestLog === undefined ? processScraperRequestLog() : options.requestLog;
  const forwarded: string[] = [];
  const refused: string[] = [];
  const robotsRefused: RobotsDisallowedError[] = [];
  const pacingRefused: ForwardProxyPacingRefusal[] = [];
  const sockets = new Set<Duplex>();
  const track = (socket: Duplex) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  };

  const admit = async (target: ForwardTarget | null): Promise<string | null> => {
    if (!target || !forwardablePorts.has(target.port)) {
      refused.push(target?.hostname ?? '');
      return null;
    }
    try {
      const address = await resolveTarget(target.hostname);
      forwarded.push(target.hostname);
      return address;
    } catch {
      refused.push(target.hostname);
      return null;
    }
  };

  const refusePacing = (host: string, error: Error): null => {
    pacingRefused.push({ host, error });
    return null;
  };

  /**
   * Charges one request to its receiving host's budget, so the browser's subresources and
   * redirect hops are paced like any axios fetch. The returned release is called once the host
   * has answered (a response's headers, or a tunnel's connection), so the slot spaces requests
   * without being held for the life of a keep-alive connection. Inside an HTTPS tunnel the
   * requests are encrypted, so a tunnel is charged once per connection the browser opens.
   * A paused host, or a slot that never came free, is refused before anything is sent.
   */
  const charge = async (host: string): Promise<(() => void) | null> => {
    const pausedBefore = hostPause(host);
    if (pausedBefore) return refusePacing(host, new HostPausedError(pausedBefore));
    if (heldHost && normalizeExcludedHost(host) === heldHost) return () => {};
    let release: () => void;
    try {
      release = await acquireHostSlotWithin(hostSlots, host, hostSlotWaitMs);
    } catch (error) {
      return refusePacing(host, error instanceof Error ? error : new Error(String(error)));
    }
    const pausedWhileWaiting = hostPause(host);
    if (pausedWhileWaiting) {
      release();
      return refusePacing(host, new HostPausedError(pausedWhileWaiting));
    }
    return release;
  };

  /**
   * A plain-HTTP subresource is checked against its host's robots.txt before it takes a slot. The
   * render's own seed host was checked, and its policy read, before the render took that host's
   * only slot, so its subresources read the cached policy and never send a robots.txt read that
   * would wait on that slot. A robots.txt read refused by a pause or the budget is left to
   * `charge`, which refuses the request for the same reason.
   */
  const robotsRefusalFor = async (
    target: ForwardTarget & { path: string },
    method: string | undefined,
  ): Promise<RobotsDisallowedError | null> => {
    const portSuffix = target.port === 80 ? '' : `:${target.port}`;
    const url = new URL(`http://${target.hostname}${portSuffix}${target.path}`);
    try {
      if (isHeldRobotsHost(target.hostname)) {
        const policy = cachedRobotsPolicy(target.hostname);
        const path = `${url.pathname}${url.search}`;
        return policy && !robotsAllows(policy, path)
          ? new RobotsDisallowedError(target.hostname, path)
          : null;
      }
      await enforceRobotsForPageRead(url, method, options.robotsTxtFetcher);
      return null;
    } catch (error) {
      return error instanceof RobotsDisallowedError ? error : null;
    }
  };

  /** An HTTPS tunnel's paths are encrypted, so only its host's Crawl-delay can apply. */
  const recordTunnelCrawlDelay = async (host: string): Promise<void> => {
    if (isHeldRobotsHost(host)) return;
    await recordRobotsCrawlDelay(host, options.robotsTxtFetcher).catch(() => undefined);
  };

  const logRequest = (url: string, dispatchedAt: Date, outcome: ScraperRequestOutcome) =>
    requestLog?.record(url, dispatchedAt, Date.now() - dispatchedAt.getTime(), outcome);

  const server = http.createServer(async (req, res) => {
    const target = requestTarget(req.url);
    const address = await admit(target);
    if (!target || !address) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('Blocked by SSRF guard');
      return;
    }
    const robotsRefusal = await robotsRefusalFor(target, req.method);
    if (robotsRefusal) {
      robotsRefused.push(robotsRefusal);
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('Disallowed by robots.txt');
      return;
    }
    const release = await charge(target.hostname);
    if (!release) {
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.end('Refused by host pacing');
      return;
    }
    const dispatchedAt = new Date();
    let settled = false;
    const settle = (outcome: ScraperRequestOutcome) => {
      if (settled) return;
      settled = true;
      release();
      logRequest(req.url ?? '', dispatchedAt, outcome);
    };
    const headers = { ...req.headers };
    for (const header of HOP_BY_HOP_REQUEST_HEADERS) delete headers[header];
    const upstream = http.request(
      {
        host: address,
        port: target.port,
        method: req.method,
        path: target.path,
        headers,
        agent: false,
        setHost: false,
      },
      (upstreamResponse) => {
        settle({ status: upstreamResponse.statusCode ?? 502 });
        res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(res);
      },
    );
    upstream.on('socket', track);
    upstream.on('error', (error: NodeJS.ErrnoException) => {
      settle({ error: error.code ?? 'UNKNOWN' });
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });

  server.on('connection', track);
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('connect', async (req: http.IncomingMessage, clientSocket: Duplex, head: Buffer) => {
    clientSocket.on('error', () => clientSocket.destroy());
    const target = tunnelTarget(req.url);
    const address = await admit(target);
    if (!target || !address) {
      clientSocket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    await recordTunnelCrawlDelay(target.hostname);
    const release = await charge(target.hostname);
    if (!release) {
      clientSocket.end('HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const dispatchedAt = new Date();
    const tunnelUrl = `https://${req.url ?? target.hostname}/`;
    let settled = false;
    const settle = (outcome: ScraperRequestOutcome) => {
      if (settled) return;
      settled = true;
      release();
      logRequest(tunnelUrl, dispatchedAt, outcome);
    };
    const upstream = net.connect({ host: address, port: target.port }, () => {
      settle({ tunnel: true });
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    track(upstream);
    upstream.on('error', (error: NodeJS.ErrnoException) => {
      settle({ error: error.code ?? 'UNKNOWN' });
      clientSocket.destroy();
    });
    clientSocket.on('close', () => upstream.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as net.AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    forwardedHosts: () => [...forwarded],
    refusedHosts: () => [...refused],
    pacingRefusals: () => [...pacingRefused],
    robotsRefusals: () => [...robotsRefused],
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
