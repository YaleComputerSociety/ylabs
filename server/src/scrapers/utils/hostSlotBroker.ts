import fs from 'fs';
import net from 'net';
import {
  HostConcurrencyLimiter,
  type HostSlotLimiter,
  type HostSlotRelease,
} from './hostConcurrencyLimiter';

export const SCRAPER_HOST_SLOT_BROKER_ENV = 'SCRAPER_HOST_SLOT_BROKER';

type ClientMessage = { t: 'acquire'; id: number; host: string } | { t: 'release'; id: number };
type BrokerMessage = { t: 'grant'; id: number };

function lineReader(onMessage: (message: unknown) => void): (chunk: Buffer) => void {
  let buffered = '';
  return (chunk) => {
    buffered += chunk.toString('utf8');
    let newline = buffered.indexOf('\n');
    while (newline >= 0) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (line.trim()) {
        try {
          onMessage(JSON.parse(line));
        } catch {
          return;
        }
      }
      newline = buffered.indexOf('\n');
    }
  };
}

function send(socket: net.Socket, message: ClientMessage | BrokerMessage): void {
  if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
}

export class HostSlotBroker {
  private readonly connections = new Set<net.Socket>();

  private constructor(
    private readonly server: net.Server,
    readonly socketPath: string,
  ) {}

  static async listen(
    socketPath: string,
    limiter: HostConcurrencyLimiter,
  ): Promise<HostSlotBroker> {
    fs.rmSync(socketPath, { force: true });
    const server = net.createServer((socket) => broker.serve(socket, limiter));
    const broker = new HostSlotBroker(server, socketPath);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => {
        server.off('error', reject);
        resolve();
      });
    });
    fs.chmodSync(socketPath, 0o600);
    return broker;
  }

  private serve(socket: net.Socket, limiter: HostConcurrencyLimiter): void {
    this.connections.add(socket);
    const leases = new Map<number, HostSlotRelease>();
    let closed = false;
    const releaseAll = () => {
      closed = true;
      this.connections.delete(socket);
      for (const release of leases.values()) release();
      leases.clear();
    };
    socket.on('close', releaseAll);
    socket.on('error', () => socket.destroy());
    socket.on(
      'data',
      lineReader((raw) => {
        const message = raw as ClientMessage;
        if (message?.t === 'acquire' && Number.isInteger(message.id)) {
          void limiter.acquire(String(message.host ?? '')).then((release) => {
            if (closed) {
              release();
              return;
            }
            leases.set(message.id, release);
            send(socket, { t: 'grant', id: message.id });
          });
        } else if (message?.t === 'release') {
          leases.get(message.id)?.();
          leases.delete(message.id);
        }
      }),
    );
  }

  async close(): Promise<void> {
    for (const socket of this.connections) socket.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    fs.rmSync(this.socketPath, { force: true });
  }
}

interface PendingAcquire {
  host: string;
  resolve: (release: HostSlotRelease) => void;
}

export class BrokeredHostSlotLimiter implements HostSlotLimiter {
  private socket?: net.Socket;
  private connected = false;
  private failed = false;
  private nextId = 1;
  private activeLeases = 0;
  private readonly pending = new Map<number, PendingAcquire>();

  constructor(
    private readonly socketPath: string,
    private readonly fallback: HostSlotLimiter,
    private readonly onFallback: (reason: string) => void = (reason) =>
      console.warn(`[host-slots] ${reason}; falling back to this process's own per-host cap`),
  ) {}

  acquire(host: string): Promise<HostSlotRelease> {
    if (this.failed) return this.fallback.acquire(host);
    const socket = this.ensureSocket();
    const id = this.nextId++;
    return new Promise<HostSlotRelease>((resolve) => {
      this.pending.set(id, { host, resolve });
      this.holdEventLoopWhileBusy();
      if (this.connected) send(socket, { t: 'acquire', id, host });
    });
  }

  close(): void {
    this.socket?.destroy();
  }

  private ensureSocket(): net.Socket {
    if (this.socket) return this.socket;
    const socket = net.createConnection(this.socketPath);
    this.socket = socket;
    socket.on('connect', () => {
      this.connected = true;
      for (const [id, { host }] of this.pending) send(socket, { t: 'acquire', id, host });
    });
    socket.on(
      'data',
      lineReader((raw) => {
        const message = raw as BrokerMessage;
        if (message?.t !== 'grant') return;
        const waiter = this.pending.get(message.id);
        if (!waiter) return;
        this.pending.delete(message.id);
        this.activeLeases += 1;
        waiter.resolve(this.leaseRelease(socket, message.id));
      }),
    );
    socket.on('error', (error) => this.failOver(`host slot broker unavailable (${error.message})`));
    socket.on('close', () => this.failOver('host slot broker connection closed'));
    return socket;
  }

  private leaseRelease(socket: net.Socket, id: number): HostSlotRelease {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeLeases -= 1;
      send(socket, { t: 'release', id });
      this.holdEventLoopWhileBusy();
    };
  }

  private holdEventLoopWhileBusy(): void {
    if (!this.socket || this.failed) return;
    if (this.pending.size > 0 || this.activeLeases > 0) this.socket.ref();
    else this.socket.unref();
  }

  private failOver(reason: string): void {
    if (this.failed) return;
    this.failed = true;
    this.socket?.unref();
    this.onFallback(reason);
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const { host, resolve } of waiting) void this.fallback.acquire(host).then(resolve);
  }
}
