import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { hermeticChildEnvironment } from '../../test/hermeticEnvironment';

const SCRIPT_PATH = path.resolve(__dirname, '../dedupeResearchEntitiesByPi.ts');
const TSX_BIN = path.resolve(__dirname, '../../../node_modules/.bin/tsx');

const LANES: Record<string, string[]> = {
  default: [],
  funding: ['--funding-only'],
  sharedPerson: ['--shared-person-id'],
  sharedPersonNameAgreed: ['--shared-person-id', '--require-name-agreement'],
  websiteUrl: ['--website-url-only'],
  profileLabUrl: ['--profile-lab-url-only'],
};

type LaneReport = {
  plan: Array<{ canonicalSlug?: string; duplicateSlugs: string[] }>;
  plannedRefusedAsDistinctPeopleGroups?: number;
  applied?: Array<{ refusedAsDistinctPeople?: boolean; archivedEntities?: number }>;
};

const oid = () => new mongoose.Types.ObjectId();
const person = { x: oid(), y: oid(), xEarlierRecord: oid() };
const row = { shared: oid(), xOwn: oid(), yOwn: oid(), yOwnSite: oid() };
const SHARED_SITE = 'https://coastal-sediment.example.edu/';

const db = () => mongoose.connection.db!;

const leadEdge = (
  entityId: mongoose.Types.ObjectId,
  personId: mongoose.Types.ObjectId,
  sourceName: string,
  role = 'PI',
) => ({
  personId,
  target: { kind: 'RESEARCH_ENTITY', id: entityId },
  role,
  state: 'CURRENT',
  confidence: 0.9,
  reviewStatus: 'UNREVIEWED',
  archived: false,
  rosterProvenance: { sourceName },
});

const leadObservation = (
  entityId: mongoose.Types.ObjectId,
  slug: string,
  personId: mongoose.Types.ObjectId,
  sourceName: string,
) => ({
  entityType: 'researchEntity',
  entityId,
  entityKey: slug,
  field: 'inferredPiUserId',
  value: String(personId),
  sourceName,
  sourceUrl: `https://${sourceName}.example.org/${slug}`,
  confidence: 0.9,
  observedAt: new Date('2026-09-01T00:00:00Z'),
  superseded: false,
});

const slugs = {
  shared: 'coastal-sediment-lab',
  xOwn: 'faculty-research-area-ada-quill',
  yOwn: 'faculty-research-area-wren-ortolan',
  yOwnSite: 'ortolan-tidal-lab',
};

const leadsBySlug = new Map<string, string[]>();

/**
 * A lab two genuinely distinct people co-lead, with each person's own rows beside it and
 * a recorded distinct-people verdict between them. `verdictOnEarlierRecord` records it on
 * a researcher that was later folded into one of the two, and `coLeadEvidence` decides
 * whether the second person's edge on the shared lab is grant-only or also a roster edge.
 */
