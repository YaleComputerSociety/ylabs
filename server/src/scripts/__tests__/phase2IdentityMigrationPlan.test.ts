import type { ClientSession } from 'mongodb';
import { describe, expect, it } from 'vitest';
import {
  assertStrictPhase2IdentityPlanComplete,
  buildPhase2IdentityFindOptions,
  parsePhase2IdentityMigrationPlanArgs,
  serializePhase2IdentityPlanCompletion,
  serializePhase2IdentityPlanError,
} from '../phase2IdentityMigrationPlan';

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
