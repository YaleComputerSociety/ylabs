import mongoose from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  annotateEntitiesWithSourceObservationUrls,
  annotateProfileDescriptionPreferredSourceEvidence,
  OBSERVATION_LOOKUP_ENTITY_CHUNK_SIZE,
  observationEntityScopeChunks,
  PROFILE_DESCRIPTION_SUPPRESSED_BY_PREFERRED_SOURCE_NAMES_FIELD,
  SOURCE_OBSERVATION_URLS_PER_ENTITY,
  sortByMostRecentlyObserved,
  sourceObservationUrlsByEntityKey,
} from '../sources/officialProfilePiBackfillScraper';
import { Observation } from '../../models/observation';

type SyntheticObservation = {
  entityId: mongoose.Types.ObjectId;
  entityKey: string;
  sourceUrl: string;
  observedAt: Date;
};

const entityCount = OBSERVATION_LOOKUP_ENTITY_CHUNK_SIZE * 2 + 17;

function syntheticEntities(count: number): Array<Record<string, any>> {
  return Array.from({ length: count }, (_, index) => ({
    _id: new mongoose.Types.ObjectId(),
    slug: `synthetic-entity-${index}`,
  }));
}

function inValues(clauses: Array<Record<string, any>>, field: string): string[] {
  const clause = clauses.find((candidate) => candidate[field]);
  return (clause?.[field]?.$in || []).map((value: unknown) => String(value));
}

function aggregateOver(observations: SyntheticObservation[]) {
  return vi.spyOn(Observation, 'aggregate').mockImplementation(((pipeline: any[]) => {
    const clauses = pipeline[0].$match.$or as Array<Record<string, any>>;
    const ids = new Set(inValues(clauses, 'entityId'));
    const keys = new Set(inValues(clauses, 'entityKey'));
    const latest = new Map<string, Record<string, any>>();
    for (const row of observations) {
      if (!ids.has(String(row.entityId)) && !keys.has(row.entityKey)) continue;
      const groupKey = `${row.entityId}|${row.entityKey}|${row.sourceUrl}`;
      const existing = latest.get(groupKey);
      if (!existing || existing.lastObservedAt < row.observedAt) {
        latest.set(groupKey, {
          entityId: row.entityId,
          entityKey: row.entityKey,
          sourceUrl: row.sourceUrl,
          lastObservedAt: row.observedAt,
        });
      }
    }
    return Promise.resolve(Array.from(latest.values()));
  }) as any);
}

