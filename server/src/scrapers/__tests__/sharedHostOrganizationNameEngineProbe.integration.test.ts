/**
 * The stored half of #2360. An umbrella laboratory that calls itself a Lab clears
 * every name-axis rule the corpus has: "Computer Systems Lab at Yale" names a
 * 13-faculty cross-department laboratory and "Yale NLP Lab" names one person's
 * group, and as strings harvested from the same faculty-directory page shape they
 * are indistinguishable. Three name-axis fixes were measured on the issue and all
 * three cost more correct names than they recovered.
 *
 * The shared academic host the row cites is the evidence the name lacks. These
 * cases pin the engine half: the materializer refuses the host organization's name
 * on one of its members, and once the graft assertion is gone the row keeps its own
 * name across repeated passes rather than needing the repair run again.
 *
 * Measured on Development: over 4,744 live rows the arm flags 1, that 1 is the row
 * the issue reports, and no organization-shaped row naming a host it cites is
 * touched.
 */
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { materializeEntity } from '../entityMaterializer';

const ENTITY_KEY = 'nih-pi-quilla-marrowbane';
const DIRECTORY_URL =
  'https://engineering.yale.edu/research-and-faculty/faculty-directory/quilla-marrowbane/';
const SHARED_HOST_ROOT = 'https://csl.yale.edu/';
const SHARED_HOST_TENANT_PAGE = 'https://csl.yale.edu/~quilla/';
const HOST_ORGANIZATION_NAME = 'Computer Systems Lab at Yale';
const OWN_LAB_NAME = 'Quilla Marrowbane Lab';

const seedNameObservation = async (
  value: string,
  sourceName: string,
  confidence: number,
  sourceUrl = DIRECTORY_URL,
): Promise<void> => {
  for (const field of ['name', 'displayName']) {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: ENTITY_KEY,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl,
      confidence,
      observedAt: new Date('2026-08-22T00:00:00Z'),
      superseded: false,
    });
  }
};

const storedNames = async (slug = ENTITY_KEY): Promise<{ name?: string; displayName?: string }> => {
  const doc = (await ResearchEntity.findOne({ slug }).lean()) as {
    name?: string;
    displayName?: string;
  } | null;
  return { name: doc?.name, displayName: doc?.displayName };
};

describe('a shared academic host organization name never survives on one of its members (#2360)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 120000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'researchers', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedRowServingTheGraft = async (
    citedHostUrl = SHARED_HOST_ROOT,
    graftedName = HOST_ORGANIZATION_NAME,
  ): Promise<void> => {
    await ResearchEntity.create({
      slug: ENTITY_KEY,
      name: graftedName,
      displayName: graftedName,
      entityType: 'LAB',
      kind: 'lab',
      websiteUrl: citedHostUrl,
      sourceUrls: [DIRECTORY_URL, citedHostUrl],
      studentVisibilityTier: 'student_ready',
    });
  };

  it('never lets the host organization name be the display name a card prefers', async () => {
    await seedRowServingTheGraft();
    await seedNameObservation(HOST_ORGANIZATION_NAME, 'lab-microsite-description-llm', 0.95);

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});

    // `displayName` is the field every client prefers over `name`, and withholding it
    // is always safe because they all fall back to `name`. Removing the graft from
    // `name` itself takes retiring the assertion, which is the repair's job, and the
    // case below pins that the engine then keeps the correction.
    expect((await storedNames()).displayName).not.toBe(HOST_ORGANIZATION_NAME);
  });

  it('refuses a name carrying the host label verbatim on a member tenant page', async () => {
    const labelBearingName = 'CSL Circuits Group';
    await seedRowServingTheGraft(SHARED_HOST_TENANT_PAGE, labelBearingName);
    await seedNameObservation(labelBearingName, 'lab-microsite-description-llm', 0.95);

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});

    // A `~user` page is the member's own research home, which is why the resolver
    // keeps serving it. Whose page it is does not make the host organization's name
    // the member's, so a name that carries the host label among its own words is
    // refused on the tenant page as well as the root.
    expect((await storedNames()).displayName).not.toBe(labelBearingName);
  });

  it('keeps a member lab whose initials merely collide with the host label', async () => {
    // The inverse of the #2360 error, and the reason the initials match is read on a
    // citation of the host ROOT alone: three letters are a coincidence a member's own
    // lab in the host's own field can reach, and holding such a row takes a correct
    // research home off every student surface.
    const collidingName = 'Cell Signaling Lab';
    await seedRowServingTheGraft(SHARED_HOST_TENANT_PAGE, collidingName);
    await seedNameObservation(collidingName, 'lab-microsite-description-llm', 0.95);

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});

    expect(await storedNames()).toMatchObject({
      name: collidingName,
      displayName: collidingName,
    });
  });

  it('keeps the row own name once the graft assertion is retired', async () => {
    await seedRowServingTheGraft();
    await seedNameObservation(OWN_LAB_NAME, 'nih-reporter', 0.9, 'https://reporter.nih.gov/x');

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});
    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});

    expect(await storedNames()).toMatchObject({
      name: OWN_LAB_NAME,
      displayName: OWN_LAB_NAME,
    });
  });

  it('leaves a member own lab name on the same shared host alone', async () => {
    const ownName = 'Analog and RF Circuits Lab at Yale';
    await ResearchEntity.create({
      slug: ENTITY_KEY,
      name: ownName,
      displayName: ownName,
      entityType: 'LAB',
      kind: 'lab',
      websiteUrl: SHARED_HOST_TENANT_PAGE,
      sourceUrls: [DIRECTORY_URL, SHARED_HOST_TENANT_PAGE],
      studentVisibilityTier: 'student_ready',
    });
    await seedNameObservation(ownName, 'lab-microsite-description-llm', 0.95);

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});

    // This is the row every name-axis candidate on #2360 regressed: a real lab whose
    // name carries neither its PI's surname nor the host's, living on the same shared
    // host as the umbrella. It must be untouched, and it is, because it does not name
    // the host.
    expect(await storedNames()).toMatchObject({ name: ownName, displayName: ownName });
  });

  it('leaves the host organization own record naming itself', async () => {
    const organizationSlug = 'computer-systems-lab-at-yale';
    await ResearchEntity.create({
      slug: organizationSlug,
      name: HOST_ORGANIZATION_NAME,
      displayName: HOST_ORGANIZATION_NAME,
      entityType: 'CENTER',
      kind: 'center',
      websiteUrl: SHARED_HOST_ROOT,
      sourceUrls: [SHARED_HOST_ROOT],
      studentVisibilityTier: 'student_ready',
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: organizationSlug,
      field: 'displayName',
      value: HOST_ORGANIZATION_NAME,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: SHARED_HOST_ROOT,
      confidence: 0.95,
      observedAt: new Date('2026-08-22T00:00:00Z'),
      superseded: false,
    });

    await materializeEntity('researchEntity', { entityKey: organizationSlug }, {});

    expect(await storedNames(organizationSlug)).toMatchObject({
      name: HOST_ORGANIZATION_NAME,
      displayName: HOST_ORGANIZATION_NAME,
    });
  });
});
