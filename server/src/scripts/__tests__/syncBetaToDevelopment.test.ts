import { describe, expect, it } from 'vitest';
import { ObjectId, type Db, type Document } from 'mongodb';
import {
  applySync,
  assertNoUnclassifiedBetaCollections,
  assertSafeBetaToDevelopmentOptions,
  betaToDevelopmentCollectionNames,
  buildBetaToDevelopmentSummary,
  parseBetaToDevelopmentOptions,
  researchPersonAccountIds,
  replaceMongoDatabaseName,
  sanitizeMirroredAccount,
  unclassifiedBetaCollectionNames,
} from '../syncBetaToDevelopment';

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
        'sources',
        'scrape_runs',
        'observations',
        'org_units',
        'taxonomy_terms',
      ]),
    );
    expect(names).not.toEqual(
      expect.arrayContaining([
        'faculty_members',
        'research_entity_stats',
        'research_scholarly_links',
        'research_scholarly_attributions',
        'researchareas',
        'users',
        'listings',
      ]),
    );
    expect(names).not.toEqual(
      expect.arrayContaining([
        'analytics_events',
        'admin_grants',
        'scrape_job_locks',
        'student_profiles',
        'papers',
        'paper_authors',
        'paper_entity_links',
        'research_entity_members',
      ]),
    );
    expect(betaToDevelopmentCollectionNames()).not.toContain('research_entity_members');
    expect(betaToDevelopmentCollectionNames(false)).not.toContain('observations');
  });

  it('resolves faculty users to preserve solely from faculty_members without touching the retired member roster', async () => {
    const facultyUserId = new ObjectId('507f1f77bcf86cd799439011');
    const memberOnlyUserId = new ObjectId('507f1f77bcf86cd799439012');
    const queriedCollections: string[] = [];
    const distinctById: Record<string, ObjectId[]> = {
      researchers: [facultyUserId],
      research_entity_members: [memberOnlyUserId],
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

    expect(resolved.map((id) => id.toHexString())).toEqual([facultyUserId.toHexString()]);
    expect(queriedCollections).toContain('researchers.accountId');
    expect(queriedCollections).not.toContain('research_entity_members.userId');
    expect(resolved.map((id) => id.toHexString())).not.toContain(memberOnlyUserId.toHexString());
  });

  it('removes account activity and student fields from copied faculty users', () => {
    const sanitized = sanitizeMirroredAccount({
      _id: 'faculty-1',
      netid: 'faculty.person',
      email: 'faculty.person@yale.edu',
      userType: 'professor',
      fname: 'Faculty',
      lname: 'Person',
      savedResearchEntities: ['research-1'],
      lastLoginAt: new Date('2026-07-25T00:00:00Z'),
      loginCount: 5,
      college: 'Example',
      year: '2027',
    });

    expect(sanitized).toMatchObject({
      _id: 'faculty-1',
      netid: 'faculty.person',
      email: 'faculty.person@yale.edu',
      userType: 'professor',
      fname: 'Faculty',
      lname: 'Person',
    });
    expect(sanitized).not.toHaveProperty('savedResearchEntities');
    expect(sanitized).not.toHaveProperty('lastLoginAt');
    expect(sanitized).not.toHaveProperty('loginCount');
    expect(sanitized).not.toHaveProperty('college');
    expect(sanitized).not.toHaveProperty('year');
  });

  it('pseudonymizes non-faculty users while preserving IDs and roles', () => {
    const id = new ObjectId('507f1f77bcf86cd799439011');
    const sanitized = sanitizeMirroredAccount(
      {
        _id: id,
        netid: 'student.person',
        email: 'student.person@yale.edu',
        userType: 'undergraduate',
        fname: 'Student',
        lname: 'Person',
        college: 'Example',
        major: ['Computer Science'],
        savedResearchEntities: [new ObjectId()],
        lastLoginAt: new Date('2026-07-25T00:00:00Z'),
      },
      false,
    );

    expect(sanitized).toMatchObject({
      _id: id,
      netid: 'mirrored-507f1f77bcf86cd799439011',
      email: 'mirrored-507f1f77bcf86cd799439011@example.invalid',
    });
    expect(sanitized).not.toHaveProperty('college');
    expect(sanitized).not.toHaveProperty('major');
    expect(sanitized).not.toHaveProperty('savedResearchEntities');
    expect(sanitized).not.toHaveProperty('lastLoginAt');
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
