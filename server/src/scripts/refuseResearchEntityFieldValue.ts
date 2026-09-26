/**
 * Records that one stored value is inadmissible at one field on one row, or
 * withdraws such a record (#3167).
 *
 * This is the operation a repair should reach for instead of `manuallyLockedFields`.
 * A lock removes the field from derivation forever; a refusal removes one value and
 * leaves the field open, so the row still improves when a better rival arrives.
 *
 * It is also layer 3's only writer. `fieldLockProvenance.operator_decision` has none
 * and deliberately keeps none: a judgement recorded as a lock cannot be revisited and
 * carries no reason, which is the state the #3368 census found 98 lock instances in,
 * every one of them reading `unknown`. `--rule=operator_judgement` therefore demands
 * both halves of the record, a `--note` and a `--decided-by`, because that rule is the
 * one nothing else can ever re-derive.
 *
 * Clearing the stored value is part of recording, not part of materialization. A
 * materializer that unsets a served field on a sweep is how a value disappears
 * without a visibility re-gate, so the clear happens here, once, and the row is
 * re-gated in the same operation. Keeping it clear afterwards is the refusal's job
 * and is what `fieldValueRefusals` exists to do.
 *
 * Per-row by construction: refusing a value is a judgement about a row, so `--slug`
 * and `--value` are both required and no bulk mode exists.
 *
 * Usage:
 *   yarn --cwd server research-entity:refuse-field-value --slug=<slug> \
 *     --field=websiteUrl --value=<url> --rule=wrong_owner --note='why'
 *   Pass --source-name=<lane> when a lane emitted the refused value, so the refusal
 *   divides by lane and that lane's precision has a denominator.
 *   yarn --cwd server research-entity:refuse-field-value --slug=<slug> \
 *     --field=websiteUrl --value=<url> --rule=wrong_owner --apply \
 *     --confirm-field-value-refusal
 *   yarn --cwd server research-entity:refuse-field-value --slug=<slug> \
 *     --field=websiteUrl --value=<url> --rule=operator_judgement --note='why' \
 *     --decided-by='<who>' --apply --confirm-field-value-refusal
 *   yarn --cwd server research-entity:refuse-field-value --slug=<slug> \
 *     --field=websiteUrl --value=<url> --withdraw --note='why' --apply \
 *     --confirm-field-value-refusal
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  fieldValueRefusalKey,
  liveFieldValueRefusals,
  planFieldValueRefusal,
  planFieldValueRefusalWithdrawal,
  perRowFieldValueRefusalRules,
  type FieldValueRefusalRule,
} from '../utils/researchEntityFieldValueRefusals';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

const SCRIPT_NAME = 'research-entity:refuse-field-value';

export interface RefuseFieldValueArgs {
  slug: string;
  field: string;
  value: string;
  rule: FieldValueRefusalRule;
  sourceName?: string;
  note: string;
  /** Who made the judgement, required when the rule is `operator_judgement`. */
  decidedBy?: string;
  evidenceUrl?: string;
  withdraw: boolean;
  apply: boolean;
  confirm: boolean;
}

export function parseRefuseFieldValueArgs(argv: string[]): RefuseFieldValueArgs {
  const args: RefuseFieldValueArgs = {
    slug: '',
    field: '',
    value: '',
    rule: 'operator_judgement',
    note: '',
    withdraw: false,
    apply: false,
    confirm: false,
  };
  for (const arg of argv) {
    if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === '--confirm-field-value-refusal') args.confirm = true;
    else if (arg === '--withdraw') args.withdraw = true;
    else if (arg.startsWith('--slug=')) args.slug = arg.slice('--slug='.length).trim();
    else if (arg.startsWith('--field=')) args.field = arg.slice('--field='.length).trim();
    else if (arg.startsWith('--value=')) args.value = arg.slice('--value='.length).trim();
    else if (arg.startsWith('--note=')) args.note = arg.slice('--note='.length).trim();
    else if (arg.startsWith('--decided-by='))
      args.decidedBy = arg.slice('--decided-by='.length).trim();
    else if (arg.startsWith('--evidence-url='))
      args.evidenceUrl = arg.slice('--evidence-url='.length).trim();
    else if (arg.startsWith('--source-name='))
      args.sourceName = arg.slice('--source-name='.length).trim();
    else if (arg.startsWith('--rule=')) args.rule = arg.slice('--rule='.length).trim() as never;
    else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return args;
}

