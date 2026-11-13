import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { ResearchEntity } from '../../models/researchEntity';
import { Department, DepartmentCategory } from '../../models/department';
import { findOrCreateForOwner } from '../researchGroupService';
import {
  buildOrgUnitResolverIndex,
  createOrgUnitCanonicalizer,
  setOrgUnitCanonicalizerForTesting,
} from '../../scrapers/orgUnitCanonicalization';
import { primaryDepartmentCatalogAncestors } from '../../scrapers/sources/undergradFellowshipRecipientScraper';

describe('findOrCreateForOwner canonical PI assignment', () => {
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
      'accounts',
      'researchers',
      'role_assignments',
      'users',
      'research_entities',
      'departments',
    ]) {
      await db.collection(name).deleteMany({});
    }
  });

  it('resolves-or-creates the owner Researcher and writes a PI RoleAssignment for an un-materialized owner', async () => {
    const ownerId = new mongoose.Types.ObjectId();
    expect(await Researcher.countDocuments({})).toBe(0);

    const { group } = await findOrCreateForOwner({
      _id: ownerId,
      netid: 'pi001',
      fname: 'Pat',
      lname: 'Investigator',
    });

    expect(group?._id).toBeTruthy();

    const researcher: any = await Researcher.findOne({}).lean();
    expect(researcher).toBeTruthy();

    const assignment: any = await RoleAssignment.findOne({
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': group._id,
      role: 'PI',
    }).lean();
    expect(assignment).toBeTruthy();
    expect(assignment.personId.toString()).toBe(researcher._id.toString());
    expect(assignment.state).toBe('CURRENT');
  });

  it('reuses the existing PI group on a second call for the same owner', async () => {
    const ownerId = new mongoose.Types.ObjectId();

    const first = await findOrCreateForOwner({
      _id: ownerId,
      netid: 'pi002',
      fname: 'Robin',
      lname: 'Scholar',
    });
    const second = await findOrCreateForOwner({
      _id: ownerId,
      netid: 'pi002',
      fname: 'Robin',
      lname: 'Scholar',
    });

    expect(second.group._id.toString()).toBe(first.group._id.toString());
    expect(await ResearchEntity.countDocuments({})).toBe(1);
    expect(
      await RoleAssignment.countDocuments({ 'target.kind': 'RESEARCH_ENTITY', role: 'PI' }),
    ).toBe(1);
  });

  it('names an individual stub with the person-scoped name rather than a hyphen suffix (#4372)', async () => {
    await Department.collection.insertOne({
      abbreviation: 'HIST',
      name: 'Synthetic History',
      displayName: 'Synthetic History',
      primaryCategory: DepartmentCategory.HUMANITIES_ARTS,
    });

    const { group } = await findOrCreateForOwner({
      _id: new mongoose.Types.ObjectId(),
      netid: 'pi003',
      fname: 'Ada',
      lname: 'Quill',
      primaryDepartment: 'Synthetic History',
    });

    expect(group.kind).toBe('individual');
    expect(group.name).toBe('Ada Quill Faculty Research');
  });

  describe('a section primary department (#6202)', () => {
    const SECTION = 'Synthetic Heart Section';
    const PARENT = 'Synthetic Humanities Parent';
    beforeEach(() => {
      setOrgUnitCanonicalizerForTesting(
        createOrgUnitCanonicalizer(
          buildOrgUnitResolverIndex([
            { slug: 'synthetic-school', name: 'Synthetic School', kind: 'SCHOOL' },
            { slug: 'synthetic-parent', name: PARENT, kind: 'DEPARTMENT' },
            {
              slug: 'synthetic-heart',
              name: SECTION,
              kind: 'SECTION',
              aliases: ['Synthetic Heart'],
            },
          ]),
          new Map([
            [SECTION, 'Synthetic School'],
            [PARENT, 'Synthetic School'],
          ]),
          new Map([[SECTION, [PARENT]]]),
        ),
      );
    });
    afterAll(() => setOrgUnitCanonicalizerForTesting(null));

    it('seeds the section with the department it sits under, in catalog spelling', async () => {
      const { group } = await findOrCreateForOwner({
        _id: new mongoose.Types.ObjectId(),
        netid: 'pi620',
        fname: 'Remy',
        lname: 'Synthetic',
        primaryDepartment: 'Synthetic Heart',
      });

      expect(group.departments).toEqual([SECTION, PARENT]);
    });

    it("infers the row's kind from the section's department", async () => {
      await Department.collection.insertOne({
        abbreviation: 'SYNH',
        name: PARENT,
        displayName: PARENT,
        primaryCategory: DepartmentCategory.HUMANITIES_ARTS,
      });

      const { group } = await findOrCreateForOwner({
        _id: new mongoose.Types.ObjectId(),
        netid: 'pi621',
        fname: 'Remy',
        lname: 'Synthetic',
        primaryDepartment: SECTION,
      });

      expect(group.kind).toBe('individual');
    });

    it('keeps a value the catalog does not name as stated', async () => {
      const { group } = await findOrCreateForOwner({
        _id: new mongoose.Types.ObjectId(),
        netid: 'pi622',
        fname: 'Remy',
        lname: 'Synthetic',
        primaryDepartment: 'Uncatalogued Unit',
      });

      expect(group.departments).toEqual(['Uncatalogued Unit']);
    });

    it("gives the fellowship lane a section's catalog ancestors", async () => {
      await expect(primaryDepartmentCatalogAncestors(SECTION)).resolves.toEqual([PARENT]);
      await expect(primaryDepartmentCatalogAncestors(PARENT)).resolves.toEqual([]);
      await expect(primaryDepartmentCatalogAncestors('')).resolves.toEqual([]);
    });
  });
});
