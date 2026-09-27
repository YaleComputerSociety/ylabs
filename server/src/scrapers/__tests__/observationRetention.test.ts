import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { Observation } from '../../models/observation';
import { ScrapeRun } from '../../models/scrapeRun';
import {
  OBSERVATION_PRUNE_DELETE_BATCH_SIZE,
  OBSERVATION_REFERENCE_SPECS,
  buildObservationReferencePipeline,
  buildSupersededObservationPruneFilter,
  pruneDeadObservations,
  pruneSupersededObservations,
  scanReferencedObservations,
  supersededPruneIsProjectionNeutral,
} from '../observationRetention';
import { materializationReadScopeFilter } from '../entityMaterializer';
import { clearC4Flags } from './c4FlagTestEnv';

const NOW = new Date('2026-05-14T12:00:00Z');
const CUTOFF = new Date('2026-04-14T12:00:00Z');

function mockReferencedObservationRows(
  rows: Array<{ _id: unknown }> = [],
  presentCollections?: string[],
) {
  vi.spyOn(Observation.db, 'listCollections').mockResolvedValue(
    (presentCollections ?? OBSERVATION_REFERENCE_SPECS.map((spec) => spec.collection)).map(
      (name) => ({ name, type: 'collection' }),
    ) as any,
  );
  return vi.spyOn(Observation.db, 'collection').mockImplementation(
    ((name: string) =>
      ({
        aggregate: vi.fn().mockReturnValue({
          toArray: vi
            .fn()
            .mockResolvedValue(
              presentCollections && !presentCollections.includes(name) ? [] : rows,
            ),
        }),
      }) as any) as any,
  );
}

function mockEligibleObservationIds(ids: unknown[]) {
  const cursor = () => ({
    async *[Symbol.asyncIterator]() {
      for (const _id of ids) yield { _id };
    },
  });
  return vi
    .spyOn(Observation, 'find')
    .mockImplementation((() => ({ select: () => ({ lean: () => ({ cursor }) }) })) as any);
}

const observationIds = (count: number, prefix = 'observation'): string[] =>
  Array.from({ length: count }, (_, index) => `${prefix}-${index}`);

const ALL_REFERENCE_SPEC_COVERAGE = (referencedObservations: number) =>
  OBSERVATION_REFERENCE_SPECS.map((spec) => ({
    collection: spec.collection,
    field: spec.field,
    collectionPresent: true,
    referencedObservations,
  }));

