import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { ResearchEntity } from '../../models/researchEntity';
import { RoleAssignment } from '../../models/roleAssignment';
import { resetKnownPersonSurnameRosterCache } from '../../utils/researchHomeNameIdentityRoster';
import {
  materializeInferredPiMembership,
  userEntityKeyForInferredPiUserKey,
} from '../entityMaterializer';

describe('userEntityKeyForInferredPiUserKey', () => {
  it('reads a bare roster alias and a Yale email as the netid user key', () => {
    expect(userEntityKeyForInferredPiUserKey('Tamsin.Quorvale')).toBe('netid:tamsin.quorvale');
    expect(userEntityKeyForInferredPiUserKey('tamsin.quorvale1@yale.edu')).toBe(
      'netid:tamsin.quorvale1',
    );
    expect(userEntityKeyForInferredPiUserKey('tq417@med.yale.edu')).toBe('netid:tq417');
  });

  it('leaves a namespaced key and a non-Yale address as stored', () => {
    expect(userEntityKeyForInferredPiUserKey('ysm:tamsin-quorvale')).toBe('ysm:tamsin-quorvale');
    expect(userEntityKeyForInferredPiUserKey('netid:tq417')).toBe('netid:tq417');
    expect(userEntityKeyForInferredPiUserKey('tq@example.com')).toBe('tq@example.com');
  });
});

