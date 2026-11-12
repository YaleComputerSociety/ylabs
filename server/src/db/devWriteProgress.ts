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
 * Progress is a settled database command or a settled fetch, and a holder with a counted command
 * in flight is progressing until that command ends, because a script connection has no socket
 * timeout and one index build can outlast any no-progress window. Liveness traffic is not progress:
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
  'updatedAt',
]);
const HEARTBEAT_OPERATORS = new Set(['$set', '$max']);

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

let clock: () => Date = () => new Date();
let lastAt: Date | undefined;
let commandsInFlight = 0;

export function setDevWriteProgressClock(now: () => Date) {
  clock = now;
}

export function recordDevWriteProgress(): void {
  lastAt = clock();
}

/** The first held lease starts the clock, so a holder that never progresses is measured from then. */
export function startDevWriteProgressClock(at: Date): void {
  lastAt ??= at;
}

export function lastDevWriteProgressAt(): Date | undefined {
  return commandsInFlight > 0 ? clock() : lastAt;
}

interface CommandMonitoringClient {
  options?: { monitorCommands?: boolean };
  on(event: 'commandStarted', listener: (event: CommandStartedEvent) => void): unknown;
  on(event: 'commandSucceeded', listener: (event: CommandSucceededEvent) => void): unknown;
  on(event: 'commandFailed', listener: (event: CommandFailedEvent) => void): unknown;
}

const watchedClients = new WeakSet<object>();

export const clientMonitorsCommands = (client: unknown): boolean =>
  (client as CommandMonitoringClient | undefined)?.options?.monitorCommands === true;

const commandKey = (event: {
  address: string;
  connectionId?: string | number;
  requestId: number;
}) => `${event.address}|${event.connectionId ?? ''}|${event.requestId}`;

/**
 * Tracks every non-liveness command on a client from start to end. It returns whether the client emits
 * command events at all: one created without `monitorCommands` cannot show progress, so a holder
 * that writes through it must not be judged by a counter that never moves.
 */
export function watchMongoClientProgress(client: unknown): boolean {
  if (!client || typeof client !== 'object') return false;
  const monitored = clientMonitorsCommands(client);
  if (!monitored || watchedClients.has(client)) return monitored;
  watchedClients.add(client);
  const counted = new Set<string>();
  const emitter = client as CommandMonitoringClient;
  const settle = (event: CommandSucceededEvent | CommandFailedEvent) => {
    if (!counted.delete(commandKey(event))) return;
    commandsInFlight -= 1;
    recordDevWriteProgress();
  };
  emitter.on('commandStarted', (event) => {
    if (!countsAsDevWriteProgress(event.commandName, event.command)) return;
    counted.add(commandKey(event));
    commandsInFlight += 1;
  });
  emitter.on('commandSucceeded', settle);
  emitter.on('commandFailed', settle);
  return true;
}

export function resetDevWriteProgressForTests() {
  clock = () => new Date();
  lastAt = undefined;
  commandsInFlight = 0;
}
