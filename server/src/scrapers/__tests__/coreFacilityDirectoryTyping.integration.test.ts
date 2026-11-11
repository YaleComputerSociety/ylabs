import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { materializeEntity } from '../entityMaterializer';

const ENTITY_KEY = 'synthetic-core-typing-home';
const PRE_CATEGORY_READ = new Date('2026-07-25T00:00:00Z');
const CATEGORY_READ = new Date('2026-10-23T00:00:00Z');
const PROFILE_READ = new Date('2026-10-23T08:00:00Z');

type PersistedEntity = { kind?: string; entityType?: string };

describe('a research directory record types its row over name-word typings (#5749)', () => {
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
    for (const name of ['observations', 'research_entities', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedEntity = (name: string, overrides: Record<string, unknown> = {}) =>
    ResearchEntity.create({
      slug: ENTITY_KEY,
      name,
      studentVisibilityTier: 'operator_review',
      archived: false,
      ...overrides,
    });

  const seedObservation = (params: {
    field: string;
    value: unknown;
    sourceName: string;
    observedAt: Date;
    sourceUrl?: string;
    confidence?: number;
  }) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: ENTITY_KEY,
      field: params.field,
      value: params.value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: params.sourceName,
      sourceUrl: params.sourceUrl ?? 'https://research.example.edu/cores',
      confidence: params.confidence ?? 0.9,
      observedAt: params.observedAt,
      superseded: false,
    });

  const seedDirectoryRead = async (
    name: string,
    entityType: string,
    kind: string,
    sourceCategory: string,
    observedAt: Date,
  ) => {
    await seedObservation({
      field: 'name',
      value: name,
      sourceName: 'yale-research-official',
      observedAt,
    });
    await seedObservation({
      field: 'entityType',
      value: entityType,
      sourceName: 'yale-research-official',
      observedAt,
    });
    await seedObservation({
      field: 'kind',
      value: kind,
      sourceName: 'yale-research-official',
      observedAt,
    });
    await seedObservation({
      field: 'sourceCategory',
      value: sourceCategory,
      sourceName: 'yale-research-official',
      observedAt,
    });
  };

  const seedProfileLinkedHomeTyping = async (name: string, entityType: string, kind: string) => {
    for (const [field, value] of [
      ['name', name],
      ['displayName', name],
      ['entityType', entityType],
      ['kind', kind],
    ]) {
      await seedObservation({
        field,
        value,
        sourceName: 'official-profile-pi-backfill',
        observedAt: PROFILE_READ,
        sourceUrl: 'https://profiles.example.edu/synthetic-profile/',
        confidence: 0.96,
      });
    }
  };

  const persisted = () => ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<PersistedEntity>();

  it('types a cores directory record CORE_FACILITY over a stale read and a name-word typing', async () => {
    const name = 'Synthetic Resonance Research Center';
    await seedEntity(name, { entityType: 'CENTER', kind: 'center' });
    await seedDirectoryRead(name, 'CENTER', 'center', 'core-facility', PRE_CATEGORY_READ);
    await seedDirectoryRead(name, 'CORE_FACILITY', 'core_facility', 'core-facility', CATEGORY_READ);
    await seedProfileLinkedHomeTyping(name, 'CENTER', 'center');
    await seedObservation({
      field: 'fullDescription',
      value:
        'The core is a fee-for-service provider: investigators request scanner time through the booking system and are billed at the posted recharge rates.',
      sourceName: 'yale-research-official',
      observedAt: CATEGORY_READ,
    });

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });
    const first = await persisted();
    expect(first?.entityType).toBe('CORE_FACILITY');
    expect(first?.kind).toBe('core_facility');

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });
    const second = await persisted();
    expect(second?.entityType).toBe('CORE_FACILITY');
    expect(second?.kind).toBe('core_facility');
  });

  it('keeps a centres directory record named after a core a CENTER', async () => {
    const name = 'Synthetic Core Questions in Cognition Center';
    await seedEntity(name, { entityType: 'CENTER', kind: 'center' });
    await seedDirectoryRead(name, 'CENTER', 'center', 'centers-institutes', CATEGORY_READ);
    await seedProfileLinkedHomeTyping(name, 'CENTER', 'center');
    await seedObservation({
      field: 'fullDescription',
      value:
        'The center conducts research on memory and attention through a program of laboratory studies, fieldwork and postdoctoral research fellows.',
      sourceName: 'yale-research-official',
      observedAt: CATEGORY_READ,
    });

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });
    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    const doc = await persisted();
    expect(doc?.entityType).toBe('CENTER');
    expect(doc?.kind).toBe('center');
  });

  it('leaves a lab that uses a core facility a LAB', async () => {
    const name = 'Synthetic Avery Lab';
    await seedEntity(name, { entityType: 'LAB', kind: 'lab' });
    await seedObservation({
      field: 'entityType',
      value: 'LAB',
      sourceName: 'ysm-faculty-directory',
      observedAt: CATEGORY_READ,
      sourceUrl: 'https://medicine.example.edu/profile/synthetic-avery/',
    });
    await seedProfileLinkedHomeTyping(name, 'LAB', 'lab');
    await seedObservation({
      field: 'fullDescription',
      value:
        'The lab studies cell signalling and sends its samples to the flow cytometry core, booking instrument time and paying the core service fees.',
      sourceName: 'ysm-faculty-directory',
      observedAt: CATEGORY_READ,
      sourceUrl: 'https://medicine.example.edu/profile/synthetic-avery/',
    });

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });
    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    const doc = await persisted();
    expect(doc?.entityType).toBe('LAB');
    expect(doc?.kind).toBe('lab');
  });

  it('lets a centres lane re-read retype its record over its own earlier typings', async () => {
    const name = 'Synthetic Sequencing Analysis Center';
    await seedEntity(name, { entityType: 'CENTER', kind: 'center' });
    const earlierReads = [
      ['https://center.example.edu/people/', '2026-09-20T00:00:00Z'],
      ['https://center.example.edu/people/?page=1', '2026-09-21T00:00:00Z'],
      ['https://center.example.edu/', '2026-09-22T00:00:00Z'],
    ] as const;
    const reads = [
      ...earlierReads.map(
        ([sourceUrl, at]) => [sourceUrl, new Date(at), 'CENTER', 'center'] as const,
      ),
      [
        'https://center.example.edu/people/',
        CATEGORY_READ,
        'CORE_FACILITY',
        'core_facility',
      ] as const,
    ];
    for (const [sourceUrl, observedAt, entityType, kind] of reads) {
      for (const [field, value] of [
        ['name', name],
        ['entityType', entityType],
        ['kind', kind],
      ]) {
        await seedObservation({
          field,
          value,
          sourceName: 'centers-institutes-index',
          observedAt,
          sourceUrl,
        });
      }
    }

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });
    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    const doc = await persisted();
    expect(doc?.entityType).toBe('CORE_FACILITY');
    expect(doc?.kind).toBe('core_facility');
  });
});