async function seed(options: {
  coLeadEvidence: 'grant-only' | 'grant-and-roster';
  verdictOnEarlierRecord?: boolean;
}) {
  const verdictHolder = options.verdictOnEarlierRecord ? person.xEarlierRecord : person.x;
  await db()
    .collection('researchers')
    .insertMany([
      {
        _id: person.x,
        displayName: 'Ada Quill',
        archived: false,
        ...(options.verdictOnEarlierRecord ? {} : { distinctFromResearcherIds: [person.y] }),
      },
      { _id: person.y, displayName: 'Wren Ortolan', archived: false },
      ...(options.verdictOnEarlierRecord
        ? [
            {
              _id: person.xEarlierRecord,
              displayName: 'Ada Quill',
              archived: true,
              dedupedIntoResearcherId: person.x,
              distinctFromResearcherIds: [person.y],
            },
          ]
        : []),
    ]);
  expect(verdictHolder).toBeDefined();
  await db()
    .collection('research_entities')
    .insertMany([
      {
        _id: row.shared,
        slug: slugs.shared,
        name: 'Coastal Sediment Lab',
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: SHARED_SITE,
        sourceUrls: [SHARED_SITE],
        researchAreas: ['Sediment transport'],
        fullDescription: 'The lab studies how sediment moves along tidal coastlines.',
        archived: false,
      },
      {
        _id: row.xOwn,
        slug: slugs.xOwn,
        name: 'Ada Quill Faculty Research',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        sourceUrls: ['https://dept.example.edu/people/ada-quill'],
        archived: false,
      },
      {
        _id: row.yOwn,
        slug: slugs.yOwn,
        name: 'Wren Ortolan Faculty Research',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        sourceUrls: ['https://dept.example.edu/people/wren-ortolan'],
        archived: false,
      },
      {
        _id: row.yOwnSite,
        slug: slugs.yOwnSite,
        name: 'Wren Ortolan Lab',
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: SHARED_SITE,
        sourceUrls: [SHARED_SITE],
        archived: false,
      },
    ]);
  const edges = [
    leadEdge(row.shared, person.x, 'dept-faculty-roster'),
    leadEdge(row.shared, person.y, 'nih-reporter'),
    leadEdge(row.xOwn, person.x, 'dept-faculty-roster'),
    leadEdge(row.yOwn, person.y, 'dept-faculty-roster'),
    leadEdge(row.yOwnSite, person.y, 'lab-microsite'),
  ];
  const observations = [
    leadObservation(row.shared, slugs.shared, person.x, 'dept-faculty-roster'),
    leadObservation(row.shared, slugs.shared, person.y, 'nih-reporter'),
    leadObservation(row.xOwn, slugs.xOwn, person.x, 'dept-faculty-roster'),
    leadObservation(row.yOwn, slugs.yOwn, person.y, 'dept-faculty-roster'),
    leadObservation(row.yOwnSite, slugs.yOwnSite, person.y, 'lab-microsite'),
  ];
  if (options.coLeadEvidence === 'grant-and-roster') {
    edges.push(leadEdge(row.shared, person.y, 'official-roster', 'DIRECTOR'));
    observations.push(leadObservation(row.shared, slugs.shared, person.y, 'lab-people-page'));
  }
  await db().collection('role_assignments').insertMany(edges);
  await db().collection('observations').insertMany(observations);
  leadsBySlug.clear();
  leadsBySlug.set(slugs.shared, [String(person.x), String(person.y)]);
  leadsBySlug.set(slugs.xOwn, [String(person.x)]);
  leadsBySlug.set(slugs.yOwn, [String(person.y)]);
  leadsBySlug.set(slugs.yOwnSite, [String(person.y)]);
}

function runLane(mongoUrl: string, args: string[]): Promise<LaneReport> {
  const outputPath = path.join(
    os.tmpdir(),
    `distinct-people-fold-${process.pid}-${new mongoose.Types.ObjectId()}.json`,
  );
  return new Promise((resolve, reject) => {
    const child = spawn(
      TSX_BIN,
      [SCRIPT_PATH, ...args, '--limit=10000', '--full-plan', '--output', outputPath],
      {
        cwd: path.resolve(__dirname, '../../..'),
        env: hermeticChildEnvironment({ MONGODBURL: mongoUrl, NODE_ENV: 'test' }),
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr?.on('data', (chunk) => (stderr += String(chunk)));
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`lane ${args.join(' ')} exited ${code}: ${stderr}`));
      const report = JSON.parse(fs.readFileSync(outputPath, 'utf8')) as LaneReport;
      fs.unlinkSync(outputPath);
      resolve(report);
    });
  });
}

const joinsTheTwoPeople = (group: { canonicalSlug?: string; duplicateSlugs: string[] }) => {
  const sides = [group.canonicalSlug ?? '', ...group.duplicateSlugs].map(
    (slug) => new Set(leadsBySlug.get(slug) ?? []),
  );
  const x = String(person.x);
  const y = String(person.y);
  const holders = sides.filter((side) => side.has(x) || side.has(y));
  return (
    holders.some((side) => side.has(x)) &&
    holders.some((side) => side.has(y)) &&
    !holders.every((side) => side.has(x) && side.has(y))
  );
};

async function dryRunEveryLane(mongoUrl: string) {
  const entries = await Promise.all(
    Object.entries(LANES).map(
      async ([lane, args]) => [lane, await runLane(mongoUrl, args)] as const,
    ),
  );
  return Object.fromEntries(entries);
}

