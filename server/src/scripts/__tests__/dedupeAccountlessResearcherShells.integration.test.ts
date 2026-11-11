import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Researcher } from '../../models/researcher';
import {
  parseRecordDistinctResearchersArgs,
  recordDistinctResearchers,
} from '../recordDistinctResearchers';
import {
  dedupeAccountlessResearcherShells,
  parseDedupeAccountlessResearcherShellsArgs,
} from '../dedupeAccountlessResearcherShells';

const canonicalId = new mongoose.Types.ObjectId();
const shellId = new mongoose.Types.ObjectId();
const twinCanonicalA = new mongoose.Types.ObjectId();
const twinCanonicalB = new mongoose.Types.ObjectId();
const twinShellId = new mongoose.Types.ObjectId();
const soloShellId = new mongoose.Types.ObjectId();
const conflictCanonicalId = new mongoose.Types.ObjectId();
const conflictShellId = new mongoose.Types.ObjectId();

const entityOne = new mongoose.Types.ObjectId();
const entityShared = new mongoose.Types.ObjectId();

const uniqueEdgeId = new mongoose.Types.ObjectId();
const redundantEdgeId = new mongoose.Types.ObjectId();
const canonicalSharedEdgeId = new mongoose.Types.ObjectId();

describe('dedupeAccountlessResearcherShells (DB-backed)', () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri(), { autoIndex: false });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('researchers').deleteMany({});
    await db.collection('role_assignments').deleteMany({});

    await db.collection('researchers').insertMany([
      {
        _id: canonicalId,
        displayName: 'Jane Roe',
        archived: false,
        profileLinks: [{ kind: 'YALE_OFFICIAL', url: 'https://canonical.yale.edu' }],
        identifiers: { email: 'directory.fixture1@example.test' },
        profile: { title: 'Professor' },
      },
      {
        _id: shellId,
        displayName: 'Jane Roe',
        archived: false,
        profileLinks: [
          { kind: 'GOOGLE_SCHOLAR', url: 'https://scholar.google.com/citations?user=abc' },
          { kind: 'YALE_OFFICIAL', url: 'https://shell.yale.edu' },
        ],
        identifiers: { orcid: '0000-0001-2222-3333', googleScholarId: 'abc' },
        profile: {
          title: 'Adjunct',
          primaryDepartment: 'Immunobiology',
          imageUrl: 'https://img/x',
          websiteUrl: 'https://w/x',
        },
      },
      {
        _id: twinCanonicalA,
        displayName: 'Sam Twin',
        identifiers: { email: 'directory.fixture2@example.test' },
        archived: false,
      },
      {
        _id: twinCanonicalB,
        displayName: 'Sam Twin',
        identifiers: { email: 'directory.fixture3@example.test' },
        archived: false,
      },
      { _id: twinShellId, displayName: 'Sam Twin', archived: false },
      { _id: soloShellId, displayName: 'Solo Person', archived: false },
      {
        _id: conflictCanonicalId,
        displayName: 'Kim Lee',
        archived: false,
        identifiers: { orcid: '0000-0001-2222-3333', email: 'directory.fixture4@example.test' },
      },
      {
        _id: conflictShellId,
        displayName: 'Kim Lee',
        archived: false,
        identifiers: { orcid: '0000-0001-0000-0000' },
      },
    ]);

    await db.collection('role_assignments').insertMany([
      {
        _id: uniqueEdgeId,
        personId: shellId,
        target: { kind: 'RESEARCH_ENTITY', id: entityOne },
        role: 'PI',
        archived: false,
      },
      {
        _id: redundantEdgeId,
        personId: shellId,
        target: { kind: 'RESEARCH_ENTITY', id: entityShared },
        role: 'PI',
        archived: false,
      },
      {
        _id: canonicalSharedEdgeId,
        personId: canonicalId,
        target: { kind: 'RESEARCH_ENTITY', id: entityShared },
        role: 'PI',
        archived: false,
      },
    ]);
  });

  it('merges only the unambiguous shell, unions signals without loss, and repoints roles', async () => {
    const result = await dedupeAccountlessResearcherShells({ apply: true });

    expect(result.byReason).toEqual({
      MERGEABLE: 1,
      NO_NAME: 0,
      NO_CANONICAL: 1,
      AMBIGUOUS_MULTIPLE_CANONICAL: 1,
      ORCID_CONFLICT: 1,
      NETID_CONFLICT: 0,
      NO_IDENTITY_WITNESS: 0,
      VARIANT_SHAPE_NOT_ALLOWED: 0,
    });
    expect(result.shellsMerged).toBe(1);
    expect(result.roleAssignmentsRepointed).toBe(1);
    expect(result.roleAssignmentsArchivedRedundant).toBe(1);

    const db = mongoose.connection.db!;
    const canonical = await db.collection('researchers').findOne({ _id: canonicalId });
    const canonicalLinks = canonical!.profileLinks as Array<{ kind: string; url: string }>;
    expect(canonicalLinks).toHaveLength(2);
    expect(canonicalLinks.find((link) => link.kind === 'YALE_OFFICIAL')?.url).toBe(
      'https://canonical.yale.edu',
    );
    expect(canonicalLinks.some((link) => link.kind === 'GOOGLE_SCHOLAR')).toBe(true);
    expect(canonical!.identifiers).toMatchObject({
      orcid: '0000-0001-2222-3333',
      googleScholarId: 'abc',
    });
    expect(canonical!.profile).toEqual({
      title: 'Professor',
      primaryDepartment: 'Immunobiology',
      imageUrl: 'https://img/x',
      websiteUrl: 'https://w/x',
    });

    const shell = await db.collection('researchers').findOne({ _id: shellId });
    expect(shell!.archived).toBe(true);
    expect(String(shell!.dedupedIntoResearcherId)).toBe(String(canonicalId));
    expect(shell!.dedupedAt).toBeInstanceOf(Date);

    const uniqueEdge = await db.collection('role_assignments').findOne({ _id: uniqueEdgeId });
    expect(String(uniqueEdge!.personId)).toBe(String(canonicalId));
    expect(uniqueEdge!.archived).toBe(false);

    const redundantEdge = await db.collection('role_assignments').findOne({ _id: redundantEdgeId });
    expect(redundantEdge!.archived).toBe(true);

    for (const untouched of [twinShellId, soloShellId, conflictShellId]) {
      const doc = await db.collection('researchers').findOne({ _id: untouched });
      expect(doc!.archived).toBe(false);
      expect(doc!.dedupedIntoResearcherId).toBeUndefined();
    }
  });

  it('is idempotent: a second apply run is a no-op', async () => {
    await dedupeAccountlessResearcherShells({ apply: true });
    const second = await dedupeAccountlessResearcherShells({ apply: true });

    expect(second.shellsMerged).toBe(0);
    expect(second.roleAssignmentsRepointed).toBe(0);
    expect(second.attributeUnion.profileLinksAppended).toBe(0);

    const db = mongoose.connection.db!;
    const canonical = await db.collection('researchers').findOne({ _id: canonicalId });
    expect(canonical!.profileLinks as unknown[]).toHaveLength(2);
    expect(canonical!.identifiers).toMatchObject({
      orcid: '0000-0001-2222-3333',
      googleScholarId: 'abc',
    });
  });

  it('leaves the database unchanged on a dry run', async () => {
    const result = await dedupeAccountlessResearcherShells({ apply: false });
    expect(result.mode).toBe('dry-run');
    expect(result.shellsMerged).toBe(1);

    const db = mongoose.connection.db!;
    const shell = await db.collection('researchers').findOne({ _id: shellId });
    expect(shell!.archived).toBe(false);
    const canonical = await db.collection('researchers').findOne({ _id: canonicalId });
    expect(canonical!.profileLinks as unknown[]).toHaveLength(1);
    const uniqueEdge = await db.collection('role_assignments').findOne({ _id: uniqueEdgeId });
    expect(String(uniqueEdge!.personId)).toBe(String(shellId));
  });
});

