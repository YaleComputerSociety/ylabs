/**
 * MongoDB connection management and model initialization.
 */
import mongoose, { Connection } from 'mongoose';
import { listingSchema, Listing } from '../models/listing';

let migrationConnection: Connection | null = null;

let MigrationListing: mongoose.Model<any> | null = null;

export type ApiMode = 'default' | 'productionMigration';

export function getApiMode(): ApiMode {
  const mode = process.env.API_MODE?.toLowerCase();
  if (mode === 'productionmigration') return 'productionMigration';
  return 'default';
}

// Shared across initializeConnections and triggerReconnect so both use identical options.
const mongoOptions = {
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 60000,
  // Close idle connections after 3.5 min so we beat the ~4-min AWS NAT TCP
  // idle timeout before the NAT silently kills them under us. startMongoKeepAlive
  // pings well inside this window so the live connection never hits the cap.
  maxIdleTimeMS: 210000,
  // minPoolSize keeps a warm connection while the process is running, but it
  // cannot survive the host pausing an idle instance (Render): a frozen process
  // runs no heartbeats, so the socket dies and the first request after wake sees
  // a lost topology. withMongoReconnect heals that path; keepAlive prevents the
  // idle-teardown path.
  minPoolSize: 1,
};

// Serialise reconnect attempts: if one is already in flight, later callers
// await the same promise rather than launching a second parallel reconnect.
let reconnectInFlight: Promise<void> | null = null;

/**
 * True when an error (or any error in its VError cause chain) indicates the
 * MongoDB topology was lost. Once client.topology goes null the driver cannot
 * self-recover; we must disconnect and reconnect explicitly.
 */
export function isTopologyLostError(error: unknown): boolean {
  const e = error as { name?: string; message?: string; cause?: unknown } | null | undefined;
  if (!e) return false;
  if (e.name === 'MongoNotConnectedError') return true;
  if (
    typeof e.message === 'string' &&
    e.message.includes('Client must be connected before running operations')
  ) {
    return true;
  }
  const cause = typeof (e as any).cause === 'function' ? (e as any).cause() : (e as any).cause;
  return isTopologyLostError(cause);
}

/**
 * Forces an explicit disconnect + reconnect when the topology is lost. Returns
 * the in-flight promise so callers can await recovery and retry their operation
 * (see withMongoReconnect) instead of surfacing the failure to the user.
 */
export function triggerReconnect(): Promise<void> {
  if (reconnectInFlight) return reconnectInFlight;
  reconnectInFlight = (async () => {
    try {
      const mode = getApiMode();
      const primaryUrl = process.env.MONGODBURL;
      if (!primaryUrl) return;

      console.error('MongoDB: topology lost — forcing reconnect');

      if (mode === 'productionMigration') {
        const migrationUrl = process.env.MONGODBURL_MIGRATION;
        if (!migrationUrl) return;
        await Promise.allSettled([mongoose.disconnect(), migrationConnection?.close()]);
        await mongoose.connect(primaryUrl, mongoOptions);
        migrationConnection = await mongoose
          .createConnection(migrationUrl, mongoOptions)
          .asPromise();
        MigrationListing = migrationConnection.model('Listing', listingSchema, 'listings');
        console.log('MongoDB: productionMigration reconnected');
      } else {
        await mongoose.disconnect();
        await mongoose.connect(primaryUrl, mongoOptions);
        console.log('MongoDB: reconnected');
      }
    } catch (err) {
      console.error('MongoDB: reconnect failed:', (err as Error)?.message ?? err);
    } finally {
      reconnectInFlight = null;
    }
  })();
  return reconnectInFlight;
}

/**
 * Runs a MongoDB operation and, if the topology was lost, awaits a reconnect
 * and retries once so a cold connection becomes a brief latency blip instead of
 * a user-visible failure. Only use for operations that are safe to retry.
 */
export async function withMongoReconnect<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isTopologyLostError(error)) throw error;
    await triggerReconnect();
    return operation();
  }
}

let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Pings the primary connection on an interval inside maxIdleTimeMS so a
 * low-traffic instance never lets its live connection go idle-closed, and so a
 * silently dead socket is detected and healed before the next real request.
 */
export function startMongoKeepAlive(intervalMs = 120000): void {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(() => {
    void (async () => {
      try {
        await mongoose.connection.db?.admin().ping();
      } catch (error) {
        if (isTopologyLostError(error)) {
          await triggerReconnect();
        } else {
          console.error('MongoDB: keepAlive ping failed:', (error as Error)?.message ?? error);
        }
      }
    })();
  }, intervalMs);
  keepAliveTimer.unref?.();
}

export async function initializeConnections(): Promise<void> {
  const mode = getApiMode();

  // Surface connection lifecycle so Render logs show exactly when the driver
  // loses or regains the server — makes the next incident much easier to trace.
  mongoose.connection.on('disconnected', () => console.error('MongoDB: disconnected'));
  mongoose.connection.on('reconnected', () => console.log('MongoDB: reconnected'));
  mongoose.connection.on('error', (err: Error) =>
    console.error('MongoDB: error', err?.message ?? err),
  );

  if (mode === 'productionMigration') {
    const primaryUrl = process.env.MONGODBURL;
    const migrationUrl = process.env.MONGODBURL_MIGRATION;

    if (!primaryUrl) {
      throw new Error('MONGODBURL is required for ProductionMigration mode');
    }
    if (!migrationUrl) {
      throw new Error('MONGODBURL_MIGRATION is required for ProductionMigration mode');
    }

    await mongoose.connect(primaryUrl, mongoOptions);
    console.log('Connected to primary database (default) 🚀');

    migrationConnection = await mongoose.createConnection(migrationUrl, mongoOptions).asPromise();
    console.log('Connected to migration database 🔄');

    MigrationListing = migrationConnection.model('Listing', listingSchema, 'listings');
  } else {
    const url = process.env.MONGODBURL;
    if (!url) {
      throw new Error('MONGODBURL is required');
    }
    await mongoose.connect(url, mongoOptions);
    console.log(`Connected to database 🚀`);
  }
}

/**
 * Internal analytics read model for the retired `listings` collection. The
 * Listing product surface is retired; only the admin analytics aggregations
 * still read it, and they are tracked for removal separately.
 */
export function getListingModel(): mongoose.Model<any> {
  const mode = getApiMode();

  if (mode === 'productionMigration' && MigrationListing) {
    return MigrationListing;
  }

  return Listing;
}
