import http from 'http';
import https from 'https';
import type { Duplex } from 'stream';

/**
 * Bounds the connect phase of an outbound request: DNS lookup, TCP handshake and, for https, the
 * TLS handshake. Node arms no connect timer of its own, and a socket timeout only measures
 * inactivity once the socket exists, so a peer that accepts the SYN and never finishes the
 * handshake is otherwise held for as long as the caller's other timers allow.
 */
export const OUTBOUND_CONNECT_TIMEOUT_MS = 15_000;

export const OUTBOUND_CONNECT_TIMEOUT_CODE = 'ETIMEDOUT';

type ConnectReadyEvent = 'connect' | 'secureConnect';

export interface ConnectDeadlineAgentOptions extends http.AgentOptions {
  connectTimeoutMs?: number;
}

export const connectTimeoutError = (timeoutMs: number): NodeJS.ErrnoException =>
  Object.assign(new Error(`connect timeout of ${timeoutMs}ms exceeded`), {
    code: OUTBOUND_CONNECT_TIMEOUT_CODE,
  });

export function armConnectDeadline<T extends Duplex | null | undefined>(
  socket: T,
  readyEvent: ConnectReadyEvent,
  timeoutMs: number,
): T {
  if (!socket) return socket;
  const timer = setTimeout(() => socket.destroy(connectTimeoutError(timeoutMs)), timeoutMs);
  const disarm = () => clearTimeout(timer);
  socket.once(readyEvent, disarm);
  socket.once('close', disarm);
  return socket;
}

const resolvedConnectTimeoutMs = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : OUTBOUND_CONNECT_TIMEOUT_MS;

export class ConnectDeadlineHttpAgent extends http.Agent {
  readonly connectTimeoutMs: number;

  constructor(options: ConnectDeadlineAgentOptions = {}) {
    const { connectTimeoutMs, ...agentOptions } = options;
    super(agentOptions);
    this.connectTimeoutMs = resolvedConnectTimeoutMs(connectTimeoutMs);
  }

  createConnection(
    ...args: Parameters<http.Agent['createConnection']>
  ): ReturnType<http.Agent['createConnection']> {
    return armConnectDeadline(super.createConnection(...args), 'connect', this.connectTimeoutMs);
  }
}

export class ConnectDeadlineHttpsAgent extends https.Agent {
  readonly connectTimeoutMs: number;

  constructor(options: ConnectDeadlineAgentOptions & https.AgentOptions = {}) {
    const { connectTimeoutMs, ...agentOptions } = options;
    super(agentOptions);
    this.connectTimeoutMs = resolvedConnectTimeoutMs(connectTimeoutMs);
  }

  createConnection(
    ...args: Parameters<https.Agent['createConnection']>
  ): ReturnType<https.Agent['createConnection']> {
    return armConnectDeadline(
      super.createConnection(...args),
      'secureConnect',
      this.connectTimeoutMs,
    );
  }
}
