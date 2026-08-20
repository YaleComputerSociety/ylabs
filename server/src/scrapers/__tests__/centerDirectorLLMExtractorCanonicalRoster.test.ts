import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoleAssignment } from '../../models/roleAssignment';
import { ResearchEntity } from '../../models/researchEntity';
import { CenterDirectorLLMExtractor } from '../sources/centerDirectorLLMExtractor';
import type { ObservationInput, ScraperContext } from '../types';

function makeContext(overrides: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'center-director-llm',
    sourceWeight: 0.6,
    options: { dryRun: true, useCache: false, release: false, exhaustive: true, ...overrides },
    emit: async (obs) => {
      if (Array.isArray(obs)) emitted.push(...obs);
      else emitted.push(obs);
    },
    log: () => {},
  };
  return { ctx, emitted };
}

describe('CenterDirectorLLMExtractor default finder missingLeadOnly on canonical RoleAssignment', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['role_assignments', 'research_entities']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedCenter = async (slug: string) => {
    const entity = await ResearchEntity.create({
      slug,
      name: `Center ${slug}`,
      kind: 'center',
      entityType: 'CENTER',
      websiteUrl: `https://${slug}.yale.edu/`,
      archived: false,
    });
    return entity._id as mongoose.Types.ObjectId;
  };

  const assignLead = async (
    entityId: mongoose.Types.ObjectId,
    overrides: Record<string, unknown> = {},
  ) =>
    RoleAssignment.create({
      personId: new mongoose.Types.ObjectId(),
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'DIRECTOR',
      state: 'CURRENT',
      confidence: 0.9,
      archived: false,
      ...overrides,
    });

  const runOverCenters = async () => {
    const fetchedUrls: string[] = [];
    const fetchPage = vi.fn(async (url: string) => {
      fetchedUrls.push(url);
      return { url, html: '<main>Empty</main>' };
    });
    const scraper = new CenterDirectorLLMExtractor({
      fetchPage,
      callLLM: vi.fn(async () => ({ director: null })),
      apiKey: 'test-key',
    });
    await scraper.run(makeContext().ctx);
    return fetchedUrls;
  };

  it('visits only the center that has no current canonical lead', async () => {
    const withLead = await seedCenter('with-lead');
    await seedCenter('missing-lead');
    await assignLead(withLead);

    const fetchedUrls = await runOverCenters();

    expect(fetchedUrls).toEqual(['https://missing-lead.yale.edu/']);
  });

  it('treats a HISTORICAL-only lead as missing and still visits that center', async () => {
    const historicalLead = await seedCenter('historical-lead');
    await assignLead(historicalLead, {
      state: 'HISTORICAL',
      endedAt: new Date('2020-01-01'),
    });

    const fetchedUrls = await runOverCenters();

    expect(fetchedUrls).toEqual(['https://historical-lead.yale.edu/']);
  });

  it('skips a center whose only current lead assignment is archived-excluded when active', async () => {
    const archivedLead = await seedCenter('archived-lead');
    const activeLead = await seedCenter('active-lead');
    await assignLead(archivedLead, { archived: true });
    await assignLead(activeLead);

    const fetchedUrls = await runOverCenters();

    expect(fetchedUrls).toEqual(['https://archived-lead.yale.edu/']);
  });
});
