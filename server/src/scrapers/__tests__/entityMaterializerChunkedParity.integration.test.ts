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
    deleteFromIndex: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { ResearchEntity } from '../../models/researchEntity';
import { RoleAssignment } from '../../models/roleAssignment';
import { MaterializationChunkPrefetch } from '../materializationChunkPrefetch';
import { listResearchEntityMergedInRowsBySurvivor } from '../../services/researchEntityCanonicalTombstone';
import {
  materializationReadScopeFilter,
  materializeEntity,
  materializeObservedEntitiesInChunks,
  DEFAULT_MATERIALIZATION_CONCURRENCY,
  materializationConcurrencyFromEnv,
  MAX_MATERIALIZATION_CONCURRENCY,
  partitionChunkForConcurrency,
  type ObservedEntityOutcome,
  type ObservedEntityRow,
} from '../entityMaterializer';

const OBSERVED_AT = new Date('2026-02-01T00:00:00Z');

const seedObservation = (
  anchor: { entityKey?: string; entityId?: mongoose.Types.ObjectId },
  field: string,
  value: unknown,
  overrides: { sourceName?: string; confidence?: number } = {},
) =>
  Observation.create({
    entityType: 'researchEntity',
    ...anchor,
    field,
    value,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: overrides.sourceName ?? 'ysm-faculty-directory',
    sourceUrl: `https://example.yale.edu/${anchor.entityKey ?? String(anchor.entityId)}/`,
    confidence: overrides.confidence ?? 0.9,
    observedAt: OBSERVED_AT,
    superseded: false,
  });

const leadRole = (entityId: mongoose.Types.ObjectId, personId: mongoose.Types.ObjectId) =>
  RoleAssignment.create({
    personId,
    target: { kind: 'RESEARCH_ENTITY', id: entityId },
    role: 'PI',
    evidenceClaimIds: [],
    confidence: 0.9,
    reviewStatus: 'UNREVIEWED',
    archived: false,
    state: 'CURRENT',
  });

async function seedCorpus(): Promise<ObservedEntityRow[]> {
  const leadPerson = await Researcher.create({ displayName: 'Example Person', archived: false });
  const otherPerson = await Researcher.create({ displayName: 'Other Person', archived: false });

  const keyed = await ResearchEntity.create({
    slug: 'example-keyed-lab',
    name: 'Example Keyed Lab',
    kind: 'lab',
    archived: false,
  });
  await seedObservation({ entityKey: 'example-keyed-lab' }, 'name', 'Example Keyed Lab');
  await seedObservation({ entityId: keyed._id }, 'researchAreas', ['Neuroscience']);
  await leadRole(keyed._id, leadPerson._id);

  const idAnchored = await ResearchEntity.create({
    slug: 'example-id-lab',
    name: 'Example Id Lab',
    kind: 'lab',
    archived: false,
  });
  await seedObservation({ entityId: idAnchored._id }, 'name', 'Example Id Lab');
  await seedObservation(
    { entityKey: 'example-id-lab' },
    'websiteUrl',
    'https://example-id-lab.yale.edu/',
  );
  await leadRole(idAnchored._id, leadPerson._id);
  await leadRole(idAnchored._id, otherPerson._id);

  const survivor = await ResearchEntity.create({
    slug: 'example-survivor-lab',
    name: 'Example Survivor Lab',
    kind: 'lab',
    archived: false,
  });
  await ResearchEntity.create({
    slug: 'example-merged-loser',
    name: 'Example Merged Loser',
    kind: 'individual',
    archived: true,
    canonicalGroupId: survivor._id,
  });
  await seedObservation({ entityKey: 'example-survivor-lab' }, 'name', 'Example Survivor Lab');
  await seedObservation({ entityKey: 'example-merged-loser' }, 'researchAreas', ['Immunology'], {
    sourceName: 'dept-faculty-roster',
  });

  await seedObservation({ entityKey: 'example-new-lab' }, 'name', 'Example New Lab');
  await seedObservation({ entityKey: 'example-new-lab' }, 'kind', 'lab');

  await seedObservation({ entityKey: 'example-tied-lab' }, 'name', 'Example Tied Lab One');
  await seedObservation({ entityKey: 'example-tied-lab' }, 'name', 'Example Tied Lab Two');

  return [
    { entityType: 'researchEntity', entityKey: 'example-keyed-lab' },
    { entityType: 'researchEntity', entityId: String(idAnchored._id), entityKey: 'example-id-lab' },
    { entityType: 'researchEntity', entityId: String(keyed._id) },
    { entityType: 'researchEntity', entityKey: 'example-survivor-lab' },
    { entityType: 'researchEntity', entityKey: 'example-new-lab' },
    { entityType: 'researchEntity', entityKey: 'example-tied-lab' },
    { entityType: 'researchEntity', entityKey: 'example-merged-loser' },
  ];
}

