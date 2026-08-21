import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ResearchEntity } from '../../models/researchEntity';
import { runResearchEntityWebsiteUrlCorrectivePass } from '../backfillResearchEntityWebsiteUrls';

const PROFILE_URL =
  'https://engineering.yale.edu/research-and-faculty/faculty-directory/lee-fixture/';
const LAB_SITE = 'https://synthlab.example.org/';

let memoryReplSet: MongoMemoryReplSet | undefined;

async function insertEntity(doc: Record<string, unknown>): Promise<mongoose.Types.ObjectId> {
  const id = new mongoose.Types.ObjectId();
  await ResearchEntity.collection.insertOne({ _id: id, ...doc });
  return id;
}

async function websiteUrlOf(id: mongoose.Types.ObjectId): Promise<string | undefined> {
  const doc = await ResearchEntity.collection.findOne({ _id: id });
  return doc?.websiteUrl as string | undefined;
}

describe('runResearchEntityWebsiteUrlCorrectivePass with MongoDB', () => {
  beforeAll(async () => {
    memoryReplSet = await MongoMemoryReplSet.create({
      binary: { version: '8.0.12' },
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await mongoose.connect(memoryReplSet.getUri('website_url_corrective_test'));
  }, 120_000);

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryReplSet?.stop();
  });

  it('demotes a persisted profile websiteUrl to a real lab site in apply mode', async () => {
    const id = await insertEntity({
      name: 'Lee Lab',
      slug: 'lee-lab',
      websiteUrl: PROFILE_URL,
      sourceUrls: ['https://reporter.nih.gov/project-details/1', LAB_SITE],
    });

    const result = await runResearchEntityWebsiteUrlCorrectivePass({ dryRun: false });

    expect(result.mode).toBe('apply');
    expect(result.profilePageWebsiteUrls).toBe(1);
    expect(result.corrected).toBe(1);
    expect(result.samples).toContainEqual({ slug: 'lee-lab', from: PROFILE_URL, to: LAB_SITE });
    expect(await websiteUrlOf(id)).toBe(LAB_SITE);
  });

  it('does not mutate the database in dry-run mode but still counts the correction', async () => {
    const id = await insertEntity({
      name: 'Lee Lab',
      slug: 'lee-lab',
      websiteUrl: PROFILE_URL,
      sourceUrls: [LAB_SITE],
    });

    const result = await runResearchEntityWebsiteUrlCorrectivePass({ dryRun: true });

    expect(result.mode).toBe('dry-run');
    expect(result.corrected).toBe(1);
    expect(await websiteUrlOf(id)).toBe(PROFILE_URL);
  });

  it('leaves a profile websiteUrl untouched when no better candidate exists', async () => {
    const id = await insertEntity({
      name: 'Kai Group',
      slug: 'kai-group',
      websiteUrl: 'https://english.yale.edu/people/kai-fixture/',
      sourceUrls: ['https://reporter.nih.gov/project-details/1'],
    });

    const result = await runResearchEntityWebsiteUrlCorrectivePass({ dryRun: false });

    expect(result.profilePageWebsiteUrls).toBe(1);
    expect(result.corrected).toBe(0);
    expect(result.noBetterCandidate).toBe(1);
    expect(await websiteUrlOf(id)).toBe('https://english.yale.edu/people/kai-fixture/');
  });

  it('never touches an entity whose websiteUrl is already a real lab site', async () => {
    const id = await insertEntity({
      name: 'Synth Lab',
      slug: 'synth-lab',
      websiteUrl: 'https://synthlab.yale.edu/',
      sourceUrls: [LAB_SITE],
    });

    const result = await runResearchEntityWebsiteUrlCorrectivePass({ dryRun: false });

    expect(result.profilePageWebsiteUrls).toBe(0);
    expect(result.corrected).toBe(0);
    expect(await websiteUrlOf(id)).toBe('https://synthlab.yale.edu/');
  });

  it('does not demote a canonical campuspress lab research home using a people path', async () => {
    const canonical = 'https://campuspress.yale.edu/squirrel/people/the-bagriantsev-lab/';
    const id = await insertEntity({
      name: 'Bagriantsev Lab',
      slug: 'bagriantsev-lab',
      websiteUrl: canonical,
      sourceUrls: ['https://slavlab.yale.edu/'],
    });

    const result = await runResearchEntityWebsiteUrlCorrectivePass({ dryRun: false });

    expect(result.corrected).toBe(0);
    expect(await websiteUrlOf(id)).toBe(canonical);
  });
});
