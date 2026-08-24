import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { getResearcherProfileByPublicKey } from '../researcherProfileService';

const validPublicDescriptions = {
  shortDescription:
    'Studies molecular dynamics, protein folding, and cellular signaling in biological systems.',
  fullDescription:
    'This research studies molecular dynamics, protein folding, and cellular signaling across complex biological systems.',
};

const seedEntity = async (
  slug: string,
  overrides: Record<string, unknown> = {},
): Promise<mongoose.Types.ObjectId> => {
  const entity = await ResearchEntity.create({
    slug,
    name: slug.replace(/-/g, ' '),
    kind: 'lab',
    studentVisibilityTier: 'student_ready',
    sourceUrls: ['https://example.yale.edu/lab'],
    archived: false,
    ...validPublicDescriptions,
    ...overrides,
  });
  return entity._id as mongoose.Types.ObjectId;
};

const seedRoleAssignment = async (
  personId: mongoose.Types.ObjectId,
  entityId: mongoose.Types.ObjectId,
  overrides: Record<string, unknown> = {},
): Promise<void> => {
  await RoleAssignment.create({
    personId,
    target: { kind: 'RESEARCH_ENTITY', id: entityId },
    role: 'PI',
    state: 'CURRENT',
    confidence: 0.9,
    ...overrides,
  });
};

describe('getResearcherProfileByPublicKey', () => {
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
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['research_entities', 'researchers', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedMultiHomePerson = async (): Promise<{ personId: mongoose.Types.ObjectId }> => {
    const person = await Researcher.create({
      displayName: 'Dr Ada Researcher',
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: 'https://medicine.yale.edu/profile/ada-researcher',
          verifiedAt: new Date('2025-01-01T00:00:00Z'),
          healthStatus: 'HEALTHY',
        },
        {
          kind: 'GOOGLE_SCHOLAR',
          purpose: 'SCHOLARLY',
          url: 'https://scholar.google.com/citations?user=abc123DEF',
          verifiedAt: new Date('2025-01-01T00:00:00Z'),
          healthStatus: 'HEALTHY',
        },
      ],
      profile: { title: 'Professor of Cell Biology', primaryDepartment: 'Cell Biology' },
      status: 'ACTIVE',
      archived: false,
    });
    const labId = await seedEntity('ada-lab', { school: 'School of Medicine' });
    const centerId = await seedEntity('ada-center', { kind: 'center', school: 'School of Medicine' });
    await seedRoleAssignment(person._id as mongoose.Types.ObjectId, labId);
    await seedRoleAssignment(person._id as mongoose.Types.ObjectId, centerId, {
      role: 'DIRECTOR',
    });
    return { personId: person._id as mongoose.Types.ObjectId };
  };

  it('aggregates every student-visible home for a personId-backed key', async () => {
    const { personId } = await seedMultiHomePerson();
    const profile = await getResearcherProfileByPublicKey(`${personId.toHexString()}-pi`);

    expect(profile).not.toBeNull();
    expect(profile?.displayName).toBe('Dr Ada Researcher');
    expect(profile?.title).toBe('Professor of Cell Biology');
    expect(profile?.primaryDepartment).toBe('Cell Biology');
    expect(profile?.school).toBe('School of Medicine');
    expect(profile?.officialProfileUrl).toBe(
      'https://medicine.yale.edu/profile/ada-researcher',
    );
    expect(profile?.scholarUrl).toBe('https://scholar.google.com/citations?user=abc123DEF');
    expect(profile?.homes.map((home) => home.slug).sort()).toEqual(['ada-center', 'ada-lab']);
  });

  it('resolves the same person regardless of the role suffix on the key', async () => {
    const { personId } = await seedMultiHomePerson();
    const viaDirector = await getResearcherProfileByPublicKey(`${personId.toHexString()}-director`);
    expect(viaDirector?.homes).toHaveLength(2);
  });

  it('excludes suppressed and operator-review homes', async () => {
    const person = await Researcher.create({
      displayName: 'Dr Ben Gate',
      profileLinks: [],
      status: 'ACTIVE',
      archived: false,
    });
    const readyId = await seedEntity('ben-ready-lab');
    const hiddenId = await seedEntity('ben-hidden-lab', {
      studentVisibilityTier: 'operator_review',
    });
    await seedRoleAssignment(person._id as mongoose.Types.ObjectId, readyId);
    await seedRoleAssignment(person._id as mongoose.Types.ObjectId, hiddenId, {
      role: 'AFFILIATED',
    });

    const profile = await getResearcherProfileByPublicKey(
      `${(person._id as mongoose.Types.ObjectId).toHexString()}-pi`,
    );
    expect(profile?.homes.map((home) => home.slug)).toEqual(['ben-ready-lab']);
  });

  it('fails closed when the person has no student-visible homes', async () => {
    const person = await Researcher.create({
      displayName: 'Dr Only Hidden',
      profileLinks: [],
      status: 'ACTIVE',
      archived: false,
    });
    const hiddenId = await seedEntity('hidden-only-lab', {
      studentVisibilityTier: 'suppressed',
    });
    await seedRoleAssignment(person._id as mongoose.Types.ObjectId, hiddenId);

    const profile = await getResearcherProfileByPublicKey(
      `${(person._id as mongoose.Types.ObjectId).toHexString()}-pi`,
    );
    expect(profile).toBeNull();
  });

  it('renders a home-less researcher that has a verified primary-identity link', async () => {
    const person = await Researcher.create({
      displayName: 'Dr Homeless Findable',
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: 'https://law.yale.edu/profile/homeless-findable',
          verifiedAt: new Date('2025-01-01T00:00:00Z'),
          healthStatus: 'HEALTHY',
        },
      ],
      status: 'ACTIVE',
      archived: false,
    });

    const profile = await getResearcherProfileByPublicKey(
      `${(person._id as mongoose.Types.ObjectId).toHexString()}-pi`,
    );
    expect(profile).not.toBeNull();
    expect(profile?.displayName).toBe('Dr Homeless Findable');
    expect(profile?.homes).toEqual([]);
    expect(profile?.officialProfileUrl).toBe('https://law.yale.edu/profile/homeless-findable');
  });

  it('fails closed for a DEPARTED researcher even with a student-visible home', async () => {
    const person = await Researcher.create({
      displayName: 'Dr Departed',
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: 'https://medicine.yale.edu/profile/departed',
          verifiedAt: new Date('2025-01-01T00:00:00Z'),
          healthStatus: 'HEALTHY',
        },
      ],
      status: 'DEPARTED',
      archived: false,
    });
    const entityId = await seedEntity('departed-lab');
    await seedRoleAssignment(person._id as mongoose.Types.ObjectId, entityId);

    const profile = await getResearcherProfileByPublicKey(
      `${(person._id as mongoose.Types.ObjectId).toHexString()}-pi`,
    );
    expect(profile).toBeNull();
  });

  it('fails closed for a valid-shaped key with no matching researcher', async () => {
    const orphanId = new mongoose.Types.ObjectId();
    const profile = await getResearcherProfileByPublicKey(`${orphanId.toHexString()}-pi`);
    expect(profile).toBeNull();
  });

  it('fails closed for a display-name-only key with no personId prefix', async () => {
    const profile = await getResearcherProfileByPublicKey('jane-doe-pi');
    expect(profile).toBeNull();
  });

  it('fails closed for an empty key', async () => {
    expect(await getResearcherProfileByPublicKey('')).toBeNull();
  });
});
