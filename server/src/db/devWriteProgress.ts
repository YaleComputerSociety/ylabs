import type {
  CommandStartedEvent,
  CommandSucceededEvent,
  CommandFailedEvent,
  Document,
} from 'mongodb';

/**
 * Counts the work a Development write-lease holder actually completes (#5880), so a holder whose
 * heartbeat keeps its lease live while its work is hung can be told apart from a busy one.
 *
 * Progress is a successful database command or a settled fetch. Liveness traffic is not progress:
 * commands on the lease collection, writes that only move heartbeat fields, and driver keep-alive
 * and session housekeeping commands would advance the counter of a process that does nothing else.
 */
export const DEV_WRITE_PROGRESS_EXCLUDED_COLLECTION = 'scrape_job_locks';

const LIVENESS_COMMANDS = new Set([
  'ping',
  'hello',
  'ismaster',
  'isMaster',
  'buildInfo',
  'buildinfo',
  'endSessions',
  'killCursors',
]);

const HEARTBEAT_FIELDS = new Set([
  'heartbeatAt',
  'leaseExpiresAt',
  'progressAt',
  'progressCount',
  'updatedAt',
]);
const HEARTBEAT_OPERATORS = new Set(['$set', '$max', '$inc']);

function commandCollection(command: Document, commandName: string): string | undefined {
  const target = command[commandName];
  if (typeof target === 'string') return target;
  return typeof command.collection === 'string' ? command.collection : undefined;
}

function isHeartbeatShapedUpdate(statement: unknown): boolean {
  const update = (statement as { u?: unknown } | null)?.u;
  if (!update || typeof update !== 'object' || Array.isArray(update)) return false;
  const operators = Object.entries(update as Record<string, unknown>);
  return (
    operators.length > 0 &&
    operators.every(
      ([operator, fields]) =>
        HEARTBEAT_OPERATORS.has(operator) &&
        fields !== null &&
        typeof fields === 'object' &&
        Object.keys(fields).every((field) => HEARTBEAT_FIELDS.has(field)),
    )
  );
}

export function countsAsDevWriteProgress(commandName: string, command: Document): boolean {
  if (LIVENESS_COMMANDS.has(commandName)) return false;
  if (commandCollection(command, commandName) === DEV_WRITE_PROGRESS_EXCLUDED_COLLECTION) {
    return false;
  }
  if (commandName === 'update' && Array.isArray(command.updates) && command.updates.length > 0) {
    return !command.updates.every(isHeartbeatShapedUpdate);
  }
  return true;
}

export interface DevWriteProgressSnapshot {
  count: number;
  lastAt?: Date;
}

let clock: () => Date = () => new Date();
let count = 0;
let lastAt: Date | undefined;

export function setDevWriteProgressClock(now: () => Date) {
  clock = now;
}

export function recordDevWriteProgress(): void {
  count += 1;
  lastAt = clock();
}

/** The first held lease starts the clock, so a holder that never progresses is measured from then. */
export function startDevWriteProgressClock(at: Date): void {
  lastAt ??= at;
}

export function devWriteProgress(): DevWriteProgressSnapshot {
  return { count, ...(lastAt ? { lastAt } : {}) };
}

interface CommandMonitoringClient {
  options?: { monitorCommands?: boolean; socketTimeoutMS?: number };
  on(event: 'commandStarted', listener: (event: CommandStartedEvent) => void): unknown;
  on(event: 'commandSucceeded', listener: (event: CommandSucceededEvent) => void): unknown;
  on(event: 'commandFailed', listener: (event: CommandFailedEvent) => void): unknown;
}

const watchedClients = new WeakSet<object>();
let longestWatchedSocketTimeoutMs = 0;

const socketTimeoutMs = (client: CommandMonitoringClient): number => {
  const timeout = client.options?.socketTimeoutMS;
  return typeof timeout === 'number' && timeout > 0 ? timeout : Number.POSITIVE_INFINITY;
};

/**
 * The longest socket timeout among the watched clients, infinite when any has none. One command on
 * a client without a ceiling can legitimately run for any length of time, so silence there is not
 * evidence of a hang.
 */
export const longestWatchedSocketTimeout = (): number => longestWatchedSocketTimeoutMs;

export const clientMonitorsCommands = (client: unknown): boolean =>
  (client as CommandMonitoringClient | undefined)?.options?.monitorCommands === true;

const commandKey = (event: {
  address: string;
  connectionId?: string | number;
  requestId: number;
}) => `${event.address}|${event.connectionId ?? ''}|${event.requestId}`;

/**
 * Counts every successful non-liveness command on a client. It returns whether the client emits
 * command events at all: one created without `monitorCommands` cannot show progress, so a holder
 * that writes through it must not be judged by a counter that never moves.
 */
export function watchMongoClientProgress(client: unknown): boolean {
  if (!client || typeof client !== 'object') return false;
  const monitored = clientMonitorsCommands(client);
  if (!monitored) return false;
  longestWatchedSocketTimeoutMs = Math.max(
    longestWatchedSocketTimeoutMs,
    socketTimeoutMs(client as CommandMonitoringClient),
  );
  if (watchedClients.has(client)) return true;
  watchedClients.add(client);
  const counted = new Set<string>();
  const emitter = client as CommandMonitoringClient;
  emitter.on('commandStarted', (event) => {
    if (countsAsDevWriteProgress(event.commandName, event.command)) counted.add(commandKey(event));
  });
  emitter.on('commandSucceeded', (event) => {
    if (counted.delete(commandKey(event))) recordDevWriteProgress();
  });
  emitter.on('commandFailed', (event) => {
    counted.delete(commandKey(event));
  });
  return true;
}

export function resetDevWriteProgressForTests() {
  clock = () => new Date();
  count = 0;
  lastAt = undefined;
  longestWatchedSocketTimeoutMs = 0;
}
