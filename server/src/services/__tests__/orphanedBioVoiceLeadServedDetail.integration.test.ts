import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
  syncEntity: meiliMocks.syncEntity,
  deleteFromIndex: meiliMocks.deleteFromIndex,
}));

import { getResearchGroupDetail } from '../researchGroupService';

interface SeedRow {
  slug: string;
  name: string;
  displayName?: string;
  kind: string;
  entityType: string;
  leadDisplayName: string;
  shortDescription: string;
  fullDescription: string;
}

const BIO_VOICE_ROWS: SeedRow[] = [
  {
    slug: 'fixture-arc-lab',
    name: 'Analog and RF Circuits (ARC) Lab',
    kind: 'lab',
    entityType: 'LAB',
    leadDisplayName: 'Marisol Okonkwo',
    shortDescription:
      'Studies analog, RF, and mm-wave integrated circuits for wireless and imaging systems.',
    fullDescription:
      'His research focuses on analog, RF, and mm-wave integrated circuits for wireless and imaging systems, combining transistor-level design, on-wafer measurement of prototype receivers, and system-level modelling of link budgets to build radios that hold their noise figure at millimetre-wave carriers.',
  },
  {
    slug: 'fixture-cellular-imaging-core',
    name: 'Cellular Imaging Core',
    kind: 'core_facility',
    entityType: 'CORE_FACILITY',
    leadDisplayName: 'Priya Raghunathan',
    shortDescription:
      'Studies the epidemiology of vector-borne disease using shared high-resolution imaging instrumentation.',
    fullDescription:
      'She holds a joint appointment and studies the epidemiology of vector-borne disease in the tropics, running confocal and light-sheet instrumentation for collaborators, training new users on sample preparation, and maintaining the analysis pipelines that turn imaging stacks into vector population estimates.',
  },
  {
    slug: 'fixture-fra-statistical-genetics',
    name: 'Statistical Genetics Faculty Research',
    displayName: 'Robin Hansen',
    kind: 'individual',
    entityType: 'FACULTY_RESEARCH_AREA',
    leadDisplayName: 'Robin Hansen',
    shortDescription:
      'Studies the statistical genetics of complex traits and their shared genetic architecture.',
    fullDescription:
      'I currently focus on the statistical genetics of complex traits and their shared architecture, developing estimators for polygenic overlap, applying them to biobank-scale cohorts, and testing whether the resulting risk scores transfer across ancestry groups.',
  },
  {
    slug: 'fixture-microfluidics-group',
    name: 'Microfluidic Systems Group',
    kind: 'lab',
    entityType: 'LAB',
    leadDisplayName: 'Tobias Ferrand',
    shortDescription:
      'Studies single-cell measurement using custom microfluidic devices and droplet assays.',
    fullDescription:
      "We're fascinated by how single cells differ from their neighbours, so we build custom microfluidic devices, droplet encapsulation assays, and imaging readouts that let a single experiment follow thousands of individual cells through a perturbation.",
  },
  // The FRA name shape the repository documents for a person whose stored
  // displayName carries an initial the roster row does not, which is the row the
  // mismatched-person-name guard would otherwise blank once the credential
  // opener is stripped and the pipeline itself synthesizes the possessive lead.
  {
    slug: 'fixture-fra-initialled-name',
    name: 'Health Policy Modeling Faculty Research',
    displayName: 'A. David Paltiel',
    kind: 'individual',
    entityType: 'FACULTY_RESEARCH_AREA',
    leadDisplayName: 'David Paltiel',
    shortDescription:
      'Studies cost-effectiveness modelling of screening and treatment policy for infectious disease.',
    fullDescription:
      'A. David Paltiel is a professor at the School of Public Health. His research focuses on the cost-effectiveness of screening and treatment policy for infectious disease, building decision-analytic models of testing cadence, calibrating them against observed epidemic trajectories, and reporting the budget impact of each candidate policy.',
  },
];

