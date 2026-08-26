import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Researcher } from '../../models/researcher';
import { dedupeAccountlessResearcherShells } from '../dedupeAccountlessResearcherShells';

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
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await server.stop();
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
        accountId: new mongoose.Types.ObjectId(),
        archived: false,
        profileLinks: [{ kind: 'YALE_OFFICIAL', url: 'https://canonical.yale.edu' }],
        identifiers: {},
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
        identifiers: { orcid: '0000-0002-1825-0097', googleScholarId: 'abc' },
        profile: {
          title: 'Adjunct',
          primaryDepartment: 'Immunobiology',
          imageUrl: 'https://img/x',
          websiteUrl: 'https://w/x',
        },
      },
      { _id: twinCanonicalA, displayName: 'Sam Twin', accountId: new mongoose.Types.ObjectId(), archived: false },
      { _id: twinCanonicalB, displayName: 'Sam Twin', accountId: new mongoose.Types.ObjectId(), archived: false },
      { _id: twinShellId, displayName: 'Sam Twin', archived: false },
      { _id: soloShellId, displayName: 'Solo Person', archived: false },
      {
        _id: conflictCanonicalId,
        displayName: 'Kim Lee',
        accountId: new mongoose.Types.ObjectId(),
        archived: false,
        identifiers: { orcid: '0000-0002-1825-0097' },
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
      orcid: '0000-0002-1825-0097',
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
      orcid: '0000-0002-1825-0097',
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
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await server.stop();
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
        accountId: new mongoose.Types.ObjectId(),
        archived: false,
        identifiers: {},
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
});
