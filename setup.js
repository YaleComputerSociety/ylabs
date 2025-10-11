// MongoDB Index Setup Script
// Run this in MongoDB shell or save as setup-indexes.js and run with: mongosh < setup-indexes.js

// Connect to your database
// use your_database_name;

print("Setting up indexes for analytics system...\n");

// ==================== ANALYTICS EVENTS COLLECTION ====================
print("Creating indexes on analytics_events collection...");

db.analytics_events.createIndex({ eventType: 1, timestamp: -1 }, { background: true });
print("✓ Created index: { eventType: 1, timestamp: -1 }");

db.analytics_events.createIndex({ netid: 1, timestamp: -1 }, { background: true });
print("✓ Created index: { netid: 1, timestamp: -1 }");

db.analytics_events.createIndex({ eventType: 1, netid: 1, timestamp: -1 }, { background: true });
print("✓ Created index: { eventType: 1, netid: 1, timestamp: -1 }");

db.analytics_events.createIndex({ timestamp: -1 }, { background: true });
print("✓ Created index: { timestamp: -1 }");

db.analytics_events.createIndex({ listingId: 1 }, { background: true });
print("✓ Created index: { listingId: 1 }");

db.analytics_events.createIndex({ userType: 1 }, { background: true });
print("✓ Created index: { userType: 1 }");

// TTL index for auto-cleanup (3 years)
db.analytics_events.createIndex(
    { timestamp: 1 }, 
    { expireAfterSeconds: 94608000, background: true }
);
print("✓ Created TTL index: { timestamp: 1 } with 3-year expiration");

print("\n");

// ==================== USERS COLLECTION ====================
print("Creating indexes on users collection...");

db.users.createIndex({ createdAt: 1 }, { background: true });
print("✓ Created index: { createdAt: 1 }");

db.users.createIndex({ updatedAt: 1 }, { background: true });
print("✓ Created index: { updatedAt: 1 }");

db.users.createIndex({ userType: 1 }, { background: true });
print("✓ Created index: { userType: 1 }");

db.users.createIndex({ netid: 1 }, { unique: true, background: true });
print("✓ Created unique index: { netid: 1 }");

db.users.createIndex({ lastLogin: 1 }, { background: true });
print("✓ Created index: { lastLogin: 1 }");

db.users.createIndex({ lastActive: 1 }, { background: true });
print("✓ Created index: { lastActive: 1 }");

print("\n");

// ==================== NEWLISTINGS COLLECTION ====================
print("Creating indexes on newListings collection...");

db.newListings.createIndex({ createdAt: 1 }, { background: true });
print("✓ Created index: { createdAt: 1 }");

db.newListings.createIndex({ updatedAt: 1 }, { background: true });
print("✓ Created index: { updatedAt: 1 }");

db.newListings.createIndex({ departments: 1 }, { background: true });
print("✓ Created index: { departments: 1 }");

db.newListings.createIndex({ archived: 1, confirmed: 1 }, { background: true });
print("✓ Created index: { archived: 1, confirmed: 1 }");

db.newListings.createIndex({ ownerId: 1 }, { background: true });
print("✓ Created index: { ownerId: 1 }");

db.newListings.createIndex({ views: -1 }, { background: true });
print("✓ Created index: { views: -1 }");

db.newListings.createIndex({ favorites: -1 }, { background: true });
print("✓ Created index: { favorites: -1 }");

print("\n");

// ==================== VERIFY INDEXES ====================
print("Verifying indexes...\n");

print("Analytics Events indexes:");
printjson(db.analytics_events.getIndexes());

print("\nUsers indexes:");
printjson(db.users.getIndexes());

print("\nNewListings indexes:");
printjson(db.newListings.getIndexes());

print("\n✅ All indexes created successfully!");
print("\nNote: Indexes were created with { background: true } to avoid blocking operations.");
print("If your collections are large, index creation may take a few minutes to complete.");