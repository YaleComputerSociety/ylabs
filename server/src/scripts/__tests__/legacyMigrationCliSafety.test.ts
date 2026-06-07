import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  assertLegacyCleanupWriteAllowed,
  buildLegacyCleanupOutput,
  parseLegacyCleanupArgs,
  writeLegacyCleanupOutput,
} from '../cleanupLegacyMongoCollections';
import {
  assertMongoNamingMigrationWriteAllowed,
  buildMongoNamingMigrationOutput,
  parseMongoNamingMigrationArgs,
  writeMongoNamingMigrationOutput,
} from '../migrateMongoNaming';
import {
  assertResearchEntityMigrationWriteAllowed,
  buildResearchEntityMigrationOutput,
  buildResearchEntityMigrationReferenceMatch,
  parseResearchEntityMigrationArgs,
  RESEARCH_ENTITY_MIGRATION_REFERENCE_CHECKS,
  writeResearchEntityMigrationOutput,
} from '../migrateResearchEntities';
import {
  assertResearchEntityCollectionMigrationWriteAllowed,
  buildCollectionMigrationTargetReferenceFilter,
  buildResearchEntityCollectionMigrationOutput,
  parseResearchEntityCollectionMigrationArgs,
  writeResearchEntityCollectionMigrationOutput,
} from '../migrateResearchEntityCollections';

const productionEnv = {
  SCRAPER_ENV: 'production',
  CONFIRM_PROD_SCRAPE: 'false',
} as NodeJS.ProcessEnv;

