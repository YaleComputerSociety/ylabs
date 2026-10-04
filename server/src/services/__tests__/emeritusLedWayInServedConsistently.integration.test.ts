import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../../utils/meiliClient', () => ({
  getMeiliSearchIndex: vi.fn(async () => ({
    search: mocks.search,
    getEmbedders: vi.fn(async () => ({})),
  })),
}));

vi.mock('../meiliSyncService', () => ({
  syncEntities: mocks.syncEntities,
  syncEntity: mocks.syncEntity,
  deleteFromIndex: mocks.deleteFromIndex,
}));

import { getResearchGroupDetail, searchResearchGroupsViaMeili } from '../researchGroupService';

const QUIET_SLUG = 'fixture-emeritus-quiet-lab';
const ACTIVE_SLUG = 'fixture-emeritus-active-lab';
const CO_LED_SLUG = 'fixture-co-led-lab';
const UNDERGRAD_ONLY_SLUG = 'fixture-emeritus-roster-lab';
const RUNNING_AWARD = {
  id: 'R01XX000001',
  agency: 'NIH',
  title: 'Fixture tissue repair award',
  startDate: new Date('2024-07-01T00:00:00Z'),
  endDate: new Date(Date.now() + 400 * 86_400_000),
  role: 'pi',
};
const WAY_IN_TYPES = ['APPLICATION_FORM_EXISTS'];
const RECENT = new Date(Date.now() - 20 * 86_400_000);

interface LeadSeed {
  key: string;
  displayName: string;
  title: string;
}

const entityIdBySlug = new Map<string, mongoose.Types.ObjectId>();

const seedRow = async (
  slug: string,
  leads: LeadSeed[],
  extraSignalTypes: string[] = [],
  extraFields: Record<string, unknown> = {},
) => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db');
  const entityId = new mongoose.Types.ObjectId();
  entityIdBySlug.set(slug, entityId);
  const siteUrl = `https://${slug}.example.edu/`;
  await db.collection('research_entities').insertOne({
    _id: entityId,
    slug,
    name: `Fixture ${slug.split('-')[2]} Tissue Repair Lab`,
    kind: 'lab',
    entityType: 'LAB',
    archived: false,
    departments: ['Pathology'],
    researchAreas: ['Tissue Repair'],
    studentVisibilityTier: 'student_ready',
    studentVisibilityReasons: ['source_backed_description'],
    shortDescription: 'The lab studies how example tissues repair after injury.',
    fullDescription:
      'The lab studies how example tissues repair after injury, combining imaging, genetics and computational modelling of cell behaviour.',
    websiteUrl: siteUrl,
    sourceUrls: [siteUrl],
    ...extraFields,
  });
  for (const lead of leads) {
    const accountId = new mongoose.Types.ObjectId();
    await db.collection('accounts').insertOne({
      _id: accountId,
      netid: `fx${lead.key}`,
      email: `fixture.${lead.key}@yale.edu`,
    });
    const personId = new mongoose.Types.ObjectId();
    await db.collection('researchers').insertOne({
      _id: personId,
      displayName: lead.displayName,
      accountId,
      profile: { title: lead.title },
      archived: false,
    });
    await db.collection('role_assignments').insertOne({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state: 'CURRENT',
      archived: false,
      verifiedAt: new Date(),
      source: { name: 'fixture-faculty', url: siteUrl },
    });
  }
  const evidence = (field: string, value: unknown) => ({
    _id: new mongoose.Types.ObjectId(),
    entityType: 'researchEntity',
    entityKey: slug,
    field,
    value,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: 'lab-microsite-undergrad-llm',
    sourceUrl: siteUrl,
    confidence: 0.5,
    observedAt: RECENT,
    superseded: false,
  });
  // #4430 serves these two types only while the row's own evidence still derives them, so a
  // fixture that seeds the signal must seed the observation it derives from.
  const joinPage = evidence('joinPageUrl', `${siteUrl}join`);
  const undergradCount = evidence(
    'currentUndergradCount',
    typeof extraFields.currentUndergradCount === 'number' ? extraFields.currentUndergradCount : 2,
  );
  await db.collection('observations').insertMany([
    evidence('undergradAccessEvidence', {
      openToUndergrads: 'yes',
      evidenceQuote: 'Undergraduates are welcome to apply.',
    }),
    joinPage,
    undergradCount,
  ]);
  const derivedSource: Record<
    string,
    { derivationKey: string; excerpt: string; evidenceId: unknown }
  > = {
    APPLICATION_FORM_EXISTS: {
      derivationKey: 'signal:APPLICATION_FORM_EXISTS:JOIN_PAGE',
      excerpt: 'A join, opportunities, or application page was found.',
      evidenceId: joinPage._id,
    },
    CURRENT_UNDERGRADS: {
      derivationKey: 'signal:CURRENT_UNDERGRADS',
      excerpt: `${undergradCount.value} current undergraduate(s) listed`,
      evidenceId: undergradCount._id,
    },
  };
  const signalTypes = [...WAY_IN_TYPES, 'PAST_UNDERGRADS', ...extraSignalTypes];
  await db.collection('signals').insertMany(
    signalTypes.map((type) => {
      const derived = derivedSource[type];
      return {
        _id: new mongoose.Types.ObjectId(),
        researchEntityId: entityId,
        type,
        ...(derived ? { derivationKey: derived.derivationKey } : {}),
        archived: false,
        confidence: 'HIGH',
        observedAt: RECENT,
        source: derived
          ? { url: siteUrl, excerpt: derived.excerpt, evidenceIds: [derived.evidenceId] }
          : { url: `${siteUrl}${type.toLowerCase()}/`, excerpt: `Fixture ${type} excerpt.` },
      };
    }),
  );
};

