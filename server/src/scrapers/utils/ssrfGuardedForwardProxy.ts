import http from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { ssrfSafeLookup, stripIpv6Brackets } from '../../utils/ssrfGuard';

export type ForwardProxyTargetResolver = (hostname: string) => Promise<string>;

export interface SsrfGuardedForwardProxy {
  url: string;
  forwardedHosts: () => string[];
  refusedHosts: () => string[];
  close: () => Promise<void>;
}

export interface SsrfGuardedForwardProxyOptions {
  resolveTarget?: ForwardProxyTargetResolver;
  forwardablePorts?: ReadonlySet<number>;
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
  const forwarded: string[] = [];
  const refused: string[] = [];
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

  const server = http.createServer(async (req, res) => {
    const target = requestTarget(req.url);
    const address = await admit(target);
    if (!target || !address) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('Blocked by SSRF guard');
      return;
    }
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
        res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(res);
      },
    );
    upstream.on('socket', track);
    upstream.on('error', () => {
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
    const upstream = net.connect({ host: address, port: target.port }, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    track(upstream);
    upstream.on('error', () => clientSocket.destroy());
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
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
