import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async () => 0),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
  syncEntity: meiliMocks.syncEntity,
  deleteFromIndex: meiliMocks.deleteFromIndex,
}));

import { ResearchEntity } from '../../models/researchEntity';
import { Fellowship } from '../../models/fellowship';
import { planStudentVisibilityGate } from '../studentVisibilityGateService';

/**
 * The gate's corpus reads must not depend on the in-memory sort limit (#3748).
 *
 * A database sort on an unindexed key is a blocking SORT stage, and the cluster refuses
 * one above 33,554,432 bytes without disk use, so a corpus that grows past the limit
 * makes every run throw before planning a row. The order the report wants is restored
 * in process, so this pins the query shape rather than the report: a later change
 * cannot reinstate a sort on a key no index serves without failing here.
 */
const id = (hex: string) => new mongoose.Types.ObjectId(hex);

const BODY =
  'The laboratory studies shoreline erosion and sediment transport along developed coasts, and it takes Yale undergraduates onto its summer field season through a posted application with a named faculty mentor.';

const researchRow = (hex: string, name: string) => ({
  _id: id(hex),
  kind: 'lab',
  entityType: 'LAB',
  archived: false,
  slug: `synthetic-${hex.slice(-4)}`,
  name,
  fullDescription: BODY,
  shortDescription: 'A coastal-systems lab that takes Yale undergraduates onto its field season.',
  websiteUrl: `https://lab-${hex.slice(-4)}.example.yale.edu`,
  sourceUrls: [`https://lab-${hex.slice(-4)}.example.yale.edu`],
  studentVisibilityTier: 'operator_review',
});

const programRow = (hex: string, title: string) => ({
  _id: id(hex),
  archived: false,
  title,
  slug: `synthetic-program-${hex.slice(-4)}`,
  sourceName: 'fixture-programs',
  studentVisibilityTier: 'operator_review',
});

/**
 * Records every sort specification the planner asks a query for while letting the query
 * run against the real database, so the assertion is about the query the gate issues
 * rather than about a stub of it.
 */
const recordSortSpecifications = (model: { find: (...args: any[]) => any }): unknown[] => {
  const specifications: unknown[] = [];
  const originalFind = model.find.bind(model);
  vi.spyOn(model as any, 'find').mockImplementation(((...args: any[]) => {
    const query: any = originalFind(...args);
    const originalSort = query.sort.bind(query);
    query.sort = (specification: any) => {
      specifications.push(specification);
      return originalSort(specification);
    };
    return query;
  }) as any);
  return specifications;
};

describe('the gate corpus read does not depend on the in-memory sort limit (#3748)', () => {
  let mongoServer: MongoMemoryServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('research_entities').deleteMany({});
    await db.collection('fellowships').deleteMany({});
    await db
      .collection('research_entities')
      .insertMany([
        researchRow('000000000000000000003748', 'Charlie Coastal Systems Laboratory'),
        researchRow('000000000000000000003749', 'Alpha Coastal Systems Laboratory'),
        researchRow('00000000000000000000374a', 'Bravo Coastal Systems Laboratory'),
      ]);
    await db
      .collection('fellowships')
      .insertMany([
        programRow('00000000000000000000374b', 'Charlie Summer Research Award'),
        programRow('00000000000000000000374c', 'Alpha Summer Research Award'),
        programRow('00000000000000000000374d', 'Bravo Summer Research Award'),
      ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sorts the research corpus read only on the indexed record id', async () => {
    const specifications = recordSortSpecifications(ResearchEntity);

    await planStudentVisibilityGate({ collection: 'research', mode: 'dry-run' });

    expect(specifications.length).toBeGreaterThan(0);
    for (const specification of specifications) {
      expect(Object.keys(specification as Record<string, unknown>)).toEqual(['_id']);
    }
  }, 120000);

  it('sorts the program corpus read only on the indexed record id', async () => {
    const specifications = recordSortSpecifications(Fellowship);

    await planStudentVisibilityGate({ collection: 'programs', mode: 'dry-run' });

    expect(specifications.length).toBeGreaterThan(0);
    for (const specification of specifications) {
      expect(Object.keys(specification as Record<string, unknown>)).toEqual(['_id']);
    }
  }, 120000);

  it('still returns research plans in label order, as the removed database sort did', async () => {
    const plans = await planStudentVisibilityGate({ collection: 'research', mode: 'dry-run' });

    expect(plans.map((plan) => plan.label)).toEqual([
      'Alpha Coastal Systems Laboratory',
      'Bravo Coastal Systems Laboratory',
      'Charlie Coastal Systems Laboratory',
    ]);
  }, 120000);

  it('still returns program plans in label order, as the removed database sort did', async () => {
    const plans = await planStudentVisibilityGate({ collection: 'programs', mode: 'dry-run' });

    expect(plans.map((plan) => plan.label)).toEqual([
      'Alpha Summer Research Award',
      'Bravo Summer Research Award',
      'Charlie Summer Research Award',
    ]);
  }, 120000);
});