const browseCardFor = async (slug: string) => {
  const entityId = entityIdBySlug.get(slug);
  if (!entityId) throw new Error(`no seeded entity for ${slug}`);
  mocks.search.mockReset();
  mocks.search.mockResolvedValue({
    hits: [{ id: entityId.toString() }],
    estimatedTotalHits: 1,
    totalHits: 1,
  });
  const result = await searchResearchGroupsViaMeili('tissue repair', {}, 1, 24);
  return result.researchEntities.find((entity: any) => entity.slug === slug) as
    Record<string, any> | undefined;
};

const servedFlags = (entity: Record<string, any> | undefined) => ({
  emeritusLed: entity?.emeritusLed,
  wayInWithheld: entity?.wayInWithheld,
});

describe('an emeritus-led row is labelled and claims no way in without current activity (#4431)', () => {
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
    for (const name of [
      'research_entities',
      'role_assignments',
      'researchers',
      'accounts',
      'signals',
    ]) {
      await db.collection(name).deleteMany({});
    }
    entityIdBySlug.clear();
    await seedRow(QUIET_SLUG, [
      { key: 'quiet', displayName: 'Avery Quietfield', title: 'Professor Emeritus of Pathology' },
    ]);
    await seedRow(
      ACTIVE_SLUG,
      [
        {
          key: 'active',
          displayName: 'Blair Activewood',
          title: 'Professor of Pathology, Emerita',
        },
      ],
      [],
      { recentGrants: [RUNNING_AWARD], recentGrantCount: 1 },
    );
    await seedRow(
      UNDERGRAD_ONLY_SLUG,
      [{ key: 'roster', displayName: 'Emery Rosterly', title: 'Professor Emeritus of Pathology' }],
      ['CURRENT_UNDERGRADS'],
      { currentUndergradCount: 2 },
    );
    await seedRow(CO_LED_SLUG, [
      { key: 'coemer', displayName: 'Casey Oldbrook', title: 'Professor Emeritus of Pathology' },
      { key: 'coactive', displayName: 'Devon Newbrook', title: 'Professor of Pathology' },
    ]);
  });

  it('withholds every way-in signal and the lead email on the detail page when nothing shows current activity', async () => {
    const detail = await getResearchGroupDetail(QUIET_SLUG);

    expect(servedFlags(detail?.researchEntity)).toEqual({ emeritusLed: true, wayInWithheld: true });
    expect(detail?.accessSignals.map((signal: any) => signal.signalType)).toEqual([
      'PAST_UNDERGRADS',
    ]);
    const lead = detail?.members.find((member: any) => member.role === 'pi');
    expect(lead?.user.emeritus).toBe(true);
    expect(lead?.user.email).toBeUndefined();
    expect(JSON.stringify(detail)).not.toContain('fixture.quiet@yale.edu');
  }, 60000);

  it('keeps the way in for an emeritus-led row with a running research award', async () => {
    const detail = await getResearchGroupDetail(ACTIVE_SLUG);

    expect(servedFlags(detail?.researchEntity)).toEqual({
      emeritusLed: true,
      wayInWithheld: undefined,
    });
    expect(detail?.accessSignals.map((signal: any) => signal.signalType).sort()).toEqual(
      [...WAY_IN_TYPES, 'PAST_UNDERGRADS'].sort(),
    );
    const lead = detail?.members.find((member: any) => member.role === 'pi');
    expect(lead?.user.emeritus).toBe(true);
    expect(lead?.user.email).toBe('fixture.active@yale.edu');
  }, 60000);

  it('still withholds when the only current evidence is an undergraduate signal or count', async () => {
    const detail = await getResearchGroupDetail(UNDERGRAD_ONLY_SLUG);

    expect(servedFlags(detail?.researchEntity)).toEqual({ emeritusLed: true, wayInWithheld: true });
    expect(detail?.accessSignals.map((signal: any) => signal.signalType).sort()).toEqual([
      'CURRENT_UNDERGRADS',
      'PAST_UNDERGRADS',
    ]);
  }, 60000);

  it('does not treat a row co-led by an active lead as emeritus-led, and labels only the emeritus person', async () => {
    const detail = await getResearchGroupDetail(CO_LED_SLUG);

    expect(servedFlags(detail?.researchEntity)).toEqual({
      emeritusLed: undefined,
      wayInWithheld: undefined,
    });
    expect(
      detail?.accessSignals.filter((signal: any) => WAY_IN_TYPES.includes(signal.signalType)),
    ).toHaveLength(1);
    const emeritusByName = Object.fromEntries(
      (detail?.members ?? []).map((member: any) => [member.user.displayName, member.user.emeritus]),
    );
    expect(emeritusByName).toEqual({ 'Casey Oldbrook': true, 'Devon Newbrook': undefined });
  }, 60000);

  it.each([QUIET_SLUG, ACTIVE_SLUG, UNDERGRAD_ONLY_SLUG, CO_LED_SLUG])(
    'serves the same label and way-in decision on the browse card as on the detail page for %s',
    async (slug) => {
      const card = await browseCardFor(slug);
      const detail = await getResearchGroupDetail(slug);

      expect(card).toBeDefined();
      expect(servedFlags(card)).toEqual(servedFlags(detail?.researchEntity));
      expect(card?.planningContext).toBeUndefined();
      expect(JSON.stringify(card)).not.toMatch(/@yale\.edu/);
    },
    60000,
  );
});
