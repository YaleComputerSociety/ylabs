import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadDerivedRosterCandidates } from '../undergradRosterDerivation';

const rows = () => mongoose.connection.db!.collection('research_entities');

describe('loadDerivedRosterCandidates', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    await rows().deleteMany({});
  });

  it('attempts every live row with a website, badged or not', async () => {
    await rows().insertMany([
      { slug: 'unbadged-with-site', websiteUrl: 'https://unbadged.example.org/' },
      {
        slug: 'badged-with-site',
        websiteUrl: 'https://badged.example.org/',
        hasUndergradHostingEvidence: true,
      },
      { slug: 'no-site' },
      { slug: 'not-a-web-url', websiteUrl: 'mailto:lab@example.org' },
      { slug: 'archived-with-site', websiteUrl: 'https://archived.example.org/', archived: true },
    ]);

    const keys = (await loadDerivedRosterCandidates()).map((c) => c.researchEntityKey);

    expect(keys).toEqual(['badged-with-site', 'unbadged-with-site']);
  });

  it('keeps a row holding a derived roster after it loses its website, so the roster is withdrawn', async () => {
    await rows().insertOne({
      slug: 'derived-no-site',
      rosterEnrichment: { configOrigin: 'derived', state: 'current' },
    });

    const [candidate] = await loadDerivedRosterCandidates();

    expect(candidate).toMatchObject({
      researchEntityKey: 'derived-no-site',
      websiteUrl: '',
      hasDerivedRoster: true,
    });
  });
});