const seedRow = async (row: SeedRow) => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db');
  const entityId = new mongoose.Types.ObjectId();
  const personId = new mongoose.Types.ObjectId();
  const sourceUrl = `https://example-research.invalid/${row.slug}/`;
  await db.collection('research_entities').insertOne({
    _id: entityId,
    slug: row.slug,
    name: row.name,
    ...(row.displayName ? { displayName: row.displayName } : {}),
    kind: row.kind,
    entityType: row.entityType,
    archived: false,
    departments: ['Biomedical Engineering'],
    researchAreas: ['Instrumentation', 'Quantitative methods'],
    studentVisibilityTier: 'student_ready',
    studentVisibilityReasons: ['source_backed_description', 'concrete_next_step'],
    shortDescription: row.shortDescription,
    fullDescription: row.fullDescription,
    websiteUrl: sourceUrl,
    sourceUrls: [sourceUrl],
    fieldProvenance: {
      shortDescription: { sourceName: 'fixture-source', sourceUrl },
      fullDescription: { sourceName: 'fixture-source', sourceUrl },
      ...(row.displayName ? { displayName: { sourceName: 'fixture-source', sourceUrl } } : {}),
    },
  });
  await db.collection('researchers').insertOne({
    _id: personId,
    displayName: row.leadDisplayName,
    archived: false,
  });
  await db.collection('role_assignments').insertOne({
    personId,
    target: { kind: 'RESEARCH_ENTITY', id: entityId },
    role: 'PI',
    state: 'CURRENT',
    archived: false,
    verifiedAt: new Date(),
    source: { name: 'fixture-source', url: sourceUrl },
  });
};

const servedFullDescription = async (slug: string): Promise<string> => {
  const detail = await getResearchGroupDetail(slug);
  const served = (detail as Record<string, any> | null)?.researchEntity as
    | Record<string, any>
    | undefined;
  return typeof served?.fullDescription === 'string' ? served.fullDescription : '';
};

const BIO_VOICE_LEAD_PATTERN = /^(?:He|She|His|Her|Their|I|We)\b/;

describe('a served research body never opens in the scraped bio voice (#1871)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  }, 30000);

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const collection of [
      'research_entities',
      'role_assignments',
      'researchers',
      'signals',
      'observations',
    ]) {
      await db.collection(collection).deleteMany({});
    }
    for (const row of BIO_VOICE_ROWS) await seedRow(row);
  });

  it.each(BIO_VOICE_ROWS.map((row) => [row.slug, row] as const))(
    're-voices the lead of %s rather than withholding the body',
    async (slug, row) => {
      const served = await servedFullDescription(slug);
      expect(served).not.toBe('');
      expect(served).not.toMatch(BIO_VOICE_LEAD_PATTERN);
      expect(served.length).toBeGreaterThan(row.fullDescription.length / 2);
    },
    30000,
  );

  it('keeps the substance of each re-voiced body on the detail page', async () => {
    expect(await servedFullDescription('fixture-arc-lab')).toContain(
      'research focuses on analog, RF, and mm-wave integrated circuits',
    );
    expect(await servedFullDescription('fixture-cellular-imaging-core')).toContain(
      'holds a joint appointment and studies the epidemiology of vector-borne disease',
    );
    expect(await servedFullDescription('fixture-fra-statistical-genetics')).toContain(
      'focuses on the statistical genetics of complex traits',
    );
    expect(await servedFullDescription('fixture-microfluidics-group')).toContain(
      'fascinated by how single cells differ from their neighbours',
    );
  }, 30000);

  it('serves a synthesized possessive lead the roster name does not spell identically', async () => {
    const served = await servedFullDescription('fixture-fra-initialled-name');
    expect(served).not.toBe('');
    expect(served).not.toContain('is a professor at the School of Public Health');
    expect(served).toContain(
      'cost-effectiveness of screening and treatment policy for infectious disease',
    );
  }, 30000);
});
