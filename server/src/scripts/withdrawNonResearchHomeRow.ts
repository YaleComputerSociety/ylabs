/**
 * research-entity:withdraw-non-research-home-row - takes one row that is not a
 * research home of any modelled type off the served surface, and stops the values that
 * made it one being admissible (#3305).
 *
 * Per-row by construction. Whether a page is a research home is a judgement about that
 * page, so `--slug`, `--kind` and `--evidence-url` are all required and there is no
 * bulk mode, for the same reason `research-entity:refuse-field-value` has none.
 *
 * Order matters and is the point. Archiving alone leaves every observation in place,
 * and a repair scoped to live slugs cannot then see them: an entity-level zero reads as
 * clean while the evidence is still there. So the refusals are recorded first, the row
 * is archived with an attribution second, and the row is rematerialized twice to prove
 * the archive holds without a lock.
 *
 *   yarn --cwd server research-entity:withdraw-non-research-home-row --slug=<slug> \
 *     --kind=blog --evidence-url=<url>
 *   yarn --cwd server research-entity:withdraw-non-research-home-row --slug=<slug> \
 *     --kind=blog --evidence-url=<url> --apply --confirm-non-research-home-withdrawal
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { archivedEntityUpdate } from '../models/entityArchival';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { RoleAssignment } from '../models/roleAssignment';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { getResearchGroupDetail } from '../services/researchGroupService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { planFieldValueRefusal } from '../utils/researchEntityFieldValueRefusals';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import {
  NON_RESEARCH_HOME_KINDS,
  WITHDRAWAL_ARCHIVE_REASON,
  planNonResearchHomeWithdrawal,
  type NonResearchHomeKind,
  type WithdrawalRow,
} from './withdrawNonResearchHomeRowCore';

const SCRIPT_NAME = 'research-entity:withdraw-non-research-home-row';
const CONFIRM_FLAG = '--confirm-non-research-home-withdrawal';

interface Options {
  slug: string;
  kind: NonResearchHomeKind;
  evidenceUrl: string;
  apply: boolean;
  confirmed: boolean;
}

export function parseWithdrawalArgs(argv: readonly string[]): Options {
  let slug = '';
  let kind = '';
  let evidenceUrl = '';
  let apply = false;
  let confirmed = false;
  for (const arg of argv) {
    if (arg.startsWith('--slug=')) slug = arg.slice('--slug='.length).trim();
    else if (arg.startsWith('--kind=')) kind = arg.slice('--kind='.length).trim();
    else if (arg.startsWith('--evidence-url='))
      evidenceUrl = arg.slice('--evidence-url='.length).trim();
    else if (arg === '--apply') apply = true;
    else if (arg === '--dry-run') apply = false;
    else if (arg === CONFIRM_FLAG) confirmed = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!slug) throw new Error('--slug is required: a withdrawal is a judgement about one row.');
  if (!(NON_RESEARCH_HOME_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`--kind must be one of ${NON_RESEARCH_HOME_KINDS.join(', ')}`);
  }
  if (!evidenceUrl) {
    throw new Error('--evidence-url is required: the page is the evidence for the judgement.');
  }
  return { slug, kind: kind as NonResearchHomeKind, evidenceUrl, apply, confirmed };
}

async function main(): Promise<void> {
  const options = parseWithdrawalArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({ scriptName: SCRIPT_NAME, apply: options.apply });
  if (options.apply && !options.confirmed) {
    throw new Error(`${SCRIPT_NAME} --apply requires ${CONFIRM_FLAG}`);
  }
  console.log(
    `Environment: ${guard.environment}; mode: ${options.apply ? 'apply' : 'dry-run'}; kind: ${options.kind}`,
  );

  mongoose.set('autoIndex', false);
  await initializeConnections();
  try {
    const doc = (await ResearchEntity.findOne({ slug: options.slug })
      .select(
        'slug name displayName entityType kind archived manuallyLockedFields fieldValueRefusals',
      )
      .lean()) as Record<string, any> | null;
    if (!doc) throw new Error('No row carries that slug.');

    const roleEdges = await RoleAssignment.countDocuments({
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': doc._id,
      archived: { $ne: true },
    });
    const observationsBefore = await Observation.countDocuments({
      entityType: 'researchEntity',
      entityKey: options.slug,
      superseded: { $ne: true },
    });
    const servedBefore = Boolean(await getResearchGroupDetail(options.slug));

    const { plan, refused } = planNonResearchHomeWithdrawal(doc as WithdrawalRow);
    let refusalsRecorded = 0;
    let archived = false;
    let servedAfter = servedBefore;
    let observationsAfter = observationsBefore;
    let archivedAfterTwoPasses = false;

    if (options.apply && plan) {
      let refusals = doc.fieldValueRefusals;
      const set: Record<string, unknown> = {};
      for (const refusal of plan.refusals) {
        const planned = planFieldValueRefusal(refusals, {
          field: refusal.field,
          value: refusal.value,
          rule: 'operator_judgement',
          refusedBy: SCRIPT_NAME,
          note: `the page is a ${options.kind}, not a research home a student can join`,
          evidenceUrl: options.evidenceUrl,
        });
        Object.assign(set, planned);
        refusals = { ...(refusals ?? {}), ...planned };
        refusalsRecorded += 1;
      }
      // Refusals first, archive second. The archive is what a student stops seeing; the
      // refusals are what stops a later pass restoring it, and recording them on a row
      // that is already archived would be a write nothing re-reads.
      await ResearchEntity.updateOne({ slug: options.slug }, { $set: set });
      await ResearchEntity.updateOne(
        { slug: options.slug },
        archivedEntityUpdate(`${WITHDRAWAL_ARCHIVE_REASON}:${options.kind}`),
      );
      archived = true;

      await materializeEntity('researchEntity', { entityKey: options.slug }, {});
      await materializeEntity('researchEntity', { entityKey: options.slug }, {});
      const after = (await ResearchEntity.findOne({ slug: options.slug })
        .select('archived archivedReason manuallyLockedFields')
        .lean()) as Record<string, any> | null;
      archivedAfterTwoPasses = after?.archived === true;
      servedAfter = Boolean(await getResearchGroupDetail(options.slug));
      observationsAfter = await Observation.countDocuments({
        entityType: 'researchEntity',
        entityKey: options.slug,
        superseded: { $ne: true },
      });
      if (Array.isArray(after?.manuallyLockedFields) && after.manuallyLockedFields.length > 0) {
        console.warn(
          `[withdrawal] ${sanitizeLogValue(options.slug)} carries a lock it did not have`,
        );
      }
    }

    console.log(
      JSON.stringify(
        {
          script: SCRIPT_NAME,
          mode: options.apply ? 'apply' : 'dry-run',
          db: mongoose.connection.name,
          kind: options.kind,
          planned: Boolean(plan),
          refusedReason: refused ?? null,
          valuesToRefuse: plan?.refusals.map((entry) => entry.field) ?? [],
          refusalsRecorded,
          archived,
          archivedAfterTwoPasses,
          servedBefore,
          servedAfter,
          // Observations are deliberately left in place. They are the only record of
          // what the page said, and the refusal is what makes them inert.
          liveObservationsBefore: observationsBefore,
          liveObservationsAfter: observationsAfter,
          liveRoleEdgesBefore: roleEdges,
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
    console.error(`Failed to withdraw the row: ${sanitizeLogValue(err)}`);
    process.exit(1);
  });
}
