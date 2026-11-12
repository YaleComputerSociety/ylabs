import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDirectoryNetidsByAddressCache } from '../../scrapers/directoryContradictedProfileNetid';
import { dedupeAccountlessResearcherShells } from '../dedupeAccountlessResearcherShells';

const db = () => mongoose.connection.db!;

const researcherState = async (id: mongoose.Types.ObjectId) =>
  (await db().collection('researchers').findOne({ _id: id }))!;

const runTwice = async () => {
  const first = await dedupeAccountlessResearcherShells({ apply: true });
  resetDirectoryNetidsByAddressCache();
  const second = await dedupeAccountlessResearcherShells({ apply: true });
  return { first, second };
};

const pageObservation = (sourceUrl: string, field: string, value: string, entityKey: string) => ({
  entityType: 'user',
  entityKey,
  field,
  value,
  sourceName: 'fixture-page-lane',
  sourceUrl,
  superseded: false,
});

describe('dedupeAccountlessResearcherShells twin arms (#5606)', () => {
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
    resetDirectoryNetidsByAddressCache();
    for (const name of [
      'researchers',
      'role_assignments',
      'research_entities',
      'observations',
      'accounts',
    ]) {
      await db().collection(name).deleteMany({});
    }
  });

  const seedRow = async (slug: string) => {
    const row = new mongoose.Types.ObjectId();
    await db().collection('research_entities').insertOne({ _id: row, slug, archived: false });
    return row;
  };

  const seedHolder = async (
    displayName = 'Avery Synth',
    identifiers: Record<string, unknown> = { netid: 'fx901', email: 'avery.synth@yale.edu' },
    extra: Record<string, unknown> = {},
  ) => {
    const holder = new mongoose.Types.ObjectId();
    await db()
      .collection('researchers')
      .insertOne({ _id: holder, displayName, archived: false, identifiers, ...extra });
    return holder;
  };

  const seedShell = async (displayName: string, extra: Record<string, unknown> = {}) => {
    const shell = new mongoose.Types.ObjectId();
    await db()
      .collection('researchers')
      .insertOne({ _id: shell, displayName, archived: false, ...extra });
    return shell;
  };

  describe('email-local-part twin with no stored email', () => {
    it('folds into the directory record storing that address, releases the netid, once', async () => {
      const holder = await seedHolder();
      const twin = await seedShell('A. B. Avery Synth', { identifiers: { netid: 'avery.synth' } });

      const { first, second } = await runTwice();

      expect(first.aliasTwinFolds.folded).toBe(1);
      const folded = await researcherState(twin);
      expect(folded.archived).toBe(true);
      expect(String(folded.dedupedIntoResearcherId)).toBe(String(holder));
      expect(folded.identifiers?.netid).toBeUndefined();
      expect((await researcherState(holder)).identifiers.netid).toBe('fx901');
      expect(second.shellsMerged).toBe(0);
    });

    it('keeps a similarly named different person holding the local part apart', async () => {
      await seedHolder();
      const twin = await seedShell('Avery Synthe', { identifiers: { netid: 'avery.synth' } });

      const result = await dedupeAccountlessResearcherShells({ apply: true });

      expect(result.aliasTwinFolds.refusals['names-disagree']).toBe(1);
      expect((await researcherState(twin)).archived).toBe(false);
    });
  });

  describe('official-page witness', () => {
    const SHELL_PAGE = 'https://fixture.yale.edu/people/avery-synth';

    it('folds a name-only shell whose own official page states the holder email, once', async () => {
      const holder = await seedHolder();
      const shell = await seedShell('Avi Synth', {
        profileLinks: [
          {
            kind: 'YALE_OFFICIAL',
            purpose: 'PRIMARY_IDENTITY',
            healthStatus: 'HEALTHY',
            url: SHELL_PAGE,
          },
        ],
      });
      await db()
        .collection('observations')
        .insertOne(
          pageObservation(SHELL_PAGE, 'email', 'avery.synth@yale.edu', 'netid:avery.synth'),
        );

      const { first, second } = await runTwice();

      expect(first.foldsByMatchedIdentity['official-page']).toBe(1);
      expect(String((await researcherState(shell)).dedupedIntoResearcherId)).toBe(String(holder));
      expect(second.shellsMerged).toBe(0);
      expect(second.foldsByMatchedIdentity['official-page']).toBe(0);
    });

    it('reads a YSM lab microsite profile an edge cites as the school profile with the same slug', async () => {
      const holder = await seedHolder('Avery Synth', {
        netid: 'fx901',
        email: 'avery.synth@yale.edu',
        orcid: '0000-0002-0000-0001',
      });
      const row = await seedRow('lab-fixture');
      const shell = await seedShell('Avi Synth');
      await db()
        .collection('role_assignments')
        .insertOne({
          personId: shell,
          target: { kind: 'RESEARCH_ENTITY', id: row },
          role: 'CORE_FACULTY',
          state: 'CURRENT',
          archived: false,
          rosterProvenance: {
            sourceName: 'official-research-home-roster',
            profileUrl: 'https://medicine.yale.edu/lab/fixture/profile/avery-synth/',
          },
        });
      await db()
        .collection('observations')
        .insertOne(
          pageObservation(
            'https://medicine.yale.edu/profile/avery-synth/',
            'orcid',
            '0000-0002-0000-0001',
            'fixture:avery-synth',
          ),
        );

      const { first, second } = await runTwice();

      expect(first.foldsByMatchedIdentity['official-page']).toBe(1);
      expect(String((await researcherState(shell)).dedupedIntoResearcherId)).toBe(String(holder));
      const edge = await db()
        .collection('role_assignments')
        .findOne({ target: { kind: 'RESEARCH_ENTITY', id: row } });
      expect(String(edge!.personId)).toBe(String(holder));
      expect(second.shellsMerged).toBe(0);
    });

    it('never equates a different slug under the lab path', async () => {
      await seedHolder('Avery Synth', {
        netid: 'fx901',
        email: 'avery.synth@yale.edu',
        orcid: '0000-0002-0000-0001',
      });
      const row = await seedRow('lab-fixture');
      const shell = await seedShell('Avi Synth');
      await db()
        .collection('role_assignments')
        .insertOne({
          personId: shell,
          target: { kind: 'RESEARCH_ENTITY', id: row },
          role: 'CORE_FACULTY',
          state: 'CURRENT',
          archived: false,
          rosterProvenance: {
            sourceName: 'official-research-home-roster',
            profileUrl: 'https://medicine.yale.edu/lab/fixture/profile/avi-synth/',
          },
        });
      await db()
        .collection('observations')
        .insertOne(
          pageObservation(
            'https://medicine.yale.edu/profile/avery-synth/',
            'orcid',
            '0000-0002-0000-0001',
            'fixture:avery-synth',
          ),
        );

      const result = await dedupeAccountlessResearcherShells({ apply: true });

      expect(result.shellsMerged).toBe(0);
      expect((await researcherState(shell)).archived).toBe(false);
    });

    it("takes no ORCID witness from a lab path whose school page states another person's email", async () => {
      await seedHolder('Avery Synth', {
        netid: 'fx901',
        email: 'asynth@yale.edu',
        orcid: '0000-0002-0000-0001',
      });
      const row = await seedRow('lab-fixture');
      const shell = await seedShell('Avery L. Synth');
      await db()
        .collection('role_assignments')
        .insertOne({
          personId: shell,
          target: { kind: 'RESEARCH_ENTITY', id: row },
          role: 'CORE_FACULTY',
          state: 'CURRENT',
          archived: false,
          rosterProvenance: {
            sourceName: 'centers-institutes-index',
            profileUrl: 'https://medicine.yale.edu/cancer/profile/avery-synth/',
          },
        });
      const schoolPage = 'https://medicine.yale.edu/profile/avery-synth/';
      await db()
        .collection('observations')
        .insertMany([
          pageObservation(schoolPage, 'email', 'avery.synth@yale.edu', 'netid:avery.synth'),
          pageObservation(schoolPage, 'orcid', '0000-0002-0000-0001', 'netid:avery.synth'),
        ]);

      const result = await dedupeAccountlessResearcherShells({ apply: true });

      expect(result.shellsMerged).toBe(0);
      expect((await researcherState(shell)).archived).toBe(false);
    });

    it('takes no ORCID witness from a page stating two ORCIDs', async () => {
      await seedHolder('Avery Synth', {
        netid: 'fx901',
        email: 'avery.synth@yale.edu',
        orcid: '0000-0002-0000-0001',
      });
      const shell = await seedShell('Avi Synth', {
        profileLinks: [
          {
            kind: 'YALE_OFFICIAL',
            purpose: 'PRIMARY_IDENTITY',
            healthStatus: 'HEALTHY',
            url: SHELL_PAGE,
          },
        ],
      });
      await db()
        .collection('observations')
        .insertMany([
          pageObservation(SHELL_PAGE, 'orcid', '0000-0002-0000-0001', 'fixture:a'),
          pageObservation(SHELL_PAGE, 'orcid', '0000-0002-0000-0002', 'fixture:b'),
        ]);

      const result = await dedupeAccountlessResearcherShells({ apply: true });

      expect(result.shellsMerged).toBe(0);
      expect((await researcherState(shell)).archived).toBe(false);
    });

    it('keeps a similarly named different person apart even when the page states the email', async () => {
      await seedHolder();
      const shell = await seedShell('Avery Synthe', {
        profileLinks: [
          {
            kind: 'YALE_OFFICIAL',
            purpose: 'PRIMARY_IDENTITY',
            healthStatus: 'HEALTHY',
            url: SHELL_PAGE,
          },
        ],
      });
      await db()
        .collection('observations')
        .insertOne(pageObservation(SHELL_PAGE, 'email', 'avery.synth@yale.edu', 'fixture:a'));

      const result = await dedupeAccountlessResearcherShells({ apply: true });

      expect(result.shellsMerged).toBe(0);
      expect((await researcherState(shell)).archived).toBe(false);
    });
  });

  describe('inverted display name in the accountless cluster', () => {
    it('folds "Surname, Given" with "Given Surname" in one department, once', async () => {
      const survivor = await seedShell('Avery Synth', {
        identifiers: { orcid: '0000-0002-0000-0001' },
        profile: { primaryDepartment: 'Fixture Studies', title: 'Lecturer' },
      });
      const inverted = await seedShell('Synth, Avery', {
        profile: {
          primaryDepartment: 'Fixture Studies',
          title: 'Assistant Professor of Fixture Studies',
        },
      });
      const row = await seedRow('lab-fixture');
      await db()
        .collection('role_assignments')
        .insertOne({
          personId: survivor,
          target: { kind: 'RESEARCH_ENTITY', id: row },
          role: 'PI',
          state: 'CURRENT',
          archived: false,
        });

      const { first, second } = await runTwice();

      expect(first.accountlessClusters.folds).toBe(1);
      expect(String((await researcherState(inverted)).dedupedIntoResearcherId)).toBe(
        String(survivor),
      );
      expect(second.shellsMerged).toBe(0);
    });

    it('keeps a similarly named different person apart', async () => {
      await seedShell('Avery Synth', { profile: { primaryDepartment: 'Fixture Studies' } });
      const other = await seedShell('Synthe, Avery', {
        profile: { primaryDepartment: 'Fixture Studies' },
      });

      const result = await dedupeAccountlessResearcherShells({ apply: true });

      expect(result.accountlessClusters.groups).toBe(0);
      expect((await researcherState(other)).archived).toBe(false);
    });
  });

  describe('only-live-lead guard', () => {
    const seedSpacingPair = async (survivorEdge: Record<string, unknown>) => {
      const holder = await seedHolder('Ji Yeon Fixture', {
        netid: 'fx903',
        email: 'jiyeon.fixture@yale.edu',
      });
      const shell = await seedShell('Jiyeon Fixture');
      const row = await seedRow('fra-fixture');
      const shellEdge = new mongoose.Types.ObjectId();
      await db()
        .collection('role_assignments')
        .insertMany([
          {
            _id: shellEdge,
            personId: shell,
            target: { kind: 'RESEARCH_ENTITY', id: row },
            role: 'PI',
            state: 'UNKNOWN',
            archived: false,
          },
          {
            personId: holder,
            target: { kind: 'RESEARCH_ENTITY', id: row },
            role: 'PI',
            state: 'UNKNOWN',
            ...survivorEdge,
          },
        ]);
      return { holder, shell, shellEdge };
    };

    it("refuses a fold that would archive a row's only live lead against a detached survivor edge", async () => {
      const { holder, shell, shellEdge } = await seedSpacingPair({
        archived: true,
        reviewStatus: 'DISPUTED',
      });

      const { first, second } = await runTwice();

      expect(first.liveLeadRefusedFolds).toEqual([
        { shellId: String(shell), canonicalId: String(holder) },
      ]);
      expect(first.shellsMerged).toBe(0);
      expect((await researcherState(shell)).archived).toBe(false);
      const edge = await db().collection('role_assignments').findOne({ _id: shellEdge });
      expect(edge!.archived).toBe(false);
      expect(String(edge!.personId)).toBe(String(shell));
      expect(second.liveLeadRefusedFolds).toHaveLength(1);
    });

    it('lets the same spacing variant fold when the survivor still leads the row, once', async () => {
      const { holder, shell } = await seedSpacingPair({ archived: false });

      const { first, second } = await runTwice();

      expect(first.liveLeadRefusedFolds).toEqual([]);
      expect(first.foldsByMatchedIdentity.name).toBe(1);
      expect(String((await researcherState(shell)).dedupedIntoResearcherId)).toBe(String(holder));
      expect(second.shellsMerged).toBe(0);
    });

    it('reports a scoped run naming a refused shell as not planned', async () => {
      const { shell } = await seedSpacingPair({ archived: true, reviewStatus: 'DISPUTED' });

      const result = await dedupeAccountlessResearcherShells({
        apply: false,
        onlyShellIds: [String(shell)],
      });

      expect(result.onlyShellsNotPlanned).toEqual([String(shell)]);
    });
  });
});
