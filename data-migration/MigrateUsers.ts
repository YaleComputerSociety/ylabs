import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { User } from '../server/src/models/user';

// Load environment variables from server/.env
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

async function migrateUsers() {
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

  console.log('\n=== Migrating Users: Production -> ProductionMigration ===\n');

  try {
    // Connect to source (Production)
    console.log('Connecting to Production database...');
    const sourceConnection = await mongoose.createConnection(sourceUrl).asPromise();
    const SourceUser = sourceConnection.model('users', User.schema);

    // Fetch all users from Production
    console.log('Fetching users from Production...');
    const users = await SourceUser.find({}).lean();
    console.log(`Found ${users.length} users in Production`);

    if (users.length === 0) {
      console.log('No users to migrate');
      await sourceConnection.close();
      return;
    }

    // Connect to target (ProductionMigration)
    console.log('Connecting to ProductionMigration database...');
    const targetConnection = await mongoose.createConnection(targetUrl).asPromise();
    const TargetUser = targetConnection.model('users', User.schema);

    // Check existing count in target
    const existingCount = await TargetUser.countDocuments();
    console.log(`Existing users in ProductionMigration: ${existingCount}`);

    // Clear existing users in target (optional - comment out to append)
    if (existingCount > 0) {
      console.log('Clearing existing users in ProductionMigration...');
      await TargetUser.deleteMany({});
    }

    // Insert all users to target
    console.log('Inserting users into ProductionMigration...');
    const result = await TargetUser.insertMany(users, { ordered: false });
    console.log(`Successfully migrated ${result.length} users`);

    // Verify
    const finalCount = await TargetUser.countDocuments();
    console.log(`Total users in ProductionMigration: ${finalCount}`);

    // Close connections
    await sourceConnection.close();
    await targetConnection.close();
    console.log('\nMigration complete!\n');

  } catch (error) {
    console.error('Error during migration:', error);
    process.exit(1);
  }
}

migrateUsers().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
