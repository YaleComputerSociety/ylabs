import type { ClientSession, MongoClient } from 'mongodb';
import { describe, expect, it } from 'vitest';
import {
  assertStrictPhase2IdentityPlanComplete,
  buildPhase2IdentityCollectionFilter,
  buildPhase2IdentityFindOptions,
  loadPhase2IdentitySnapshot,
  parsePhase2IdentityMigrationPlanArgs,
  serializePhase2IdentityPlanCompletion,
  serializePhase2IdentityPlanError,
} from '../phase2IdentityMigrationPlan';
import { buildPhase2IdentityMigrationPlan } from '../phase2IdentityMigrationPlannerCore';

describe('Phase 2 identity migration plan CLI', () => {
  it('parses a bounded read-only Development plan', () => {
    expect(
      parsePhase2IdentityMigrationPlanArgs([
        '--environment',
        'development',
        '--document-limit',
        '250',
        '--quarantine-limit=50',
        '--max-time-ms',
        '3000',
        '--strict',
        '--output',
        '/tmp/phase2-identity-plan.json',
      ]),
    ).toEqual({
      environment: 'development',
      documentLimit: 250,
      quarantineLimit: 50,
      maxTimeMs: 3000,
      strict: true,
      output: '/tmp/phase2-identity-plan.json',
    });
  });

  it('rejects Production, missing private output, and unbounded values', () => {
    expect(() =>
      parsePhase2IdentityMigrationPlanArgs([
        '--environment',
        'production',
        '--output',
        '/tmp/phase2.json',
      ]),
    ).toThrow(/development, beta, or production-copy/);
    expect(() => parsePhase2IdentityMigrationPlanArgs(['--environment', 'development'])).toThrow(
      /--output is required/,
    );
    expect(() =>
      parsePhase2IdentityMigrationPlanArgs([
        '--environment',
        'development',
        '--document-limit',
        '1000001',
        '--output',
        '/tmp/phase2.json',
      ]),
    ).toThrow(/no greater than 1000000/);
  });

  it('builds snapshot, time-bounded, commented read options', () => {
    const session = {} as ClientSession;
    expect(buildPhase2IdentityFindOptions({ _id: 1 }, 5000, session)).toEqual({
      projection: { _id: 1 },
      comment: 'ylabs-phase2:identity-migration-plan',
      maxTimeMS: 5000,
      readConcern: { level: 'snapshot' },
      session,
    });
  });

  it('scans archived rows so historical memberships and referenced identities are not omitted', () => {
    expect(buildPhase2IdentityCollectionFilter()).toEqual({});
  });

  it('loads bounded research entity existence in the command snapshot and reports truncation', async () => {
    const session = { snapshotEnabled: true } as unknown as ClientSession;
    const rowsByCollection: Record<string, Array<Record<string, unknown>>> = {
      users: [],
      faculty_members: [
        {
          _id: 'faculty-1',
          name: 'Fixture Faculty',
          netid: 'fixture-faculty',
        },
      ],
      research_entity_members: [
        {
          _id: 'membership-1',
          researchGroupId: 'entity-1',
          facultyMemberId: 'faculty-1',
          role: 'pi',
          isCurrentMember: true,
          evidenceStatus: 'verified',
        },
      ],
      research_entities: [{ _id: 'entity-1' }, { _id: 'entity-2' }],
    };
    const calls: Array<{
      collection: string;
      filter?: unknown;
      options?: unknown;
      operation: string;
      value?: unknown;
    }> = [];
    const client = {
      db() {
        return {
          collection(collection: string) {
            calls.push({ collection, operation: 'collection' });
            const cursor = {
              sort(value: unknown) {
                calls.push({ collection, operation: 'sort', value });
                return this;
              },
              limit(value: unknown) {
                calls.push({ collection, operation: 'limit', value });
                return this;
              },
              batchSize(value: unknown) {
                calls.push({ collection, operation: 'batchSize', value });
                return this;
              },
              async *[Symbol.asyncIterator]() {
                yield* rowsByCollection[collection] || [];
              },
            };
            return {
              find(filter: unknown, options: unknown) {
                calls.push({ collection, filter, operation: 'find', options });
                return cursor;
              },
            };
          },
        };
      },
    } as unknown as MongoClient;

    const snapshot = await loadPhase2IdentitySnapshot({
      client,
      documentLimit: 1,
      maxTimeMs: 4321,
      session,
    });
    const report = buildPhase2IdentityMigrationPlan({
      users: snapshot.users.documents,
      facultyMembers: snapshot.facultyMembers.documents,
      memberships: snapshot.memberships.documents,
      knownResearchEntityIds: snapshot.researchEntities.documents,
      environment: 'development',
      databaseName: 'Development',
      sourceCommit: 'a'.repeat(40),
      limits: {
        documentsPerCollection: 1,
        quarantineRecords: 10,
      },
      truncation: {
        users: snapshot.users.truncated,
        facultyMembers: snapshot.facultyMembers.truncated,
        memberships: snapshot.memberships.truncated,
        researchEntities: snapshot.researchEntities.truncated,
      },
      generatedAt: '2026-07-29T00:00:00.000Z',
    });

    expect(
      calls
        .filter(({ operation }) => operation === 'collection')
        .map(({ collection }) => collection),
    ).toEqual(['users', 'faculty_members', 'research_entity_members', 'research_entities']);
    expect(
      calls
        .filter(({ operation }) => operation === 'find')
        .map(({ options }) => (options as { session?: ClientSession }).session),
    ).toEqual([session, session, session, session]);
    expect(
      calls.find(
        ({ collection, operation }) =>
          collection === 'research_entity_members' && operation === 'find',
      ),
    ).toMatchObject({
      options: {
        projection: expect.objectContaining({
          researchEntityId: 1,
          researchGroupId: 1,
        }),
      },
    });
    expect(
      calls.find(
        ({ collection, operation }) => collection === 'research_entities' && operation === 'find',
      ),
    ).toMatchObject({
      filter: {},
      options: {
        projection: { _id: 1 },
        comment: 'ylabs-phase2:identity-migration-plan',
        maxTimeMS: 4321,
        readConcern: { level: 'snapshot' },
        session,
      },
    });
    expect(
      calls.filter(({ operation }) => operation === 'limit').map(({ value }) => value),
    ).toEqual([2, 2, 2, 2]);
    expect(calls.filter(({ operation }) => operation === 'sort').map(({ value }) => value)).toEqual(
      [{ _id: 1 }, { _id: 1 }, { _id: 1 }, { _id: 1 }],
    );
    expect(
      calls.filter(({ operation }) => operation === 'batchSize').map(({ value }) => value),
    ).toEqual([500, 500, 500, 500]);
    expect(snapshot.researchEntities).toEqual({
      documents: ['entity-1'],
      truncated: true,
    });
    expect(report.plannedRoleAssignments).toHaveLength(1);
    expect(report.scan.documentsScanned.researchEntities).toBe(1);
    expect(report.scan.possibleTruncation.researchEntities).toBe(true);
    expect(report.scan.complete).toBe(false);
    expect(() => assertStrictPhase2IdentityPlanComplete(true, report)).toThrow(/was truncated/);
  });

  it('fails closed in strict mode when any evidence is truncated', () => {
    expect(() =>
      assertStrictPhase2IdentityPlanComplete(true, { scan: { complete: false } }),
    ).toThrow(/was truncated/);
    expect(() =>
      assertStrictPhase2IdentityPlanComplete(false, { scan: { complete: false } }),
    ).not.toThrow();
  });

  it('keeps completion aggregate-free and validation errors generic', () => {
    expect(
      JSON.parse(
        serializePhase2IdentityPlanCompletion({
          environment: 'development',
          databaseName: 'Development',
          sourceCommit: 'a'.repeat(40),
        }),
      ),
    ).toEqual({
      status: 'complete',
      environment: 'development',
      databaseName: 'Development',
      sourceCommit: 'a'.repeat(40),
      mode: 'read-only-dry-run',
    });
    expect(serializePhase2IdentityPlanError(new Error('private source id user-123'))).toBe(
      'Phase 2 identity planning failed during protected validation.',
    );
  });
});