describe('Mongo naming migration CLI safety helpers', () => {
  it('defaults to dry-run and parses apply/output flags', () => {
    expect(parseMongoNamingMigrationArgs([])).toEqual({ apply: false });
    expect(
      parseMongoNamingMigrationArgs([
        '--apply',
        '--confirm-mongo-naming',
        '--output=/tmp/mongo-naming.json',
      ]),
    ).toEqual({
      apply: true,
      confirmMongoNaming: true,
      output: '/tmp/mongo-naming.json',
    });
  });

  it('rejects malformed Mongo naming migration output paths', () => {
    expect(() => parseMongoNamingMigrationArgs(['--output', '--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseMongoNamingMigrationArgs(['--output=--apply'])).toThrow(
      /--output requires a path/,
    );
  });

  it('blocks production Mongo naming migration applies without confirmation', () => {
    expect(() =>
      assertMongoNamingMigrationWriteAllowed(
        { apply: true, confirmMongoNaming: true },
        productionEnv,
        'mongodb+srv://example.mongodb.net/Production',
      ),
    ).toThrow(/production writes require CONFIRM_PROD_SCRAPE=true/);
  });

  it('requires explicit confirmation before Mongo naming migration apply can run', () => {
    expect(() =>
      assertMongoNamingMigrationWriteAllowed(
        { apply: true },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).toThrow(/--confirm-mongo-naming is required/);

    expect(() =>
      assertMongoNamingMigrationWriteAllowed(
        { apply: true, confirmMongoNaming: true },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).not.toThrow();
  });

  it('adds target metadata and writes Mongo naming migration artifacts', () => {
    const payload = buildMongoNamingMigrationOutput(
      { mode: 'dry-run', collections: [{ from: 'researchgroups', to: 'research_entities' }] },
      {
        environment: 'beta',
        db: 'Beta',
        options: { apply: false, output: '/tmp/mongo-naming.json' },
      },
    );

    expect(payload).toMatchObject({
      mode: 'dry-run',
      collections: [{ from: 'researchgroups', to: 'research_entities' }],
      environment: 'beta',
      db: 'Beta',
      options: { apply: false, output: '/tmp/mongo-naming.json' },
    });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-mongo-naming-'));
    const output = path.join(dir, 'summary.json');
    writeMongoNamingMigrationOutput(payload, output);
    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject(payload);
  });
});

describe('legacy cleanup CLI safety helpers', () => {
  it('parses mode and output flags', () => {
    expect(parseLegacyCleanupArgs(['--verify', '--output', '/tmp/legacy-cleanup.json'])).toEqual({
      mode: 'verify',
      output: '/tmp/legacy-cleanup.json',
    });
    expect(
      parseLegacyCleanupArgs([
        '--drop-legacy',
        '--confirm-drop-legacy',
        '--output=/tmp/legacy-cleanup-drop.json',
      ]),
    ).toEqual({
      mode: 'drop-legacy',
      confirmDropLegacy: true,
      output: '/tmp/legacy-cleanup-drop.json',
    });
  });

  it('rejects malformed legacy cleanup output paths', () => {
    expect(() => parseLegacyCleanupArgs(['--output', '--drop-legacy'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseLegacyCleanupArgs(['--output=--drop-legacy'])).toThrow(
      /--output requires a path/,
    );
  });

  it('blocks production legacy cleanup drops without confirmation', () => {
    expect(() =>
      assertLegacyCleanupWriteAllowed(
        { mode: 'drop-legacy', confirmDropLegacy: true },
        productionEnv,
        'mongodb+srv://example.mongodb.net/Production',
      ),
    ).toThrow(/production writes require CONFIRM_PROD_SCRAPE=true/);
  });

  it('requires explicit confirmation before dropping legacy cleanup collections', () => {
    expect(() =>
      assertLegacyCleanupWriteAllowed(
        { mode: 'drop-legacy' },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).toThrow(/--confirm-drop-legacy is required/);

    expect(() =>
      assertLegacyCleanupWriteAllowed(
        { mode: 'drop-legacy', confirmDropLegacy: true },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).not.toThrow();
  });

  it('adds target metadata and writes cleanup artifacts', () => {
    const payload = buildLegacyCleanupOutput(
      { mode: 'verify', verification: { ok: true } },
      {
        environment: 'beta',
        db: 'Beta',
        options: { mode: 'verify', output: '/tmp/legacy-cleanup.json' },
      },
    );

    expect(payload).toMatchObject({
      mode: 'verify',
      verification: { ok: true },
      environment: 'beta',
      db: 'Beta',
      options: { mode: 'verify', output: '/tmp/legacy-cleanup.json' },
    });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-legacy-cleanup-'));
    const output = path.join(dir, 'summary.json');
    writeLegacyCleanupOutput(payload, output);
    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject(payload);
  });
});

describe('research entity migration CLI safety helpers', () => {
  it('parses mode and output flags', () => {
    expect(parseResearchEntityMigrationArgs(['--rollback-plan', '--output=/tmp/migrate.json'])).toEqual({
      mode: 'rollback-plan',
      confirmResearchEntityMigration: false,
      output: '/tmp/migrate.json',
    });
    expect(parseResearchEntityMigrationArgs([
      '--apply',
      '--confirm-research-entity-migration',
      '--limit=25',
    ])).toEqual({
      mode: 'apply',
      confirmResearchEntityMigration: true,
      limit: 25,
    });
  });

  it('rejects malformed research entity migration output paths', () => {
    expect(() => parseResearchEntityMigrationArgs(['--output', '--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseResearchEntityMigrationArgs(['--output=--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseResearchEntityMigrationArgs(['--limit=bad'])).toThrow(
      /--limit requires a positive integer/,
    );
  });

  it('blocks production research entity migration applies without confirmation', () => {
    expect(() =>
      assertResearchEntityMigrationWriteAllowed(
        { mode: 'apply', confirmResearchEntityMigration: true, limit: 25 },
        productionEnv,
        'mongodb+srv://example.mongodb.net/Production',
      ),
    ).toThrow(/production writes require CONFIRM_PROD_SCRAPE=true/);
  });

  it('requires a bounded limit before research entity migration apply can run', () => {
    expect(() =>
      assertResearchEntityMigrationWriteAllowed(
        { mode: 'apply' },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).toThrow(/--limit is required/);

    expect(() =>
      assertResearchEntityMigrationWriteAllowed(
        { mode: 'apply', confirmResearchEntityMigration: true, limit: 25 },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).not.toThrow();
  });

  it('requires explicit confirmation before research entity migration apply can run', () => {
    expect(parseResearchEntityMigrationArgs(['--apply', '--limit=25'])).toMatchObject({
      mode: 'apply',
      confirmResearchEntityMigration: false,
      limit: 25,
    });

    expect(() =>
      assertResearchEntityMigrationWriteAllowed(
        { mode: 'apply', confirmResearchEntityMigration: false, limit: 25 },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).toThrow(/--confirm-research-entity-migration is required/);
  });

  it('adds target metadata and writes migration artifacts', () => {
    const payload = buildResearchEntityMigrationOutput(
      { mode: 'verify', verification: { ok: true } },
      {
        environment: 'beta',
        db: 'Beta',
        options: { mode: 'verify', output: '/tmp/migrate.json' },
      },
    );

    expect(payload).toMatchObject({
      mode: 'verify',
      verification: { ok: true },
      environment: 'beta',
      db: 'Beta',
      options: { mode: 'verify', output: '/tmp/migrate.json' },
    });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-research-entity-migrate-'));
    const output = path.join(dir, 'summary.json');
    writeResearchEntityMigrationOutput(payload, output);
    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject(payload);
  });

  it('scopes member reference migration checks to live current memberships', () => {
    const memberCheck = RESEARCH_ENTITY_MIGRATION_REFERENCE_CHECKS.find(
      (check) => check.collection === 'research_entity_members',
    );

    expect(memberCheck).toBeDefined();
    expect(buildResearchEntityMigrationReferenceMatch(memberCheck!)).toMatchObject({
      archived: { $ne: true },
      isCurrentMember: { $ne: false },
      researchEntityId: { $exists: true, $ne: null },
    });
  });
});

describe('research entity collection migration CLI safety helpers', () => {
  it('parses mode and output flags', () => {
    expect(
      parseResearchEntityCollectionMigrationArgs([
        '--drop-legacy',
        '--confirm-drop-legacy',
        '--output',
        '/tmp/collections.json',
      ]),
    ).toEqual({
      mode: 'drop-legacy',
      confirmDropLegacy: true,
      output: '/tmp/collections.json',
    });
  });

  it('rejects malformed dependent collection migration output paths', () => {
    expect(() =>
      parseResearchEntityCollectionMigrationArgs(['--output', '--drop-legacy']),
    ).toThrow(/--output requires a path/);
    expect(() =>
      parseResearchEntityCollectionMigrationArgs(['--output=--drop-legacy']),
    ).toThrow(/--output requires a path/);
  });

  it('blocks production dependent collection drops without confirmation', () => {
    expect(() =>
      assertResearchEntityCollectionMigrationWriteAllowed(
        { mode: 'drop-legacy', confirmDropLegacy: true },
        productionEnv,
        'mongodb+srv://example.mongodb.net/Production',
      ),
    ).toThrow(/production writes require CONFIRM_PROD_SCRAPE=true/);
  });

  it('requires explicit confirmation before dropping dependent legacy collections', () => {
    expect(() =>
      assertResearchEntityCollectionMigrationWriteAllowed(
        { mode: 'drop-legacy' },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).toThrow(/--confirm-drop-legacy is required/);

    expect(() =>
      assertResearchEntityCollectionMigrationWriteAllowed(
        { mode: 'drop-legacy', confirmDropLegacy: true },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).not.toThrow();
  });

  it('adds target metadata and writes dependent collection migration artifacts', () => {
    const payload = buildResearchEntityCollectionMigrationOutput(
      { mode: 'verify', verification: { ok: true } },
      {
        environment: 'beta',
        db: 'Beta',
        options: { mode: 'verify', output: '/tmp/collections.json' },
      },
    );

    expect(payload).toMatchObject({
      mode: 'verify',
      verification: { ok: true },
      environment: 'beta',
      db: 'Beta',
      options: { mode: 'verify', output: '/tmp/collections.json' },
    });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-research-entity-collections-'));
    const output = path.join(dir, 'summary.json');
    writeResearchEntityCollectionMigrationOutput(payload, output);
    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject(payload);
  });

  it('scopes dependent member collection reference checks to live current memberships', () => {
    expect(buildCollectionMigrationTargetReferenceFilter('research_entity_members')).toEqual({
      archived: { $ne: true },
      isCurrentMember: { $ne: false },
      researchEntityId: { $exists: true, $ne: null },
    });
  });
});
