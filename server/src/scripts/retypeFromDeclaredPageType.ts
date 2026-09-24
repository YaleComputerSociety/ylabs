/**
 * research-entity:retype-from-declared-page-type - corrects the type of a row whose
 * served heading contradicts it, using what the row's own site declares about itself
 * (#3304).
 *
 * Why the refusal and not a write to the row. 33 of the 35 rows in this cohort carry a
 * live `entityType` or `kind` observation asserting a lab, written by a directory lane,
 * so setting the stored type is undone by the next materialize pass (#3143). Rewriting
 * the directory lane's observation is not available either: the grant-shell repair may
 * do that because the fixed lane now emits the corrected value from the same URL,
 * whereas a directory lane would still emit `LAB` for these rows, so putting the page's
 * verdict in its mouth fabricates provenance. A refusal is keyed on the value, removes
 * it from the resolver, and leaves the field open to a better rival (#3167).
 *
 * The type then has to come from somewhere, so the row is planned only when the
 * refusal leaves no rival asserting a third type: the stored value becomes the
 * authority the derivation reads, and this sets it to the declared type in the same
 * pass, before the rematerialize. A row with a surviving rival needs the type asserted
 * rather than the old one refused and is refused here as a separate arm.
 *
 * Reads are serial with a browser user agent, because a parallel pass over these hosts
 * returns throttled 403s rather than dead pages. A status with almost no body is the
 * host declining, not the page answering, and is recorded as unread.
 *
 *   yarn --cwd server research-entity:retype-from-declared-page-type
 *   yarn --cwd server research-entity:retype-from-declared-page-type --apply \
 *     --confirm-declared-page-type-retype
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import mongoose from 'mongoose';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { initializeConnections } from '../db/connections';
import { LIVE_ENTITY_FILTER } from '../models/entityArchival';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { materializeEntity } from '../scrapers/entityMaterializer';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { assertPublicHttpUrl } from '../utils/ssrfGuard';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { planFieldValueRefusal } from '../utils/researchEntityFieldValueRefusals';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import {
  planDeclaredPageTypeRetypes,
  rowContradictsItsOwnType,
  type DeclaredTypeRow,
} from './retypeFromDeclaredPageTypeCore';

const SCRIPT_NAME = 'research-entity:retype-from-declared-page-type';
const CONFIRM_FLAG = '--confirm-declared-page-type-retype';
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const READ_SPACING_MS = 1500;
const READ_TIMEOUT_MS = 25_000;

interface PageRead {
  status: string;
  bytes: number;
  title: string;
  heading: string;
}

const firstMatch = (html: string, pattern: RegExp): string => {
  const match = pattern.exec(html);
  if (!match) return '';
  return match[1]
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
};

async function readPage(url: string): Promise<PageRead> {
  try {
    const safeUrl = await assertPublicHttpUrl(url);
    const response = await axios.get(safeUrl.toString(), {
      timeout: READ_TIMEOUT_MS,
      headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: 'text/html' },
      maxRedirects: 5,
      validateStatus: () => true,
      responseType: 'text',
      transformResponse: [(data) => data],
    } as Parameters<typeof axios.get>[1] & { validateStatus: () => boolean });
    const html = typeof response.data === 'string' ? response.data : '';
    return {
      status: String(response.status),
      bytes: html.length,
      title: firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
      heading: firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i),
    };
  } catch (err: any) {
    const status = err?.response?.status ? String(err.response.status) : 'unreachable';
    return { status, bytes: 0, title: '', heading: '' };
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const confirmed = argv.includes(CONFIRM_FLAG);
  const guard = assertScriptApplyAllowed({ scriptName: SCRIPT_NAME, apply });
  if (apply && !confirmed) {
    throw new Error(`${SCRIPT_NAME} --apply requires ${CONFIRM_FLAG}`);
  }
  console.log(`Environment: ${guard.environment}; mode: ${apply ? 'apply' : 'dry-run'}`);

  mongoose.set('autoIndex', false);
  await initializeConnections();
  try {
    const candidates = (await ResearchEntity.find({
      ...LIVE_ENTITY_FILTER,
      entityType: 'LAB',
      studentVisibilityTier: 'student_ready',
    })
      .select(
        'slug name displayName entityType kind websiteUrl manuallyLockedFields fieldValueRefusals',
      )
      .lean()) as Array<Record<string, any>>;

    const contradicting = candidates.filter((row) => rowContradictsItsOwnType(row));
    const withASite = contradicting.filter((row) => String(row.websiteUrl ?? '').trim());
    console.log(
      `Scanned ${candidates.length} served LAB rows; ${contradicting.length} contradict their own heading; ${withASite.length} carry a site to read.`,
    );

    const typeObservations = (await Observation.find({
      entityType: 'researchEntity',
      entityKey: { $in: withASite.map((row) => String(row.slug)) },
      field: { $in: ['entityType', 'kind'] },
      superseded: { $ne: true },
    })
      .select('entityKey field value')
      .lean()) as Array<Record<string, any>>;
    const observationsBySlug = new Map<string, Array<{ field: string; value: string }>>();
    for (const observation of typeObservations) {
      const slug = String(observation.entityKey);
      const entry = { field: String(observation.field), value: String(observation.value ?? '') };
      observationsBySlug.set(slug, [...(observationsBySlug.get(slug) ?? []), entry]);
    }

    const rows: DeclaredTypeRow[] = [];
    for (const row of withASite) {
      const read = await readPage(String(row.websiteUrl));
      rows.push({
        slug: String(row.slug),
        name: row.name,
        displayName: row.displayName,
        entityType: row.entityType,
        kind: row.kind,
        manuallyLockedFields: row.manuallyLockedFields,
        typeObservations: observationsBySlug.get(String(row.slug)) ?? [],
        pageStatus: read.status,
        pageBytes: read.bytes,
        pageTitle: read.title,
        pageHeading: read.heading,
      });
      await sleep(READ_SPACING_MS);
    }

    const outcome = planDeclaredPageTypeRetypes(rows);
    const refusedByReason: Record<string, number> = {};
    for (const entry of outcome.refused) {
      refusedByReason[entry.reason] = (refusedByReason[entry.reason] ?? 0) + 1;
    }
    const plannedByType: Record<string, number> = {};
    for (const plan of outcome.plans) {
      plannedByType[plan.declaredType] = (plannedByType[plan.declaredType] ?? 0) + 1;
    }

    let refusalsRecorded = 0;
    let typesSet = 0;
    let rematerializedTwice = 0;
    let stillAssertingALabAfterTwoPasses = 0;

    if (apply && outcome.plans.length > 0) {
      const docBySlug = new Map(withASite.map((row) => [String(row.slug), row]));
      for (const plan of outcome.plans) {
        const doc = docBySlug.get(plan.slug);
        if (!doc) continue;
        let refusals = doc.fieldValueRefusals;
        const set: Record<string, unknown> = {};
        for (const refusal of plan.refusals) {
          const planned = planFieldValueRefusal(refusals, {
            field: refusal.field,
            value: refusal.value,
            rule: 'superseded_by_better_source',
            refusedBy: SCRIPT_NAME,
            note: "the row's own site declares a different research-home type",
            evidenceUrl: String(doc.websiteUrl ?? ''),
          });
          Object.assign(set, planned);
          refusals = { ...(refusals ?? {}), ...planned };
          refusalsRecorded += 1;
        }
        // The stored type is set in the same operation and before the rematerialize,
        // because once the lab observations are refused the stored value is what the
        // derivation reads. Setting it afterwards would let one pass serve an untyped
        // row.
        set.entityType = plan.declaredType;
        await ResearchEntity.updateOne({ slug: plan.slug }, { $set: set });
        typesSet += 1;

        // Twice, with no lock anywhere: a refusal that only holds for one pass is the
        // frozen-field defect wearing a different name.
        await materializeEntity('researchEntity', { entityKey: plan.slug }, {});
        await materializeEntity('researchEntity', { entityKey: plan.slug }, {});
        rematerializedTwice += 1;

        const after = (await ResearchEntity.findOne({ slug: plan.slug })
          .select('entityType kind manuallyLockedFields')
          .lean()) as Record<string, any> | null;
        if (
          String(after?.entityType ?? '').toUpperCase() === 'LAB' ||
          String(after?.kind ?? '').toLowerCase() === 'lab'
        ) {
          stillAssertingALabAfterTwoPasses += 1;
          console.warn(
            `[declared-page-type] ${sanitizeLogValue(plan.slug)} still asserts a lab after two passes`,
          );
        }
      }

      // Re-gate only the rows this run changed. Stripping or changing a served field
      // without a re-gate is how a row's tier stops matching what it now holds.
      const changed = (await ResearchEntity.find({
        slug: { $in: outcome.plans.map((plan) => plan.slug) },
      })
        .select('_id')
        .lean()) as Array<Record<string, any>>;
      const gatePlans = await planStudentVisibilityGate({
        collection: 'research',
        mode: 'apply',
        recordIds: changed.map((doc) => String(doc._id)),
      });
      await applyStudentVisibilityGatePlans(gatePlans);
    }

    console.log(
      JSON.stringify(
        {
          script: SCRIPT_NAME,
          mode: apply ? 'apply' : 'dry-run',
          db: mongoose.connection.name,
          servedLabRowsScanned: candidates.length,
          contradictingTheirOwnHeading: contradicting.length,
          pagesRead: rows.filter((row) => row.pageStatus === '200' && row.pageBytes >= 500).length,
          planned: outcome.plans.length,
          plannedByDeclaredType: plannedByType,
          refusedByReason,
          refusalsRecorded,
          typesSet,
          rematerializedTwice,
          stillAssertingALabAfterTwoPasses,
        },
        null,
        2,
      ),
    );
  } finally {
    await mongoose.disconnect();
  }
}

const isDirectRun =
  process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (isDirectRun) {
  main().catch((err) => {
    console.error(`Failed to retype from declared page type: ${sanitizeLogValue(err)}`);
    process.exit(1);
  });
}
