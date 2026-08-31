import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { ObjectId, type Db, type Document } from 'mongodb';
import '../../models';
import '../../models/canonicalAlias';
import '../../models/observation';
import '../../models/scrapeRun';
import '../../models/scrapeSnapshot';
import {
  applySync,
  assertNoUnclassifiedBetaCollections,
  assertSafeBetaToDevelopmentOptions,
  betaToDevelopmentCollectionNames,
  buildBetaToDevelopmentSummary,
  collectionsForOptions,
  parseBetaToDevelopmentOptions,
  researchPersonAccountIds,
  replaceMongoDatabaseName,
  sanitizeMirroredAccount,
  unclassifiedBetaCollectionNames,
} from '../syncBetaToDevelopment';
import { assertNoNeverCopyCollections } from '../mirrorCollectionPolicy';

const baseEnv = {
  BETA_MONGODBURL: 'mongodb+srv://user:pass@beta.example.test/Beta',
  DEVELOPMENT_MONGODBURL: 'mongodb+srv://user:pass@development.example.test/Development',
};

describe('Beta to Development sync guards', () => {
  it('rolls back every collection when post-cutover verification fails', async () => {
    const createFakeDb = (initial: Record<string, Document[]>) => {
      const data = new Map(
        Object.entries(initial).map(([name, documents]) => [
          name,
          documents.map((document) => ({ ...document })),
        ]),
      );
      const db = {
        createCollection: async (name: string) => {
          data.set(name, []);
        },
        listCollections: (filter: { name?: string } = {}) => ({
          hasNext: async () => (filter.name ? data.has(filter.name) : data.size > 0),
          toArray: async () =>
            [...data.keys()]
              .filter((name) => !filter.name || name === filter.name)
              .map((name) => ({ name })),
        }),
        collection: (name: string) => ({
          indexes: async () => [{ name: '_id_', key: { _id: 1 } }],
          find: () => ({
            async *[Symbol.asyncIterator]() {
              for (const document of data.get(name) || []) yield { ...document };
            },
            close: async () => undefined,
          }),
          countDocuments: async () => (data.get(name) || []).length,
          bulkWrite: async (operations: Array<{ insertOne: { document: Document } }>) => {
            data.get(name)!.push(...operations.map((operation) => operation.insertOne.document));
          },
          createIndexes: async () => undefined,
          rename: async (targetName: string) => {
            if (!data.has(name)) throw new Error(`Missing collection ${name}`);
            if (data.has(targetName)) throw new Error(`Existing collection ${targetName}`);
            data.set(targetName, data.get(name)!);
            data.delete(name);
          },
          drop: async () => {
            data.delete(name);
          },
        }),
      };
      return { db: db as unknown as Db, data };
    };

    const beta = createFakeDb({ research_entities: [{ _id: 'beta' }] });
    const development = createFakeDb({
      research_entities: [{ _id: 'development' }],
      analytics_events: [{ _id: 'local' }],
    });

    await expect(
      applySync(
        beta.db,
        development.db,
        [{ name: 'research_entities', category: 'research-discovery' }],
        ['analytics_events'],
        async () => {
          throw new Error('verification failed');
        },
      ),
    ).rejects.toThrow('verification failed');

    expect(development.data.get('research_entities')).toEqual([{ _id: 'development' }]);
    expect(development.data.get('analytics_events')).toEqual([{ _id: 'local' }]);
    expect([...development.data.keys()].some((name) => name.startsWith('__beta_'))).toBe(false);
  });

  it('keeps the canonical collection validator on the collections it replaces', async () => {
    interface FakeCollection {
      documents: Document[];
      options: Document;
    }
    const createFakeDb = (initial: Record<string, FakeCollection>) => {
      const data = new Map(Object.entries(initial));
      const db = {
        createCollection: async (name: string, options: Document = {}) => {
          data.set(name, { documents: [], options: { ...options } });
        },
        listCollections: (filter: { name?: string } = {}) => ({
          hasNext: async () => (filter.name ? data.has(filter.name) : data.size > 0),
          toArray: async () =>
            [...data.entries()]
              .filter(([name]) => !filter.name || name === filter.name)
              .map(([name, entry]) => ({ name, options: entry.options })),
        }),
        collection: (name: string) => ({
          indexes: async () => [{ name: '_id_', key: { _id: 1 } }],
          find: () => ({
            async *[Symbol.asyncIterator]() {
              for (const document of data.get(name)?.documents || []) yield { ...document };
            },
            close: async () => undefined,
          }),
          countDocuments: async () => (data.get(name)?.documents || []).length,
          bulkWrite: async (operations: Array<{ insertOne: { document: Document } }>) => {
            data
              .get(name)!
              .documents.push(...operations.map((operation) => operation.insertOne.document));
          },
          createIndexes: async () => undefined,
          rename: async (targetName: string) => {
            data.set(targetName, data.get(name)!);
            data.delete(name);
          },
          drop: async () => {
            data.delete(name);
          },
        }),
      };
      return { db: db as unknown as Db, data };
    };

    const accountsValidator = { $jsonSchema: { bsonType: 'object', required: ['netid'] } };
    const signalsValidator = { $jsonSchema: { bsonType: 'object', required: ['type'] } };
    const beta = createFakeDb({
      accounts: {
        documents: [{ _id: 'account-1', netid: 'faculty.person' }],
        options: {
          validator: accountsValidator,
          validationLevel: 'strict',
          validationAction: 'error',
        },
      },
      signals: { documents: [{ _id: 'signal-1' }], options: {} },
    });
    const development = createFakeDb({
      accounts: { documents: [], options: {} },
      signals: { documents: [], options: { validator: signalsValidator } },
    });

    await applySync(
      beta.db,
      development.db,
      [
        { name: 'accounts', category: 'identity-spine' },
        { name: 'signals', category: 'research-discovery' },
      ],
      [],
      async () => undefined,
    );

    expect(development.data.get('accounts')?.options).toEqual({
      validator: accountsValidator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
    expect(development.data.get('signals')?.options).toEqual({ validator: signalsValidator });
  });

  it('defaults to a dry-run from remote Beta to local Development', () => {
    const options = parseBetaToDevelopmentOptions([], baseEnv);

    expect(options).toMatchObject({
      mode: 'dry-run',
      confirmSync: false,
      confirmAtlasDevelopmentOverwrite: false,
      clearDevelopmentNonMirrorData: false,
      includeObservations: false,
    });
    expect(() => assertSafeBetaToDevelopmentOptions(options)).not.toThrow();
  });

  it('prefers an explicit Beta URL over derived Development credentials', () => {
    const options = parseBetaToDevelopmentOptions([], {
      BETA_MONGODBURL: baseEnv.BETA_MONGODBURL,
      DEVELOPMENT_MONGODBURL: baseEnv.DEVELOPMENT_MONGODBURL,
    });

    expect(options.betaUrl).toBe(baseEnv.BETA_MONGODBURL);
    expect(() => assertSafeBetaToDevelopmentOptions(options)).not.toThrow();
  });

  it('requires an explicit confirmation for apply mode', () => {
    const blocked = parseBetaToDevelopmentOptions(['--apply'], baseEnv);
    expect(() => assertSafeBetaToDevelopmentOptions(blocked)).toThrow(
      'Apply mode requires --confirm-beta-to-development',
    );

    const missingAtlasConfirmation = parseBetaToDevelopmentOptions(
      ['--apply', '--confirm-beta-to-development'],
      baseEnv,
    );
    expect(() => assertSafeBetaToDevelopmentOptions(missingAtlasConfirmation)).toThrow(
      'Apply mode requires --confirm-overwrite-atlas-development',
    );

    const allowed = parseBetaToDevelopmentOptions(
      ['--apply', '--confirm-beta-to-development', '--confirm-overwrite-atlas-development'],
      baseEnv,
    );
    expect(() => assertSafeBetaToDevelopmentOptions(allowed)).not.toThrow();
  });

  it('derives the Beta source database from Atlas Development credentials', () => {
    const options = parseBetaToDevelopmentOptions([], {
      MONGODBURL: 'mongodb+srv://user:pass@shared.example.test/Development?retryWrites=true',
    });

    expect(options.betaUrl).toBe(
      'mongodb+srv://user:pass@shared.example.test/Beta?retryWrites=true',
    );
    expect(options.developmentUrl).toBe(
      'mongodb+srv://user:pass@shared.example.test/Development?retryWrites=true',
    );
    expect(replaceMongoDatabaseName(options.developmentUrl, 'Beta')).toBe(options.betaUrl);
  });

  it('makes Development non-mirror cleanup explicit and reviewable', () => {
    const options = parseBetaToDevelopmentOptions(['--clear-development-non-mirror-data'], baseEnv);

    expect(options.clearDevelopmentNonMirrorData).toBe(true);
    const summary = buildBetaToDevelopmentSummary(options, [], [], ['analytics_events']);
    expect(summary.clearsDevelopmentNonMirrorData).toBe(true);
    expect(summary.localCollectionsClearedOnApply).toEqual(['analytics_events']);
    expect(summary.excludedOperationalCollections).toEqual(
      expect.arrayContaining([
        'admin_grants',
        'analytics_events',
        'scrape_job_locks',
        'student_profiles',
      ]),
    );
  });

  it('refuses the wrong source or destination direction', () => {
    const localSource = parseBetaToDevelopmentOptions([], {
      ...baseEnv,
      BETA_MONGODBURL: 'mongodb://127.0.0.1:27017/Beta',
    });
    expect(() => assertSafeBetaToDevelopmentOptions(localSource)).toThrow(
      /Beta source must be a remote MongoDB database named Beta/,
    );

    const localDestination = parseBetaToDevelopmentOptions([], {
      ...baseEnv,
      DEVELOPMENT_MONGODBURL: 'mongodb://127.0.0.1:27017/Development',
    });
    expect(() => assertSafeBetaToDevelopmentOptions(localDestination)).toThrow(
      /Development destination must be remote MongoDB database Development/,
    );

    const productionDestination = parseBetaToDevelopmentOptions([], {
      ...baseEnv,
      DEVELOPMENT_MONGODBURL: 'mongodb://127.0.0.1:27017/Production',
    });
    expect(() => assertSafeBetaToDevelopmentOptions(productionDestination)).toThrow(
      /Development destination must be remote MongoDB database Development/,
    );
  });

  it('copies the research dataset but excludes operational collections', () => {
    const names = betaToDevelopmentCollectionNames();

    expect(names).toEqual(
      expect.arrayContaining([
        'research_entities',
        'research_entity_relationships',
        'research_entity_redirects',
        'signals',
        'researchers',
        'role_assignments',
        'accounts',
        'canonical_aliases',
        'sources',
        'scrape_runs',
        'observations',
        'org_units',
        'taxonomy_terms',
      ]),
    );
    for (const retired of [
      'faculty_members',
      'research_entity_stats',
      'research_scholarly_links',
      'research_scholarly_attributions',
      'researchareas',
      'users',
      'listings',
      'research_entity_members',
      'papers',
      'paper_authors',
      'paper_entity_links',
    ]) {
      expect(names).not.toContain(retired);
    }
    for (const operational of [
      'analytics_events',
      'admin_grants',
      'scrape_job_locks',
      'student_profiles',
    ]) {
      expect(names).not.toContain(operational);
    }
    expect(betaToDevelopmentCollectionNames(false)).not.toContain('observations');
  });

  it('resolves accounts to preserve solely from researchers', async () => {
    const researchAccountId = new ObjectId('507f1f77bcf86cd799439011');
    const unreferencedAccountId = new ObjectId('507f1f77bcf86cd799439012');
    const queriedCollections: string[] = [];
    const distinctById: Record<string, ObjectId[]> = {
      researchers: [researchAccountId, researchAccountId],
      accounts: [researchAccountId, unreferencedAccountId],
    };
    const betaDb = {
      listCollections: (filter: { name?: string } = {}) => ({
        hasNext: async () => filter.name !== undefined && filter.name in distinctById,
      }),
      collection: (name: string) => ({
        distinct: async (field: string) => {
          queriedCollections.push(`${name}.${field}`);
          return distinctById[name] ?? [];
        },
      }),
    } as unknown as Db;

    const resolved = await researchPersonAccountIds(betaDb);

    expect(resolved.map((id) => id.toHexString())).toEqual([researchAccountId.toHexString()]);
    expect(queriedCollections).toEqual(['researchers.accountId']);
  });

  // The previous rule read `faculty_members`, a collection that no longer
  // exists, so it silently protected nothing while every helper-level test
  // passed. Drive the wiring, not the helper.
  it('wires the accounts transform so a non-research account is pseudonymized by value', () => {
    const researchAccountId = new ObjectId('507f1f77bcf86cd799439011');
    const studentAccountId = new ObjectId('507f1f77bcf86cd799439022');
    const collections = collectionsForOptions({ includeObservations: false } as never, [
      researchAccountId,
    ]);
    const accounts = collections.find((collection) => collection.name === 'accounts');

    expect(accounts?.category).toBe('identity-spine');
    expect(accounts?.transform).toBeTypeOf('function');

    const preserved = accounts?.transform?.({
      _id: researchAccountId,
      netid: 'faculty.person',
      email: 'faculty.person@yale.edu',
      status: 'ACTIVE',
      lastLoginAt: new Date('2026-07-25T00:00:00Z'),
      profile: { userType: 'professor', college: 'Example', major: ['Computer Science'] },
    }) as Document;

    expect(preserved.netid).toBe('faculty.person');
    expect(preserved.email).toBe('faculty.person@yale.edu');
    expect(preserved).not.toHaveProperty('lastLoginAt');
    expect(preserved.profile).toEqual({ userType: 'professor' });

    const pseudonymized = accounts?.transform?.({
      _id: studentAccountId,
      netid: 'student.person',
      email: 'student.person@yale.edu',
      status: 'ACTIVE',
      profile: { college: 'Example', major: ['Computer Science'] },
    }) as Document;

    expect(pseudonymized.netid).toBe('mirrored-507f1f77bcf86cd799439022');
    expect(pseudonymized.email).toBe('mirrored-507f1f77bcf86cd799439022@example.invalid');
    expect(pseudonymized).not.toHaveProperty('profile');
  });

  it('strips nested student profile fields and login state from a preserved account', () => {
    const sanitized = sanitizeMirroredAccount({
      _id: 'account-1',
      schemaVersion: 1,
      netid: 'faculty.person',
      email: 'faculty.person@yale.edu',
      status: 'ACTIVE',
      lastLoginAt: new Date('2026-07-25T00:00:00Z'),
      profile: {
        firstName: 'Faculty',
        lastName: 'Person',
        userType: 'professor',
        title: 'Professor of Example Studies',
        department: 'Example Department',
        college: 'Example College',
        year: '2027',
        major: ['Computer Science'],
      },
      archived: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-07-25T00:00:00Z'),
    });

    expect(sanitized).toMatchObject({
      _id: 'account-1',
      schemaVersion: 1,
      netid: 'faculty.person',
      email: 'faculty.person@yale.edu',
      status: 'ACTIVE',
      archived: false,
      profile: {
        firstName: 'Faculty',
        lastName: 'Person',
        userType: 'professor',
        title: 'Professor of Example Studies',
        department: 'Example Department',
      },
    });
    expect(sanitized.profile).not.toHaveProperty('college');
    expect(sanitized.profile).not.toHaveProperty('year');
    expect(sanitized.profile).not.toHaveProperty('major');
    expect(sanitized).not.toHaveProperty('lastLoginAt');
  });

  it('drops the profile entirely when it carries only student PII', () => {
    const sanitized = sanitizeMirroredAccount({
      _id: 'account-2',
      schemaVersion: 1,
      netid: 'student.person',
      email: 'student.person@yale.edu',
      status: 'ACTIVE',
      profile: { college: 'Example College', year: '2027', major: ['Computer Science'] },
      archived: false,
    });

    expect(sanitized).not.toHaveProperty('profile');
  });

  it('pseudonymizes accounts no Researcher references while preserving IDs', () => {
    const id = new ObjectId('507f1f77bcf86cd799439011');
    const sanitized = sanitizeMirroredAccount(
      {
        _id: id,
        schemaVersion: 1,
        netid: 'student.person',
        email: 'student.person@yale.edu',
        status: 'ACTIVE',
        profile: {
          firstName: 'Student',
          lastName: 'Person',
          userType: 'undergraduate',
          college: 'Example College',
          year: '2027',
          major: ['Computer Science'],
        },
        archived: false,
        lastLoginAt: new Date('2026-07-25T00:00:00Z'),
      },
      false,
    );

    expect(sanitized).toMatchObject({
      _id: id,
      schemaVersion: 1,
      netid: 'mirrored-507f1f77bcf86cd799439011',
      email: 'mirrored-507f1f77bcf86cd799439011@example.invalid',
      status: 'ACTIVE',
    });
    expect(sanitized).not.toHaveProperty('profile');
    expect(sanitized).not.toHaveProperty('lastLoginAt');
  });

  it('refuses to mirror environment-local collections and clears the real mirror set', () => {
    expect(() => assertNoNeverCopyCollections(['research_entities', 'analytics_events'])).toThrow(
      /Refusing to mirror environment-local collections: analytics_events/,
    );
    expect(() => assertNoNeverCopyCollections(['scrape_job_locks'])).toThrow(
      /Refusing to mirror environment-local collections: scrape_job_locks/,
    );
    expect(() => assertNoNeverCopyCollections(betaToDevelopmentCollectionNames())).not.toThrow();
    expect(() =>
      assertNoNeverCopyCollections(betaToDevelopmentCollectionNames(false)),
    ).not.toThrow();
  });

  it('classifies every collection the current model can create on Beta', () => {
    const modelCollectionNames = Object.values(mongoose.models).map(
      (model) => model.collection.name,
    );
    expect(modelCollectionNames).toContain('canonical_aliases');
    expect(modelCollectionNames).toContain('observations');

    const mirrorNames = betaToDevelopmentCollectionNames();
    const unclassified = unclassifiedBetaCollectionNames(modelCollectionNames, mirrorNames);

    expect(unclassified).toEqual([]);
    expect(() => assertNoUnclassifiedBetaCollections(unclassified)).not.toThrow();
  });

  it('blocks new Beta collections until their mirror policy is classified', () => {
    const mirrorNames = betaToDevelopmentCollectionNames();
    const unclassified = unclassifiedBetaCollectionNames(
      [...mirrorNames, 'analytics_events', 'new_sensitive_collection'],
      mirrorNames,
    );

    expect(unclassified).toEqual(['new_sensitive_collection']);
    expect(() => assertNoUnclassifiedBetaCollections(unclassified)).toThrow(
      /Beta has unclassified collections: new_sensitive_collection/,
    );
    expect(() => assertNoUnclassifiedBetaCollections([])).not.toThrow();
  });

  it('builds a reviewable sanitized summary', () => {
    const options = parseBetaToDevelopmentOptions([], baseEnv);
    const summary = buildBetaToDevelopmentSummary(options, [
      {
        name: 'research_entities',
        category: 'research-discovery',
        sourceCount: 12,
        sourceCopyCount: 12,
        targetCount: 3,
        excludedCount: 0,
      },
    ]);

    expect(summary).toMatchObject({
      mode: 'dry-run',
      sourceEnvironment: 'beta',
      targetEnvironment: 'development',
      betaTarget: 'beta.example.test/Beta',
      developmentTarget: 'development.example.test/Development',
      includesObservations: false,
      unclassifiedBetaCollections: [],
      localCollectionsClearedOnApply: [],
    });
  });

  it('rejects unsafe output paths and unknown arguments', () => {
    expect(() =>
      parseBetaToDevelopmentOptions(['--output', '/etc/beta-development.json'], baseEnv),
    ).toThrow(/--output must write under/);
    expect(() => parseBetaToDevelopmentOptions(['beta'], baseEnv)).toThrow(
      /Unknown development:refresh-from-beta argument/,
    );
  });
});