const comparable = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (key, inner) =>
      ['lastObservedAt', 'createdAt', 'updatedAt', 'entityId', '_id', 'confidence'].includes(key)
        ? undefined
        : key === 'confidenceByField'
          ? Object.keys(inner as object).sort()
          : inner,
    ),
  );

const projectCorpus = async () => {
  const rows = (await ResearchEntity.find({})
    .sort({ slug: 1 })
    .select('slug name kind archived websiteUrl researchAreas canonicalGroupId')
    .lean()) as Array<Record<string, unknown>>;
  const slugById = new Map(rows.map((row) => [String(row._id), row.slug]));
  return comparable(
    rows.map((row) => ({
      ...row,
      canonicalGroupId: row.canonicalGroupId ? slugById.get(String(row.canonicalGroupId)) : null,
    })),
  );
};

const identifierOf = (row: ObservedEntityRow) => ({
  entityId: row.entityId,
  entityKey: row.entityKey,
});

describe('chunked materialization reads per chunk and projects what row-by-row does (#3568)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Promise.all([Observation.init(), ResearchEntity.init(), RoleAssignment.init()]);
  });

  afterAll(async () => {
    mongoose.set('debug', false);
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'role_assignments', 'researchers']) {
      await db.collection(name).deleteMany({});
    }
  });

  const countingQueries = () => {
    const counts: Record<string, number> = {};
    mongoose.set('debug', (collection: string, method: string) => {
      counts[`${collection}.${method}`] = (counts[`${collection}.${method}`] ?? 0) + 1;
    });
    return counts;
  };

  it('plans the same projection for every row in a dry run with fewer reads', async () => {
    const rows = await seedCorpus();

    const perRowCounts = countingQueries();
    const perRow: unknown[] = [];
    for (const row of rows) {
      perRow.push(
        comparable(await materializeEntity(row.entityType, identifierOf(row), { dryRun: true })),
      );
    }
    const chunkedCounts = countingQueries();
    const chunked: unknown[] = [];
    await materializeObservedEntitiesInChunks(
      rows,
      { dryRun: true },
      (_row, outcome) => {
        chunked.push(comparable('result' in outcome ? outcome.result : outcome));
      },
      100,
      1,
    );
    mongoose.set('debug', false);

    expect(chunked).toEqual(perRow);
    const total = (counts: Record<string, number>) =>
      Object.values(counts).reduce((sum, count) => sum + count, 0);
    expect(total(chunkedCounts)).toBeLessThan(total(perRowCounts));
    expect(chunkedCounts['observations.find'] ?? 0).toBeLessThan(
      perRowCounts['observations.find'] ?? 0,
    );
  }, 120000);

  it('writes the same corpus as row-by-row in an apply run, including rows that share a document', async () => {
    const rows = await seedCorpus();
    for (const row of rows) {
      await materializeEntity(row.entityType, identifierOf(row));
    }
    const sequential = await projectCorpus();

    const db = mongoose.connection.db;
    for (const name of ['observations', 'research_entities', 'role_assignments', 'researchers']) {
      await db?.collection(name).deleteMany({});
    }
    const reseeded = await seedCorpus();
    const outcomes: ObservedEntityOutcome[] = [];
    await materializeObservedEntitiesInChunks(reseeded, {}, (_row, outcome) => {
      outcomes.push(outcome);
    });

    expect(outcomes.filter((outcome) => 'error' in outcome)).toEqual([]);
    expect(await projectCorpus()).toEqual(sequential);
  }, 120000);

  it('keeps chunk boundaries and order when chunks are smaller than the run', async () => {
    const rows = await seedCorpus();
    const perRow: unknown[] = [];
    for (const row of rows) {
      perRow.push(
        comparable(await materializeEntity(row.entityType, identifierOf(row), { dryRun: true })),
      );
    }
    const seen: ObservedEntityRow[] = [];
    const chunked: unknown[] = [];
    await materializeObservedEntitiesInChunks(
      rows,
      { dryRun: true },
      (row, outcome) => {
        seen.push(row);
        chunked.push(comparable('result' in outcome ? outcome.result : outcome));
      },
      2,
      1,
    );

    expect(seen).toEqual(rows);
    expect(chunked).toEqual(perRow);
  }, 120000);

  const idOfSlug = async (slug: string): Promise<string> =>
    String(
      ((await ResearchEntity.findOne({ slug }).select('_id').lean()) as { _id?: unknown })?._id,
    );

  it('answers only what no earlier write in the chunk can have changed', async () => {
    const rows = await seedCorpus();
    const prefetch = await MaterializationChunkPrefetch.load({
      entityType: 'researchEntity',
      rows,
      readScopeFilter: materializationReadScopeFilter(),
      entityDocs: { model: ResearchEntity, keyField: 'slug' },
    });
    const keyed = await idOfSlug('example-keyed-lab');
    const idAnchored = await idOfSlug('example-id-lab');
    const survivor = await idOfSlug('example-survivor-lab');

    const first = prefetch.observationsForKey('researchEntity', 'example-keyed-lab');
    const second = prefetch.observationsForKey('researchEntity', 'example-keyed-lab');
    expect(first.hit && second.hit).toBe(true);
    if (first.hit && second.hit) {
      (first.value[0] as { value?: unknown }).value = 'mutated';
      expect((second.value[0] as { value?: unknown }).value).toBe('Example Keyed Lab');
    }
    expect(prefetch.observationsForKey('user', 'example-keyed-lab').hit).toBe(false);

    expect(prefetch.soleLeadPersonId(keyed).hit).toBe(true);
    expect(prefetch.soleLeadPersonId(idAnchored).hit).toBe(false);
    expect(prefetch.hasNoMergedInRows(keyed)).toBe(true);
    expect(prefetch.hasNoMergedInRows(survivor)).toBe(false);

    const absent = prefetch.entityDocForKey('researchEntity', 'example-new-lab');
    expect(absent).toEqual({ hit: true, value: null });
    prefetch.markCreated();
    expect(prefetch.entityDocForKey('researchEntity', 'example-new-lab').hit).toBe(false);

    expect(prefetch.entityDocForId('researchEntity', keyed).hit).toBe(true);
    prefetch.markTouched(keyed);
    expect(prefetch.entityDocForId('researchEntity', keyed).hit).toBe(false);
    expect(prefetch.entityDocForKey('researchEntity', 'example-keyed-lab').hit).toBe(false);
    expect(prefetch.observationsForId('researchEntity', keyed).hit).toBe(false);
    expect(prefetch.soleLeadPersonId(keyed).hit).toBe(false);

    prefetch.markTouched('example-id-lab');
    expect(prefetch.observationsForKey('researchEntity', 'example-id-lab').hit).toBe(false);
  }, 120000);

  const seedIndependentLabs = async (count: number): Promise<ObservedEntityRow[]> => {
    const sharedLead = await Researcher.create({ displayName: 'Shared Lead', archived: false });
    const rows: ObservedEntityRow[] = [];
    for (let index = 0; index < count; index += 1) {
      const slug = `example-plain-lab-${index}`;
      const lab = await ResearchEntity.create({
        slug,
        name: `Example Plain Lab ${index}`,
        kind: 'lab',
        archived: false,
      });
      await seedObservation({ entityKey: slug }, 'name', `Example Plain Lab ${index} Renamed`);
      await seedObservation({ entityId: lab._id }, 'researchAreas', [`Topic ${index}`]);
      await seedObservation(
        { entityKey: slug },
        'websiteUrl',
        `https://example-plain-lab-${index}.yale.edu/`,
      );
      await leadRole(lab._id, sharedLead._id);
      rows.push({ entityType: 'researchEntity', entityKey: slug });
    }
    await ResearchEntity.create({
      slug: 'dept-example-shell',
      name: 'Example Shell Lab',
      kind: 'lab',
      archived: false,
    });
    await seedObservation({ entityKey: 'dept-example-shell' }, 'name', 'Example Shell Lab');
    rows.push({ entityType: 'researchEntity', entityKey: 'dept-example-shell' });
    return rows;
  };

  const resetCorpus = async () => {
    const db = mongoose.connection.db;
    for (const name of ['observations', 'research_entities', 'role_assignments', 'researchers']) {
      await db?.collection(name).deleteMany({});
    }
  };

  const byKey = (outcomes: Array<{ row: ObservedEntityRow; value: unknown }>) =>
    outcomes
      .map(({ row, value }) => ({ key: `${row.entityKey ?? ''}|${row.entityId ?? ''}`, value }))
      .sort((left, right) => left.key.localeCompare(right.key));

  it('runs in parallel only rows that update their own live, unmerged, stored entity (#5521)', async () => {
    const rows = [...(await seedCorpus()), ...(await seedIndependentLabs(3))];
    const prefetch = await MaterializationChunkPrefetch.load({
      entityType: 'researchEntity',
      rows,
      readScopeFilter: materializationReadScopeFilter(),
      entityDocs: { model: ResearchEntity, keyField: 'slug' },
    });

    const { independent, sequential } = partitionChunkForConcurrency(rows, prefetch);

    expect(independent.map((row) => row.entityKey)).toEqual([
      'example-id-lab',
      'example-plain-lab-0',
      'example-plain-lab-1',
      'example-plain-lab-2',
    ]);
    expect(sequential).toEqual(rows.filter((row) => !independent.includes(row)));
    expect(partitionChunkForConcurrency(rows, undefined)).toEqual({
      independent: [],
      sequential: rows,
    });
  }, 120000);

  it('plans the same projection in a dry run at any concurrency (#5521)', async () => {
    const rows = [...(await seedCorpus()), ...(await seedIndependentLabs(6))];
    const collect = async (concurrency: number) => {
      const outcomes: Array<{ row: ObservedEntityRow; value: unknown }> = [];
      await materializeObservedEntitiesInChunks(
        rows,
        { dryRun: true },
        (row, outcome) => {
          outcomes.push({ row, value: comparable('result' in outcome ? outcome.result : outcome) });
        },
        100,
        concurrency,
      );
      return byKey(outcomes);
    };

    const sequential = await collect(1);
    expect(sequential).toHaveLength(rows.length);
    expect(await collect(4)).toEqual(sequential);
  }, 120000);

  it('writes the same corpus at concurrency 4 as sequentially in an apply run (#5521)', async () => {
    const seed = async () => [...(await seedCorpus()), ...(await seedIndependentLabs(6))];
    const apply = async (concurrency: number) => {
      await resetCorpus();
      const rows = await seed();
      const errors: unknown[] = [];
      await materializeObservedEntitiesInChunks(
        rows,
        {},
        (_row, outcome) => {
          if ('error' in outcome) errors.push(outcome.error);
        },
        100,
        concurrency,
      );
      expect(errors).toEqual([]);
      return projectCorpus();
    };

    const sequential = await apply(1);
    expect(await apply(4)).toEqual(sequential);
  }, 120000);

  const seedMergedSurvivors = async (count: number, hops = 1): Promise<ObservedEntityRow[]> => {
    const rows: ObservedEntityRow[] = [];
    for (let index = 0; index < count; index += 1) {
      const slug = `example-merged-survivor-${index}`;
      const survivor = await ResearchEntity.create({
        slug,
        name: `Example Merged Survivor ${index}`,
        kind: 'lab',
        archived: false,
      });
      let mergedInto = survivor._id;
      for (let hop = 0; hop < hops; hop += 1) {
        const loserSlug = `${slug}-loser-${hop}`;
        const loser = await ResearchEntity.create({
          slug: loserSlug,
          name: `Example Merged Loser ${index}.${hop}`,
          kind: 'lab',
          archived: true,
          canonicalGroupId: mergedInto,
        });
        await seedObservation({ entityKey: loserSlug }, 'researchAreas', [`Loser Topic ${index}`], {
          sourceName: 'dept-faculty-roster',
        });
        mergedInto = loser._id;
      }
      await seedObservation(
        { entityKey: slug },
        'name',
        `Example Merged Survivor ${index} Renamed`,
      );
      await seedObservation({ entityId: survivor._id }, 'researchAreas', [
        `Survivor Topic ${index}`,
      ]);
      rows.push({ entityType: 'researchEntity', entityKey: slug });
    }
    return rows;
  };

  const partitionWithMergeGroups = async (rows: ObservedEntityRow[]) => {
    const prefetch = await MaterializationChunkPrefetch.load({
      entityType: 'researchEntity',
      rows,
      readScopeFilter: materializationReadScopeFilter(),
      entityDocs: { model: ResearchEntity, keyField: 'slug' },
    });
    const survivors = await ResearchEntity.find({ slug: /^example-merged-survivor-\d+$/ })
      .select('_id')
      .lean();
    const mergeGroups = await listResearchEntityMergedInRowsBySurvivor(
      survivors.map((row) => String(row._id)),
    );
    return partitionChunkForConcurrency(rows, prefetch, mergeGroups);
  };

  it('runs a merged survivor in parallel once its merge group is known and no sibling names it (#5555)', async () => {
    const rows = [...(await seedMergedSurvivors(2, 2)), ...(await seedIndependentLabs(2))];
    const { independent, sequential } = await partitionWithMergeGroups(rows);
    expect(independent.map((row) => row.entityKey)).toEqual([
      'example-merged-survivor-0',
      'example-merged-survivor-1',
      'example-plain-lab-0',
      'example-plain-lab-1',
    ]);
    expect(sequential.every((row) => String(row.entityKey).startsWith('dept-'))).toBe(true);
  }, 120000);

  it('keeps a merged survivor sequential when a sibling row is keyed by any row merged into it (#5555)', async () => {
    const survivors = await seedMergedSurvivors(2, 2);
    const loserKeyed: ObservedEntityRow = {
      entityType: 'researchEntity',
      entityKey: 'example-merged-survivor-0-loser-1',
    };
    const loser = await ResearchEntity.findOne({ slug: 'example-merged-survivor-1-loser-0' })
      .select('_id')
      .lean();
    const loserIdAnchored: ObservedEntityRow = {
      entityType: 'researchEntity',
      entityId: String(loser?._id),
    };
    const rows = [...survivors, loserKeyed, loserIdAnchored];
    const { independent, sequential } = await partitionWithMergeGroups(rows);
    expect(independent).toEqual([]);
    expect(sequential).toEqual(rows);
  }, 120000);

  it('keeps a merged survivor sequential when its merge group was not loaded (#5555)', async () => {
    const rows = await seedMergedSurvivors(1);
    const prefetch = await MaterializationChunkPrefetch.load({
      entityType: 'researchEntity',
      rows,
      readScopeFilter: materializationReadScopeFilter(),
      entityDocs: { model: ResearchEntity, keyField: 'slug' },
    });
    expect(partitionChunkForConcurrency(rows, prefetch).independent).toEqual([]);
  }, 120000);

  it('writes the same corpus at concurrency 4 as sequentially with merged survivors in the chunk (#5555)', async () => {
    const seed = async () => [
      ...(await seedCorpus()),
      ...(await seedMergedSurvivors(4, 2)),
      ...(await seedIndependentLabs(4)),
    ];
    const apply = async (concurrency: number) => {
      await resetCorpus();
      const rows = await seed();
      const errors: unknown[] = [];
      await materializeObservedEntitiesInChunks(
        rows,
        {},
        (_row, outcome) => {
          if ('error' in outcome) errors.push(outcome.error);
        },
        100,
        concurrency,
      );
      expect(errors).toEqual([]);
      return projectCorpus();
    };

    const sequential = await apply(1);
    expect(await apply(4)).toEqual(sequential);
  }, 120000);

  it('reads concurrency from MATERIALIZE_CONCURRENCY, defaulting to 8 and falling back to sequential on an invalid value', () => {
    expect(materializationConcurrencyFromEnv(undefined)).toBe(DEFAULT_MATERIALIZATION_CONCURRENCY);
    expect(materializationConcurrencyFromEnv('  ')).toBe(DEFAULT_MATERIALIZATION_CONCURRENCY);
    expect(DEFAULT_MATERIALIZATION_CONCURRENCY).toBe(8);
    expect(materializationConcurrencyFromEnv('1')).toBe(1);
    expect(materializationConcurrencyFromEnv('2.5')).toBe(1);
    expect(materializationConcurrencyFromEnv('0')).toBe(1);
    expect(materializationConcurrencyFromEnv('-3')).toBe(1);
    expect(materializationConcurrencyFromEnv('many')).toBe(1);
    expect(materializationConcurrencyFromEnv(' 8 ')).toBe(8);
    expect(materializationConcurrencyFromEnv('999')).toBe(MAX_MATERIALIZATION_CONCURRENCY);
  });
});
