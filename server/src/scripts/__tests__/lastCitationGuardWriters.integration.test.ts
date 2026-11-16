import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: vi.fn().mockResolvedValue(true),
    deleteFromIndex: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../scrapers/entityMaterializer', async (importActual) => ({
  ...(await importActual<typeof import('../../scrapers/entityMaterializer')>()),
  materializeEntity: vi.fn(async () => ({})),
}));

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { clearDeadLabHomes } from '../clearDeadLabResearchHomes';
import { planDeadWebsiteClearUpdateKeepingLastCitation } from '../clearDeadResearchWebsitesCore';
import { runClearStaleRefusalProvenance } from '../clearStaleRefusalProvenance';
import { applyPlans as applyDeadCitationDrops } from '../dropSupersededDeadCitations';
import { runLabBrandedNameTypeBackfill } from '../labBrandedNameTypeBackfill';
import { planRefuseFieldValueWrite } from '../refuseResearchEntityFieldValue';
import { staleProvenanceUnset } from '../refusedFieldProvenance';
import { retireSiteGraftFromHolder, type RetargetRow } from '../retargetForeignLabWebsites';
import { writeRetireBorrowedLabWebsitesPlan } from '../retireBorrowedLabWebsites';
import { applyRepair as retireGraftedDirectoryUrls } from '../retireGraftedDirectoryUrls';
import { clearStoredListingItemAreas } from '../retireListingItemResearchAreas';
import {
  applyRepair as retireOrganizationIdentityWebsites,
  type PlannedRow as OrganizationIdentityPlannedRow,
} from '../retireOrganizationIdentityWebsiteGrafts';
import { writeRetireSharedRosterWebsitesPlan } from '../retireSharedRosterWebsites';
import { applyStrips as stripDirectoryLoaderSourceUrls } from '../stripDirectoryLoaderSourceUrls';
import { updateOneKeepingLastCitation } from '../../services/lastCitationGuard';
import { applyRetirement as retireStaleLaunchOverrides } from '../retireStaleLaunchSuppressionOverrides';
import { planFieldValueRefusal } from '../../utils/researchEntityFieldValueRefusals';

const SLUG = 'synthetic-last-citation-row';
const DIRECTORY_LOADER_CITATION = 'https://example.edu/synthetic-directory-loader/';
const ONLY_CITATION = 'https://example.edu/synthetic-gone-page/';
const LIVE_ELSEWHERE = 'https://example.edu/synthetic-live-page/';

const stamp = (sourceUrl = ONLY_CITATION, extra: Record<string, unknown> = {}) => ({
  sourceName: 'synthetic-lane',
  sourceUrl,
  ...extra,
});

