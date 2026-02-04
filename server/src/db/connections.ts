import mongoose, { Connection } from 'mongoose';
import { listingSchema } from '../models/listing';

// Connection instances
let productionConnection: Connection | null = null;
let migrationConnection: Connection | null = null;

// Listing model that may use a different connection in ProductionMigration mode
let MigrationListing: mongoose.Model<any> | null = null;

export type ApiMode = 'test' | 'production' | 'productionMigration';

export function getApiMode(): ApiMode {
  const mode = process.env.API_MODE?.toLowerCase();
  if (mode === 'test') return 'test';
  if (mode === 'productionmigration') return 'productionMigration';
  return 'production';
}

export async function initializeConnections(): Promise<void> {
  const mode = getApiMode();

  if (mode === 'productionMigration') {
    const prodUrl = process.env.MONGODBURL;
    const migrationUrl = process.env.MONGODBURL_MIGRATION;

    if (!prodUrl) {
      throw new Error('MONGODBURL is required for ProductionMigration mode');
    }
    if (!migrationUrl) {
      throw new Error('MONGODBURL_MIGRATION is required for ProductionMigration mode');
    }

    // Connect default mongoose to Production (for users, departments, etc.)
    await mongoose.connect(prodUrl);
    productionConnection = mongoose.connection;
    console.log('Connected to Production database (default) 🚀');

    // Create separate connection for ProductionMigration listings
    migrationConnection = await mongoose.createConnection(migrationUrl).asPromise();
    console.log('Connected to ProductionMigration database (listings) 🔄');

    // Create Listing model on the migration connection
    MigrationListing = migrationConnection.model('listings', listingSchema);
  } else if (mode === 'test') {
    const testUrl = process.env.MONGODBURL_TEST;
    if (!testUrl) {
      throw new Error('MONGODBURL_TEST is required for test mode');
    }
    await mongoose.connect(testUrl);
    console.log('Connected to Test database 🔬');
  } else {
    // Production mode
    const prodUrl = process.env.MONGODBURL;
    if (!prodUrl) {
      throw new Error('MONGODBURL is required');
    }
    await mongoose.connect(prodUrl);
    console.log('Connected to Production database 🚀');
  }
}

/**
 * Get the appropriate Listing model based on API_MODE.
 * In ProductionMigration mode, returns a model connected to ProductionMigration DB.
 * Otherwise, returns the default Listing model.
 */
export function getListingModel(): mongoose.Model<any> {
  const mode = getApiMode();

  if (mode === 'productionMigration' && MigrationListing) {
    return MigrationListing;
  }

  // Return the default Listing model (uses default mongoose connection)
  const { Listing } = require('../models/listing');
  return Listing;
}

export function getMigrationConnection(): Connection | null {
  return migrationConnection;
}

export function getProductionConnection(): Connection | null {
  return productionConnection;
}
