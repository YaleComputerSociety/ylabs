import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { ResearchEntity } from '../../models/researchEntity';
import { runDeclaredPageTypeRetype, type PageRead } from '../retypeFromDeclaredPageType';
import { parseDeclaredPageTypeRetypeArgs } from '../retypeFromDeclaredPageTypeCore';

const centerPage: PageRead = {
  status: '200',
  bytes: 4000,
  title: 'Synthetic Center for Fixture Studies',
  heading: 'Synthetic Center for Fixture Studies',
};

describe('research-entity:retype-from-declared-page-type scope and dry run', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    await mongoose.connection.db?.collection('research_entities').deleteMany({});
    await mongoose.connection.db?.collection('observations').deleteMany({});
    for (const slug of ['synthetic-programme-one', 'synthetic-programme-two']) {
      await ResearchEntity.create({
        slug,
        name: 'Fixture Membrane Dynamics',
        entityType: 'LAB',
        kind: 'lab',
        websiteUrl: `https://${slug}.example.edu/`,
        studentVisibilityTier: 'student_ready',
        archived: false,
      });
    }
  });

  const quietly = { pause: async () => undefined, log: () => undefined };

  it('reads only the rows named by --only-slugs', async () => {
    const readPage = vi.fn(async (_url: string) => centerPage);

    const summary = await runDeclaredPageTypeRetype({
      apply: false,
      onlySlugs: new Set(['synthetic-programme-one']),
      readPage,
      ...quietly,
    });

    expect(readPage.mock.calls.map(([url]) => url)).toEqual([
      'https://synthetic-programme-one.example.edu/',
    ]);
    expect(summary.servedLabRowsScanned).toBe(1);
    expect(summary.planned).toBe(1);
    expect(summary.plannedRefusals).toEqual([expect.objectContaining({ declaredType: 'CENTER' })]);
  });

  it('writes nothing on a dry run, though it plans the retype', async () => {
    const summary = await runDeclaredPageTypeRetype({
      apply: false,
      onlySlugs: new Set(['synthetic-programme-one']),
      readPage: async () => centerPage,
      ...quietly,
    });

    const stored = await ResearchEntity.findOne({ slug: 'synthetic-programme-one' }).lean<any>();
    expect(summary.planned).toBe(1);
    expect(summary.refusalsRecorded).toBe(0);
    expect(summary.typesSet).toBe(0);
    expect(stored.entityType).toBe('LAB');
    expect(stored.fieldValueRefusals ?? {}).toEqual({});
  });

  it('retypes only the named row on an apply, through a type-scoped materialize', async () => {
    const summary = await runDeclaredPageTypeRetype({
      apply: true,
      onlySlugs: new Set(['synthetic-programme-one']),
      readPage: async () => centerPage,
      ...quietly,
    });

    const named = await ResearchEntity.findOne({ slug: 'synthetic-programme-one' }).lean<any>();
    const other = await ResearchEntity.findOne({ slug: 'synthetic-programme-two' }).lean<any>();
    expect(summary.typesSet).toBe(1);
    expect(named.entityType).toBe('CENTER');
    expect(other.entityType).toBe('LAB');
    expect(other.fieldValueRefusals ?? {}).toEqual({});
  });
});

describe('parseDeclaredPageTypeRetypeArgs', () => {
  it('reads a dry run, an apply and a slug file', () => {
    expect(parseDeclaredPageTypeRetypeArgs(['--dry-run', '--only-slugs=/tmp/s.txt'])).toEqual({
      apply: false,
      confirmed: false,
      onlySlugsFile: '/tmp/s.txt',
    });
    expect(
      parseDeclaredPageTypeRetypeArgs(['--apply', '--confirm-declared-page-type-retype']),
    ).toEqual({ apply: true, confirmed: true });
  });

  it('refuses an apply that also asks for a dry run, an empty slug file, or an unknown flag', () => {
    expect(() => parseDeclaredPageTypeRetypeArgs(['--apply', '--dry-run'])).toThrow(
      /cannot be combined/,
    );
    expect(() => parseDeclaredPageTypeRetypeArgs(['--only-slugs='])).toThrow(/needs a file path/);
    expect(() => parseDeclaredPageTypeRetypeArgs(['--slug=x'])).toThrow(/Unknown/);
  });
});
