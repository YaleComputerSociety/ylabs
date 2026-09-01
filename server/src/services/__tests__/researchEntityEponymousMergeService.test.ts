import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResearchEntityPiDedupeRow } from '../../scripts/researchEntityPiDedupeCore';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async (_entityType: string, _docs: any[]) => {}),
  deleteFromIndex: vi.fn(async (_entityType: string, _id: string) => {}),
}));

vi.mock('../meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
  deleteFromIndex: meiliMocks.deleteFromIndex,
}));

import {
  applyResearchEntityMergeGroupsWithCanonicalResync,
  forceResyncCanonicalResearchEntities,
  recomputeVisibilityAndResyncCanonicals,
  runEponymousFraLabMerge,
  selectEponymousFraLabMergeGroups,
} from '../researchEntityEponymousMergeService';

function eponymousShellRow(
  overrides: Partial<ResearchEntityPiDedupeRow> = {},
): ResearchEntityPiDedupeRow {
  return {
    userId: 'pi-ada-lovelace',
    normalizedName: 'same-pi:pi-ada-lovelace',
    piFirstName: 'Ada',
    piLastName: 'Lovelace',
    entities: [
      {
        id: 'lovelace-lab',
        slug: 'ysm-lovelace',
        name: 'Lovelace Laboratory',
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: 'https://medicine.yale.edu/lab/lovelace/',
        sourceUrls: ['https://medicine.yale.edu/lab/lovelace/'],
        departments: ['Computer Science'],
      },
      {
        id: 'lovelace-fra-shell',
        slug: 'faculty-research-area-ada-lovelace',
        name: 'Ada Lovelace Research',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        sourceUrls: ['https://medicine.yale.edu/profile/ada-lovelace/'],
        departments: ['Computer Science'],
      },
    ],
    ...overrides,
  };
}

describe('selectEponymousFraLabMergeGroups', () => {
  it('selects an FRA shell that shadows the same PI own lab', () => {
    const groups = selectEponymousFraLabMergeGroups([eponymousShellRow()]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      dedupeCategory: 'profile_area_shell_with_concrete_home',
      canonicalEntityId: 'lovelace-lab',
      duplicateEntityIds: ['lovelace-fra-shell'],
    });
  });

  it('never merges an FRA shell into a CENTER when the same PI leads a center but no lab', () => {
    const groups = selectEponymousFraLabMergeGroups([
      {
        userId: 'pi-grace-hopper',
        normalizedName: 'same-pi:pi-grace-hopper',
        piFirstName: 'Grace',
        piLastName: 'Hopper',
        entities: [
          {
            id: 'hopper-center',
            slug: 'ysm-hopper-center',
            name: 'Hopper Center for Computing',
            kind: 'center',
            entityType: 'CENTER',
            websiteUrl: 'https://medicine.yale.edu/hopper-center/',
            sourceUrls: ['https://medicine.yale.edu/hopper-center/'],
            departments: ['Computer Science'],
          },
          {
            id: 'hopper-fra-shell',
            slug: 'faculty-research-area-grace-hopper',
            name: 'Grace Hopper Research',
            kind: 'individual',
            entityType: 'FACULTY_RESEARCH_AREA',
            sourceUrls: ['https://medicine.yale.edu/profile/grace-hopper/'],
            departments: ['Computer Science'],
          },
        ],
      },
    ]);
    expect(groups).toHaveLength(0);
  });

  it('keeps the PI own lab canonical and never the center when the PI leads both', () => {
    const groups = selectEponymousFraLabMergeGroups([
      {
        userId: 'pi-katherine-johnson',
        normalizedName: 'same-pi:pi-katherine-johnson',
        piFirstName: 'Katherine',
        piLastName: 'Johnson',
        entities: [
          {
            id: 'johnson-center',
            slug: 'ysm-johnson-center',
            name: 'Johnson Center for Orbital Mechanics',
            kind: 'center',
            entityType: 'CENTER',
            websiteUrl: 'https://medicine.yale.edu/johnson-center/',
            sourceUrls: ['https://medicine.yale.edu/johnson-center/'],
            departments: ['Astronomy'],
          },
          {
            id: 'johnson-lab',
            slug: 'ysm-johnson-lab',
            name: 'Johnson Laboratory',
            kind: 'lab',
            entityType: 'LAB',
            websiteUrl: 'https://medicine.yale.edu/lab/johnson/',
            sourceUrls: ['https://medicine.yale.edu/lab/johnson/'],
            departments: ['Astronomy'],
          },
          {
            id: 'johnson-fra-shell',
            slug: 'faculty-research-area-katherine-johnson',
            name: 'Katherine Johnson Research',
            kind: 'individual',
            entityType: 'FACULTY_RESEARCH_AREA',
            sourceUrls: ['https://medicine.yale.edu/profile/katherine-johnson/'],
            departments: ['Astronomy'],
          },
        ],
      },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].canonicalEntityId).toBe('johnson-lab');
    expect(groups[0].duplicateEntityIds).toContain('johnson-fra-shell');
    expect([groups[0].canonicalEntityId, ...groups[0].duplicateEntityIds]).not.toContain(
      'johnson-center',
    );
  });

  it('does not auto-select a name-only cluster with no eponymous FRA shadow', () => {
    const groups = selectEponymousFraLabMergeGroups([
      {
        userId: 'pi-alan-turing',
        normalizedName: 'same-pi:pi-alan-turing',
        piFirstName: 'Alan',
        piLastName: 'Turing',
        entities: [
          {
            id: 'turing-home-a',
            slug: 'ysm-turing-a',
            name: 'Computation Theory Group',
            kind: 'lab',
            entityType: 'LAB',
            websiteUrl: 'https://medicine.yale.edu/lab/turing-a/',
            sourceUrls: ['https://medicine.yale.edu/lab/turing-a/'],
            departments: ['Computer Science'],
          },
          {
            id: 'turing-home-b',
            slug: 'ysm-turing-b',
            name: 'Computation Theory Group',
            kind: 'lab',
            entityType: 'LAB',
            websiteUrl: 'https://medicine.yale.edu/lab/turing-b/',
            sourceUrls: ['https://medicine.yale.edu/lab/turing-b/'],
            departments: ['Computer Science'],
          },
        ],
      },
    ]);
    expect(groups).toHaveLength(0);
  });
});