describe('materializeInferredPiMembership follows the user identity join', () => {
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
    for (const name of ['researchers', 'role_assignments', 'research_entities', 'observations']) {
      await db.collection(name).deleteMany({});
    }
    resetKnownPersonSurnameRosterCache();
  });

  const seedEntity = async (slug: string, name: string) =>
    ResearchEntity.create({
      slug,
      name,
      kind: 'lab',
      studentVisibilityTier: 'operator_review',
      archived: false,
    });

  const seedResearcher = async (displayName: string, title: string) =>
    Researcher.create({
      schemaVersion: 1,
      displayName,
      profile: { title },
      status: 'ACTIVE',
      archived: false,
    });

  const seedUserName = async (entityKey: string, fname: string, lname: string) => {
    for (const [field, value] of [
      ['fname', fname],
      ['lname', lname],
    ]) {
      await Observation.create({
        entityType: 'user',
        entityKey,
        field,
        value,
        sourceName: 'ysm-faculty-directory',
        sourceUrl: 'https://example.edu/profile/synthetic/',
        sourceId: new mongoose.Types.ObjectId(),
        confidence: 0.9,
        observedAt: new Date('2026-01-01T00:00:00Z'),
        superseded: false,
      });
    }
  };

  const piKey = (value: string) => ({
    field: 'inferredPiUserKey',
    value,
    sourceName: 'ysm-faculty-directory',
    sourceUrl: 'https://example.edu/profile/synthetic/',
    confidence: 0.88,
    observedAt: new Date('2026-01-01T00:00:00Z'),
  });

  const leads = async (entityId: unknown) =>
    RoleAssignment.find({ 'target.id': entityId, role: 'PI' }).lean();

  it('links the researcher a key-only identifier reaches through its observed full name', async () => {
    const entity = await seedEntity('synthetic-join-name', 'Tamsin Quorvale Faculty Research');
    const researcher = await seedResearcher('Tamsin Quorvale', 'Associate Professor of Medicine');
    await seedUserName('ysm:tq417', 'Tamsin', 'Quorvale');

    await materializeInferredPiMembership(String(entity._id), [piKey('ysm:tq417')]);

    const found = await leads(entity._id);
    expect(found).toHaveLength(1);
    expect(String(found[0].personId)).toBe(String(researcher._id));
  });

  it('links a Yale email key through the netid user key it names', async () => {
    const entity = await seedEntity('synthetic-join-email', 'Tamsin Quorvale Faculty Research');
    const researcher = await seedResearcher('Tamsin Quorvale', 'Professor of Chemistry');
    await seedUserName('netid:tq417', 'Tamsin', 'Quorvale');

    await materializeInferredPiMembership(String(entity._id), [piKey('tq417@yale.edu')]);

    const found = await leads(entity._id);
    expect(found).toHaveLength(1);
    expect(String(found[0].personId)).toBe(String(researcher._id));
  });

  it('refuses a joined researcher whose title cannot own a research home', async () => {
    const entity = await seedEntity('synthetic-join-trainee', 'Tamsin Quorvale Faculty Research');
    await seedResearcher('Tamsin Quorvale', 'Postdoctoral Associate');
    await seedUserName('ysm:tq417', 'Tamsin', 'Quorvale');

    await materializeInferredPiMembership(String(entity._id), [piKey('ysm:tq417')]);

    expect(await leads(entity._id)).toHaveLength(0);
  });

  it('refuses a joined researcher who is not the person an eponymous lab name names', async () => {
    const entity = await seedEntity('synthetic-join-eponym', 'Brindlecomb Lab');
    await seedResearcher('Odile Brindlecomb', 'Professor of Genetics');
    await seedResearcher('Tamsin Quorvale', 'Associate Research Scientist');
    await seedUserName('ysm:tq417', 'Tamsin', 'Quorvale');

    await materializeInferredPiMembership(String(entity._id), [piKey('ysm:tq417')]);

    expect(await leads(entity._id)).toHaveLength(0);
  });

  it('does not read a topical lab name as another person when no researcher holds the word', async () => {
    const entity = await seedEntity('synthetic-join-topical', 'Glycomics Lab');
    const researcher = await seedResearcher('Tamsin Quorvale', 'Associate Professor of Medicine');
    await seedUserName('ysm:tq417', 'Tamsin', 'Quorvale');

    await materializeInferredPiMembership(String(entity._id), [piKey('ysm:tq417')]);

    const found = await leads(entity._id);
    expect(found).toHaveLength(1);
    expect(String(found[0].personId)).toBe(String(researcher._id));
  });

  const seedUserField = async (
    entityKey: string,
    field: string,
    value: unknown,
    sourceName = 'dept-faculty-roster',
  ) =>
    Observation.create({
      entityType: 'user',
      entityKey,
      field,
      value,
      sourceName,
      sourceUrl: 'https://example.edu/roster/synthetic/',
      sourceId: new mongoose.Types.ObjectId(),
      confidence: 0.9,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });

  const officialLink = (url: string) => ({
    kind: 'YALE_OFFICIAL' as const,
    purpose: 'PRIMARY_IDENTITY' as const,
    url,
    verifiedAt: new Date('2026-01-01T00:00:00Z'),
    healthStatus: 'UNKNOWN' as const,
  });

  describe('a key whose own address or official page names one live researcher', () => {
    const seedAliasMappedToTwoNetids = async (alias: string) => {
      await seedUserField('netid:qz101', 'email', `${alias}@yale.edu`, 'yale-directory');
      await seedUserField('netid:qz202', 'email', `${alias}@yale.edu`, 'yale-directory');
    };

    it('follows the key email past an alias the directory maps to two netids', async () => {
      const entity = await seedEntity('synthetic-email-ambiguous', 'Fenwright Lab');
      const researcher = await Researcher.create({
        displayName: 'Odalys Fenwright',
        identifiers: { email: 'odalys.fenwright@yale.edu' },
        profile: { title: 'Professor of Engineering' },
        archived: false,
      });
      await seedAliasMappedToTwoNetids('odalys.fenwright');
      await seedUserName('netid:odalys.fenwright', 'Odalys', 'Fenwright');
      await seedUserField('netid:odalys.fenwright', 'email', 'odalys.fenwright@yale.edu');

      await materializeInferredPiMembership(String(entity._id), [piKey('netid:odalys.fenwright')]);

      const found = await leads(entity._id);
      expect(found).toHaveLength(1);
      expect(String(found[0].personId)).toBe(String(researcher._id));
    });

    it('still fails closed past an ambiguous alias when two live researchers hold the address', async () => {
      const entity = await seedEntity('synthetic-email-two-holders', 'Fenwright Lab');
      for (const title of ['Professor of Engineering', 'Professor of Physics']) {
        await Researcher.create({
          displayName: 'Odalys Fenwright',
          identifiers: { email: 'odalys.fenwright@yale.edu' },
          profile: { title },
          archived: false,
        });
      }
      await seedAliasMappedToTwoNetids('odalys.fenwright');
      await seedUserName('netid:odalys.fenwright', 'Odalys', 'Fenwright');
      await seedUserField('netid:odalys.fenwright', 'email', 'odalys.fenwright@yale.edu');

      await materializeInferredPiMembership(String(entity._id), [piKey('netid:odalys.fenwright')]);

      expect(await leads(entity._id)).toHaveLength(0);
    });

    it('joins the stamped official page a department keeps outside a /people/ path', async () => {
      const page = 'https://som.example.yale.edu/faculty-directory/odalys-fenwright';
      const entity = await seedEntity(
        'synthetic-stamped-page',
        'Odalys Fenwright Faculty Research',
      );
      const researcher = await Researcher.create({
        displayName: 'Odalys Fenwright',
        profile: { title: 'Professor of Economics' },
        profileLinks: [officialLink(page)],
        archived: false,
      });
      await seedResearcher('Odalys P. Fenwright', 'Professor of Medicine');
      await seedUserName('dept:som:odalys-q-fenwright', 'Odalys Q.', 'Fenwright');
      await seedUserField('dept:som:odalys-q-fenwright', 'profileUrls', { departmental: page });

      await materializeInferredPiMembership(String(entity._id), [
        piKey('dept:som:odalys-q-fenwright'),
      ]);

      const found = await leads(entity._id);
      expect(found).toHaveLength(1);
      expect(String(found[0].personId)).toBe(String(researcher._id));
    });

    it('joins a person known by one name through the official page they hold', async () => {
      const page = 'https://art.example.yale.edu/people/faculty-and-staff/quillane';
      const entity = await seedEntity('synthetic-mononym', 'Quillane Faculty Research');
      const researcher = await Researcher.create({
        displayName: 'Quillane',
        profile: { title: 'Lecturer' },
        profileLinks: [officialLink(page)],
        archived: false,
      });
      await seedUserField('dept:art:quillane', 'fname', 'Quillane');
      await seedUserField('dept:art:quillane', 'profileUrls', { departmental: page });

      await materializeInferredPiMembership(String(entity._id), [piKey('dept:art:quillane')]);

      const found = await leads(entity._id);
      expect(found).toHaveLength(1);
      expect(String(found[0].personId)).toBe(String(researcher._id));
    });

    it('refuses the official page when the person holding it has another single name', async () => {
      const page = 'https://art.example.yale.edu/people/faculty-and-staff/quillane';
      const entity = await seedEntity('synthetic-mononym-other', 'Quillane Faculty Research');
      await Researcher.create({
        displayName: 'Marisol',
        profile: { title: 'Lecturer' },
        profileLinks: [officialLink(page)],
        archived: false,
      });
      await seedUserField('dept:art:quillane', 'fname', 'Quillane');
      await seedUserField('dept:art:quillane', 'profileUrls', { departmental: page });

      await materializeInferredPiMembership(String(entity._id), [piKey('dept:art:quillane')]);

      expect(await leads(entity._id)).toHaveLength(0);
    });
  });
});
