import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { GRANT_SHELL_ENTITY_TYPE, GRANT_SHELL_KIND } from '../scrapers/utils/grantShellIdentity';
import {
  runStudentVisibilityGate,
  type StudentVisibilityGateReport,
} from '../services/studentVisibilityGateService';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  GRANT_LANE_SOURCE_NAMES,
  GRANT_SHELL_SLUG_RE,
  entityKeysWithNonGrantLabEvidence,
  planGrantMintedLabShellRetype,
  summarizeGrantShellRetypeRefusals,
  type GrantShellLabAssertion,
  type GrantShellRetypeRefusal,
  type GrantShellRow,
} from './retypeGrantMintedLabShellsCore';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:retype-grant-minted-lab-shells';
export const CONFIRM_FLAG = '--confirm-retype-grant-minted-lab-shells';

interface Options {
  dryRun: boolean;
  confirmed: boolean;
  output?: string;
}

export function parseRetypeGrantMintedLabShellArgs(argv: string[]): Options {
  const options: Options = { dryRun: true, confirmed: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.dryRun = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === CONFIRM_FLAG) options.confirmed = true;
    else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseRetypeGrantMintedLabShellArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: !options.dryRun,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (!options.dryRun && !options.confirmed) {
    throw new Error(`${SCRIPT_NAME} apply requires ${CONFIRM_FLAG}`);
  }
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${
      options.dryRun ? 'dry-run' : 'apply'
    }`,
  );

  await initializeConnections();

  const entityDocs = (await ResearchEntity.find({
    archived: { $ne: true },
    slug: GRANT_SHELL_SLUG_RE,
  })
    .select('_id slug name kind entityType websiteUrl website manuallyLockedFields')
    .lean()) as unknown as Array<Record<string, unknown>>;
  const rows: GrantShellRow[] = entityDocs.flatMap((doc) => {
    const id = serializedDocumentId(doc._id);
    return id ? [{ id, ...doc } as GrantShellRow] : [];
  });

  const assertionDocs = (await Observation.find({
    entityType: 'researchEntity',
    entityKey: { $in: rows.map((row) => String(row.slug)) },
    field: { $in: ['name', 'displayName', 'kind', 'entityType'] },
    superseded: { $ne: true },
  })
    .select('entityKey field value sourceName')
    .lean()) as unknown as GrantShellLabAssertion[];

  const outcome = planGrantMintedLabShellRetype(
    rows,
    entityKeysWithNonGrantLabEvidence(assertionDocs),
  );

  const renameArm = outcome.plans.filter((plan) => plan.nameAssertsALab);
  const retypeArm = outcome.plans.filter((plan) => plan.typeAssertsALab);
  const nameObservationsPending = await Observation.countDocuments({
    entityType: 'researchEntity',
    entityKey: { $in: renameArm.map((plan) => plan.slug) },
    field: 'name',
    sourceName: { $in: [...GRANT_LANE_SOURCE_NAMES] },
    superseded: { $ne: true },
    value: { $regex: '\\s(?:Lab|Laboratory)$', $options: 'i' },
  });
  const kindObservationsPending = await Observation.countDocuments({
    entityType: 'researchEntity',
    entityKey: { $in: retypeArm.map((plan) => plan.slug) },
    field: 'kind',
    sourceName: { $in: [...GRANT_LANE_SOURCE_NAMES] },
    superseded: { $ne: true },
    value: 'lab',
  });

  let nameObservationsCorrected = 0;
  let kindObservationsCorrected = 0;
  let entityTypesCorrected = 0;
  let rematerialized = 0;
  let servedNameStillAssertsALab = 0;
  let gateCounts: StudentVisibilityGateReport['counts'] | null = null;

  if (!options.dryRun && outcome.plans.length > 0) {
    // Correct the evidence, not the row. A repair that set `name` directly would be
    // undone by the next materialize pass, because the grant lane's own observation
    // would still assert the lab (#3143). Same source and same sourceUrl, because the
    // fixed lane now emits exactly this value from exactly that URL.
    for (const plan of renameArm) {
      const nameResult = await Observation.updateMany(
        {
          entityType: 'researchEntity',
          entityKey: plan.slug,
          field: 'name',
          sourceName: { $in: [...GRANT_LANE_SOURCE_NAMES] },
          superseded: { $ne: true },
          value: { $regex: '\\s(?:Lab|Laboratory)$', $options: 'i' },
        },
        { $set: { value: plan.correctedName } },
      );
      nameObservationsCorrected += nameResult.modifiedCount || 0;
    }

    if (retypeArm.length > 0) {
      const kindResult = await Observation.updateMany(
        {
          entityType: 'researchEntity',
          entityKey: { $in: retypeArm.map((plan) => plan.slug) },
          field: 'kind',
          sourceName: { $in: [...GRANT_LANE_SOURCE_NAMES] },
          superseded: { $ne: true },
          value: 'lab',
        },
        { $set: { value: GRANT_SHELL_KIND } },
      );
      kindObservationsCorrected = kindResult.modifiedCount || 0;

      // `entityType` is set on the row and not through an observation, because the
      // materializer derives `kind` from the observed-or-stored `entityType` and
      // discards an observed `kind`. Nothing observes `entityType` on a grant shell,
      // so the stored value is the authority the derivation reads, which is what makes
      // this durable rather than something the next pass undoes.
      const typeResult = await ResearchEntity.updateMany(
        {
          _id: {
            $in: retypeArm
              .map((plan) => plan.id)
              .filter((id) => mongoose.isValidObjectId(id))
              .map((id) => new mongoose.Types.ObjectId(id)),
          },
        },
        { $set: { entityType: GRANT_SHELL_ENTITY_TYPE, kind: GRANT_SHELL_KIND } },
      );
      entityTypesCorrected = typeResult.modifiedCount || 0;
    }

    for (const plan of outcome.plans) {
      await materializeEntity('researchEntity', { entityKey: plan.slug }, {});
      rematerialized += 1;
    }

    // Re-gate only the rows this run changed. An unscoped gate re-decides all 4,756
    // live research rows to settle a handful, which makes a small repair unsafe to run
    // beside any other Development write pass and buys nothing: a row this run did not
    // touch cannot have changed tier because of it. `retireSurnameClashLeadGrafts`
    // already passes `recordIds` for the same reason.
    const gateReport = await runStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: outcome.plans.map((plan) => plan.id),
    });
    gateCounts = gateReport.counts;
  }

  // Read every scanned row this lane still owes a correction, in both modes, rather
  // than `outcome.plans`. Scoping it to the rows the repair acted on excluded every
  // refusal by construction, so the one number a reader takes as "is the job done"
  // could not see the only rows where it is not: it read 0 while served rows asserted
  // a lab, and read 0 in a dry run because the apply block never ran.
  //
  // Two refusals mean the row is genuinely a lab and this lane must not touch it, so
  // counting those would swap a false zero for an inflated total that reads as 99
  // defects when 97 of them are correct rows. Everything else that still asserts a
  // lab is work outstanding, whether the repair planned it or declined it.
  const legitimateLabRefusals = new Set<GrantShellRetypeRefusal>([
    'lab-corroborated-by-a-non-grant-source',
    'carries-a-website-of-its-own',
  ]);
  const idsThisLaneMustNotTouch = new Set(
    outcome.refused
      .filter((entry) => legitimateLabRefusals.has(entry.reason))
      .map((entry) => entry.id),
  );
  const owedSlugs = rows
    .filter((row) => !idsThisLaneMustNotTouch.has(row.id))
    .map((row) => String(row.slug));
  const after = (await ResearchEntity.find({
    archived: { $ne: true },
    slug: { $in: owedSlugs },
    studentVisibilityTier: { $in: publicStudentVisibilityTiers },
  })
    .select('slug name kind entityType')
    .lean()) as unknown as Array<Record<string, unknown>>;
  servedNameStillAssertsALab = after.filter(
    (doc) =>
      /\s+(?:Lab|Laboratory)$/i.test(String(doc.name ?? '').trim()) ||
      String(doc.entityType ?? '').toUpperCase() === 'LAB',
  ).length;

  const report = {
    script: SCRIPT_NAME,
    mode: options.dryRun ? 'dry-run' : 'apply',
    grantShellsScanned: rows.length,
    plannedForRetype: outcome.plans.length,
    plannedRename: renameArm.length,
    plannedRetype: retypeArm.length,
    refusedByReason: summarizeGrantShellRetypeRefusals(outcome.refused),
    nameObservationsPending,
    kindObservationsPending,
    nameObservationsCorrected,
    kindObservationsCorrected,
    entityTypesCorrected,
    rematerialized,
    rowsStillAssertingALab: servedNameStillAssertsALab,
    gateCounts,
  };
  console.log(JSON.stringify(report, null, 2));

  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, JSON.stringify(report, null, 2));
    console.log(`Saved ${SCRIPT_NAME} report to ${options.output}`);
  }
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
