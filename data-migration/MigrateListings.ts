import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { Listing } from '../server/src/models/listing';

// Load environment variables from server/.env
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

async function migrateListings() {
  const sourceUrl = process.env.MONGODBURL;
  const targetUrl = process.env.MONGODBURL_MIGRATION;

  if (!sourceUrl) {
    console.error('ERROR: MONGODBURL (Production) not set in environment');
    process.exit(1);
  }

  if (!targetUrl) {
    console.error('ERROR: MONGODBURL_MIGRATION (ProductionMigration) not set in environment');
    console.error('Please add MONGODBURL_MIGRATION to your server/.env file');
    process.exit(1);
  }

  console.log('\n=== Migrating Listings: Production -> ProductionMigration ===\n');

  try {
    // Connect to source (Production)
    console.log('Connecting to Production database...');
    const sourceConnection = await mongoose.createConnection(sourceUrl).asPromise();
    const SourceListing = sourceConnection.model('listings', Listing.schema);

    // Fetch all listings from Production (including embeddings)
    console.log('Fetching listings from Production...');
    const listings = await SourceListing.find({}).select('+embedding').lean();
    console.log(`Found ${listings.length} listings in Production`);

    if (listings.length === 0) {
      console.log('No listings to migrate');
      await sourceConnection.close();
      return;
    }

    // Connect to target (ProductionMigration)
    console.log('Connecting to ProductionMigration database...');
    const targetConnection = await mongoose.createConnection(targetUrl).asPromise();
    const TargetListing = targetConnection.model('listings', Listing.schema);

    // Check existing count in target
    const existingCount = await TargetListing.countDocuments();
    console.log(`Existing listings in ProductionMigration: ${existingCount}`);

    // Clear existing listings in target (optional - comment out to append)
    if (existingCount > 0) {
      console.log('Clearing existing listings in ProductionMigration...');
      await TargetListing.deleteMany({});
    }

    // Insert all listings to target
    console.log('Inserting listings into ProductionMigration...');
    const result = await TargetListing.insertMany(listings, { ordered: false });
    console.log(`Successfully migrated ${result.length} listings`);

    // Verify
    const finalCount = await TargetListing.countDocuments();
    console.log(`Total listings in ProductionMigration: ${finalCount}`);

    // Close connections
    await sourceConnection.close();
    await targetConnection.close();
    console.log('\nMigration complete!\n');

  } catch (error) {
    console.error('Error during migration:', error);
    process.exit(1);
  }
}

migrateListings().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
