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

export async function initializeConnections(): Promise<void> {
  const mode = getApiMode();

  if (mode === 'productionMigration') {
    const primaryUrl = process.env.MONGODBURL;
    const migrationUrl = process.env.MONGODBURL_MIGRATION;

    if (!primaryUrl) {
      throw new Error('MONGODBURL is required for ProductionMigration mode');
    }
    if (!migrationUrl) {
      throw new Error('MONGODBURL_MIGRATION is required for ProductionMigration mode');
    }

    await mongoose.connect(primaryUrl);
    productionConnection = mongoose.connection;
    console.log('Connected to primary database (default) 🚀');

    migrationConnection = await mongoose.createConnection(migrationUrl).asPromise();
    console.log('Connected to migration database (listings) 🔄');

    MigrationListing = migrationConnection.model('listings', listingSchema);
  } else {
    const url = process.env.MONGODBURL;
    if (!url) {
      throw new Error('MONGODBURL is required');
    }
    await mongoose.connect(url);
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