describe('writers keep a row last citation stamp and still clear the value (#6320)', () => {
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
    for (const name of ['research_entities', 'observations', 'role_assignments']) {
      await mongoose.connection.db?.collection(name).deleteMany({});
    }
  });

  const seedRow = async (fields: Record<string, unknown>) => {
    const _id = new mongoose.Types.ObjectId();
    await mongoose.connection.db!.collection('research_entities').insertOne({
      _id,
      slug: SLUG,
      name: 'Synthetic Last Citation Research',
      entityType: 'LAB',
      archived: false,
      sourceUrls: [],
      manuallyLockedFields: [],
      studentVisibilityTier: 'student_ready',
      ...fields,
    });
    return _id;
  };

  const stored = async () =>
    (await mongoose.connection
      .db!.collection('research_entities')
      .findOne({ slug: SLUG })) as Record<string, any>;

  it('retireStaleLaunchSuppressionOverrides keeps the override stamp of a row it releases', async () => {
    const _id = await seedRow({
      studentVisibilityOverrideTier: 'suppressed',
      studentVisibilitySuppressionReason: 'synthetic launch hold',
      fieldProvenance: { studentVisibilityOverrideTier: stamp() },
    });

    const result = await retireStaleLaunchOverrides([{ entityId: String(_id) }], []);

    const after = await stored();
    expect(result.lastCitationStampsKept).toBe(1);
    expect(after.studentVisibilityOverrideTier).toBeUndefined();
    expect(after.fieldProvenance.studentVisibilityOverrideTier.sourceUrl).toBe(ONLY_CITATION);
  });

  it('clearStaleRefusalProvenance keeps the stamp a served row has nothing else to cite by', async () => {
    const refused = await Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      field: 'websiteUrl',
      value: ONLY_CITATION,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'synthetic-lane',
      sourceUrl: ONLY_CITATION,
      confidence: 0.9,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });
    await seedRow({
      fieldProvenance: { websiteUrl: stamp(ONLY_CITATION, { observationId: refused._id }) },
      fieldValueRefusals: {
        websiteUrl: planFieldValueRefusal(undefined, {
          field: 'websiteUrl',
          value: ONLY_CITATION,
          rule: 'wrong_owner',
          refusedBy: 'synthetic reviewer',
          note: 'synthetic refusal',
          refusedAt: new Date('2026-01-02T00:00:00Z'),
        })['fieldValueRefusals.websiteUrl'],
      },
    });

    const result = await runClearStaleRefusalProvenance({ apply: true });

    expect(result.lastCitationStampsKept).toBe(1);
    expect(result.unset).toBe(0);
    expect((await stored()).fieldProvenance.websiteUrl.sourceUrl).toBe(ONLY_CITATION);
  });

  it('the refusal CLI clears the refused value and keeps its stamp', async () => {
    const row = {
      _id: new mongoose.Types.ObjectId(),
      slug: SLUG,
      websiteUrl: ONLY_CITATION,
      sourceUrls: [],
      studentVisibilityTier: 'student_ready',
      fieldProvenance: { websiteUrl: stamp() },
    };
    const plan = await planRefuseFieldValueWrite(row, {
      field: 'websiteUrl',
      value: ONLY_CITATION,
      rule: 'wrong_owner',
      note: 'synthetic refusal',
      withdraw: false,
    });
    expect(plan.write.$unset).toEqual({ websiteUrl: '' });
    expect(plan.lastCitationRemovalsWithheld).toEqual(['fieldProvenance.websiteUrl']);
  });

  it('staleProvenanceUnset, the vanity repoint core, keeps the last stamp', async () => {
    const row = {
      websiteUrl: ONLY_CITATION,
      sourceUrls: [],
      studentVisibilityTier: 'student_ready',
      fieldProvenance: { websiteUrl: stamp() },
    };
    expect(await staleProvenanceUnset(row, { websiteUrl: LIVE_ELSEWHERE })).toEqual({
      unset: {},
      withheld: ['fieldProvenance.websiteUrl'],
    });
    expect(
      await staleProvenanceUnset(
        row,
        { websiteUrl: LIVE_ELSEWHERE },
        { sourceUrls: [LIVE_ELSEWHERE] },
      ),
    ).toEqual({ unset: { 'fieldProvenance.websiteUrl': '' }, withheld: [] });
  });

  it('dropSupersededDeadCitations keeps the stamp when its write would leave nothing cited', async () => {
    await seedRow({ websiteUrl: ONLY_CITATION, fieldProvenance: { websiteUrl: stamp() } });

    const result = await applyDeadCitationDrops([
      {
        entitySlug: SLUG,
        droppedUrls: [],
        keptUrls: [],
        clearsWebsiteUrl: true,
        websiteUrl: ONLY_CITATION,
      },
    ]);

    const after = await stored();
    expect(result.lastCitationStampsKept).toBe(1);
    expect(after.websiteUrl).toBeUndefined();
    expect(after.fieldProvenance.websiteUrl.sourceUrl).toBe(ONLY_CITATION);
  });

  it('clearDeadResearchWebsites keeps the dead website stamp of a served row it clears', () => {
    const { update, withheld } = planDeadWebsiteClearUpdateKeepingLastCitation(
      {
        slug: SLUG,
        websiteUrl: ONLY_CITATION,
        sourceUrls: [],
        studentVisibilityTier: 'student_ready',
        fieldProvenance: { websiteUrl: stamp() },
      } as never,
      [{ slug: SLUG, field: 'websiteUrl', url: ONLY_CITATION, liveCitationsRemaining: 0 }],
      new Date('2026-11-16T00:00:00Z'),
    );
    expect(update.$set.websiteUrl).toBe('');
    expect(update.$unset).toBeUndefined();
    expect(withheld).toEqual(['fieldProvenance.websiteUrl']);
  });

  it('retireGraftedDirectoryUrls keeps the stamp and the citation list it would have emptied', async () => {
    const _id = await seedRow({
      websiteUrl: ONLY_CITATION,
      sourceUrls: [ONLY_CITATION],
      fieldProvenance: { websiteUrl: stamp() },
    });

    const result = await retireGraftedDirectoryUrls(
      [
        {
          entityId: String(_id),
          slug: SLUG,
          plan: {
            clearWebsiteUrl: true,
            retiredWebsiteUrl: ONLY_CITATION,
            nextSourceUrls: [],
            removedSourceUrls: [ONLY_CITATION],
          },
          leavesNoCitation: true,
        },
      ],
      [],
    );

    const after = await stored();
    expect(result.lastCitationStampsKept).toBe(1);
    expect(after.websiteUrl).toBeUndefined();
    expect(after.sourceUrls).toEqual([]);
    expect(after.fieldProvenance.websiteUrl.sourceUrl).toBe(ONLY_CITATION);
  });

  it('retireListingItemResearchAreas clears the areas and keeps their only stamp', async () => {
    const _id = await seedRow({
      researchAreas: ['Synthetic Topic'],
      fieldProvenance: { researchAreas: stamp() },
    });

    const result = await clearStoredListingItemAreas({
      entityId: String(_id),
      assertedAreas: ['Synthetic Topic'],
    });

    const after = await stored();
    expect(result.withheld).toEqual(['fieldProvenance.researchAreas']);
    expect(after.researchAreas).toEqual([]);
    expect(after.fieldProvenance.researchAreas.sourceUrl).toBe(ONLY_CITATION);
  });

  it('clearDeadLabResearchHomes clears the website and keeps its only stamp', async () => {
    const _id = await seedRow({
      websiteUrl: ONLY_CITATION,
      fieldProvenance: { websiteUrl: stamp() },
    });

    const result = await clearDeadLabHomes([{ entityId: String(_id) }]);

    const after = await stored();
    expect(result).toEqual({ cleared: 1, lastCitationStampsKept: 1 });
    expect(after.websiteUrl).toBeUndefined();
    expect(after.fieldProvenance.websiteUrl.sourceUrl).toBe(ONLY_CITATION);
  });

  for (const [label, write] of [
    ['retireBorrowedLabWebsites', writeRetireBorrowedLabWebsitesPlan],
    ['retireSharedRosterWebsites', writeRetireSharedRosterWebsitesPlan],
  ] as const) {
    it(`${label} clears the website and keeps its only stamp`, async () => {
      const _id = await seedRow({
        websiteUrl: ONLY_CITATION,
        fieldProvenance: { websiteUrl: stamp() },
      });

      const result = await write({
        entityId: String(_id),
        url: ONLY_CITATION,
        sourceName: 'synthetic-lane',
        refuse: false,
        clearStored: true,
      });

      const after = await stored();
      expect(result.withheld).toEqual(['fieldProvenance.websiteUrl']);
      expect(after.websiteUrl).toBeUndefined();
      expect(after.fieldProvenance.websiteUrl.sourceUrl).toBe(ONLY_CITATION);
    });
  }

  it('retireOrganizationIdentityWebsiteGrafts clears the website and keeps its only stamp', async () => {
    const _id = await seedRow({
      websiteUrl: ONLY_CITATION,
      fieldProvenance: { websiteUrl: stamp() },
    });
    const row: OrganizationIdentityPlannedRow = {
      entityId: String(_id),
      slug: SLUG,
      storedWebsiteUrl: ONLY_CITATION,
      manuallyLockedFields: [],
      fieldValueRefusals: undefined,
      plan: {
        graftedWebsiteUrl: ONLY_CITATION,
        ownerSlug: 'synthetic-owner',
        ownerEntityType: 'CENTER',
        resolvedPageKey: 'example.edu/synthetic-gone-page',
      },
    };

    const result = await retireOrganizationIdentityWebsites([row], [], []);

    const after = await stored();
    expect(result.lastCitationStampsKept).toBe(1);
    expect(after.websiteUrl).toBeUndefined();
    expect(after.fieldProvenance.websiteUrl.sourceUrl).toBe(ONLY_CITATION);
  });

  it('retargetForeignLabWebsites clears a site-grafted field and keeps its only stamp', async () => {
    const siteUrl = 'https://synthetic-foreign-lab.example.org/';
    await seedRow({
      methods: 'Synthetic grafted methods text.',
      fieldProvenance: { methods: stamp(siteUrl) },
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      field: 'methods',
      value: 'Synthetic grafted methods text.',
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'synthetic-lane',
      sourceUrl: siteUrl,
      confidence: 0.9,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });

    const result = await retireSiteGraftFromHolder({
      websiteUrl: siteUrl,
      holderSlug: SLUG,
      slotNames: [],
      manuallyLockedFields: [],
    } as unknown as RetargetRow);

    const after = await stored();
    expect(result.lastCitationStampsKept).toBe(1);
    expect(after.methods).toBeUndefined();
    expect(after.fieldProvenance.methods.sourceUrl).toBe(siteUrl);
  });

  it('labBrandedNameTypeBackfill clears the grafted displayName and keeps its only stamp', async () => {
    const directoryProfile = 'https://environment.example.edu/directory/faculty/synthetic-person';
    const brand = 'Synthetic Person Lab';
    const _id = await seedRow({
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      name: brand,
      displayName: brand,
      websiteUrl: '',
      fieldProvenance: { displayName: stamp(directoryProfile) },
    });
    for (const field of ['name', 'displayName']) {
      await Observation.create({
        entityType: 'researchEntity',
        entityId: _id,
        entityKey: SLUG,
        field,
        value: brand,
        sourceId: new mongoose.Types.ObjectId(),
        sourceName: 'lab-microsite-description-llm',
        sourceUrl: directoryProfile,
        confidence: 0.95,
        observedAt: new Date('2026-08-22T04:00:00.000Z'),
        superseded: false,
      });
    }

    const result = await runLabBrandedNameTypeBackfill({ dryRun: false });

    const after = await stored();
    expect(result.lastCitationStampsKept).toBe(1);
    expect(after.displayName).toBeUndefined();
    expect(after.fieldProvenance.displayName.sourceUrl).toBe(directoryProfile);
  });

  it('stripDirectoryLoaderSourceUrls keeps the directory-loader citation a served row has nothing else to cite by', async () => {
    const _id = await seedRow({ sourceUrls: [DIRECTORY_LOADER_CITATION] });

    const result = await stripDirectoryLoaderSourceUrls([
      {
        researchEntityId: String(_id),
        label: SLUG,
        removed: [DIRECTORY_LOADER_CITATION],
        remainingCount: 0,
      },
    ]);

    expect(result.lastCitationsKept).toBe(1);
    expect((await stored()).sourceUrls).toEqual([DIRECTORY_LOADER_CITATION]);
  });

  it('a conditional write whose filter no longer matches reports nothing kept', async () => {
    await seedRow({ websiteUrl: ONLY_CITATION, fieldProvenance: { websiteUrl: stamp() } });

    const result = await updateOneKeepingLastCitation(
      ResearchEntity,
      { slug: SLUG, websiteUrl: LIVE_ELSEWHERE },
      { $unset: { websiteUrl: '', 'fieldProvenance.websiteUrl': '' } },
    );

    expect(result).toEqual({ modifiedCount: 0, withheld: [] });
    expect((await stored()).fieldProvenance.websiteUrl.sourceUrl).toBe(ONLY_CITATION);
  });

  it('a row whose citations change between the read and the write is left alone', async () => {
    await seedRow({
      websiteUrl: ONLY_CITATION,
      sourceUrls: [LIVE_ELSEWHERE],
      fieldProvenance: { websiteUrl: stamp() },
    });
    const concurrentWriterDropsTheOtherCitation = {
      findOne: (filter: Record<string, unknown>) => {
        const query = ResearchEntity.findOne(filter);
        const lean = query.lean.bind(query);
        return Object.assign(query, {
          lean: async () => {
            const read = await lean();
            await mongoose.connection
              .db!.collection('research_entities')
              .updateOne({ slug: SLUG }, { $set: { sourceUrls: [] } });
            return read;
          },
        });
      },
      updateOne: ResearchEntity.updateOne.bind(ResearchEntity),
    } as unknown as typeof ResearchEntity;

    const result = await updateOneKeepingLastCitation(
      concurrentWriterDropsTheOtherCitation,
      { slug: SLUG },
      { $unset: { websiteUrl: '', 'fieldProvenance.websiteUrl': '' } },
    );

    expect(result).toEqual({ modifiedCount: 0, withheld: [] });
    const after = await stored();
    expect(after.websiteUrl).toBe(ONLY_CITATION);
    expect(after.fieldProvenance.websiteUrl.sourceUrl).toBe(ONLY_CITATION);
  });

  it('a row whose citations are still as read takes the write', async () => {
    await seedRow({
      websiteUrl: ONLY_CITATION,
      sourceUrls: [LIVE_ELSEWHERE],
      fieldProvenance: { websiteUrl: stamp(), name: stamp(LIVE_ELSEWHERE) },
      studentVisibilityOverrideTier: 'student_ready',
    });

    const result = await updateOneKeepingLastCitation(
      ResearchEntity,
      { slug: SLUG },
      { $unset: { websiteUrl: '', 'fieldProvenance.websiteUrl': '' } },
    );

    expect(result).toEqual({ modifiedCount: 1, withheld: [] });
    const after = await stored();
    expect(after.websiteUrl).toBeUndefined();
    expect(after.fieldProvenance.websiteUrl).toBeUndefined();
  });

  it('a row held on its dead citation keeps the stamp, so the re-gate that follows still holds it', async () => {
    const _id = await seedRow({
      studentVisibilityTier: 'operator_review',
      websiteUrl: ONLY_CITATION,
      fieldProvenance: { websiteUrl: stamp() },
    });

    const result = await clearDeadLabHomes([{ entityId: String(_id) }]);

    const after = await stored();
    expect(result.lastCitationStampsKept).toBe(1);
    expect(after.websiteUrl).toBeUndefined();
    expect(after.fieldProvenance.websiteUrl.sourceUrl).toBe(ONLY_CITATION);
  });

  it('a row with another citation loses the stamp as before', async () => {
    const _id = await seedRow({
      websiteUrl: ONLY_CITATION,
      sourceUrls: [LIVE_ELSEWHERE],
      fieldProvenance: { websiteUrl: stamp() },
    });

    await clearDeadLabHomes([{ entityId: String(_id) }]);

    expect(
      (await ResearchEntity.findById(_id).lean())?.fieldProvenance?.websiteUrl,
    ).toBeUndefined();
  });
});
