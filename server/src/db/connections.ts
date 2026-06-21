/**
 * MongoDB connection management and model initialization.
 */
import mongoose, { Connection } from 'mongoose';
import { listingSchema, Listing } from '../models/listing';

let productionConnection: Connection | null = null;
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
  // idle timeout before the NAT silently kills them under us.
  maxIdleTimeMS: 210000,
  // Keep at least one connection alive so the topology is never fully torn
  // down between requests on a low-traffic server (Beta).
  minPoolSize: 1,
};

// Serialise reconnect attempts: if one is already in flight, later callers
// wait for it rather than launching a second parallel reconnect.
let reconnectInFlight: Promise<void> | null = null;

/**
 * Called by the error handler whenever a MongoNotConnectedError escapes to
 * application code. Once client.topology goes null the driver cannot
 * self-recover; we must disconnect and reconnect explicitly.
 */
export function triggerReconnect(): void {
  if (reconnectInFlight) return;
  reconnectInFlight = (async () => {
    // Brief pause so the in-flight 503 response can be flushed before we
    // tear down and recreate the connections.
    await new Promise((r) => setTimeout(r, 250));
    try {
      const mode = getApiMode();
      const primaryUrl = process.env.MONGODBURL;
      if (!primaryUrl) return;

      console.error('MongoDB: topology lost — forcing reconnect');

      if (mode === 'productionMigration') {
        const migrationUrl = process.env.MONGODBURL_MIGRATION;
        if (!migrationUrl) return;
        await Promise.allSettled([
          mongoose.disconnect(),
          migrationConnection?.close(),
        ]);
        await mongoose.connect(primaryUrl, mongoOptions);
        productionConnection = mongoose.connection;
        migrationConnection = await mongoose.createConnection(migrationUrl, mongoOptions).asPromise();
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
    productionConnection = mongoose.connection;
    console.log('Connected to primary database (default) 🚀');

    migrationConnection = await mongoose.createConnection(migrationUrl, mongoOptions).asPromise();
    console.log('Connected to migration database (listings) 🔄');

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
 * Get the appropriate Listing model. In productionMigration mode, returns a model connected to the migration DB.
 */
export function getListingModel(): mongoose.Model<any> {
  const mode = getApiMode();

  if (mode === 'productionMigration' && MigrationListing) {
    return MigrationListing;
  }

  return Listing;
}

export function getMigrationConnection(): Connection | null {
  return migrationConnection;
}

export function getProductionConnection(): Connection | null {
  return productionConnection;
}
