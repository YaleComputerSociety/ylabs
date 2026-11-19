/**
 * Records that one stored value is inadmissible at one field of one person record, or
 * withdraws such a record (#5641). The person counterpart of
 * `research-entity:refuse-field-value`, with the same record and the same fences.
 *
 * Recording clears the stored value in the same write, because that is the only thing that
 * reaches a person no identity resolves to; the user materializer keeps it clear afterwards
 * and drops the refused value from every identity that joins the person. Neither the
 * research-entity gate nor the search index reads these fields, so nothing is re-gated.
 *
 * Per person by construction: `--researcher` takes one id, and `--value` one value. The
 * summary prints counts and field names only, never a person-bearing value.
 *
 * Usage:
 *   yarn --cwd server researcher:refuse-field-value --researcher=<id> --field=websiteUrl \
 *     --value=<url> --rule=over_shared_value --note='why'
 *   ... --apply --confirm-researcher-field-value-refusal
 *   ... --rule=operator_judgement --note='why' --decided-by='<who>'
 *   ... --withdraw --note='why'
 *
 * Fields: websiteUrl, title, primaryDepartment, imageUrl, email, orcid, profileLink (one link URL).
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { Researcher } from '../models/researcher';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  fieldValueRefusalKey,
  liveFieldValueRefusals,
  perRowFieldValueRefusalRules,
  planFieldValueRefusal,
  planFieldValueRefusalWithdrawal,
  type FieldValueRefusalRule,
} from '../utils/researchEntityFieldValueRefusals';
import {
  isResearcherRefusableField,
  orcidRefusalValue,
  planResearcherRefusedStoredValueClear,
  RESEARCHER_REFUSABLE_FIELDS,
  type ResearcherRefusableField,
} from '../utils/researcherFieldValueRefusals';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env'), quiet: true });

const SCRIPT_NAME = 'researcher:refuse-field-value';
const CONFIRM_FLAG = '--confirm-researcher-field-value-refusal';

export interface RefuseResearcherFieldValueArgs {
  researcherId: string;
  field: string;
  value: string;
  rule: FieldValueRefusalRule;
  sourceName?: string;
  note: string;
  decidedBy?: string;
  evidenceUrl?: string;
  withdraw: boolean;
  apply: boolean;
  confirm: boolean;
}

const unknownArgumentLabel = (arg: string): string =>
  arg.startsWith('--') ? arg.split('=')[0] : 'a positional argument';

export function parseRefuseResearcherFieldValueArgs(
  argv: string[],
): RefuseResearcherFieldValueArgs {
  const args: RefuseResearcherFieldValueArgs = {
    researcherId: '',
    field: '',
    value: '',
    rule: 'operator_judgement',
    note: '',
    withdraw: false,
    apply: false,
    confirm: false,
  };
  const valueOf = (arg: string, flag: string) => arg.slice(flag.length).trim();
  for (const arg of argv) {
    if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === CONFIRM_FLAG) args.confirm = true;
    else if (arg === '--withdraw') args.withdraw = true;
    else if (arg.startsWith('--researcher=')) args.researcherId = valueOf(arg, '--researcher=');
    else if (arg.startsWith('--field=')) args.field = valueOf(arg, '--field=');
    else if (arg.startsWith('--value=')) args.value = valueOf(arg, '--value=');
    else if (arg.startsWith('--note=')) args.note = valueOf(arg, '--note=');
    else if (arg.startsWith('--decided-by=')) args.decidedBy = valueOf(arg, '--decided-by=');
    else if (arg.startsWith('--evidence-url=')) args.evidenceUrl = valueOf(arg, '--evidence-url=');
    else if (arg.startsWith('--source-name=')) args.sourceName = valueOf(arg, '--source-name=');
    else if (arg.startsWith('--rule=')) args.rule = valueOf(arg, '--rule=') as never;
    else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${unknownArgumentLabel(arg)}`);
  }
  return args;
}

export function assertRefuseResearcherFieldValueArgs(args: RefuseResearcherFieldValueArgs): void {
  if (!mongoose.isValidObjectId(args.researcherId)) {
    throw new Error('--researcher=<id> is required: a refusal is a judgement about one person.');
  }
  if (!isResearcherRefusableField(args.field)) {
    throw new Error(`--field must be one of ${RESEARCHER_REFUSABLE_FIELDS.join(', ')}.`);
  }
  if (!args.value) throw new Error('--value is required: a refusal names the value it refuses.');
  if (args.withdraw && !args.note) {
    throw new Error('--note is required when withdrawing: a withdrawal records why.');
  }
  if (!args.withdraw && args.rule === 'operator_judgement' && (!args.note || !args.decidedBy)) {
    throw new Error(
      '--rule=operator_judgement requires --note and --decided-by: nothing else will explain it.',
    );
  }
  if (!args.withdraw && !(perRowFieldValueRefusalRules as readonly string[]).includes(args.rule)) {
    throw new Error(`--rule must be one of ${perRowFieldValueRefusalRules.join(', ')}.`);
  }
  if (args.apply && !args.confirm) {
    throw new Error(`${SCRIPT_NAME} --apply requires ${CONFIRM_FLAG}.`);
  }
}

export interface ResearcherFieldValueRefusalOutcome {
  found: boolean;
  field: string;
  action: 'refuse' | 'withdraw';
  applied: boolean;
  storedValueIsTheRefusedValue: boolean;
  liveRefusalsBefore: number;
  liveRefusalsAfter?: number;
  clearedPaths: string[];
  pulledProfileLinks: number;
}

const storedValueAt = (researcher: any, field: ResearcherRefusableField): unknown[] => {
  if (field === 'email') return [researcher?.identifiers?.email];
  if (field === 'orcid') return [researcher?.identifiers?.orcid];
  if (field === 'profileLink') {
    return (researcher?.profileLinks ?? []).map((link: { url?: unknown }) => link?.url);
  }
  return [researcher?.profile?.[field]];
};

/** Plans, and with `apply` writes, one refusal or withdrawal on one researcher. */
export async function refuseResearcherFieldValue(
  args: RefuseResearcherFieldValueArgs,
): Promise<ResearcherFieldValueRefusalOutcome> {
  const field = args.field as ResearcherRefusableField;
  if (field === 'orcid') {
    const bare = orcidRefusalValue(args.value);
    if (!bare) throw new Error('--value must name an ORCID for --field=orcid.');
    args = { ...args, value: bare };
  }
  const researcher: any = await Researcher.findById(args.researcherId).lean();
  const base = {
    field,
    action: (args.withdraw ? 'withdraw' : 'refuse') as 'refuse' | 'withdraw',
    applied: false,
    clearedPaths: [] as string[],
    pulledProfileLinks: 0,
  };
  if (!researcher) {
    return { ...base, found: false, storedValueIsTheRefusedValue: false, liveRefusalsBefore: 0 };
  }
  const refusedKey = fieldValueRefusalKey(field, args.value);
  const storedValueIsTheRefusedValue = storedValueAt(researcher, field).some(
    (stored) => fieldValueRefusalKey(field, stored) === refusedKey,
  );
  const liveRefusalsBefore = liveFieldValueRefusals(researcher.fieldValueRefusals, field).length;
  const refusalSet = args.withdraw
    ? planFieldValueRefusalWithdrawal(researcher.fieldValueRefusals, field, args.value, args.note)
    : planFieldValueRefusal(researcher.fieldValueRefusals, {
        field,
        value: args.value,
        rule: args.rule,
        ...(args.sourceName ? { sourceName: args.sourceName } : {}),
        refusedBy: args.decidedBy ? `${SCRIPT_NAME} (${args.decidedBy})` : SCRIPT_NAME,
        note: args.note,
        evidenceUrl: args.evidenceUrl,
      });
  const projected = {
    ...researcher,
    fieldValueRefusals: {
      ...Object.fromEntries(
        researcher.fieldValueRefusals instanceof Map
          ? researcher.fieldValueRefusals
          : Object.entries(researcher.fieldValueRefusals ?? {}),
      ),
      [field]: Object.values(refusalSet)[0],
    },
  };
  const clear = args.withdraw
    ? { unset: [], profileLinkUrlsToPull: [] }
    : planResearcherRefusedStoredValueClear(projected);
  const outcome = {
    ...base,
    found: true,
    storedValueIsTheRefusedValue,
    liveRefusalsBefore,
    clearedPaths: clear.unset,
    pulledProfileLinks: clear.profileLinkUrlsToPull.length,
  };
  if (!args.apply) return outcome;

  const update: Record<string, unknown> = { $set: refusalSet };
  if (clear.unset.length > 0) {
    update.$unset = Object.fromEntries(clear.unset.map((unsetPath) => [unsetPath, '']));
  }
  if (clear.profileLinkUrlsToPull.length > 0) {
    update.$pull = { profileLinks: { url: { $in: clear.profileLinkUrlsToPull } } };
  }
  await Researcher.updateOne({ _id: researcher._id }, update);
  const after: any = await Researcher.findById(researcher._id).select('fieldValueRefusals').lean();
  return {
    ...outcome,
    applied: true,
    liveRefusalsAfter: liveFieldValueRefusals(after?.fieldValueRefusals, field).length,
  };
}

async function main(): Promise<void> {
  const args = parseRefuseResearcherFieldValueArgs(process.argv.slice(2));
  assertRefuseResearcherFieldValueArgs(args);
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();
  try {
    const outcome = await refuseResearcherFieldValue(args);
    console.log(
      JSON.stringify({ script: SCRIPT_NAME, mode: args.apply ? 'apply' : 'dry-run', ...outcome }),
    );
    if (!args.apply) console.log('dry run: nothing written');
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