export function assertRefuseFieldValueArgs(args: RefuseFieldValueArgs): void {
  if (!args.slug) throw new Error('--slug is required: a refusal is a judgement about one row.');
  if (!args.field) throw new Error('--field is required.');
  if (!args.value) throw new Error('--value is required: a refusal names the value it refuses.');
  if (args.withdraw && !args.note) {
    throw new Error('--note is required when withdrawing: a withdrawal records why.');
  }
  // An operator judgement is the one rule nothing can re-derive, so the record has to
  // carry both halves of it: why, and whose. Without them the row holds a veto no
  // later reader can read, which is the state 98 reasonless locks were in (#3368).
  if (!args.withdraw && args.rule === 'operator_judgement') {
    if (!args.note) {
      throw new Error(
        '--note is required for --rule=operator_judgement: nothing else will ever explain it.',
      );
    }
    if (!args.decidedBy) {
      throw new Error(
        '--decided-by is required for --rule=operator_judgement: a judgement names who made it.',
      );
    }
  }
  if (
    !args.withdraw &&
    !(perRowFieldValueRefusalRules as readonly string[]).includes(args.rule) &&
    !args.rule.includes('-')
  ) {
    throw new Error(
      `--rule must be one of ${perRowFieldValueRefusalRules.join(', ')} or a researchHomeWebsiteUrlDecision rule name.`,
    );
  }
  if (args.apply && !args.confirm) {
    throw new Error(`${SCRIPT_NAME} --apply requires --confirm-field-value-refusal.`);
  }
}

async function main(): Promise<void> {
  const args = parseRefuseFieldValueArgs(process.argv.slice(2));
  assertRefuseFieldValueArgs(args);
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();
  try {
    const row = await ResearchEntity.findOne({ slug: args.slug }).lean<Record<string, unknown>>();
    if (!row) throw new Error(`no research entity for the named slug`);

    const refusedKey = fieldValueRefusalKey(args.field, args.value);
    const storedKey = fieldValueRefusalKey(args.field, row[args.field]);
    const clearsStoredValue = !args.withdraw && storedKey !== '' && storedKey === refusedKey;
    const update = args.withdraw
      ? planFieldValueRefusalWithdrawal(row.fieldValueRefusals, args.field, args.value, args.note)
      : planFieldValueRefusal(row.fieldValueRefusals, {
          field: args.field,
          value: args.value,
          rule: args.rule,
          ...(args.sourceName ? { sourceName: args.sourceName } : {}),
          refusedBy: args.decidedBy ? `${SCRIPT_NAME} (${args.decidedBy})` : SCRIPT_NAME,
          note: args.note,
          evidenceUrl: args.evidenceUrl,
        });

    console.log(
      JSON.stringify(
        {
          script: SCRIPT_NAME,
          mode: args.apply ? 'apply' : 'dry-run',
          field: args.field,
          action: args.withdraw ? 'withdraw' : 'refuse',
          rule: args.withdraw ? undefined : args.rule,
          refusedKey,
          storedValueIsTheRefusedValue: clearsStoredValue,
          liveRefusalsBefore: liveFieldValueRefusals(row.fieldValueRefusals, args.field).length,
          alsoStillLocked: Array.isArray(row.manuallyLockedFields)
            ? (row.manuallyLockedFields as string[]).includes(args.field)
            : false,
        },
        null,
        2,
      ),
    );

    if (!args.apply) {
      console.log('dry run: nothing written');
      return;
    }

    await ResearchEntity.updateOne(
      { _id: row._id },
      clearsStoredValue ? { $set: update, $unset: { [args.field]: '' } } : { $set: update },
    );

    if (clearsStoredValue) {
      // A cleared served field can change what the row is allowed to show, so it is
      // re-gated here rather than left on a tier decided about evidence it no longer
      // has. Same reason `fieldRetraction` re-gates what it clears.
      const plans = await planStudentVisibilityGate({
        collection: 'research',
        mode: 'apply',
        recordIds: [String(row._id)],
      });
      const applied = await applyStudentVisibilityGatePlans(plans);
      console.log(`re-gated the row: ${JSON.stringify(applied)}`);
    }

    const after = await ResearchEntity.findOne({ _id: row._id }).lean<Record<string, unknown>>();
    console.log(
      JSON.stringify(
        {
          liveRefusalsAfter: liveFieldValueRefusals(after?.fieldValueRefusals, args.field).length,
          storedValueAfter: after?.[args.field] ?? '(absent)',
        },
        null,
        2,
      ),
    );
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
