### Purpose of Data Migration

Yale Labs has been collecting data over a somewhat long period of time. For this reason we have data from 2017 that is:
- Either out of date
- Not good enough

The purpose of data migration is to give a way for us to easily migrate data to new models updating or deleting old listings.

### Meilisearch Listing Migration

`MigrateToMeilisearch.ts` reads listings from `MONGODBURL`, configures the listings index, and pushes searchable documents into Meilisearch. Before indexing, it removes legacy vectors and private evidence notes (`embedding`, `_id`, `__v`, and `evidence.internalNotes`) so the search index only receives public-safe evidence/source metadata.