describe('applyResearchEntityMergeGroupsWithCanonicalResync', () => {
  it('forces a canonical re-sync after merging, over the unique canonical ids', async () => {
    const callOrder: string[] = [];
    const applyMergeGroup = vi.fn(async (group: { canonicalEntityId: string }) => {
      callOrder.push(`merge:${group.canonicalEntityId}`);
      return { canonicalEntityId: group.canonicalEntityId };
    });
    const recomputeVisibility = vi.fn(async (ids: string[]) => {
      callOrder.push(`visibility:${ids.join(',')}`);
      return ids.length;
    });
    const resyncCanonicalEntities = vi.fn(async (ids: string[]) => {
      callOrder.push(`resync:${ids.join(',')}`);
      return ids.length;
    });

    const result = await applyResearchEntityMergeGroupsWithCanonicalResync(
      [
        { canonicalEntityId: 'lab-a' },
        { canonicalEntityId: 'lab-a' },
        { canonicalEntityId: 'lab-b' },
      ],
      { applyMergeGroup, recomputeVisibility, resyncCanonicalEntities },
    );

    expect(applyMergeGroup).toHaveBeenCalledTimes(3);
    expect(result.canonicalEntityIds).toEqual(['lab-a', 'lab-b']);
    expect(recomputeVisibility).toHaveBeenCalledWith(['lab-a', 'lab-b']);
    expect(resyncCanonicalEntities).toHaveBeenCalledWith(['lab-a', 'lab-b']);
    expect(result.canonicalEntitiesResynced).toBe(2);
    expect(callOrder).toEqual([
      'merge:lab-a',
      'merge:lab-a',
      'merge:lab-b',
      'visibility:lab-a,lab-b',
      'resync:lab-a,lab-b',
    ]);
  });

  it('forces the canonical re-sync even when no visibility tier changed', async () => {
    const resyncCanonicalEntities = vi.fn(async (ids: string[]) => ids.length);
    const result = await applyResearchEntityMergeGroupsWithCanonicalResync(
      [{ canonicalEntityId: 'lab-c' }],
      {
        applyMergeGroup: async (group) => ({ canonicalEntityId: group.canonicalEntityId }),
        recomputeVisibility: async () => 0,
        resyncCanonicalEntities,
      },
    );
    expect(resyncCanonicalEntities).toHaveBeenCalledWith(['lab-c']);
    expect(result.visibilityRecomputed).toBe(0);
    expect(result.canonicalEntitiesResynced).toBe(1);
  });
});

