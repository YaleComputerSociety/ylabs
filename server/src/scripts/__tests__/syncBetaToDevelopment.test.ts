import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { type Db, type Document } from 'mongodb';
import '../../models';
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
  localNonMirrorCollectionNames,
  parseBetaToDevelopmentOptions,
  preservedDevelopmentCollectionNames,
  replaceMongoDatabaseName,
  unclassifiedBetaCollectionNames,
} from '../syncBetaToDevelopment';
import {
  assertEnvironmentLocalCollectionsClassified,
  assertNoNeverCopyCollections,
  assertNoPreservedCollectionsCleared,
  EPHEMERAL_ENVIRONMENT_LOCAL_COLLECTIONS,
  NEVER_COPY_COLLECTIONS,
  PRESERVED_ENVIRONMENT_LOCAL_COLLECTIONS,
} from '../mirrorCollectionPolicy';

const matchesFilter = (document: Document, filter: Document = {}): boolean =>
  Object.entries(filter).every(([field, condition]) => {
    if (condition && typeof condition === 'object' && '$nin' in condition) {
      return !(condition.$nin as unknown[]).includes(document[field] ?? null);
    }
    return document[field] === condition;
  });

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
          countDocuments: async (filter?: Document) =>
            (data.get(name) || []).filter((document) => matchesFilter(document, filter)).length,
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
      scrape_snapshots: [{ _id: 'local' }],
    });

    await expect(
      applySync(
        beta.db,
        development.db,
        [{ name: 'research_entities', category: 'research-discovery' }],
        ['scrape_snapshots'],
        async () => {
          throw new Error('verification failed');
        },
      ),
    ).rejects.toThrow('verification failed');

    expect(development.data.get('research_entities')).toEqual([{ _id: 'development' }]);
    expect(development.data.get('scrape_snapshots')).toEqual([{ _id: 'local' }]);
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
            toArray: async () =>
              (data.get(name)?.documents || []).map((document) => ({ ...document })),
            close: async () => undefined,
          }),
          distinct: async (field: string) => [
            ...new Set((data.get(name)?.documents || []).map((document) => document[field])),
          ],
          countDocuments: async (filter?: Document) =>
            (data.get(name)?.documents || []).filter((document) => matchesFilter(document, filter))
              .length,
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

    const researchersValidator = {
      $jsonSchema: { bsonType: 'object', required: ['displayName'] },
    };
    const signalsValidator = { $jsonSchema: { bsonType: 'object', required: ['type'] } };
    const beta = createFakeDb({
      researchers: {
        documents: [{ _id: 'researcher-1', displayName: 'Faculty Person' }],
        options: {
          validator: researchersValidator,
          validationLevel: 'strict',
          validationAction: 'error',
        },
      },
      signals: { documents: [{ _id: 'signal-1' }], options: {} },
    });
    const development = createFakeDb({
      researchers: { documents: [], options: {} },
      signals: { documents: [], options: { validator: signalsValidator } },
    });

    await applySync(
      beta.db,
      development.db,
      [
        { name: 'researchers', category: 'identity-spine' },
        { name: 'signals', category: 'research-discovery' },
      ],
      [],
      async () => undefined,
    );

    expect(development.data.get('researchers')?.options).toEqual({
      validator: researchersValidator,
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
    const summary = buildBetaToDevelopmentSummary(
      options,
      [],
      [],
      ['scrape_job_locks'],
      ['lane_benchmarks'],
    );
    expect(summary.clearsDevelopmentNonMirrorData).toBe(true);
    expect(summary.localCollectionsClearedOnApply).toEqual(['scrape_job_locks']);
    expect(summary.localCollectionsPreservedOnApply).toEqual(['lane_benchmarks']);
    expect(summary.excludedOperationalCollections).toEqual(
      expect.arrayContaining([
        'admin_grants',
        'analytics_events',
        'scrape_job_locks',
        'student_profiles',
      ]),
    );
  });

  it('keeps every environment-local measurement collection out of the cleared set', () => {
    const developmentCollections = [
      ...PRESERVED_ENVIRONMENT_LOCAL_COLLECTIONS,
      ...EPHEMERAL_ENVIRONMENT_LOCAL_COLLECTIONS,
      'research_entities',
      'scrape_snapshots',
      'system.views',
    ];

    const cleared = localNonMirrorCollectionNames(developmentCollections, ['research_entities']);

    for (const preserved of PRESERVED_ENVIRONMENT_LOCAL_COLLECTIONS) {
      expect(cleared).not.toContain(preserved);
    }
    expect(cleared).toEqual(['scrape_job_locks', 'scrape_snapshots']);
    expect(preservedDevelopmentCollectionNames(developmentCollections)).toEqual(
      [...PRESERVED_ENVIRONMENT_LOCAL_COLLECTIONS].sort(),
    );
  });

  it('pins the preserved collections so dropping one from the list fails', () => {
    expect([...PRESERVED_ENVIRONMENT_LOCAL_COLLECTIONS].sort()).toEqual([
      'accounts',
      'analytics_events',
      'corpus_quality_snapshots',
      'engine_benchmark_rows',
      'engine_benchmark_snapshots',
      'engine_benchmarks',
      'gate_scorecard_snapshots',
      'lane_benchmark_pages',
      'lane_benchmarks',
      'lane_scorecard_snapshots',
      'login_signal_tallies',
      'weekly_sweep_runs',
    ]);
    expect(EPHEMERAL_ENVIRONMENT_LOCAL_COLLECTIONS).toEqual(['scrape_job_locks']);
  });

  it('refuses an environment-local collection that is classified neither way', () => {
    expect(() => assertEnvironmentLocalCollectionsClassified()).not.toThrow();

    NEVER_COPY_COLLECTIONS.push('unclassified_instrument_snapshots');
    try {
      expect(() => assertEnvironmentLocalCollectionsClassified()).toThrow(
        /must be classified as preserved or ephemeral/,
      );
    } finally {
      NEVER_COPY_COLLECTIONS.pop();
    }
    expect(() => assertEnvironmentLocalCollectionsClassified()).not.toThrow();
  });

  it('refuses a clear list that names preserved history', () => {
    expect(() => assertNoPreservedCollectionsCleared(['scrape_snapshots'])).not.toThrow();
    expect(() =>
      assertNoPreservedCollectionsCleared(['scrape_snapshots', 'lane_benchmark_pages']),
    ).toThrow(/Refusing to clear environment-local history/);
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
        'signals',
        'researchers',
        'role_assignments',
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
      'accounts',
      'analytics_events',
      'admin_grants',
      'scrape_job_locks',
      'student_profiles',
    ]) {
      expect(names).not.toContain(operational);
    }
    expect(betaToDevelopmentCollectionNames(false)).not.toContain('observations');
  });

  it('refuses a sync whose source corpus still carries an account _id', async () => {
    const source = {
      listCollections: (filter: { name?: string } = {}) => ({
        hasNext: async () => filter.name === 'researchers',
      }),
      collection: () => ({
        countDocuments: async (filter?: Document) =>
          [{ accountId: 'account-1' }, { accountId: null }].filter((document) =>
            matchesFilter(document, filter),
          ).length,
      }),
    } as unknown as Db;

    await expect(
      applySync(
        source,
        {} as Db,
        [{ name: 'researchers', category: 'identity-spine' }],
        [],
        async () => undefined,
      ),
    ).rejects.toThrow(
      'Sync blocked: 1 researchers row carries an account _id in accountId; accounts are environment-local',
    );
  });

  it('never copies accounts and never clears them from the target', () => {
    expect(
      collectionsForOptions({ includeObservations: true }).map(({ name }) => name),
    ).not.toContain('accounts');
    expect(NEVER_COPY_COLLECTIONS).toContain('accounts');
    expect(PRESERVED_ENVIRONMENT_LOCAL_COLLECTIONS).toContain('accounts');
    expect(
      localNonMirrorCollectionNames(['accounts', 'research_entities'], ['research_entities']),
    ).toEqual([]);
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
    expect(modelCollectionNames).not.toContain('canonical_aliases');
    expect(modelCollectionNames).not.toContain('research_entity_redirects');
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
      localCollectionsPreservedOnApply: [],
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
