import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: vi.fn().mockResolvedValue(undefined),
    syncEntities: vi.fn().mockResolvedValue(undefined),
    deleteFromIndex: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { ResearchEntity } from '../../models/researchEntity';
import { materializeEntity } from '../entityMaterializer';
import { LANE_PAGE_HEALTH_FIELD } from '../lanePageHealth';
import { appendObservations } from '../observationStore';
import type { ObservationInput } from '../types';

const SLUG = 'synthetic-borrowed-lab';
const PAGE = 'https://synthetic-borrowed.example.edu/research/';
const SYNTHESIS =
  'The Synthetic Borrowed Lab studies how tissues repair themselves, combining imaging with computational models of cell migration.';

let rowId = '';

async function append(sourceName: string, observations: ObservationInput[], observedAt: Date) {
  await appendObservations(
    observations.map((observation) => ({ ...observation, observedAt })),
    {
      scrapeRunId: new mongoose.Types.ObjectId().toString(),
      sourceId: new mongoose.Types.ObjectId().toString(),
      sourceName,
      sourceWeight: 0.8,
      dryRun: false,
    },
  );
}

const pageVerdict = (healthStatus: string, httpStatusCode?: number): ObservationInput => ({
  entityType: 'researchEntity',
  entityId: rowId,
  entityKey: SLUG,
  sourceUrl: PAGE,
  field: LANE_PAGE_HEALTH_FIELD,
  value: { url: PAGE, healthStatus, ...(httpStatusCode ? { httpStatusCode } : {}) },
});

const resolve = () => materializeEntity('researchEntity', { entityId: rowId }, {});
const storedDescription = async () =>
  (await ResearchEntity.findById(rowId).lean<{ fullDescription?: unknown }>())?.fullDescription;

describe('a page-borrowing lane value is withdrawn by another lane gone verdict (#4862)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'role_assignments', 'signals']) {
      await db.collection(name).deleteMany({});
    }
    const row = await ResearchEntity.create({
      slug: SLUG,
      name: 'Synthetic Borrowed Lab',
      entityType: 'LAB',
      websiteUrl: PAGE,
    });
    rowId = String(row._id);
    await append(
      'coverage-synthesis-llm',
      [
        {
          entityType: 'researchEntity',
          entityId: rowId,
          entityKey: SLUG,
          sourceUrl: PAGE,
          field: 'fullDescription',
          value: SYNTHESIS,
        },
      ],
      new Date('2026-09-01T00:00:00Z'),
    );
    await resolve();
    expect(await storedDescription()).toBe(SYNTHESIS);
  });

  it('withdraws the synthesis once a page-reading lane records the cited page gone', async () => {
    await append(
      'ysm-faculty-directory',
      [pageVerdict('UNAVAILABLE', 404)],
      new Date('2026-09-10T00:00:00Z'),
    );
    await resolve();
    expect(await storedDescription()).toBeFalsy();
    await resolve();
    expect(await storedDescription()).toBeFalsy();
  });

  it('withdraws nothing on an inconclusive verdict', async () => {
    await append(
      'ysm-faculty-directory',
      [pageVerdict('UNKNOWN', 403), pageVerdict('UNAVAILABLE')],
      new Date('2026-09-10T00:00:00Z'),
    );
    await resolve();
    expect(await storedDescription()).toBe(SYNTHESIS);
  });

  it('restores the synthesis when a later read finds the page live', async () => {
    await append(
      'ysm-faculty-directory',
      [pageVerdict('UNAVAILABLE', 404)],
      new Date('2026-09-10T00:00:00Z'),
    );
    await resolve();
    expect(await storedDescription()).toBeFalsy();
    await append(
      'lab-site-lead-verification',
      [pageVerdict('HEALTHY', 200)],
      new Date('2026-09-12T00:00:00Z'),
    );
    await resolve();
    expect(await storedDescription()).toBe(SYNTHESIS);
  });
});
