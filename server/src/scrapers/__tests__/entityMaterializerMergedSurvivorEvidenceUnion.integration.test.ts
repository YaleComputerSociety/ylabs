import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntity: vi.fn().mockResolvedValue(undefined),
  deleteFromIndex: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: meiliMocks.syncEntity,
    deleteFromIndex: meiliMocks.deleteFromIndex,
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { Signal } from '../../models/signal';
import { materializeEntity } from '../entityMaterializer';

type ProjectedSurvivor = {
  name?: string;
  kind?: string;
  websiteUrl?: string;
  researchAreas?: string[];
  archived?: boolean;
};

describe('a merged survivor resolves over its tombstoned losers evidence (#3560)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
    await Signal.deleteMany({});
  });

  const seedObservation = async (
    entityKey: string,
    field: string,
    value: unknown,
    sourceName = 'ysm-faculty-directory',
    overrides: { confidence?: number; observedAt?: Date; sourceUrl?: string } = {},
  ) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl: overrides.sourceUrl ?? `https://example.yale.edu/${entityKey}/`,
      confidence: overrides.confidence ?? 0.9,
      observedAt: overrides.observedAt ?? new Date('2026-02-01T00:00:00Z'),
      superseded: false,
    });
  };

  const projectSurvivor = async (id: mongoose.Types.ObjectId) => {
    const doc = await ResearchEntity.findById(id).lean<ProjectedSurvivor>();
    return {
      name: doc?.name,
      kind: doc?.kind,
      websiteUrl: doc?.websiteUrl ?? '',
      researchAreas: [...(doc?.researchAreas ?? [])].sort(),
      archived: doc?.archived,
    };
  };

  const seedMerge = async (loserSlug: string) => {
    const survivor = await ResearchEntity.create({
      slug: 'example-lead-lab',
      name: 'Example Lead Lab',
      kind: 'lab',
      archived: false,
    });
    await ResearchEntity.create({
      slug: loserSlug,
      name: 'Example Lead Research',
      kind: 'individual',
      archived: true,
      canonicalGroupId: survivor._id,
    });
    await seedObservation('example-lead-lab', 'name', 'Example Lead Lab');
    await seedObservation('example-lead-lab', 'researchAreas', ['Neuroscience']);
    await seedObservation(loserSlug, 'name', 'Example Lead Research', 'dept-faculty-roster');
    await seedObservation(
      loserSlug,
      'websiteUrl',
      'https://examplelead.yale.edu/',
      'dept-faculty-roster',
    );
    return survivor;
  };

  it('keeps a loser-only value when the survivor re-resolves under its own key', async () => {
    const survivor = await seedMerge('ysm-faculty-example-lead');

    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });

    const projected = await projectSurvivor(survivor._id);
    expect(projected.websiteUrl).toBe('https://examplelead.yale.edu/');
    expect(projected.name).toBe('Example Lead Lab');
    expect(projected.researchAreas).toContain('Neuroscience');
  });

  it('projects the same survivor from either entry point and on a second run', async () => {
    const survivor = await seedMerge('ysm-faculty-example-lead');

    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });
    const viaSurvivor = await projectSurvivor(survivor._id);
    await materializeEntity('researchEntity', { entityKey: 'ysm-faculty-example-lead' });
    const viaLoser = await projectSurvivor(survivor._id);
    await materializeEntity('researchEntity', { entityId: survivor._id.toHexString() });
    const viaSurvivorAgain = await projectSurvivor(survivor._id);

    expect(viaLoser).toEqual(viaSurvivor);
    expect(viaSurvivorAgain).toEqual(viaSurvivor);
    expect(viaSurvivor.name).toBe('Example Lead Lab');
  });

  it('resolves a survivor that has no evidence of its own from its losers', async () => {
    const survivor = await ResearchEntity.create({
      slug: 'example-lead-lab',
      name: 'Example Lead Lab',
      kind: 'lab',
      archived: false,
    });
    await ResearchEntity.create({
      slug: 'ysm-faculty-example-lead',
      name: 'Example Lead Research',
      kind: 'individual',
      archived: true,
      canonicalGroupId: survivor._id,
    });
    await seedObservation(
      'ysm-faculty-example-lead',
      'websiteUrl',
      'https://examplelead.yale.edu/',
    );

    const result = await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });

    expect(result.fieldsWritten).toBeGreaterThan(0);
    expect((await projectSurvivor(survivor._id)).websiteUrl).toBe('https://examplelead.yale.edu/');
  });

  it.each(['nih-pi-example-lead', 'faculty-research-area-example-lead'])(
    'refuses a low-trust %s shell topics from both entry points',
    async (shellSlug) => {
      const survivor = await seedMerge(shellSlug);
      await seedObservation(shellSlug, 'researchAreas', ['Grant Topic'], 'nih-reporter');

      await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });
      const viaSurvivor = await projectSurvivor(survivor._id);
      await materializeEntity('researchEntity', { entityKey: shellSlug });
      const viaShell = await projectSurvivor(survivor._id);

      expect(viaSurvivor.researchAreas).not.toContain('Grant Topic');
      expect(viaShell).toEqual(viaSurvivor);
      expect(viaSurvivor.websiteUrl).toBe('https://examplelead.yale.edu/');
    },
  );

  it('carries a trusted loser topics onto the survivor', async () => {
    const survivor = await ResearchEntity.create({
      slug: 'example-lead-lab',
      name: 'Example Lead Lab',
      kind: 'lab',
      archived: false,
    });
    await ResearchEntity.create({
      slug: 'ysm-faculty-example-lead',
      name: 'Example Lead Research',
      kind: 'individual',
      archived: true,
      canonicalGroupId: survivor._id,
    });
    await seedObservation('example-lead-lab', 'name', 'Example Lead Lab');
    await seedObservation('ysm-faculty-example-lead', 'researchAreas', ['Synaptic Plasticity']);

    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });

    expect((await projectSurvivor(survivor._id)).researchAreas).toContain('Synaptic Plasticity');
  });

  it('resolves an exact tie between survivor and loser topics the same from both entry points', async () => {
    const survivor = await seedMerge('ysm-faculty-example-lead');
    await seedObservation('ysm-faculty-example-lead', 'researchAreas', ['Synaptic Plasticity']);

    await materializeEntity('researchEntity', { entityKey: 'ysm-faculty-example-lead' });
    const viaLoser = await projectSurvivor(survivor._id);
    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });
    const viaSurvivor = await projectSurvivor(survivor._id);

    expect(viaSurvivor).toEqual(viaLoser);
  });

  it('derives a loser access signal onto the survivor from the survivor key', async () => {
    const survivor = await seedMerge('ysm-faculty-example-lead');
    await seedObservation('ysm-faculty-example-lead', 'offersIndependentStudy', true);

    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });

    const signalTypes = (await Signal.find({ researchEntityId: survivor._id }).lean()).map(
      (signal) => signal.type,
    );
    expect(signalTypes).toContain('CREDIT_FORMALIZATION_POSSIBLE');
  });

  it('keeps the survivor own value when a same-source loser observation is newer', async () => {
    const survivor = await seedMerge('ysm-faculty-example-lead');
    await seedObservation(
      'example-lead-lab',
      'websiteUrl',
      'https://examplelead-lab.yale.edu/',
      'dept-faculty-roster',
    );
    await seedObservation(
      'ysm-faculty-example-lead',
      'researchAreas',
      ['Unrelated Topic'],
      'ysm-faculty-directory',
      { observedAt: new Date('2026-06-01T00:00:00Z') },
    );

    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });
    const viaSurvivor = await projectSurvivor(survivor._id);
    await materializeEntity('researchEntity', { entityKey: 'ysm-faculty-example-lead' });
    const viaLoser = await projectSurvivor(survivor._id);

    expect(viaSurvivor.researchAreas).toEqual(['Neuroscience']);
    expect(viaSurvivor.websiteUrl).toBe('https://examplelead-lab.yale.edu/');
    expect(viaLoser).toEqual(viaSurvivor);
  });

  it('keeps the survivor own value when a loser carries a higher-confidence source', async () => {
    const survivor = await seedMerge('dept-example-lead');
    await seedObservation(
      'example-lead-lab',
      'websiteUrl',
      'https://examplelead-lab.yale.edu/',
      'nih-reporter',
      { confidence: 0.4 },
    );
    await seedObservation(
      'dept-example-lead',
      'researchAreas',
      ['Unrelated Topic'],
      'ysm-atoz-index',
      { confidence: 0.95 },
    );

    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });
    const projected = await projectSurvivor(survivor._id);

    expect(projected.researchAreas).toEqual(['Neuroscience']);
    expect(projected.websiteUrl).toBe('https://examplelead-lab.yale.edu/');
  });

  it('keeps the survivor own departments against a newer higher-confidence loser roster', async () => {
    const survivor = await seedMerge('dept-example-lead');
    await seedObservation(
      'example-lead-lab',
      'departments',
      ['Example Studies'],
      'lead-pi-school-inheritance',
      {
        confidence: 0.6,
      },
    );
    await seedObservation(
      'dept-example-lead',
      'departments',
      ['Other Studies'],
      'dept-faculty-roster',
      {
        confidence: 0.7,
        observedAt: new Date('2026-06-01T00:00:00Z'),
      },
    );

    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });
    const stored = await ResearchEntity.findById(survivor._id).lean<{ departments?: string[] }>();

    expect(stored?.departments ?? []).not.toContain('Other Studies');
  });

  it('keeps a stored survivor department no survivor observation backs', async () => {
    const survivor = await seedMerge('dept-example-lead');
    await ResearchEntity.updateOne(
      { _id: survivor._id },
      { $set: { departments: ['Example Studies'] } },
    );
    await seedObservation('dept-example-lead', 'departments', ['Law'], 'dept-faculty-roster', {
      confidence: 0.7,
    });

    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });
    await materializeEntity('researchEntity', { entityKey: 'dept-example-lead' });
    const stored = await ResearchEntity.findById(survivor._id).lean<{ departments?: string[] }>();

    expect(stored?.departments).toEqual(['Example Studies']);
  });

  describe("a merged-in citation of the lead's verified primary profile (#4695)", () => {
    const seedLead = async (survivorId: mongoose.Types.ObjectId, profileUrl: string) => {
      const person = await Researcher.create({
        schemaVersion: 1,
        displayName: 'Example Lead',
        status: 'ACTIVE',
        archived: false,
        profileLinks: [
          {
            kind: 'YALE_OFFICIAL',
            purpose: 'PRIMARY_IDENTITY',
            url: profileUrl,
            verifiedAt: new Date('2026-09-01T00:00:00Z'),
          },
        ],
      });
      await RoleAssignment.create({
        schemaVersion: 1,
        personId: person._id,
        target: { kind: 'RESEARCH_ENTITY', id: survivorId },
        role: 'PI',
        state: 'CURRENT',
        confidence: 0.7,
        reviewStatus: 'UNREVIEWED',
      });
    };

    it('carries it onto a survivor that cites its own pages', async () => {
      const survivor = await seedMerge('dept-example-lead');
      await seedObservation('example-lead-lab', 'sourceUrls', ['https://example.yale.edu/lab/']);
      await seedObservation('dept-example-lead', 'sourceUrls', [
        'https://example.yale.edu/profile/example-lead/',
        'https://example.yale.edu/people/faculty/',
      ]);
      await seedLead(survivor._id, 'https://example.yale.edu/profile/example-lead');

      await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });
      const stored = await ResearchEntity.findById(survivor._id).lean<{ sourceUrls?: string[] }>();

      expect(stored?.sourceUrls).toContain('https://example.yale.edu/profile/example-lead/');
      expect(stored?.sourceUrls).not.toContain('https://example.yale.edu/people/faculty/');
    });

    it('leaves out the lead verified profile when the survivor records it as dead', async () => {
      const survivor = await seedMerge('dept-example-lead');
      await ResearchEntity.updateOne(
        { _id: survivor._id },
        {
          $set: {
            sourceLinkHealth: [
              {
                url: 'https://example.yale.edu/profile/example-lead/',
                healthStatus: 'UNAVAILABLE',
                httpStatusCode: 404,
              },
            ],
          },
        },
      );
      await seedObservation('example-lead-lab', 'sourceUrls', ['https://example.yale.edu/lab/']);
      await seedObservation('dept-example-lead', 'sourceUrls', [
        'https://example.yale.edu/profile/example-lead/',
      ]);
      await seedLead(survivor._id, 'https://example.yale.edu/profile/example-lead');

      await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });
      const stored = await ResearchEntity.findById(survivor._id).lean<{ sourceUrls?: string[] }>();

      expect(stored?.sourceUrls ?? []).not.toContain(
        'https://example.yale.edu/profile/example-lead/',
      );
    });

    it('leaves out a merged-in profile that is not the lead verified one', async () => {
      const survivor = await seedMerge('dept-example-lead');
      await seedObservation('example-lead-lab', 'sourceUrls', ['https://example.yale.edu/lab/']);
      await seedObservation('dept-example-lead', 'sourceUrls', [
        'https://example.yale.edu/profile/other-person/',
      ]);
      await seedLead(survivor._id, 'https://example.yale.edu/profile/example-lead');

      await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });
      const stored = await ResearchEntity.findById(survivor._id).lean<{ sourceUrls?: string[] }>();

      expect(stored?.sourceUrls ?? []).not.toContain(
        'https://example.yale.edu/profile/other-person/',
      );
    });
  });

  it('does not pair a loser body with the survivor own card', async () => {
    const survivor = await seedMerge('ysm-faculty-example-lead');
    await seedObservation(
      'example-lead-lab',
      'shortDescription',
      'Studies how hippocampal circuits encode spatial memory in behaving animals.',
    );
    await seedObservation(
      'ysm-faculty-example-lead',
      'fullDescription',
      'The lab studies kidney epithelial ion transport and how its failure drives cyst growth in polycystic kidney disease, using patient-derived organoids and mouse models to test targeted therapies.',
      'ysm-faculty-directory',
      { sourceUrl: 'https://examplelead.yale.edu/' },
    );

    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });
    const stored = await ResearchEntity.findById(survivor._id).lean<{ fullDescription?: string }>();

    expect(stored?.fullDescription ?? '').not.toContain('kidney');
  });

  it('lets a newer same-lane award read on a merged-in key supersede the survivor older one', async () => {
    const survivor = await seedMerge('ysm-faculty-example-lead');
    const grant = (id: string) => ({ id, title: `Synthetic award ${id}`, agency: 'NIH' });
    await seedObservation(
      'example-lead-lab',
      'recentGrants',
      [grant('R01-SURVIVOR')],
      'nih-reporter',
    );
    await seedObservation(
      'ysm-faculty-example-lead',
      'recentGrants',
      [grant('R01-LOSER')],
      'nih-reporter',
      { observedAt: new Date('2026-06-01T00:00:00Z') },
    );

    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });
    const stored = await ResearchEntity.findById(survivor._id).lean<{
      recentGrants?: Array<{ id?: string }>;
    }>();

    expect((stored?.recentGrants ?? []).map((award) => award.id)).toEqual(['R01-LOSER']);
  });

  it('keeps a loser-only clearable field stable across repeated resolves', async () => {
    const survivor = await seedMerge('ysm-faculty-example-lead');
    await seedObservation('ysm-faculty-example-lead', 'methods', ['Calcium imaging']);

    const methodsAfterEachRun: string[][] = [];
    for (let run = 0; run < 3; run++) {
      await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });
      const stored = await ResearchEntity.findById(survivor._id).lean<{ methods?: string[] }>();
      methodsAfterEachRun.push([...(stored?.methods ?? [])]);
    }

    expect(methodsAfterEachRun).toEqual([
      ['Calcium imaging'],
      ['Calcium imaging'],
      ['Calcium imaging'],
    ]);
  });

  it('lets a loser lane update the value it filled on the survivor', async () => {
    const survivor = await seedMerge('ysm-faculty-example-lead');

    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });
    expect((await projectSurvivor(survivor._id)).websiteUrl).toBe('https://examplelead.yale.edu/');

    await Observation.updateMany(
      { entityKey: 'ysm-faculty-example-lead', field: 'websiteUrl' },
      { $set: { superseded: true } },
    );
    await seedObservation(
      'ysm-faculty-example-lead',
      'websiteUrl',
      'https://examplelead-moved.yale.edu/',
      'dept-faculty-roster',
      { observedAt: new Date('2026-06-01T00:00:00Z') },
    );
    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });

    expect((await projectSurvivor(survivor._id)).websiteUrl).toBe(
      'https://examplelead-moved.yale.edu/',
    );
  });

  it('does not let a second loser displace the value another loser filled', async () => {
    const survivor = await seedMerge('ysm-faculty-example-lead');
    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });
    expect((await projectSurvivor(survivor._id)).websiteUrl).toBe('https://examplelead.yale.edu/');

    await ResearchEntity.create({
      slug: 'dept-example-second-roster',
      name: 'Example Lead Second Roster',
      kind: 'individual',
      archived: true,
      canonicalGroupId: survivor._id,
    });
    await seedObservation(
      'dept-example-second-roster',
      'websiteUrl',
      'https://example-program.yale.edu/',
      'dept-faculty-roster',
      { observedAt: new Date('2026-06-01T00:00:00Z') },
    );
    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });

    expect((await projectSurvivor(survivor._id)).websiteUrl).toBe('https://examplelead.yale.edu/');
  });

  it('aggregates grant counts and agencies together with the unioned grants', async () => {
    const survivor = await seedMerge('ysm-faculty-example-lead');
    await seedObservation(
      'example-lead-lab',
      'recentGrants',
      [{ id: 'R01-SURVIVOR', title: 'Synthetic award', agency: 'NIH' }],
      'nih-reporter',
    );
    await seedObservation('example-lead-lab', 'recentGrantCount', 1, 'nih-reporter');
    await seedObservation('example-lead-lab', 'fundingAgencies', ['NIH'], 'nih-reporter');
    await seedObservation(
      'ysm-faculty-example-lead',
      'recentGrants',
      [{ id: 'NSF-LOSER', title: 'Synthetic award', agency: 'NSF' }],
      'nsf-award-search',
    );
    await seedObservation('ysm-faculty-example-lead', 'recentGrantCount', 1, 'nsf-award-search');
    await seedObservation(
      'ysm-faculty-example-lead',
      'fundingAgencies',
      ['NSF'],
      'nsf-award-search',
    );

    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });
    const stored = await ResearchEntity.findById(survivor._id).lean<{
      recentGrants?: Array<{ id?: string }>;
      recentGrantCount?: number;
      fundingAgencies?: string[];
    }>();

    expect((stored?.recentGrants ?? []).map((award) => award.id).sort()).toEqual([
      'NSF-LOSER',
      'R01-SURVIVOR',
    ]);
    expect(stored?.recentGrantCount).toBe(2);
    expect([...(stored?.fundingAgencies ?? [])].sort()).toEqual(['NIH', 'NSF']);
  });

  it('leaves the shell archived and unwritten', async () => {
    await seedMerge('ysm-faculty-example-lead');

    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });

    const shell = await ResearchEntity.findOne({
      slug: 'ysm-faculty-example-lead',
    }).lean<ProjectedSurvivor>();
    expect(shell?.archived).toBe(true);
    expect(shell?.websiteUrl ?? '').toBe('');
  });
});
