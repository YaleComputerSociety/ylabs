import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Account } from '../../models/account';
import { Researcher } from '../../models/researcher';
import { ResearchEntity } from '../../models/researchEntity';
import { RoleAssignment, type RoleAssignmentRole } from '../../models/roleAssignment';
import { LEAD_ROLE_LEGACY_LABELS } from '../../models/canonicalRoleMapping';
import { recomputeBrowseRankForEntities } from '../researchEntityBrowseRankService';
import { leadMembersForEntities } from '../researchGroupService';
import { buildResearchEntityQualitySummary } from '../researchEntityQuality';
import { studentVisibilityGateLeadRows } from '../studentVisibilityGateService';
import { serializedDocumentId } from '../../utils/idSerialization';

const SERVER_SRC = path.resolve(__dirname, '../..');

/**
 * A served roster member's `role` is a LEGACY label, so a lead test written against
 * labels that exist in no vocabulary matches only the ones that coincide. Two copies
 * of `['pi','principal_investigator','lead','faculty_lead']` matched `pi` alone, so an
 * entity led only by a DIRECTOR, CO_DIRECTOR or CO_PI read as leadless, took
 * `missing_lead` and a 35-point browse-rank penalty, and that penalty is persisted to
 * Meilisearch. Selective rather than a visible zero, which is why it survived its own
 * fix (#2732).
 */
describe('a lead role set compared against a served member role', () => {
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
    for (const name of ['accounts', 'researchers', 'role_assignments', 'research_entities']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedEntity = async (slug: string) =>
    ResearchEntity.create({
      slug,
      name: `Entity ${slug}`,
      entityType: 'CENTER',
      fullDescription: 'A complete, source-backed description of the research work.',
      status: 'ACTIVE',
      archived: false,
    });

  const attachLead = async (
    entityId: mongoose.Types.ObjectId,
    role: RoleAssignmentRole,
    netid: string,
  ) => {
    const account = await Account.create({
      netid,
      email: `${netid}@example.test`,
      status: 'ACTIVE',
      archived: false,
    });
    const person = await Researcher.create({
      displayName: `Person ${netid}`,
      accountId: account._id,
      profileLinks: [],
      profile: { title: 'Professor of Testing' },
      status: 'ACTIVE',
      archived: false,
    });
    await RoleAssignment.create({
      personId: person._id,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role,
      state: 'CURRENT',
      confidence: 0.9,
    });
  };

  const scoreOf = async (id: mongoose.Types.ObjectId): Promise<number> => {
    const doc = await ResearchEntity.findById(id).lean<{ browseRankScore?: number }>();
    return doc?.browseRankScore ?? 0;
  };

  it('persists the same browse rank for a director-led entity as for a PI-led one', async () => {
    const piLed = await seedEntity('pi-led');
    const directorLed = await seedEntity('director-led');
    const coDirectorLed = await seedEntity('co-director-led');
    const coPiLed = await seedEntity('co-pi-led');
    const leadless = await seedEntity('leadless');

    await attachLead(piLed._id, 'PI', 'aa100');
    await attachLead(directorLed._id, 'DIRECTOR', 'aa101');
    await attachLead(coDirectorLed._id, 'CO_DIRECTOR', 'aa102');
    await attachLead(coPiLed._id, 'CO_PI', 'aa103');

    await recomputeBrowseRankForEntities(
      [piLed._id, directorLed._id, coDirectorLed._id, coPiLed._id, leadless._id],
      { sync: false },
    );

    const piScore = await scoreOf(piLed._id);
    expect(await scoreOf(directorLed._id)).toBe(piScore);
    expect(await scoreOf(coDirectorLed._id)).toBe(piScore);
    expect(await scoreOf(coPiLed._id)).toBe(piScore);
    expect(await scoreOf(leadless._id)).toBeLessThan(piScore);
  });

  it('keeps missing_lead off a director-led entity on the browse quality path', async () => {
    const directorLed = await seedEntity('director-led-quality');
    const leadless = await seedEntity('leadless-quality');
    await attachLead(directorLed._id, 'DIRECTOR', 'aa104');

    const leadsByEntityId = await leadMembersForEntities([directorLed._id, leadless._id]);
    const flagsFor = (entity: any) =>
      buildResearchEntityQualitySummary({
        entity,
        leadMembers: leadsByEntityId.get(serializedDocumentId(entity._id) || '') || [],
      }).repairFlags;

    expect(flagsFor(directorLed.toObject())).not.toContain('missing_lead');
    expect(flagsFor(leadless.toObject())).toContain('missing_lead');
  });

  it('counts a director as a lead row in the visibility gate', () => {
    const rows = studentVisibilityGateLeadRows([
      { role: 'director', state: 'CURRENT', name: 'Fixture Person' },
      { role: 'postdoc', state: 'CURRENT', name: 'Other Person' },
    ]);
    expect(rows).toHaveLength(1);
  });
});

const sourceFiles = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      sourceFiles(full, out);
    } else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
};

/**
 * The owner only owns the question while nobody re-declares it. Both defective copies
 * were `new Set([...])` literals holding a served-member role label, so scan for that
 * shape rather than trusting that the four call sites stay converted.
 */
describe('no server source re-declares the served lead role set', () => {
  const REDECLARED_LEAD_LABEL_SET =
    /new Set\(\[\s*'pi',\s*'co-pi',\s*'director',\s*'co-director',?\s*\]\)/;

  it('scans every server source file and finds none', () => {
    const offenders: string[] = [];
    const owner = path.join(SERVER_SRC, 'models', 'canonicalRoleMapping.ts');
    for (const file of sourceFiles(SERVER_SRC)) {
      if (file === owner) continue;
      const contents = fs.readFileSync(file, 'utf8');
      if (REDECLARED_LEAD_LABEL_SET.test(contents)) offenders.push(path.relative(SERVER_SRC, file));
    }
    expect(offenders).toEqual([]);
  });

  it('catches a re-declaration and spares a deliberately wider set', () => {
    expect(
      REDECLARED_LEAD_LABEL_SET.test("new Set(['pi', 'co-pi', 'director', 'co-director'])"),
    ).toBe(true);
    expect(
      REDECLARED_LEAD_LABEL_SET.test(
        "new Set([\n  'pi',\n  'co-pi',\n  'director',\n  'co-director',\n])",
      ),
    ).toBe(true);
    expect(
      REDECLARED_LEAD_LABEL_SET.test(
        "new Set(['pi', 'co-pi', 'director', 'co-director', 'core-faculty'])",
      ),
    ).toBe(false);
    expect(REDECLARED_LEAD_LABEL_SET.test('LEAD_ROLE_LEGACY_LABELS.has(member.role)')).toBe(false);
  });
});

/**
 * `principal_investigator`, `lead` and `faculty_lead` are the labels that made the
 * defect look deliberate: three of four entries in a live set, matching nothing.
 */
describe('the labels that never existed', () => {
  it('are absent from the owner set, which holds exactly the served lead labels', () => {
    for (const label of ['principal_investigator', 'lead', 'faculty_lead']) {
      expect(LEAD_ROLE_LEGACY_LABELS.has(label)).toBe(false);
    }
    expect(LEAD_ROLE_LEGACY_LABELS.has('director')).toBe(true);
    expect(LEAD_ROLE_LEGACY_LABELS.has('co-director')).toBe(true);
    expect(LEAD_ROLE_LEGACY_LABELS.has('co-pi')).toBe(true);
  });
});