describe('observation retention', () => {
  beforeEach(() => {
    clearC4Flags();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearC4Flags();
  });

  it('builds a compact-retention filter that only targets old superseded observations', () => {
    expect(
      buildSupersededObservationPruneFilter({
        cutoff: CUTOFF,
        sourceName: 'openalex',
        keepRunIds: ['recent-run-1', 'recent-run-2'],
      }),
    ).toEqual({
      superseded: true,
      observedAt: { $lt: CUTOFF },
      sourceName: 'openalex',
      scrapeRunId: { $nin: ['recent-run-1', 'recent-run-2'] },
    });
  });

  it('builds reference scans for direct and field-provenance observation references', () => {
    expect(OBSERVATION_REFERENCE_SPECS).toEqual(
      expect.arrayContaining([
        { collection: 'observations', field: 'supersededBy' },
        { collection: 'signals', field: 'source.evidenceIds' },
        {
          collection: 'research_entities',
          field: 'fieldProvenance',
          kind: 'provenance-map',
        },
      ]),
    );
    expect(
      buildObservationReferencePipeline({
        collection: 'signals',
        field: 'source.evidenceIds',
      }),
    ).toEqual([
      { $project: { observationId: '$source.evidenceIds' } },
      { $unwind: '$observationId' },
      { $match: { observationId: { $type: 'objectId' } } },
      { $group: { _id: '$observationId' } },
    ]);
    expect(
      buildObservationReferencePipeline({
        collection: 'research_entities',
        field: 'fieldProvenance',
        kind: 'provenance-map',
      }),
    ).toEqual([
      {
        $project: {
          provenanceValues: {
            $cond: [
              { $eq: [{ $type: '$fieldProvenance' }, 'object'] },
              { $objectToArray: '$fieldProvenance' },
              [],
            ],
          },
        },
      },
      { $unwind: '$provenanceValues' },
      { $project: { observationId: '$provenanceValues.v.observationId' } },
      { $match: { observationId: { $type: 'objectId' } } },
      { $group: { _id: '$observationId' } },
    ]);
  });

  it('dry-runs by counting candidates and never deleting', async () => {
    vi.spyOn(ScrapeRun, 'aggregate').mockResolvedValue([
      { _id: 'openalex', runIds: ['recent-run-1', 'recent-run-2', 'recent-run-3'] },
    ] as any);
    mockReferencedObservationRows();
    const find = mockEligibleObservationIds(observationIds(42));
    const deleteMany = vi.spyOn(Observation, 'deleteMany');

    const result = await pruneSupersededObservations({
      now: NOW,
      olderThanDays: 30,
      keepRuns: 3,
      apply: false,
    });

    expect(find).toHaveBeenCalledWith({
      superseded: true,
      observedAt: { $lt: CUTOFF },
      scrapeRunId: { $nin: ['recent-run-1', 'recent-run-2', 'recent-run-3'] },
    });
    expect(deleteMany).not.toHaveBeenCalled();
    expect(result).toEqual({
      apply: false,
      projectionNeutral: true,
      readScopeDeclared: false,
      eligibleCandidates: 42,
      protectedCandidates: 0,
      candidates: 42,
      deleted: 0,
      cutoff: CUTOFF.toISOString(),
      keepRuns: 3,
      retainedRuns: 3,
      sourceName: undefined,
      referenceSpecs: ALL_REFERENCE_SPEC_COVERAGE(0),
    });
  });

  it('applies the same safe filter when deletion is explicitly requested', async () => {
    vi.spyOn(ScrapeRun, 'aggregate').mockResolvedValue([
      { _id: 'openalex', runIds: ['recent-run-1'] },
    ] as any);
    mockReferencedObservationRows();
    mockEligibleObservationIds(observationIds(5));
    const deleteMany = vi
      .spyOn(Observation, 'deleteMany')
      .mockResolvedValue({ deletedCount: 5 } as any);

    const result = await pruneSupersededObservations({
      now: NOW,
      olderThanDays: 30,
      keepRuns: 1,
      sourceName: 'openalex',
      apply: true,
    });

    expect(deleteMany).toHaveBeenCalledWith({
      superseded: true,
      observedAt: { $lt: CUTOFF },
      sourceName: 'openalex',
      scrapeRunId: { $nin: ['recent-run-1'] },
      _id: { $in: observationIds(5) },
    });
    expect(result.deleted).toBe(5);
  });

  it('excludes observations referenced by durable materialized records', async () => {
    vi.spyOn(ScrapeRun, 'aggregate').mockResolvedValue([
      { _id: 'openalex', runIds: ['recent-run-1'] },
    ] as any);
    mockReferencedObservationRows([{ _id: 'referenced-observation' }]);
    mockEligibleObservationIds(['referenced-observation', ...observationIds(4)]);
    const deleteMany = vi
      .spyOn(Observation, 'deleteMany')
      .mockResolvedValue({ deletedCount: 4 } as any);

    const result = await pruneSupersededObservations({
      now: NOW,
      olderThanDays: 30,
      keepRuns: 1,
      apply: true,
    });

    expect(deleteMany).toHaveBeenCalledWith({
      superseded: true,
      observedAt: { $lt: CUTOFF },
      scrapeRunId: { $nin: ['recent-run-1'] },
      _id: { $in: observationIds(4) },
    });
    expect(result).toMatchObject({
      eligibleCandidates: 5,
      protectedCandidates: 1,
      candidates: 4,
      deleted: 4,
    });
  });

  describe('coupling to the materializer read scope (C4_LOSSLESS_INGEST)', () => {
    it('reads the materializer scope rather than restating that superseded means unprojected', () => {
      expect(materializationReadScopeFilter()).toEqual({ superseded: false });
      expect(supersededPruneIsProjectionNeutral()).toBe(true);

      process.env.C4_LOSSLESS_INGEST = 'true';

      expect(materializationReadScopeFilter()).not.toHaveProperty('superseded');
      expect(supersededPruneIsProjectionNeutral()).toBe(false);
    });

    it('refuses to delete superseded observations while the materializer projects them', async () => {
      process.env.C4_LOSSLESS_INGEST = 'true';
      const deleteMany = vi.spyOn(Observation, 'deleteMany');

      await expect(
        pruneSupersededObservations({ now: NOW, olderThanDays: 30, keepRuns: 3, apply: true }),
      ).rejects.toThrow(/C4_LOSSLESS_INGEST/);
      await expect(pruneDeadObservations({ now: NOW, apply: true })).rejects.toThrow(
        /C4_LOSSLESS_INGEST/,
      );

      expect(deleteMany).not.toHaveBeenCalled();
    });

    it('reports the lost neutrality in a dry run instead of counting candidates as dead storage', async () => {
      process.env.C4_LOSSLESS_INGEST = 'true';
      vi.spyOn(ScrapeRun, 'aggregate').mockResolvedValue([] as any);
      mockReferencedObservationRows();
      mockEligibleObservationIds(observationIds(7));
      const deleteMany = vi.spyOn(Observation, 'deleteMany');

      const compact = await pruneSupersededObservations({ now: NOW, apply: false });
      const dead = await pruneDeadObservations({ now: NOW, apply: false });

      expect(compact).toMatchObject({
        projectionNeutral: false,
        readScopeDeclared: true,
        candidates: 7,
        deleted: 0,
      });
      expect(dead).toMatchObject({
        projectionNeutral: false,
        readScopeDeclared: true,
        candidates: 7,
        deleted: 0,
      });
      expect(deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('dead-observation prune (superseded and unreferenced, any age)', () => {
    it('targets every superseded observation up to now while protecting referenced ids and the last runs per source', async () => {
      vi.spyOn(ScrapeRun, 'aggregate').mockResolvedValue([
        { _id: 'openalex', runIds: ['run-c', 'run-b', 'run-a'] },
      ] as any);
      mockReferencedObservationRows([{ _id: 'referenced-observation' }]);
      mockEligibleObservationIds(['referenced-observation', ...observationIds(9)]);
      const deleteMany = vi
        .spyOn(Observation, 'deleteMany')
        .mockResolvedValue({ deletedCount: 9 } as any);

      const result = await pruneDeadObservations({ now: NOW, apply: true });

      expect(deleteMany).toHaveBeenCalledWith({
        superseded: true,
        observedAt: { $lt: NOW },
        scrapeRunId: { $nin: ['run-c', 'run-b', 'run-a'] },
        _id: { $in: observationIds(9) },
      });
      expect(result).toEqual({
        apply: true,
        projectionNeutral: true,
        readScopeDeclared: false,
        eligibleCandidates: 10,
        protectedCandidates: 1,
        candidates: 9,
        deleted: 9,
        cutoff: NOW.toISOString(),
        keepRuns: 3,
        retainedRuns: 3,
        sourceName: undefined,
        referenceSpecs: ALL_REFERENCE_SPEC_COVERAGE(1),
      });
    });

    it('keeps the rollback predecessor set by retaining the last runs per source by default', async () => {
      const aggregate = vi
        .spyOn(ScrapeRun, 'aggregate')
        .mockResolvedValue([
          { _id: 'openalex', runIds: ['newest-run', 'previous-run', 'older-run'] },
        ] as any);
      mockReferencedObservationRows();
      mockEligibleObservationIds(observationIds(4));
      const deleteMany = vi
        .spyOn(Observation, 'deleteMany')
        .mockResolvedValue({ deletedCount: 4 } as any);

      await pruneDeadObservations({ now: NOW, apply: true });

      expect(aggregate).toHaveBeenCalled();
      const filter = deleteMany.mock.calls[0]?.[0] as Record<string, any>;
      expect(filter.scrapeRunId).toEqual({
        $nin: ['newest-run', 'previous-run', 'older-run'],
      });
    });

    it('forfeits run retention only when the caller explicitly asks for keepRuns=0', async () => {
      const aggregate = vi.spyOn(ScrapeRun, 'aggregate');
      mockReferencedObservationRows();
      mockEligibleObservationIds(observationIds(4));
      const deleteMany = vi
        .spyOn(Observation, 'deleteMany')
        .mockResolvedValue({ deletedCount: 4 } as any);

      const result = await pruneDeadObservations({ now: NOW, apply: true, keepRuns: 0 });

      expect(aggregate).not.toHaveBeenCalled();
      expect(deleteMany).toHaveBeenCalledWith({
        superseded: true,
        observedAt: { $lt: NOW },
        _id: { $in: observationIds(4) },
      });
      expect(result).toMatchObject({ keepRuns: 0, retainedRuns: 0 });
    });

    it('records that the read scope was undeclared so a refused apply cannot read as a clean corpus', async () => {
      vi.spyOn(ScrapeRun, 'aggregate').mockResolvedValue([] as any);
      mockReferencedObservationRows();
      mockEligibleObservationIds(observationIds(3));

      const undeclared = await pruneDeadObservations({ now: NOW, apply: false });
      expect(undeclared).toMatchObject({ projectionNeutral: true, readScopeDeclared: false });

      process.env.C4_LOSSLESS_INGEST = 'false';
      const declared = await pruneDeadObservations({ now: NOW, apply: false });
      expect(declared).toMatchObject({ projectionNeutral: true, readScopeDeclared: true });
    });

    it('never deletes in dry-run mode', async () => {
      vi.spyOn(ScrapeRun, 'aggregate').mockResolvedValue([] as any);
      mockReferencedObservationRows();
      mockEligibleObservationIds(observationIds(3));
      const deleteMany = vi.spyOn(Observation, 'deleteMany');

      const result = await pruneDeadObservations({ now: NOW, apply: false });

      expect(deleteMany).not.toHaveBeenCalled();
      expect(result).toMatchObject({ apply: false, candidates: 3, deleted: 0 });
    });
  });

  describe('a referenced set larger than one BSON command (#3733)', () => {
    it('never sends the referenced ids to the server and deletes in bounded batches', async () => {
      vi.spyOn(ScrapeRun, 'aggregate').mockResolvedValue([] as any);
      const referenced = observationIds(1_100_000, 'referenced');
      mockReferencedObservationRows(
        referenced.map((_id) => ({ _id })),
        ['observations'],
      );
      const unreferenced = observationIds(OBSERVATION_PRUNE_DELETE_BATCH_SIZE + 1, 'dead');
      const find = mockEligibleObservationIds([...referenced.slice(0, 3), ...unreferenced]);
      const deleteMany = vi.spyOn(Observation, 'deleteMany').mockImplementation((async (
        filter: any,
      ) => ({
        deletedCount: filter._id.$in.length,
      })) as any);

      const result = await pruneDeadObservations({ now: NOW, apply: true });

      expect(JSON.stringify((find.mock.calls as unknown[][])[0]?.[0])).not.toContain('referenced-');
      expect(deleteMany).toHaveBeenCalledTimes(2);
      for (const [filter] of deleteMany.mock.calls as any[]) {
        expect(filter._id.$in.length).toBeLessThanOrEqual(OBSERVATION_PRUNE_DELETE_BATCH_SIZE);
        expect(JSON.stringify(filter)).not.toContain('referenced-');
      }
      expect(result).toMatchObject({
        eligibleCandidates: unreferenced.length + 3,
        protectedCandidates: 3,
        candidates: unreferenced.length,
        deleted: unreferenced.length,
      });
    });
  });

  describe('a reference spec whose collection is absent (#210)', () => {
    it('is reported as absent rather than as a collection that references nothing', async () => {
      vi.spyOn(ScrapeRun, 'aggregate').mockResolvedValue([] as any);
      mockReferencedObservationRows(
        [{ _id: 'referenced-observation' }],
        ['observations', 'signals', 'research_entities'],
      );
      mockEligibleObservationIds(observationIds(3));

      const scan = await scanReferencedObservations();

      expect(scan.ids).toEqual(['referenced-observation']);
      expect(
        scan.specs.filter((spec) => !spec.collectionPresent).map((spec) => spec.collection),
      ).toEqual(['faculty_members', 'papers', 'paper_authors', 'research_entity_members']);
      for (const spec of scan.specs) {
        expect(spec.referencedObservations).toBe(spec.collectionPresent ? 1 : 0);
      }
    });

    it('carries the same coverage onto both prune reports', async () => {
      vi.spyOn(ScrapeRun, 'aggregate').mockResolvedValue([] as any);
      mockReferencedObservationRows([{ _id: 'referenced-observation' }], ['observations']);
      mockEligibleObservationIds(observationIds(3));

      const superseded = await pruneSupersededObservations({ now: NOW, apply: false });
      const dead = await pruneDeadObservations({ now: NOW, apply: false });

      for (const result of [superseded, dead]) {
        expect(result.referenceSpecs).toHaveLength(OBSERVATION_REFERENCE_SPECS.length);
        expect(result.referenceSpecs.filter((spec) => spec.collectionPresent)).toEqual([
          {
            collection: 'observations',
            field: 'supersededBy',
            collectionPresent: true,
            referencedObservations: 1,
          },
        ]);
      }
    });
  });
});
