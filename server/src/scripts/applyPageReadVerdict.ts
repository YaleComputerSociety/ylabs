/**
 * research-entity:apply-page-read-verdict - applies one of the three verdicts a page
 * read can support on a row whose served heading disagrees with its own type (#3252).
 *
 * Per-row and per-arm by construction, because each verdict rests on a different fact
 * about a different page. `--slug`, `--arm` and `--evidence-url` are all required and
 * there is no bulk mode.
 *
 * Stored fields are set before the rematerialize, which is the ordering established in
 * #3314 and #3322: once a value is refused, the stored value is what the derivation
 * reads, so setting it afterwards would let one pass serve a row whose every candidate
 * had just been refused. Each row is rematerialized twice and re-read, because a
 * correction that holds for one pass, or that needs a lock to hold, is the frozen-field
 * defect under another name.
 *
 *   yarn --cwd server research-entity:apply-page-read-verdict --slug=<slug> \
 *     --arm=promote-declared-lab --evidence-url=<url>
 *   yarn --cwd server research-entity:apply-page-read-verdict --slug=<slug> \
 *     --arm=promote-declared-lab --evidence-url=<url> --apply \
 *     --confirm-page-read-verdict
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { materializeEntity } from '../scrapers/entityMaterializer';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { getResearchGroupDetail } from '../services/researchGroupService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { planFieldValueRefusal } from '../utils/researchEntityFieldValueRefusals';
import { researchEntityTypeNameContradiction } from '../utils/researchHomeNameIdentityAuthority';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import {
  PAGE_READ_ARMS,
  planPageReadVerdict,
  type PageReadArm,
  type PageReadRow,
} from './applyPageReadVerdictCore';

const SCRIPT_NAME = 'research-entity:apply-page-read-verdict';
const CONFIRM_FLAG = '--confirm-page-read-verdict';

const ARM_REFUSAL_RULE: Record<
  PageReadArm,
  'superseded_by_better_source' | 'not_this_rows_research'
> = {
  'promote-declared-lab': 'superseded_by_better_source',
  'refuse-borrowed-site': 'not_this_rows_research',
  'refuse-grafted-organization': 'not_this_rows_research',
};

const ARM_NOTE: Record<PageReadArm, string> = {
  'promote-declared-lab': "the row's own page names the laboratory in its title",
  'refuse-borrowed-site': "the page is a department landing page, not this row's own site",
  'refuse-grafted-organization': 'an affiliated organization was grafted onto a person-scoped row',
};

export function parsePageReadVerdictArgs(argv: readonly string[]): {
  slug: string;
  arm: PageReadArm;
  evidenceUrl: string;
  apply: boolean;
  confirmed: boolean;
} {
  let slug = '';
  let arm = '';
  let evidenceUrl = '';
  let apply = false;
  let confirmed = false;
  for (const raw of argv) {
    if (raw.startsWith('--slug=')) slug = raw.slice('--slug='.length).trim();
    else if (raw.startsWith('--arm=')) arm = raw.slice('--arm='.length).trim();
    else if (raw.startsWith('--evidence-url='))
      evidenceUrl = raw.slice('--evidence-url='.length).trim();
    else if (raw === '--apply') apply = true;
    else if (raw === '--dry-run') apply = false;
    else if (raw === CONFIRM_FLAG) confirmed = true;
    else throw new Error(`Unknown argument: ${raw}`);
  }
  if (!slug) throw new Error('--slug is required: each verdict is a judgement about one row.');
  if (!(PAGE_READ_ARMS as readonly string[]).includes(arm)) {
    throw new Error(`--arm must be one of ${PAGE_READ_ARMS.join(', ')}`);
  }
  if (!evidenceUrl) throw new Error('--evidence-url is required: the page is the evidence.');
  return { slug, arm: arm as PageReadArm, evidenceUrl, apply, confirmed };
}

async function main(): Promise<void> {
  const options = parsePageReadVerdictArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({ scriptName: SCRIPT_NAME, apply: options.apply });
  if (options.apply && !options.confirmed) {
    throw new Error(`${SCRIPT_NAME} --apply requires ${CONFIRM_FLAG}`);
  }
  console.log(
    `Environment: ${guard.environment}; mode: ${options.apply ? 'apply' : 'dry-run'}; arm: ${options.arm}`,
  );

  mongoose.set('autoIndex', false);
  await initializeConnections();
  try {
    const doc = (await ResearchEntity.findOne({ slug: options.slug })
      .select(
        'slug name displayName entityType kind websiteUrl manuallyLockedFields fieldValueRefusals',
      )
      .lean()) as Record<string, any> | null;
    if (!doc) throw new Error('No row carries that slug.');

    const observations = (
      (await Observation.find({
        entityType: 'researchEntity',
        entityKey: options.slug,
        field: { $in: ['entityType', 'kind', 'name', 'displayName', 'websiteUrl'] },
        superseded: { $ne: true },
      })
        .select('field value')
        .lean()) as Array<Record<string, any>>
    ).map((observation) => ({
      field: String(observation.field),
      value: String(observation.value ?? ''),
    }));
    const rowsSharingTheWebsiteUrl = String(doc.websiteUrl ?? '').trim()
      ? await ResearchEntity.countDocuments({
          archived: { $ne: true },
          websiteUrl: doc.websiteUrl,
          slug: { $ne: options.slug },
        })
      : 0;

    const before = await getResearchGroupDetail(options.slug);
    const beforeEntity = (before?.researchEntity ?? {}) as Record<string, unknown>;
    const { plan, refused } = planPageReadVerdict(
      { ...(doc as PageReadRow), observations, rowsSharingTheWebsiteUrl },
      options.arm,
    );

    let refusalsRecorded = 0;
    let servedAfter: Record<string, unknown> = beforeEntity;
    let contradictionAfter = '';
    let lockAfter = 0;

    if (options.apply && plan) {
      let refusals = doc.fieldValueRefusals;
      const set: Record<string, unknown> = { ...plan.set };
      for (const refusal of plan.refusals) {
        const planned = planFieldValueRefusal(refusals, {
          field: refusal.field,
          value: refusal.value,
          rule: ARM_REFUSAL_RULE[options.arm],
          refusedBy: `${SCRIPT_NAME}:${options.arm}`,
          note: ARM_NOTE[options.arm],
          evidenceUrl: options.evidenceUrl,
        });
        Object.assign(set, planned);
        refusals = { ...(refusals ?? {}), ...planned };
        refusalsRecorded += 1;
      }
      await ResearchEntity.updateOne({ slug: options.slug }, { $set: set });

      await materializeEntity('researchEntity', { entityKey: options.slug }, {});
      await materializeEntity('researchEntity', { entityKey: options.slug }, {});

      const regate = (await ResearchEntity.findOne({ slug: options.slug })
        .select('_id manuallyLockedFields')
        .lean()) as Record<string, any> | null;
      lockAfter = Array.isArray(regate?.manuallyLockedFields)
        ? regate.manuallyLockedFields.length
        : 0;
      const gatePlans = await planStudentVisibilityGate({
        collection: 'research',
        mode: 'apply',
        recordIds: regate?._id ? [String(regate._id)] : [],
      });
      await applyStudentVisibilityGatePlans(gatePlans);

      const after = await getResearchGroupDetail(options.slug);
      servedAfter = (after?.researchEntity ?? {}) as Record<string, unknown>;
      contradictionAfter = researchEntityTypeNameContradiction({
        entityType: servedAfter.entityType,
        name: servedAfter.name,
        displayName: servedAfter.displayName,
      });
    }

    console.log(
      JSON.stringify(
        {
          script: SCRIPT_NAME,
          mode: options.apply ? 'apply' : 'dry-run',
          db: mongoose.connection.name,
          arm: options.arm,
          planned: Boolean(plan),
          refusedReason: refused ?? null,
          fieldsToRefuse: plan?.refusals.map((entry) => entry.field) ?? [],
          fieldsToSet: Object.keys(plan?.set ?? {}),
          refusalsRecorded,
          servedTypeBefore: beforeEntity.entityType ?? null,
          servedTypeAfter: servedAfter.entityType ?? null,
          // `||` and not `??`. A cleared `displayName` is the empty string rather than
          // null, so `??` stops there and reports a blank heading for a row serving its
          // `name` perfectly well, which is how this counter accused its own fix once.
          servedHeadingIsNonEmptyAfter: Boolean(
            (String(servedAfter.displayName ?? '') || String(servedAfter.name ?? '')).trim(),
          ),
          contradictionBefore: researchEntityTypeNameContradiction({
            entityType: beforeEntity.entityType,
            name: beforeEntity.name,
            displayName: beforeEntity.displayName,
          }),
          contradictionAfter,
          locksAfterTwoPasses: lockAfter,
          resolvesThroughTheRouteAfter: options.apply ? Object.keys(servedAfter).length > 0 : null,
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
    console.error(`Failed to apply the page-read verdict: ${sanitizeLogValue(err)}`);
    process.exit(1);
  });
}
