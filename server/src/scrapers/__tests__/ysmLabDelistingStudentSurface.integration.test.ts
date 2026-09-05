import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../../services/meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
  syncEntity: meiliMocks.syncEntity,
  deleteFromIndex: meiliMocks.deleteFromIndex,
}));

const probeSourceLink = vi.fn();
vi.mock('../../services/sourceLinkHealth', async () => {
  const actual = await vi.importActual<typeof import('../../services/sourceLinkHealth')>(
    '../../services/sourceLinkHealth',
  );
  return { ...actual, probeSourceLink: (url: string) => probeSourceLink(url) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { getResearchGroupDetail } from '../../services/researchGroupService';
import { runStudentVisibilityGate } from '../../services/studentVisibilityGateService';
import { buildYsmLabIndexHealthSnapshot, parseLabs } from '../sources/ysmAtoZScraper';
import {
  reconcileYsmLabDelistingFromRun,
  YSM_LAB_INDEX_HEALTH_ENTITY_KEY,
  YSM_LAB_INDEX_HEALTH_FIELD,
} from '../ysmLabDelistingReconciler';

const GONE = { status: 404 };
const ALIVE = { status: 200 };

const LIVE_A = { slug: 'ysm-pitt', lastName: 'Pitt', url: 'https://medicine.yale.edu/lab/pitt/' };
const LIVE_B = {
  slug: 'ysm-colon-ramos',
  lastName: 'Ramos',
  url: 'https://medicine.yale.edu/lab/colon-ramos/',
};
const DELISTED = {
  slug: 'ysm-delacruz',
  lastName: 'Delacruz',
  url: 'https://medicine.yale.edu/lab/delacruz/',
};

/**
 * The stored `websiteUrl` values above are the normalized spellings, while the
 * A-Z index writes the casing and separator drift this fixture reproduces
 * (`lab/Pitt`, `lab/colon_ramos`). Both live rows must still read as indexed.
 */
const INDEX_HTML = `
<html><body><table><tbody>
  <tr><td><a href="https://medicine.yale.edu/lab/Pitt/">Pitt Lab</a></td><td>https://medicine.yale.edu/lab/Pitt/</td></tr>
  <tr><td><a href="https://medicine.yale.edu/lab/colon_ramos/">Colon-Ramos Lab</a></td><td>https://medicine.yale.edu/lab/colon_ramos/</td></tr>
</tbody></table></body></html>
`;

const READY_SHORT =
  'Studies neonatal care quality improvement across community hospital nurseries in Connecticut.';
const READY_FULL =
  'The lab studies neonatal care quality improvement across community hospital nurseries, combining bedside outcome audits, staffing and transfer pattern analysis, and implementation trials of standardized resuscitation protocols to reduce avoidable transfers to tertiary intensive care.';

type PersistedVisibility = {
  slug?: string;
  studentVisibilityTier?: string;
  studentVisibilityReasons?: string[];
  studentVisibilitySuppressionReason?: string;
  absentFromIndexSinceRunId?: string;
};

const persisted = (slug: string) =>
  ResearchEntity.findOne({ slug }).lean<PersistedVisibility>() as Promise<PersistedVisibility>;

const servedToStudents = async (slug: string): Promise<boolean> =>
  (await getResearchGroupDetail(slug)) !== null;

describe('a YSM lab YSM deleted and delisted stops being served to students (#2511)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  }, 30000);

  const seedServedLab = async (input: { slug: string; lastName: string; url: string }) => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const entityId = new mongoose.Types.ObjectId();
    await db.collection('research_entities').insertOne({
      _id: entityId,
      slug: input.slug,
      name: `${input.lastName} Neonatal Outcomes Lab`,
      displayName: `${input.lastName} Neonatal Outcomes Lab`,
      kind: 'lab',
      entityType: 'LAB',
      archived: false,
      departments: ['Pediatrics'],
      researchAreas: ['Neonatology', 'Health services research'],
      studentVisibilityTier: 'student_ready',
      studentVisibilityReasons: ['source_backed_description', 'concrete_next_step'],
      shortDescription: READY_SHORT,
      fullDescription: READY_FULL,
      websiteUrl: input.url,
      sourceUrls: [input.url],
      fieldProvenance: {
        shortDescription: { sourceName: 'ysm-atoz-labs', sourceUrl: input.url },
        fullDescription: { sourceName: 'ysm-atoz-labs', sourceUrl: input.url },
        displayName: { sourceName: 'ysm-atoz-labs', sourceUrl: input.url },
      },
    });
    const personId = new mongoose.Types.ObjectId();
    await db.collection('researchers').insertOne({
      _id: personId,
      displayName: `Robin ${input.lastName}`,
      firstName: 'Robin',
      lastName: input.lastName,
      netid: `fixture${input.lastName.toLowerCase()}`,
      archived: false,
    });
    await db.collection('role_assignments').insertOne({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state: 'CURRENT',
      archived: false,
      verifiedAt: new Date(),
      source: { name: 'ysm-atoz-labs', url: input.url },
    });
    return entityId;
  };

  const emitIndexSnapshot = (runId: string, options: { narrowed?: boolean } = {}) => {
    const snapshot = buildYsmLabIndexHealthSnapshot({
      labs: parseLabs(INDEX_HTML),
      narrowed: Boolean(options.narrowed),
    });
    return Observation.create({
      entityType: 'ysmLabIndexHealth',
      entityKey: YSM_LAB_INDEX_HEALTH_ENTITY_KEY,
      field: YSM_LAB_INDEX_HEALTH_FIELD,
      value: snapshot,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'ysm-atoz-labs',
      confidence: 0.9,
      scrapeRunId: new mongoose.Types.ObjectId(runId),
      observedAt: new Date('2026-09-05T00:00:00.000Z'),
    });
  };

  const newRunId = () => new mongoose.Types.ObjectId().toString();

  beforeEach(async () => {
    process.env.SCRAPER_YSM_LAB_DELISTING_DETECTION = 'true';
    probeSourceLink.mockReset();
    probeSourceLink.mockResolvedValue(GONE);
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of [
      'research_entities',
      'role_assignments',
      'researchers',
      'observations',
      'signals',
      'visibility_release_queue_items',
    ]) {
      await db.collection(name).deleteMany({});
    }
    for (const lab of [LIVE_A, LIVE_B, DELISTED]) await seedServedLab(lab);
  });

  afterEach(() => {
    delete process.env.SCRAPER_YSM_LAB_DELISTING_DETECTION;
  });

  it('serves all three labs before the lane runs, including the deleted one', async () => {
    expect(await servedToStudents(DELISTED.slug)).toBe(true);
    expect(await servedToStudents(LIVE_A.slug)).toBe(true);
    expect(await servedToStudents(LIVE_B.slug)).toBe(true);
  }, 30000);

  it('does nothing while the flag is off, even with the index snapshot and a 404 microsite', async () => {
    delete process.env.SCRAPER_YSM_LAB_DELISTING_DETECTION;
    const runOne = newRunId();
    await emitIndexSnapshot(runOne);
    const first = await reconcileYsmLabDelistingFromRun(runOne);
    const runTwo = newRunId();
    await emitIndexSnapshot(runTwo);
    const second = await reconcileYsmLabDelistingFromRun(runTwo);

    expect([first.outcome, second.outcome]).toEqual(['disabled', 'disabled']);
    expect(probeSourceLink).not.toHaveBeenCalled();
    const gone = await persisted(DELISTED.slug);
    expect(gone.studentVisibilitySuppressionReason || '').not.toContain('permanently_closed');
    expect(gone.absentFromIndexSinceRunId || '').toBe('');
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });
    expect(await servedToStudents(DELISTED.slug)).toBe(true);
  }, 30000);

  it('keeps serving the delisted lab after one absent run, so a single blip cannot retire it', async () => {
    const runOne = newRunId();
    await emitIndexSnapshot(runOne);

    const result = await reconcileYsmLabDelistingFromRun(runOne);

    expect(result.outcome).toBe('reconciled');
    expect(result.suppressed).toBe(0);
    expect(result.absenceRecorded).toBe(1);
    expect((await persisted(DELISTED.slug)).absentFromIndexSinceRunId).toBe(runOne);
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });
    expect(await servedToStudents(DELISTED.slug)).toBe(true);
  }, 30000);

  it('stops serving it once a second run confirms absence and the microsite probes 404', async () => {
    const runOne = newRunId();
    await emitIndexSnapshot(runOne);
    await reconcileYsmLabDelistingFromRun(runOne);

    const runTwo = newRunId();
    await emitIndexSnapshot(runTwo);
    const result = await reconcileYsmLabDelistingFromRun(runTwo);

    expect(result.suppressed).toBe(1);
    expect(probeSourceLink).toHaveBeenCalledWith(DELISTED.url);
    const marked = await persisted(DELISTED.slug);
    expect(marked.studentVisibilitySuppressionReason).toBe('permanently_closed');

    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });

    const gated = await persisted(DELISTED.slug);
    expect(gated.studentVisibilityTier).toBe('suppressed');
    expect(gated.studentVisibilityReasons).toContain('permanently_closed');
    expect(await servedToStudents(DELISTED.slug)).toBe(false);
  }, 30000);

  it('keeps the two live labs served through both runs despite index casing and separator drift', async () => {
    const runOne = newRunId();
    await emitIndexSnapshot(runOne);
    await reconcileYsmLabDelistingFromRun(runOne);
    const runTwo = newRunId();
    await emitIndexSnapshot(runTwo);
    await reconcileYsmLabDelistingFromRun(runTwo);

    for (const lab of [LIVE_A, LIVE_B]) {
      const row = await persisted(lab.slug);
      expect(row.studentVisibilitySuppressionReason || '').not.toContain('permanently_closed');
      expect(row.absentFromIndexSinceRunId || '').toBe('');
    }
    expect(probeSourceLink).not.toHaveBeenCalledWith(LIVE_A.url);
    expect(probeSourceLink).not.toHaveBeenCalledWith(LIVE_B.url);

    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });
    expect(await servedToStudents(LIVE_A.slug)).toBe(true);
    expect(await servedToStudents(LIVE_B.slug)).toBe(true);
  }, 30000);

  it('keeps serving a delisted-but-reachable lab, because absence alone never suppresses', async () => {
    probeSourceLink.mockResolvedValue(ALIVE);
    const runOne = newRunId();
    await emitIndexSnapshot(runOne);
    await reconcileYsmLabDelistingFromRun(runOne);
    const runTwo = newRunId();
    await emitIndexSnapshot(runTwo);

    const result = await reconcileYsmLabDelistingFromRun(runTwo);

    expect(result.suppressed).toBe(0);
    expect(result.held).toBe(1);
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });
    expect(await servedToStudents(DELISTED.slug)).toBe(true);
  }, 30000);

  it('freezes the pass when the run only parsed part of the index', async () => {
    const runOne = newRunId();
    await emitIndexSnapshot(runOne, { narrowed: true });

    const result = await reconcileYsmLabDelistingFromRun(runOne);

    expect(result.outcome).toBe('index-not-authoritative');
    expect((await persisted(DELISTED.slug)).absentFromIndexSinceRunId || '').toBe('');
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });
    expect(await servedToStudents(DELISTED.slug)).toBe(true);
  }, 30000);

  it('would have retired every live lab from the pre-fix snapshot shape, which emitted entity slugs', async () => {
    const preFixSlugs = parseLabs(INDEX_HTML).map((lab) => lab.slug);
    expect(preFixSlugs).toEqual(['ysm-pitt', 'ysm-colon_ramos']);
    const emitPreFixSnapshot = (runId: string) =>
      Observation.create({
        entityType: 'ysmLabIndexHealth',
        entityKey: YSM_LAB_INDEX_HEALTH_ENTITY_KEY,
        field: YSM_LAB_INDEX_HEALTH_FIELD,
        value: {
          status: 'ok',
          complete: true,
          discoveredCount: preFixSlugs.length,
          discoveredLabSlugs: preFixSlugs,
        },
        sourceId: new mongoose.Types.ObjectId(),
        sourceName: 'ysm-atoz-labs',
        confidence: 0.9,
        scrapeRunId: new mongoose.Types.ObjectId(runId),
        observedAt: new Date('2026-09-05T00:00:00.000Z'),
      });

    const runOne = newRunId();
    await emitPreFixSnapshot(runOne);
    await reconcileYsmLabDelistingFromRun(runOne);
    const runTwo = newRunId();
    await emitPreFixSnapshot(runTwo);
    const result = await reconcileYsmLabDelistingFromRun(runTwo);

    expect(result.suppressed).toBe(3);
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });
    expect(await servedToStudents(LIVE_A.slug)).toBe(false);
  }, 30000);

  it('skips a row whose suppression reason an operator locked', async () => {
    await ResearchEntity.updateOne(
      { slug: DELISTED.slug },
      { $set: { manuallyLockedFields: ['studentVisibilitySuppressionReason'] } },
    );
    const runOne = newRunId();
    await emitIndexSnapshot(runOne);
    await reconcileYsmLabDelistingFromRun(runOne);
    const runTwo = newRunId();
    await emitIndexSnapshot(runTwo);

    const result = await reconcileYsmLabDelistingFromRun(runTwo);

    expect(result.lockedSkipped).toBe(1);
    expect(result.suppressed).toBe(0);
    const row = await persisted(DELISTED.slug);
    expect(row.studentVisibilitySuppressionReason || '').not.toContain('permanently_closed');
  }, 30000);
});
