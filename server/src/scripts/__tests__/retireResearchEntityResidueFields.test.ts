import fs from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ResearchEntity } from '../../models/researchEntity';
import {
  assertRetireResearchEntityResidueFieldsApplyAllowed,
  parseRetireResearchEntityResidueFieldsArgs,
  retireResearchEntityResidueFields,
} from '../retireResearchEntityResidueFields';
import {
  RETIRED_RESEARCH_ENTITY_RESIDUE_FIELDS,
  WRITERLESS_RESEARCH_ENTITY_FIELDS,
  assertResidueFieldsFullyUnset,
  snapshotResidueRow,
} from '../retireResearchEntityResidueFieldsCore';

const DEVELOPMENT_URL = 'mongodb://localhost:27017/Development';

describe('retireResearchEntityResidueFields CLI helpers', () => {
  it('defaults to a dry run and parses the apply flags', () => {
    expect(parseRetireResearchEntityResidueFieldsArgs([])).toEqual({
      apply: false,
      confirmRetireResearchEntityResidueFields: false,
    });
    const snapshot = path.join(os.tmpdir(), 'residue-snapshot.json');
    expect(
      parseRetireResearchEntityResidueFieldsArgs([
        '--apply',
        '--confirm-retire-research-entity-residue-fields',
        `--snapshot=${snapshot}`,
      ]),
    ).toEqual({
      apply: true,
      confirmRetireResearchEntityResidueFields: true,
      snapshot,
    });
  });

  it('rejects malformed arguments', () => {
    expect(() => parseRetireResearchEntityResidueFieldsArgs(['prod'])).toThrow(
      /Unknown retire:research-entity-residue-fields argument: prod/,
    );
    expect(() =>
      parseRetireResearchEntityResidueFieldsArgs([
        '--confirm-retire-research-entity-residue-fields=1',
      ]),
    ).toThrow(/does not accept a value/);
    expect(() =>
      parseRetireResearchEntityResidueFieldsArgs(['--snapshot', '/etc/residue.json']),
    ).toThrow(/--snapshot must write under/);
  });

  it('requires confirmation and a snapshot before applying', () => {
    expect(() =>
      assertRetireResearchEntityResidueFieldsApplyAllowed(
        { apply: true, confirmRetireResearchEntityResidueFields: false, snapshot: '/tmp/a.json' },
        { SCRAPER_ENV: 'development' },
        DEVELOPMENT_URL,
      ),
    ).toThrow(/--confirm-retire-research-entity-residue-fields is required/);
    expect(() =>
      assertRetireResearchEntityResidueFieldsApplyAllowed(
        { apply: true, confirmRetireResearchEntityResidueFields: true },
        { SCRAPER_ENV: 'development' },
        DEVELOPMENT_URL,
      ),
    ).toThrow(/--snapshot is required/);
    expect(() =>
      assertRetireResearchEntityResidueFieldsApplyAllowed(
        { apply: false, confirmRetireResearchEntityResidueFields: false },
        { SCRAPER_ENV: 'development' },
        DEVELOPMENT_URL,
      ),
    ).not.toThrow();
  });

  it('refuses a production apply unless the production env vars are set', () => {
    expect(() =>
      assertRetireResearchEntityResidueFieldsApplyAllowed(
        { apply: true, confirmRetireResearchEntityResidueFields: true, snapshot: '/tmp/a.json' },
        { SCRAPER_ENV: 'development' },
        'mongodb://localhost:27017/Prod',
      ),
    ).toThrow(/looks like production/);
  });
});

describe('retireResearchEntityResidueFields invariants', () => {
  it('fails the apply when any retired field survives', () => {
    expect(() => assertResidueFieldsFullyUnset({ location: 0, description: 4 })).toThrow(
      /description on 4/,
    );
    expect(() => assertResidueFieldsFullyUnset({ location: 0, description: 0 })).not.toThrow();
  });

  it('snapshots only the retired fields a row actually carries', () => {
    expect(
      snapshotResidueRow({ _id: 'row-1', name: 'Kept', location: '', departmentIds: ['d'] }),
    ).toEqual({ _id: 'row-1', values: { location: '', departmentIds: ['d'] } });
  });

  it('no longer declares any writerless field on the research-entity schema', () => {
    for (const field of WRITERLESS_RESEARCH_ENTITY_FIELDS) {
      expect(ResearchEntity.schema.path(field)).toBeUndefined();
    }
  });

  it('declares none of the fields it retires', () => {
    for (const field of RETIRED_RESEARCH_ENTITY_RESIDUE_FIELDS) {
      expect(ResearchEntity.schema.path(field)).toBeUndefined();
    }
  });
});

let memoryReplSet: MongoMemoryReplSet | undefined;

describe('retireResearchEntityResidueFields with MongoDB', () => {
  beforeAll(async () => {
    let mongoUrl = process.env.RETIRE_RESEARCH_ENTITY_RESIDUE_TEST_MONGO_URL;
    if (!mongoUrl) {
      memoryReplSet = await MongoMemoryReplSet.create({
        binary: { version: '8.0.12' },
        replSet: { count: 1, storageEngine: 'wiredTiger' },
      });
      mongoUrl = memoryReplSet.getUri('retire_research_entity_residue_test');
    }
    await mongoose.connect(mongoUrl);
  });

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.db!.collection('research_entities').insertMany([
      {
        name: 'Synthetic Residue Lab',
        slug: 'synthetic-residue-lab',
        shortDescription: 'Studies synthetic systems.',
        location: '',
        prerequisiteCourses: [],
        embedding: [],
        accessAcceptanceLevel: 'HIGH',
        description: 'A legacy paragraph.',
        departmentIds: ['dept-synthetic'],
        archiveReason: 'misspelled',
        archived: false,
      },
      {
        name: 'Synthetic Clean Lab',
        slug: 'synthetic-clean-lab',
        shortDescription: 'Already clean.',
        archived: false,
      },
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryReplSet?.stop();
  });

  it('writes nothing in dry-run mode', async () => {
    const result = await retireResearchEntityResidueFields({ apply: false });

    expect(result.mode).toBe('dry-run');
    expect(result.rowsCarryingResidue).toBe(1);
    expect(result.presentBefore.description).toBe(1);
    expect(result.presentAfter.description).toBe(1);
    expect(result.snapshotRows).toBe(0);
  });

  it('refuses to apply without a snapshot path', async () => {
    await expect(retireResearchEntityResidueFields({ apply: true })).rejects.toThrow(
      /--snapshot is required/,
    );
  });

  it('snapshots the values, unsets every retired field and keeps the rest of the row', async () => {
    const snapshot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'residue-')), 'snap.json');
    const result = await retireResearchEntityResidueFields({ apply: true, snapshot });

    expect(result.matched).toBe(1);
    expect(result.snapshotRows).toBe(1);
    expect(Object.values(result.presentAfter).every((count) => count === 0)).toBe(true);

    const written = JSON.parse(fs.readFileSync(snapshot, 'utf8'));
    expect(written.rows).toHaveLength(1);
    expect(written.rows[0].values).toMatchObject({
      accessAcceptanceLevel: 'HIGH',
      description: 'A legacy paragraph.',
      departmentIds: ['dept-synthetic'],
    });

    const row = await mongoose.connection
      .db!.collection('research_entities')
      .findOne({ name: 'Synthetic Residue Lab' });
    for (const field of RETIRED_RESEARCH_ENTITY_RESIDUE_FIELDS) {
      expect(row).not.toHaveProperty(field);
    }
    expect(row?.shortDescription).toBe('Studies synthetic systems.');
  });
});