describe('runEponymousFraLabMerge', () => {
  it('selects the eponymous group and applies it through the shared resync path', async () => {
    const applyMergeGroup = vi.fn(async (group: { canonicalEntityId: string }) => ({
      canonicalEntityId: group.canonicalEntityId,
    }));
    const resyncCanonicalEntities = vi.fn(async (ids: string[]) => ids.length);

    const result = await runEponymousFraLabMerge(
      { rows: [eponymousShellRow()] },
      {
        apply: true,
        applyMergeGroup,
        recomputeVisibility: async (ids) => ids.length,
        resyncCanonicalEntities,
      },
    );

    expect(result.groups).toHaveLength(1);
    expect(applyMergeGroup).toHaveBeenCalledTimes(1);
    expect(resyncCanonicalEntities).toHaveBeenCalledWith(['lovelace-lab']);
    expect(result.canonicalEntitiesResynced).toBe(1);
  });

  it('does not apply or re-sync in dry-run mode', async () => {
    const applyMergeGroup = vi.fn(async (group: { canonicalEntityId: string }) => ({
      canonicalEntityId: group.canonicalEntityId,
    }));
    const resyncCanonicalEntities = vi.fn(async (ids: string[]) => ids.length);

    const result = await runEponymousFraLabMerge(
      { rows: [eponymousShellRow()] },
      { apply: false, applyMergeGroup, resyncCanonicalEntities },
    );

    expect(result.groups).toHaveLength(1);
    expect(applyMergeGroup).not.toHaveBeenCalled();
    expect(resyncCanonicalEntities).not.toHaveBeenCalled();
  });
});

describe('forceResyncCanonicalResearchEntities', () => {
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
    await mongoose.connection.db!.collection('research_entities').deleteMany({});
  });

  afterEach(() => {
    meiliMocks.syncEntities.mockClear();
  });

  it('re-syncs live canonical entities and skips archived ones', async () => {
    const liveId = new mongoose.Types.ObjectId();
    const archivedId = new mongoose.Types.ObjectId();
    await mongoose.connection.db!.collection('research_entities').insertMany([
      { _id: liveId, slug: 'live-lab', archived: false },
      { _id: archivedId, slug: 'archived-lab', archived: true },
    ]);

    const resynced = await forceResyncCanonicalResearchEntities([
      liveId.toHexString(),
      archivedId.toHexString(),
    ]);

    expect(resynced).toBe(1);
    expect(meiliMocks.syncEntities).toHaveBeenCalledTimes(1);
    const [entityType, docs] = meiliMocks.syncEntities.mock.calls[0];
    expect(entityType).toBe('researchEntity');
    expect(docs).toHaveLength(1);
    expect(String((docs[0] as any)._id)).toBe(liveId.toHexString());
  });

  it('is a no-op for an empty id set', async () => {
    const resynced = await forceResyncCanonicalResearchEntities([]);
    expect(resynced).toBe(0);
    expect(meiliMocks.syncEntities).not.toHaveBeenCalled();
  });
});

describe('recomputeVisibilityAndResyncCanonicals', () => {
  it('runs the resync after the visibility recompute and returns both counts', async () => {
    const order: string[] = [];
    const result = await recomputeVisibilityAndResyncCanonicals(['lab-x', 'lab-y'], {
      recomputeVisibility: async (ids) => {
        order.push(`visibility:${ids.length}`);
        return ids.length;
      },
      resyncCanonicalEntities: async (ids) => {
        order.push(`resync:${ids.length}`);
        return ids.length;
      },
    });
    expect(order).toEqual(['visibility:2', 'resync:2']);
    expect(result).toEqual({ visibilityRecomputed: 2, canonicalEntitiesResynced: 2 });
  });
});