describe('dedupeAccountlessResearcherShells (with schema unique indexes)', () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri(), { autoIndex: false });
    await Researcher.syncIndexes();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('researchers').deleteMany({});
    await db.collection('role_assignments').deleteMany({});
  });

  it('gap-fills the canonical ORCID from the shell without violating the unique index', async () => {
    const canonicalOnly = new mongoose.Types.ObjectId();
    const orcidShell = new mongoose.Types.ObjectId();
    const db = mongoose.connection.db!;
    await db.collection('researchers').insertMany([
      {
        _id: canonicalOnly,
        displayName: 'Rosa Vega',
        archived: false,
        identifiers: { email: 'directory.fixture5@example.test' },
      },
      {
        _id: orcidShell,
        displayName: 'Rosa Vega',
        archived: false,
        identifiers: { orcid: '0000-0003-1111-2222' },
      },
    ]);

    const result = await dedupeAccountlessResearcherShells({ apply: true });
    expect(result.byReason.MERGEABLE).toBe(1);
    expect(result.attributeUnion.identifiersFilled.orcid).toBe(1);

    const canonical = await db.collection('researchers').findOne({ _id: canonicalOnly });
    expect(canonical!.identifiers).toMatchObject({ orcid: '0000-0003-1111-2222' });

    const shell = await db.collection('researchers').findOne({ _id: orcidShell });
    expect(shell!.archived).toBe(true);
    expect((shell!.identifiers as { orcid?: string } | undefined)?.orcid).toBeUndefined();
  });

  it("copies the shell's refusals to the survivor and never gap-fills a refused value (#5641)", async () => {
    const survivor = new mongoose.Types.ObjectId();
    const refusingShell = new mongoose.Types.ObjectId();
    const refusedSite = 'https://school.example.test/about/fixture-fund-story/';
    const refusedDepartment = 'Department of Fixture Stories';
    const refusal = (valueKey: string) => ({
      valueKey,
      rule: 'over_shared_value',
      refusedBy: 'synthetic fixture',
      refusedAt: new Date('2026-11-11T00:00:00Z'),
      note: 'synthetic fixture',
    });
    const db = mongoose.connection.db!;
    await db.collection('researchers').insertMany([
      {
        _id: survivor,
        displayName: 'Ines Fixture',
        archived: false,
        identifiers: { email: 'directory.fixture9@example.test' },
        profile: { primaryDepartment: refusedDepartment },
      },
      {
        _id: refusingShell,
        displayName: 'Ines Fixture',
        archived: false,
        profile: { websiteUrl: refusedSite, title: 'Fixture Professor' },
        fieldValueRefusals: {
          websiteUrl: [refusal('school.example.test/about/fixture-fund-story')],
          title: [refusal('fixture professor')],
          primaryDepartment: [refusal('department of fixture stories')],
        },
      },
    ]);

    await dedupeAccountlessResearcherShells({ apply: true });

    const kept = await db.collection('researchers').findOne({ _id: survivor });
    expect(kept!.profile?.websiteUrl).toBeUndefined();
    expect(kept!.profile?.title).toBeUndefined();
    expect(kept!.profile?.primaryDepartment).toBeUndefined();
    expect(Object.keys(kept!.fieldValueRefusals ?? {}).sort()).toEqual([
      'primaryDepartment',
      'title',
      'websiteUrl',
    ]);
    const shell = await db.collection('researchers').findOne({ _id: refusingShell });
    expect(shell!.archived).toBe(true);
    expect(Object.keys(shell!.fieldValueRefusals ?? {}).sort()).toEqual([
      'primaryDepartment',
      'title',
      'websiteUrl',
    ]);
  });

  it('moves the shell ORCID link with its ORCID so neither row fails the schema (#4501)', async () => {
    const orcid = '9999-9999-9999-9994';
    const orcidLink = {
      kind: 'ORCID',
      purpose: 'SCHOLARLY',
      url: `https://orcid.org/${orcid}`,
      verifiedAt: new Date('2026-01-01T00:00:00Z'),
      healthStatus: 'UNKNOWN',
    };
    const canonicalOnly = new mongoose.Types.ObjectId();
    const orcidShell = new mongoose.Types.ObjectId();
    const db = mongoose.connection.db!;
    await db.collection('researchers').insertMany([
      {
        _id: canonicalOnly,
        displayName: 'Rosa Vega',
        archived: false,
        identifiers: { email: 'directory.fixture6@example.test' },
        profileLinks: [],
      },
      {
        _id: orcidShell,
        displayName: 'Rosa Vega',
        archived: false,
        identifiers: { orcid },
        profileLinks: [orcidLink],
      },
    ]);

    const result = await dedupeAccountlessResearcherShells({ apply: true });
    expect(result.byReason.MERGEABLE).toBe(1);

    const canonical = await db.collection('researchers').findOne({ _id: canonicalOnly });
    const shell = await db.collection('researchers').findOne({ _id: orcidShell });
    expect(canonical!.identifiers).toMatchObject({ orcid });
    expect(canonical!.profileLinks.map((link: { url: string }) => link.url)).toEqual([
      orcidLink.url,
    ]);
    expect((shell!.identifiers as { orcid?: string } | undefined)?.orcid).toBeUndefined();
    expect(shell!.profileLinks).toEqual([]);
    expect(Researcher.hydrate(canonical!).validateSync()).toBeUndefined();
    expect(Researcher.hydrate(shell!).validateSync()).toBeUndefined();
  });

  it('folds an accountless-only group into the copy holding the live edge', async () => {
    const survivor = new mongoose.Types.ObjectId();
    const copyA = new mongoose.Types.ObjectId();
    const copyB = new mongoose.Types.ObjectId();
    const entity = new mongoose.Types.ObjectId();
    const edge = new mongoose.Types.ObjectId();
    const copyEdge = new mongoose.Types.ObjectId();
    const verified = [
      {
        kind: 'YALE_OFFICIAL',
        purpose: 'PRIMARY_IDENTITY',
        url: 'https://dept.example.edu/p/2001',
        verifiedAt: new Date(),
        healthStatus: 'HEALTHY',
      },
    ];
    const db = mongoose.connection.db!;
    await db.collection('researchers').deleteMany({});
    await db.collection('role_assignments').deleteMany({});
    await db.collection('researchers').insertMany(
      [copyA, survivor, copyB].map((_id) => ({
        _id,
        displayName: 'Cara Copyset',
        archived: false,
        identifiers: {},
        profileLinks: verified,
      })),
    );
    await db.collection('role_assignments').insertMany([
      {
        _id: edge,
        personId: survivor,
        target: { kind: 'RESEARCH_ENTITY', id: entity },
        role: 'PI',
        archived: false,
      },
      {
        _id: copyEdge,
        personId: copyA,
        target: { kind: 'RESEARCH_ENTITY', id: entity },
        role: 'PI',
        archived: false,
      },
    ]);

    const result = await dedupeAccountlessResearcherShells({ apply: true });
    expect(result.accountlessClusters).toMatchObject({ groups: 1, foldedGroups: 1, folds: 2 });

    for (const copy of [copyA, copyB]) {
      const row = await db.collection('researchers').findOne({ _id: copy });
      expect(row!.archived).toBe(true);
      expect(String(row!.dedupedIntoResearcherId)).toBe(String(survivor));
    }
    expect((await db.collection('researchers').findOne({ _id: survivor }))!.archived).toBe(false);
    expect((await db.collection('role_assignments').findOne({ _id: copyEdge }))!.archived).toBe(
      true,
    );
    expect((await db.collection('role_assignments').findOne({ _id: edge }))!.archived).toBe(false);

    const again = await dedupeAccountlessResearcherShells({ apply: true });
    expect(again.accountlessClusters.folds).toBe(0);
  });

  it('applies only the named shell when the run is scoped with --only-shell', async () => {
    const db = mongoose.connection.db!;
    const pairs = ['Scoped Fixture', 'Unscoped Fixture'].map((displayName, index) => ({
      canonical: new mongoose.Types.ObjectId(),
      shell: new mongoose.Types.ObjectId(),
      displayName,
      email: `directory.scope${index}@example.test`,
    }));
    await db.collection('researchers').insertMany(
      pairs.flatMap(({ canonical, shell, displayName, email }) => [
        { _id: canonical, displayName, archived: false, identifiers: { email } },
        { _id: shell, displayName, archived: false, identifiers: {} },
      ]),
    );
    const [scoped, unscoped] = pairs;
    const notPlanned = new mongoose.Types.ObjectId().toHexString();

    const result = await dedupeAccountlessResearcherShells({
      apply: true,
      onlyShellIds: [scoped.shell.toHexString(), notPlanned],
    });

    expect(result.shellsMerged).toBe(1);
    expect(result.onlyShellsNotPlanned).toEqual([notPlanned]);
    expect((await db.collection('researchers').findOne({ _id: scoped.shell }))!.archived).toBe(
      true,
    );
    expect((await db.collection('researchers').findOne({ _id: unscoped.shell }))!.archived).toBe(
      false,
    );

    const unscopedRun = await dedupeAccountlessResearcherShells({ apply: false });
    expect(unscopedRun.shellsMerged).toBe(1);
    expect(unscopedRun.onlyShellsNotPlanned).toBeUndefined();
  });

  it('folds a name-only shell into a netid-backed accountless canonical (FRA lead)', async () => {
    const netidCanonical = new mongoose.Types.ObjectId();
    const nameOnlyShell = new mongoose.Types.ObjectId();
    const db = mongoose.connection.db!;
    await db.collection('researchers').deleteMany({});
    await db.collection('role_assignments').deleteMany({});
    await db.collection('researchers').insertMany([
      {
        _id: netidCanonical,
        displayName: 'Nate Netid',
        archived: false,
        identifiers: { netid: 'nn7' },
        profileLinks: [],
      },
      {
        _id: nameOnlyShell,
        displayName: 'Nate Netid',
        archived: false,
        identifiers: {},
        profileLinks: [],
      },
    ]);

    const result = await dedupeAccountlessResearcherShells({ apply: true });
    expect(result.byReason.MERGEABLE).toBe(1);

    const shell = await db.collection('researchers').findOne({ _id: nameOnlyShell });
    expect(shell!.archived).toBe(true);
    expect(String(shell!.dedupedIntoResearcherId)).toBe(String(netidCanonical));

    const canonical = await db.collection('researchers').findOne({ _id: netidCanonical });
    expect(canonical!.archived).toBe(false);
    expect((canonical!.identifiers as { netid?: string }).netid).toBe('nn7');
  });

  it('folds both a netid-backed twin and a name-only shell into the account-backed canonical', async () => {
    const accountCanonical = new mongoose.Types.ObjectId();
    const netidTwin = new mongoose.Types.ObjectId();
    const nameOnlyShell = new mongoose.Types.ObjectId();
    const netidTwinEdge = new mongoose.Types.ObjectId();
    const nameOnlyShellEdge = new mongoose.Types.ObjectId();
    const twinEntity = new mongoose.Types.ObjectId();
    const shellEntity = new mongoose.Types.ObjectId();
    const db = mongoose.connection.db!;
    await db.collection('researchers').insertMany([
      {
        _id: accountCanonical,
        displayName: 'Jane Roe',
        archived: false,
        identifiers: { email: 'directory.fixture7@example.test' },
        profileLinks: [],
      },
      {
        _id: netidTwin,
        displayName: 'Jane Roe',
        archived: false,
        identifiers: { netid: 'jr55' },
        profileLinks: [],
      },
      {
        _id: nameOnlyShell,
        displayName: 'Jane Roe',
        archived: false,
        identifiers: {},
        profileLinks: [],
      },
    ]);
    await db.collection('role_assignments').insertMany([
      {
        _id: netidTwinEdge,
        personId: netidTwin,
        target: { kind: 'RESEARCH_ENTITY', id: twinEntity },
        role: 'PI',
        archived: false,
      },
      {
        _id: nameOnlyShellEdge,
        personId: nameOnlyShell,
        target: { kind: 'RESEARCH_ENTITY', id: shellEntity },
        role: 'PI',
        archived: false,
      },
    ]);

    const result = await dedupeAccountlessResearcherShells({ apply: true });

    expect(result.byReason.MERGEABLE).toBe(2);
    expect(result.byReason.AMBIGUOUS_MULTIPLE_CANONICAL).toBe(0);
    expect(result.roleAssignmentsRepointed).toBe(2);
    expect(result.netidBackedShellResearchers).toBe(1);
    expect(result.directoryIdentifiedResearchers).toBe(1);
    expect(result.shellResearchers).toBe(2);

    for (const shellId of [netidTwin, nameOnlyShell]) {
      const shell = await db.collection('researchers').findOne({ _id: shellId });
      expect(shell!.archived).toBe(true);
      expect(String(shell!.dedupedIntoResearcherId)).toBe(String(accountCanonical));
    }

    const twin = await db.collection('researchers').findOne({ _id: netidTwin });
    expect((twin!.identifiers as { netid?: string } | undefined)?.netid).toBeUndefined();

    const canonical = await db.collection('researchers').findOne({ _id: accountCanonical });
    expect(canonical!.archived).toBe(false);
    expect((canonical!.identifiers as { netid?: string }).netid).toBe('jr55');

    for (const edgeId of [netidTwinEdge, nameOnlyShellEdge]) {
      const edge = await db.collection('role_assignments').findOne({ _id: edgeId });
      expect(String(edge!.personId)).toBe(String(accountCanonical));
      expect(edge!.archived).toBe(false);
    }
  });

  it('folds a netid twin and a name-only shell into a directory record that links no account (#5000)', async () => {
    const directoryCanonical = new mongoose.Types.ObjectId();
    const netidTwin = new mongoose.Types.ObjectId();
    const nameOnlyShell = new mongoose.Types.ObjectId();
    const db = mongoose.connection.db!;
    await db.collection('accounts').deleteMany({});
    await db.collection('researchers').insertMany([
      {
        _id: directoryCanonical,
        displayName: 'Jane Roe',
        archived: false,
        identifiers: { email: 'jane.roe@example.test' },
        profileLinks: [],
      },
      {
        _id: netidTwin,
        displayName: 'Jane Roe',
        archived: false,
        identifiers: { netid: 'jr55' },
        profileLinks: [],
      },
      {
        _id: nameOnlyShell,
        displayName: 'Jane Roe',
        archived: false,
        identifiers: {},
        profileLinks: [],
      },
    ]);

    const result = await dedupeAccountlessResearcherShells({ apply: false });

    expect(await db.collection('accounts').countDocuments({})).toBe(0);
    expect(result.directoryIdentifiedResearchers).toBe(1);
    expect(result.shellResearchers).toBe(2);
    expect(result.netidBackedShellResearchers).toBe(1);
    expect(result.byReason.MERGEABLE).toBe(2);
    expect(result.merges.map((merge) => merge.canonicalId)).toEqual([
      String(directoryCanonical),
      String(directoryCanonical),
    ]);
    expect(result.merges.map((merge) => merge.shellId).sort()).toEqual(
      [String(netidTwin), String(nameOnlyShell)].sort(),
    );
  });

  it('never treats a directory record that links no account as a shell (#5000)', async () => {
    const db = mongoose.connection.db!;
    await db.collection('accounts').deleteMany({});
    await db.collection('researchers').insertMany([
      {
        displayName: 'Kim Lee',
        archived: false,
        identifiers: { netid: 'kl10', email: 'kim.lee@example.test' },
        profileLinks: [],
      },
      {
        displayName: 'Kim Lee',
        archived: false,
        identifiers: { netid: 'kl99', email: 'kim.lee2@example.test' },
        profileLinks: [],
      },
    ]);

    const result = await dedupeAccountlessResearcherShells({ apply: false });

    expect(result.directoryIdentifiedResearchers).toBe(2);
    expect(result.shellResearchers).toBe(0);
    expect(result.shellsMerged).toBe(0);
    expect(result.accountlessClusters.groups).toBe(0);
  });

  it('leaves a netid-backed twin unmerged when its netid conflicts with the canonical', async () => {
    const accountCanonical = new mongoose.Types.ObjectId();
    const conflictingTwin = new mongoose.Types.ObjectId();
    const db = mongoose.connection.db!;
    await db.collection('researchers').insertMany([
      {
        _id: accountCanonical,
        displayName: 'Kim Lee',
        archived: false,
        identifiers: { netid: 'kl10', email: 'directory.fixture8@example.test' },
        profileLinks: [],
      },
      {
        _id: conflictingTwin,
        displayName: 'Kim Lee',
        archived: false,
        identifiers: { netid: 'kl99' },
        profileLinks: [],
      },
    ]);

    const result = await dedupeAccountlessResearcherShells({ apply: true });

    expect(result.byReason.NETID_CONFLICT).toBe(1);
    expect(result.shellsMerged).toBe(0);

    const twin = await db.collection('researchers').findOne({ _id: conflictingTwin });
    expect(twin!.archived).toBe(false);
    expect((twin!.identifiers as { netid?: string }).netid).toBe('kl99');
  });
});

