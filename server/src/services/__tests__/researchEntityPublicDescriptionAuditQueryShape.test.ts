import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../researchEntityMembershipAccessor', () => ({
  getResearchEntityRosterByEntityId: vi.fn(async () => new Map()),
}));

import { ResearchEntity } from '../../models/researchEntity';
import { getResearchEntityRosterByEntityId } from '../researchEntityMembershipAccessor';
import {
  auditStudentReadyPublicDescriptions,
  PUBLIC_DESCRIPTION_AUDIT_ENTITY_CHUNK_SIZE,
  STUDENT_READY_PUBLIC_DESCRIPTION_AUDIT_FILTER,
} from '../researchEntityPublicDescriptionAuditService';

const servableEntity = (index: number) => ({
  _id: `entity-valid-${index}`,
  slug: `valid-research-${index}`,
  name: `Valid Research ${String(index).padStart(4, '0')}`,
  kind: 'lab',
  shortDescription:
    'Studies molecular dynamics, protein folding, and cellular signaling in biological systems.',
  fullDescription:
    'This research studies molecular dynamics, protein folding, and cellular signaling across complex biological systems.',
  sourceUrls: ['https://example.yale.edu/research/valid'],
});

const blankEntity = (recordId: string, name: string) => ({
  _id: recordId,
  slug: recordId,
  name,
  kind: 'lab',
  sourceUrls: ['https://example.yale.edu/research/blank'],
});

function streamedFind(entities: Array<Record<string, any>>) {
  const sort = vi.fn();
  const cursor = vi.fn(() => ({
    async *[Symbol.asyncIterator]() {
      yield* entities;
    },
  }));
  const find = vi.spyOn(ResearchEntity, 'find').mockImplementation((() => ({
    sort,
    lean: () => ({ sort, cursor }),
  })) as any);
  return { find, sort, cursor };
}

describe('auditStudentReadyPublicDescriptions query shape', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(getResearchEntityRosterByEntityId).mockClear();
  });

  it('streams whole documents unsorted in bounded chunks, so the corpus size never reaches a database sort', async () => {
    const entityCount = PUBLIC_DESCRIPTION_AUDIT_ENTITY_CHUNK_SIZE * 2 + 17;
    const entities: Array<Record<string, any>> = Array.from(
      { length: entityCount - 1 },
      (_, index) => servableEntity(index),
    );
    entities.push(blankEntity('entity-late-blank', 'Late Blank Research'));
    const { find, sort, cursor } = streamedFind(entities);

    const report = await auditStudentReadyPublicDescriptions({ includeSamples: true });

    expect(find).toHaveBeenCalledTimes(1);
    expect(find.mock.calls[0]).toEqual([STUDENT_READY_PUBLIC_DESCRIPTION_AUDIT_FILTER]);
    expect(sort).not.toHaveBeenCalled();
    expect(cursor).toHaveBeenCalledWith({ batchSize: PUBLIC_DESCRIPTION_AUDIT_ENTITY_CHUNK_SIZE });

    const rosterCalls = vi.mocked(getResearchEntityRosterByEntityId).mock.calls;
    expect(rosterCalls).toHaveLength(3);
    for (const [ids] of rosterCalls) {
      expect(ids.length).toBeLessThanOrEqual(PUBLIC_DESCRIPTION_AUDIT_ENTITY_CHUNK_SIZE);
    }
    expect(rosterCalls.flatMap(([ids]) => ids)).toHaveLength(entityCount);

    expect(report.counts.scanned).toBe(entityCount);
    expect(report.counts.violations).toBe(1);
    expect(report.samples?.map((sample) => sample.recordId)).toEqual(['entity-late-blank']);
  });

  it('orders samples by name in process, as the removed database sort did', async () => {
    streamedFind([
      blankEntity('entity-c', 'Charlie Research'),
      blankEntity('entity-a', 'Alpha Research'),
      blankEntity('entity-b', 'Bravo Research'),
    ]);

    const report = await auditStudentReadyPublicDescriptions({
      includeSamples: true,
      sampleLimit: 2,
    });

    expect(report.counts.violations).toBe(3);
    expect(report.samples?.map((sample) => sample.recordId)).toEqual(['entity-a', 'entity-b']);
    expect(report.samples?.[0]).not.toHaveProperty('sortName');
  });
});
