import mongoose from 'mongoose';

/**
 * Whether this process has opened a database connection. A cache read in a process with no
 * database answers "no entry"; once a connection was opened, a read during a reconnect runs
 * and either succeeds or throws, so a dropped connection is never read as a cache miss.
 */
export function mongooseConnectionWasOpened(): boolean {
  return Boolean((mongoose.connection as { client?: unknown }).client);
}

export interface ConnectionDropCount {
  disconnected: number;
  reconnected: number;
}

export function countConnectionDrops(): ConnectionDropCount {
  const count: ConnectionDropCount = { disconnected: 0, reconnected: 0 };
  mongoose.connection.on('disconnected', () => {
    count.disconnected += 1;
  });
  mongoose.connection.on('reconnected', () => {
    count.reconnected += 1;
  });
  return count;
}