describe('parseDedupeAccountlessResearcherShellsArgs --only-shell', () => {
  it('collects every repeated --only-shell id, lower-cased', () => {
    const first = 'AAAAAAAAAAAAAAAAAAAAAAAA';
    const second = 'bbbbbbbbbbbbbbbbbbbbbbbb';
    expect(
      parseDedupeAccountlessResearcherShellsArgs([
        `--only-shell=${first}`,
        `--only-shell=${second}`,
      ]).onlyShellIds,
    ).toEqual([first.toLowerCase(), second]);
  });

  it('leaves the scope unset when no --only-shell is given', () => {
    expect(parseDedupeAccountlessResearcherShellsArgs([]).onlyShellIds).toBeUndefined();
  });

  it('refuses a value that is not a researcher id', () => {
    expect(() => parseDedupeAccountlessResearcherShellsArgs(['--only-shell=not-an-id'])).toThrow(
      /24-character researcher id/,
    );
  });
});

describe('dedupeAccountlessResearcherShells name-variant twins (#5592)', () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri(), { autoIndex: false });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db!;
    for (const name of ['researchers', 'role_assignments', 'research_entities', 'observations']) {
      await db.collection(name).deleteMany({});
    }
  });

  const HOLDER_PROFILE = 'https://fixture.yale.edu/profile/avery-synthetic';
  const LISTING_PAGE = 'https://center.fixture.yale.edu/people/avery-synthetic';

  const seedPair = async (input: {
    shellName: string;
    holderName: string;
    linkedProfile: string;
    holderEdgeState?: string;
    otherMembers?: number;
  }) => {
    const db = mongoose.connection.db!;
    const row = new mongoose.Types.ObjectId();
    const holder = new mongoose.Types.ObjectId();
    const shell = new mongoose.Types.ObjectId();
    await db.collection('research_entities').insertOne({
      _id: row,
      slug: 'center-fixture',
      name: 'Fixture Center',
      archived: false,
    });
    await db.collection('researchers').insertMany([
      {
        _id: holder,
        displayName: input.holderName,
        archived: false,
        identifiers: { email: 'directory.variant@example.test' },
        profileLinks: [{ kind: 'YALE_OFFICIAL', purpose: 'PRIMARY_IDENTITY', url: HOLDER_PROFILE }],
      },
      { _id: shell, displayName: input.shellName, archived: false, identifiers: {} },
    ]);
    await db.collection('role_assignments').insertMany([
      {
        personId: holder,
        target: { kind: 'RESEARCH_ENTITY', id: row },
        role: 'CORE_FACULTY',
        state: input.holderEdgeState ?? 'HISTORICAL',
        archived: false,
      },
      {
        personId: shell,
        target: { kind: 'RESEARCH_ENTITY', id: row },
        role: 'CORE_FACULTY',
        state: 'CURRENT',
        archived: false,
        rosterProvenance: { profileUrl: LISTING_PAGE },
      },
    ]);
    for (let index = 0; index < (input.otherMembers ?? 0); index += 1) {
      const member = new mongoose.Types.ObjectId();
      await db
        .collection('researchers')
        .insertOne({ _id: member, displayName: `Member Fixture ${index}`, archived: false });
      await db.collection('role_assignments').insertOne({
        personId: member,
        target: { kind: 'RESEARCH_ENTITY', id: row },
        role: 'AFFILIATED',
        state: 'CURRENT',
        archived: false,
      });
    }
    const listing = (field: string, value: unknown) => ({
      entityType: 'researchGroupMember',
      entityKey: 'listing-variant-fixture',
      field,
      value,
      superseded: false,
    });
    await db.collection('observations').insertMany([
      listing('profileUrl', LISTING_PAGE),
      listing('researchGroupKey', 'center-fixture'),
      listing('profileIdentityEvidence', {
        linkedProfileUrls: [input.linkedProfile],
        emails: [],
        netids: [],
      }),
    ]);
    return { holder, shell };
  };

  it('folds a name-only variant into the stronger record its own listing links, on a large center too', async () => {
    const { holder, shell } = await seedPair({
      shellName: 'Avery Synthetic',
      holderName: 'Avery Q. Synthetic',
      linkedProfile: HOLDER_PROFILE,
      otherMembers: 60,
    });

    const result = await dedupeAccountlessResearcherShells({ apply: true });

    expect(result.foldsByMatchedIdentity['name-variant-shared-row']).toBe(1);
    const folded = await mongoose.connection.db!.collection('researchers').findOne({ _id: shell });
    expect(folded!.archived).toBe(true);
    expect(String(folded!.dedupedIntoResearcherId)).toBe(String(holder));
  });

  it('accepts a holder department person page held as its website, and the divinity legacy path for it', async () => {
    const PERSON_PAGE = 'https://divinity.yale.edu/profile/avery-synthetic';
    const { holder, shell } = await seedPair({
      shellName: 'Avery Synthetic',
      holderName: 'Avery Q. Synthetic',
      linkedProfile: 'https://divinity.yale.edu/faculty-and-research/yds-faculty/avery-synthetic',
    });
    const db = mongoose.connection.db!;
    await db
      .collection('researchers')
      .updateOne(
        { _id: holder },
        { $set: { profileLinks: [], 'profile.websiteUrl': PERSON_PAGE } },
      );

    const result = await dedupeAccountlessResearcherShells({ apply: true });

    expect(result.foldsByMatchedIdentity['name-variant-shared-row']).toBe(1);
    expect((await db.collection('researchers').findOne({ _id: shell }))!.archived).toBe(true);
  });

  it('refuses a witness that is only the listing page itself, held by the holder as a lab website', async () => {
    const LAB_SITE = 'https://fixture.yale.edu/lab/synthetic-lab';
    const { holder, shell } = await seedPair({
      shellName: 'Avery Synthetic',
      holderName: 'Avery Q. Synthetic',
      linkedProfile: LAB_SITE,
    });
    const db = mongoose.connection.db!;
    await db
      .collection('researchers')
      .updateOne({ _id: holder }, { $set: { 'profile.websiteUrl': LAB_SITE } });
    await db
      .collection('observations')
      .updateOne({ field: 'profileIdentityEvidence' }, { $set: { 'value.pageUrl': LAB_SITE } });

    const result = await dedupeAccountlessResearcherShells({ apply: true });

    expect(result.byReason.NO_IDENTITY_WITNESS).toBe(1);
    const untouched = await db.collection('researchers').findOne({ _id: shell });
    expect(untouched!.archived).toBe(false);
  });

  it('refuses a shared center role whose listing links a profile elsewhere, as for two namesakes', async () => {
    const { shell } = await seedPair({
      shellName: 'Avery Synthetic-Fixture',
      holderName: 'Avery Synthetic Fixture',
      linkedProfile: 'https://law.fixture.yale.edu/faculty/avery-synthetic-fixture',
    });

    const result = await dedupeAccountlessResearcherShells({ apply: true });

    expect(result.byReason.NO_IDENTITY_WITNESS).toBe(1);
    expect(result.shellsMerged).toBe(0);
    const untouched = await mongoose.connection
      .db!.collection('researchers')
      .findOne({ _id: shell });
    expect(untouched!.archived).toBe(false);
  });

  it('records a distinct-people pair on both records, once, and the dedupe then refuses it', async () => {
    const { holder, shell } = await seedPair({
      shellName: 'Avery Synthetic',
      holderName: 'Avery Synthetic',
      linkedProfile: HOLDER_PROFILE,
    });
    const dry = await recordDistinctResearchers(String(holder), String(shell), false);
    expect(dry).toMatchObject({ found: 2, applied: false, alreadyRecorded: false });
    expect(await recordDistinctResearchers(String(holder), String(shell), true)).toMatchObject({
      applied: true,
    });
    expect(await recordDistinctResearchers(String(shell), String(holder), true)).toMatchObject({
      applied: false,
      alreadyRecorded: true,
    });
    const result = await dedupeAccountlessResearcherShells({ apply: false });
    expect(result.distinctPeopleRefusedFolds).toBe(1);
    expect(result.shellsMerged).toBe(0);
    expect(() => parseRecordDistinctResearchersArgs(['--left=x', '--right=y'])).toThrow(
      /24-character/,
    );
  });

  it('never folds a pair an operator recorded as different people, whichever arm planned it', async () => {
    const { holder, shell } = await seedPair({
      shellName: 'Avery Synthetic',
      holderName: 'Avery Synthetic',
      linkedProfile: HOLDER_PROFILE,
    });
    await mongoose.connection
      .db!.collection('researchers')
      .updateOne({ _id: holder }, { $set: { distinctFromResearcherIds: [shell] } });

    const result = await dedupeAccountlessResearcherShells({ apply: true });

    expect(result.distinctPeopleRefusedFolds).toBe(1);
    expect(result.shellsMerged).toBe(0);
    const untouched = await mongoose.connection
      .db!.collection('researchers')
      .findOne({ _id: shell });
    expect(untouched!.archived).toBe(false);
  });

  it('honours a verdict recorded on a researcher record that was later folded into the holder', async () => {
    const { holder, shell } = await seedPair({
      shellName: 'Avery Synthetic',
      holderName: 'Avery Synthetic',
      linkedProfile: HOLDER_PROFILE,
    });
    const earlierRecord = new mongoose.Types.ObjectId();
    await mongoose.connection.db!.collection('researchers').insertOne({
      _id: earlierRecord,
      displayName: 'Avery Synthetic',
      archived: true,
      dedupedIntoResearcherId: holder,
      distinctFromResearcherIds: [shell],
    });

    const result = await dedupeAccountlessResearcherShells({ apply: true });

    expect(result.distinctPeopleRefusedFolds).toBe(1);
    expect(result.shellsMerged).toBe(0);
    const untouched = await mongoose.connection
      .db!.collection('researchers')
      .findOne({ _id: shell });
    expect(untouched!.archived).toBe(false);
  });
});