async function liveSlugs(): Promise<string[]> {
  return (
    await db()
      .collection('research_entities')
      .find({ archived: { $ne: true } }, { projection: { slug: 1 } })
      .toArray()
  )
    .map((doc) => String(doc.slug))
    .sort();
}

describe('every research-row fold lane honours a recorded distinct-people verdict (#5802)', () => {
  let mongod: MongoMemoryServer;
  let mongoUrl: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    mongoUrl = mongod.getUri('yale_research_dev');
    await mongoose.connect(mongoUrl);
  });

  afterAll(async () => {
    await mongoose.disconnect().catch(() => {});
    await mongod?.stop();
  });

  beforeEach(async () => {
    for (const name of ['research_entities', 'role_assignments', 'researchers', 'observations']) {
      await db().collection(name).deleteMany({});
    }
  });

  for (const coLeadEvidence of ['grant-only', 'grant-and-roster'] as const) {
    it(`plans no fold that joins the two people when the co-lead edge is ${coLeadEvidence}`, async () => {
      await seed({ coLeadEvidence });
      const reports = await dryRunEveryLane(mongoUrl);
      for (const [lane, report] of Object.entries(reports)) {
        expect({ lane, joining: report.plan.filter(joinsTheTwoPeople) }).toEqual({
          lane,
          joining: [],
        });
      }
    }, 300_000);
  }

  it('refuses the folds a co-lead gaining roster evidence would otherwise reopen', async () => {
    await seed({ coLeadEvidence: 'grant-and-roster' });
    const reports = await dryRunEveryLane(mongoUrl);
    const refusedByLane = Object.fromEntries(
      Object.entries(reports).map(([lane, report]) => [
        lane,
        report.plannedRefusedAsDistinctPeopleGroups ?? 0,
      ]),
    );
    expect(refusedByLane.default).toBeGreaterThan(0);
  }, 300_000);

  it('reads a verdict recorded on a researcher record that was later folded away', async () => {
    await seed({ coLeadEvidence: 'grant-and-roster', verdictOnEarlierRecord: true });
    const reports = await dryRunEveryLane(mongoUrl);
    for (const [lane, report] of Object.entries(reports)) {
      expect({ lane, joining: report.plan.filter(joinsTheTwoPeople) }).toEqual({
        lane,
        joining: [],
      });
    }
    expect(reports.default.plannedRefusedAsDistinctPeopleGroups).toBeGreaterThan(0);
  }, 300_000);

  it('keeps the split and the genuine co-lead edge across two apply runs of every lane', async () => {
    await seed({ coLeadEvidence: 'grant-and-roster' });
    const before = await liveSlugs();
    for (let pass = 0; pass < 2; pass += 1) {
      for (const args of Object.values(LANES)) {
        const report = await runLane(mongoUrl, [
          ...args,
          '--apply',
          '--confirm-research-entity-pi-dedupe',
          '--max-apply=500',
        ]);
        expect(report.plan.filter(joinsTheTwoPeople)).toEqual([]);
      }
    }
    const after = await liveSlugs();
    expect(after).toEqual(expect.arrayContaining([slugs.shared, slugs.xOwn]));
    expect(before).toEqual(expect.arrayContaining(after));
    const folds = await db()
      .collection('research_entities')
      .find({ archived: true, canonicalGroupId: { $ne: null } })
      .toArray();
    const slugById = new Map(
      (await db().collection('research_entities').find({}).toArray()).map((doc) => [
        String(doc._id),
        String(doc.slug),
      ]),
    );
    for (const fold of folds) {
      expect(
        joinsTheTwoPeople({
          canonicalSlug: slugById.get(String(fold.canonicalGroupId)),
          duplicateSlugs: [String(fold.slug)],
        }),
      ).toBe(false);
    }
    const coLeadEdges = await db()
      .collection('role_assignments')
      .countDocuments({
        'target.id': row.shared,
        personId: person.y,
        archived: { $ne: true },
        state: { $ne: 'HISTORICAL' },
      });
    expect(coLeadEdges).toBeGreaterThan(0);
  }, 600_000);
});