describe('official profile PI backfill observation lookups', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('splits the entity list into bounded chunks that cover every entity', () => {
    const entities = syntheticEntities(entityCount);
    const scopes = observationEntityScopeChunks(entities);

    expect(scopes).toHaveLength(3);
    for (const scope of scopes) {
      expect(scope.entityIds.length).toBeLessThanOrEqual(OBSERVATION_LOOKUP_ENTITY_CHUNK_SIZE);
      expect(scope.entityKeys.length).toBeLessThanOrEqual(OBSERVATION_LOOKUP_ENTITY_CHUNK_SIZE);
    }
    expect(scopes.flatMap((scope) => scope.entityKeys)).toEqual(
      entities.map((entity) => entity.slug),
    );
  });

  it('gives an entity late in the order its own source URLs however much evidence precedes it', async () => {
    const entities = syntheticEntities(entityCount);
    const newest = new Date('2026-09-01T00:00:00Z');
    const oldest = new Date('2020-01-01T00:00:00Z');
    const observations: SyntheticObservation[] = entities.flatMap((entity, index) => {
      const isLast = index === entities.length - 1;
      return Array.from({ length: isLast ? 1 : 40 }, (_, row) => ({
        entityId: entity._id,
        entityKey: entity.slug,
        sourceUrl: isLast
          ? 'https://example.yale.edu/people/late-entity-fixture'
          : `https://example.yale.edu/${entity.slug}/page-${row % 3}`,
        observedAt: isLast ? oldest : newest,
      }));
    });
    const aggregate = aggregateOver(observations);

    const annotated = await annotateEntitiesWithSourceObservationUrls(entities);

    expect(aggregate).toHaveBeenCalledTimes(3);
    expect(annotated.at(-1)?.sourceObservationUrls).toEqual([
      'https://example.yale.edu/people/late-entity-fixture',
    ]);
    expect(annotated.every((entity) => entity.sourceObservationUrls.length > 0)).toBe(true);
  });

  it('never asks the database to sort or cap across entities', async () => {
    const aggregate = aggregateOver([]);

    await annotateEntitiesWithSourceObservationUrls(syntheticEntities(entityCount));

    for (const [pipeline] of aggregate.mock.calls as unknown as Array<[any[]]>) {
      const stageNames = pipeline.flatMap((stage) => Object.keys(stage));
      expect(stageNames).not.toContain('$sort');
      expect(stageNames).not.toContain('$limit');
      const clauses = pipeline[0].$match.$or as Array<Record<string, any>>;
      expect(inValues(clauses, 'entityId').length).toBeLessThanOrEqual(
        OBSERVATION_LOOKUP_ENTITY_CHUNK_SIZE,
      );
      const entityIdClause = clauses.find((clause) => clause.entityId);
      expect(entityIdClause?.entityId.$in[0]).toBeInstanceOf(mongoose.Types.ObjectId);
    }
  });

  it('caps URLs per entity, keeping the most recently observed', () => {
    const entityId = new mongoose.Types.ObjectId();
    const groups = Array.from({ length: SOURCE_OBSERVATION_URLS_PER_ENTITY + 5 }, (_, index) => ({
      entityId,
      entityKey: 'synthetic-capped-entity',
      sourceUrl: `https://example.yale.edu/page-${index}`,
      lastObservedAt: new Date(Date.UTC(2026, 0, 1 + index)),
    }));

    const urls = sourceObservationUrlsByEntityKey(groups).get(String(entityId)) || [];

    expect(urls).toHaveLength(SOURCE_OBSERVATION_URLS_PER_ENTITY);
    expect(urls[0]).toBe(`https://example.yale.edu/page-${SOURCE_OBSERVATION_URLS_PER_ENTITY + 4}`);
    expect(urls).not.toContain('https://example.yale.edu/page-0');
  });

  it('keys a URL under both the entity id and the slug and merges duplicates', () => {
    const entityId = new mongoose.Types.ObjectId();
    const urls = sourceObservationUrlsByEntityKey([
      {
        entityId,
        entityKey: 'synthetic-slug',
        sourceUrl: 'https://example.yale.edu/a',
        lastObservedAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        entityKey: 'synthetic-slug',
        sourceUrl: 'https://example.yale.edu/a',
        lastObservedAt: new Date('2026-02-01T00:00:00Z'),
      },
    ]);

    expect(urls.get(String(entityId))).toEqual(['https://example.yale.edu/a']);
    expect(urls.get('synthetic-slug')).toEqual(['https://example.yale.edu/a']);
  });

  it('reads preferred description evidence chunk by chunk and still marks a late entity', async () => {
    const entities = syntheticEntities(entityCount);
    const lastEntity = entities.at(-1)!;
    const find = vi.spyOn(Observation, 'find').mockImplementation(((filter: any) => {
      const keys = new Set(inValues(filter.$or, 'entityKey'));
      const rows = keys.has(lastEntity.slug)
        ? [{ entityKey: lastEntity.slug, sourceName: 'lab-microsite-description-llm' }]
        : [];
      return { select: () => ({ lean: () => Promise.resolve(rows) }) };
    }) as any);

    const annotated = await annotateProfileDescriptionPreferredSourceEvidence(entities);

    expect(find).toHaveBeenCalledTimes(3);
    expect(
      annotated.at(-1)?.[PROFILE_DESCRIPTION_SUPPRESSED_BY_PREFERRED_SOURCE_NAMES_FIELD],
    ).toEqual(['lab-microsite-description-llm']);
    expect(
      annotated[0][PROFILE_DESCRIPTION_SUPPRESSED_BY_PREFERRED_SOURCE_NAMES_FIELD],
    ).toBeUndefined();
  });

  it('orders unlimited entity selections newest first with an id tie-break, matching the database sort', () => {
    const first = new mongoose.Types.ObjectId('000000000000000000000001');
    const second = new mongoose.Types.ObjectId('000000000000000000000002');
    const third = new mongoose.Types.ObjectId('000000000000000000000003');
    const sorted = sortByMostRecentlyObserved([
      { _id: third, lastObservedAt: new Date('2026-01-01T00:00:00Z') },
      { _id: second },
      { _id: first, lastObservedAt: new Date('2026-01-01T00:00:00Z') },
      { _id: second, lastObservedAt: new Date('2026-05-01T00:00:00Z') },
    ]);

    expect(
      sorted.map((entity) => [String(entity._id), entity.lastObservedAt?.getUTCMonth()]),
    ).toEqual([
      [String(second), 4],
      [String(first), 0],
      [String(third), 0],
      [String(second), undefined],
    ]);
  });
});
