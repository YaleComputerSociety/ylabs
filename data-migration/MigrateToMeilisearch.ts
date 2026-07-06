import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from server/.env
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

const MEILISEARCH_HOST = process.env.MEILISEARCH_HOST || 'http://localhost:7700';
const MEILISEARCH_API_KEY = process.env.MEILISEARCH_API_KEY;
const MEILISEARCH_INDEX_PREFIX = process.env.MEILISEARCH_INDEX_PREFIX || '';

async function migrateToMeilisearch() {
  const { Meilisearch } = await import('meilisearch');
  
  const meiliClient = new Meilisearch({
    host: MEILISEARCH_HOST,
    apiKey: MEILISEARCH_API_KEY,
  });

  const sourceUrl = process.env.MONGODBURL;
  if (!sourceUrl) {
    console.error('ERROR: MONGODBURL not set in environment');
    process.exit(1);
  }

  console.log('\n=== Migrating Listings to Meilisearch ===\n');

  try {
    console.log('Connecting to MongoDB...');
    const sourceConnection = await mongoose.createConnection(sourceUrl).asPromise();

    console.log('Fetching listings from MongoDB...');
    const listings = await sourceConnection.db.collection('listings').find({}).toArray();
    console.log(`Found ${listings.length} listings.`);

    if (listings.length === 0) {
      console.log('No listings to migrate');
      await sourceConnection.close();
      return;
    }

    const meiliDocs = listings.map((doc: any) => {
      const meiliDoc = { ...doc, id: doc._id.toString() };
      delete meiliDoc._id;
      delete meiliDoc.__v;
      delete meiliDoc.embedding; // Ensure legacy vectors aren't pushed
      return meiliDoc;
    });

    const indexName = MEILISEARCH_INDEX_PREFIX ? `${MEILISEARCH_INDEX_PREFIX}_listings` : 'listings';
    console.log(`Configuring Meilisearch Index: ${indexName}...`);
    const index = meiliClient.index(indexName);
    
    await index.updateFilterableAttributes([
      'departments',
      'researchAreas',
      'archived',
      'confirmed'
    ]);
    
    await index.updateSortableAttributes([
      'createdAt',
      'updatedAt',
      'searchScore'
    ]);

    if (process.env.OPENAI_API_KEY) {
        console.log('Configuring OpenAI Embedder native Meilisearch support...');
        await index.updateEmbedders({
            default: {
                source: 'openAi',
                apiKey: process.env.OPENAI_API_KEY,
                model: 'text-embedding-3-small',
                documentTemplate: "Title: {{doc.title}}\nProfessors: {{doc.professorNames}}\nDescription: {{doc.description}}\nKeywords: {{doc.keywords}}",
            }
        });
    }

    console.log('Pushing to Meilisearch...');
    const task = await index.addDocuments(meiliDocs, { primaryKey: 'id' });
    const completedTask = await meiliClient.tasks.waitForTask(task.taskUid, { timeout: 300000 });

    if (completedTask.status !== 'succeeded') {
      throw new Error(
        `Meilisearch task ${completedTask.uid} failed: ${completedTask.error?.message || 'Unknown error'}`,
      );
    }

    console.log(`Pushed documents. Meilisearch Task UID: ${completedTask.uid}`);
    console.log('\nMigration complete! Meilisearch confirmed the documents were indexed.\n');

    await sourceConnection.close();
  } catch (error) {
    console.error('Error during migration:', error);
    process.exit(1);
  }
}

migrateToMeilisearch().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
