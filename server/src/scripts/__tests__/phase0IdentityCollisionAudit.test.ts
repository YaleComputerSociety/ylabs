import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import type { ClientSession, MongoClient } from 'mongodb';
import {
  PHASE0_IDENTITY_MONGO_CLIENT_OPTIONS,
  PHASE0_IDENTITY_SNAPSHOT_SESSION_OPTIONS,
  assertHardenedIdentityCollisionProfile,
  assertPhase0IdentityCollisionAuditTargetAllowed,
  assertStrictIdentityCollisionAuditComplete,
  buildPhase0IdentityFindOptions,
  loadBoundedIdentityAuditUsers,
  parsePhase0IdentityCollisionAuditArgs,
  serializePhase0IdentityCollisionAuditCompletion,
  serializePhase0IdentityCollisionAuditError,
  writePhase0IdentityCollisionAuditOutput,
} from '../phase0IdentityCollisionAudit';

function atlasUrl(database: string): string {
  return `mongodb+srv://identity-reader:unit-test-password@cluster.unit-test.mongodb.net/${database}`;
}

describe('phase0IdentityCollisionAudit CLI', () => {
  it('requires explicit bounded read-only arguments and parses strict mode', () => {
    expect(
      parsePhase0IdentityCollisionAuditArgs([
        '--environment=development',
        '--document-limit=20',
        '--group-limit=10',
        '--group-member-limit=5',
        '--max-time-ms=2500',
        '--strict',
        '--output=/tmp/identity-audit.json',
      ]),
    ).toEqual({
      environment: 'development',
      documentLimit: 20,
      groupLimit: 10,
      groupMemberLimit: 5,
      maxTimeMs: 2500,
      strict: true,
      output: '/tmp/identity-audit.json',
    });
    expect(() =>
      parsePhase0IdentityCollisionAuditArgs([
        '--environment=production',
        '--output=/tmp/identity-audit.json',
      ]),
    ).toThrow(/development, beta, or production-copy/);
    expect(() => parsePhase0IdentityCollisionAuditArgs(['--environment=development'])).toThrow(
      /--output is required/,
    );
    expect(() =>
      parsePhase0IdentityCollisionAuditArgs([
        '--environment=development',
        '--document-limit=1000001',
        '--output=/tmp/identity-audit.json',
      ]),
    ).toThrow(/no greater than 1000000/);
  });

  it('rejects Production and forged Beta targets before a database read', () => {
    expect(() =>
      assertPhase0IdentityCollisionAuditTargetAllowed(
        { environment: 'beta' },
        { MONGODBURL: atlasUrl('Beta') },
      ),
    ).toThrow(/protected profile launcher/);
    expect(() =>
      assertHardenedIdentityCollisionProfile('development', {
        MONGODBURL: atlasUrl('Production'),
      }),
    ).toThrow(/must never target Production/);
  });

  it('revalidates the external profile instead of trusting forged environment flags', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-identity-profile-'));
    fs.chmodSync(directory, 0o700);
    const profilePath = path.join(directory, 'beta-inventory.env');
    fs.writeFileSync(profilePath, `MONGODBURL=${atlasUrl('Beta')}\n`, { mode: 0o600 });
    fs.chmodSync(profilePath, 0o600);
    const baseEnvironment = {
      YLABS_INVENTORY_PROFILE_ACTIVE: 'true',
      YLABS_IDENTITY_AUDIT_PROFILE_ACTIVE: 'true',
      YLABS_INVENTORY_PROFILE_NAME: 'beta-inventory',
      YLABS_INVENTORY_PROFILE_PATH: profilePath,
    };
    try {
      expect(() =>
        assertHardenedIdentityCollisionProfile('beta', {
          ...baseEnvironment,
          MONGODBURL: atlasUrl('Beta'),
        }),
      ).not.toThrow();
      expect(() =>
        assertHardenedIdentityCollisionProfile('beta', {
          ...baseEnvironment,
          MONGODBURL: atlasUrl('ProductionCopy'),
        }),
      ).toThrow(/exactly match/);
      const localProfileUrl = atlasUrl('Beta').replace(
        'cluster.unit-test.mongodb.net',
        'localhost',
      );
      fs.writeFileSync(profilePath, `MONGODBURL=${localProfileUrl}\n`, { mode: 0o600 });
      expect(() =>
        assertHardenedIdentityCollisionProfile('beta', {
          ...baseEnvironment,
          MONGODBURL: localProfileUrl,
        }),
      ).toThrow(/protected Atlas contract/);
      expect(() =>
        assertHardenedIdentityCollisionProfile('production-copy', {
          ...baseEnvironment,
          MONGODBURL: atlasUrl('Beta'),
        }),
      ).toThrow(/hardened external profiles/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('uses only a bounded commented read with low-pool secondary-preferred options', async () => {
    const calls: Array<{ operation: string; value?: unknown }> = [];
    const documents = [
      { _id: 'one', fname: 'One', lname: 'Person' },
      { _id: 'two', fname: 'Two', lname: 'Person' },
    ];
    const cursor = {
      sort(value: unknown) {
        calls.push({ operation: 'sort', value });
        return this;
      },
      limit(value: unknown) {
        calls.push({ operation: 'limit', value });
        return this;
      },
      batchSize(value: unknown) {
        calls.push({ operation: 'batchSize', value });
        return this;
      },
      async *[Symbol.asyncIterator]() {
        yield* documents;
      },
    };
    const client = {
      db() {
        return {
          collection(name: string) {
            calls.push({ operation: 'collection', value: name });
            return {
              find(filter: unknown, options: unknown) {
                calls.push({ operation: 'find', value: { filter, options } });
                return cursor;
              },
            };
          },
        };
      },
    } as unknown as MongoClient;
    const session = { snapshotEnabled: true } as unknown as ClientSession;

    const result = await loadBoundedIdentityAuditUsers(client, 1, 4321, session);

    expect(result).toMatchObject({ possibleDocumentTruncation: true });
    expect(calls.map((call) => call.operation)).toEqual([
      'collection',
      'find',
      'sort',
      'limit',
      'batchSize',
    ]);
    expect(buildPhase0IdentityFindOptions(4321, session)).toMatchObject({
      comment: 'ylabs-phase0:identity-collision-audit',
      maxTimeMS: 4321,
      readConcern: { level: 'snapshot' },
      session,
    });
    expect(PHASE0_IDENTITY_MONGO_CLIENT_OPTIONS).toMatchObject({
      maxPoolSize: 2,
      retryWrites: false,
    });
    expect(String(PHASE0_IDENTITY_MONGO_CLIENT_OPTIONS.readPreference)).toContain('secondary');
    expect(PHASE0_IDENTITY_SNAPSHOT_SESSION_OPTIONS).toEqual({ snapshot: true });
  });

  it('writes one mode-0600 artifact, refuses overwrite, and keeps stdout aggregate-free', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-identity-output-'));
    const output = path.join(directory, 'identity.json');
    try {
      writePhase0IdentityCollisionAuditOutput({ private: 'evidence' }, output);
      expect(fs.statSync(output).mode & 0o777).toBe(0o600);
      expect(() =>
        writePhase0IdentityCollisionAuditOutput({ private: 'replacement' }, output),
      ).toThrow(/never overwritten/);
      const completion = serializePhase0IdentityCollisionAuditCompletion({
        environment: 'beta',
        db: 'Beta',
        sourceCommit: 'a'.repeat(40),
      });
      expect(completion).not.toContain('count');
      expect(completion).not.toContain('private');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects output directories reached through a symlink', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-identity-symlink-'));
    const targetDirectory = path.join(directory, 'target');
    const linkDirectory = path.join(directory, 'link');
    fs.mkdirSync(targetDirectory);
    fs.symlinkSync(targetDirectory, linkDirectory);
    try {
      expect(() =>
        writePhase0IdentityCollisionAuditOutput(
          { private: 'evidence' },
          path.join(linkDirectory, 'identity.json'),
        ),
      ).toThrow(/symlink components/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('redacts filesystem paths from the top-level operator error surface', () => {
    const sentinel = '/tmp/private-phase0-package/sentinel-identity.json';
    const serialized = serializePhase0IdentityCollisionAuditError(
      Object.assign(new Error(`EACCES: permission denied, open '${sentinel}'`), {
        code: 'EACCES',
      }),
    );
    expect(serialized).toBe(
      'Identity-collision audit failed because a protected filesystem operation was unavailable.',
    );
    expect(serialized).not.toContain(sentinel);
  });

  it('reports numeric Mongo errors as database failures instead of filesystem failures', () => {
    const serialized = serializePhase0IdentityCollisionAuditError(
      Object.assign(new Error('snapshot read concern is unavailable'), {
        name: 'MongoServerError',
        code: 246,
      }),
    );
    expect(serialized).toBe('Identity-collision audit failed during the protected database read.');
    expect(serialized).not.toContain('filesystem');
  });

  it('fails strict evidence when any bound is reached', () => {
    expect(() =>
      assertStrictIdentityCollisionAuditComplete(true, {
        scan: { countSemantics: 'bounded-lower-bound' },
      }),
    ).toThrow(/truncated/);
    expect(() =>
      assertStrictIdentityCollisionAuditComplete(true, {
        scan: { countSemantics: 'complete-within-document-scan' },
      }),
    ).not.toThrow();
  });
});
