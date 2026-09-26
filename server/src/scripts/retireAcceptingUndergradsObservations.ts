import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  RETIRED_ACCEPTING_UNDERGRADS_FIELD,
  RETIRE_ACCEPTING_UNDERGRADS_ROLLBACK_REASON,
  RETIRE_ACCEPTING_UNDERGRADS_SCRIPT_NAME,
  assertAcceptingUndergradsFullyRetired,
  assertRetireAcceptingUndergradsApplyAllowed,
  parseRetireAcceptingUndergradsArgs,
  type RetireAcceptingUndergradsCounts,
} from './retireAcceptingUndergradsObservationsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const PROVENANCE_PATH = `fieldProvenance.${RETIRED_ACCEPTING_UNDERGRADS_FIELD}`;

export async function retireAcceptingUndergradsObservations(options: {
  apply: boolean;
}): Promise<RetireAcceptingUndergradsCounts> {
  const liveObservationFilter = {
    field: RETIRED_ACCEPTING_UNDERGRADS_FIELD,
    superseded: { $ne: true },
  };
  const provenanceFilter = { [PROVENANCE_PATH]: { $exists: true } };

  const liveObservationsBefore = await Observation.countDocuments(liveObservationFilter);
  const provenanceEntriesBefore = await ResearchEntity.countDocuments(provenanceFilter);

  let supersededObservations = 0;
  let clearedProvenanceEntries = 0;

  if (options.apply) {
    const supersede = await Observation.updateMany(liveObservationFilter, {
      $set: {
        superseded: true,
        rollback: {
          rolledBackAt: new Date(),
          reason: RETIRE_ACCEPTING_UNDERGRADS_ROLLBACK_REASON,
        },
      },
    });
    supersededObservations = supersede.modifiedCount || 0;

    const cleared = await ResearchEntity.updateMany(provenanceFilter, {
      $unset: { [PROVENANCE_PATH]: '' },
    });
    clearedProvenanceEntries = cleared.modifiedCount || 0;
  }

  const counts: RetireAcceptingUndergradsCounts = {
    liveObservationsBefore,
    liveObservationsAfter: await Observation.countDocuments(liveObservationFilter),
    provenanceEntriesBefore,
    provenanceEntriesAfter: await ResearchEntity.countDocuments(provenanceFilter),
    supersededObservations,
    clearedProvenanceEntries,
  };
  if (options.apply) assertAcceptingUndergradsFullyRetired(counts);
  return counts;
}

async function main(): Promise<void> {
  const args = parseRetireAcceptingUndergradsArgs(process.argv.slice(2));
  assertRetireAcceptingUndergradsApplyAllowed(args);
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: RETIRE_ACCEPTING_UNDERGRADS_SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const counts = await retireAcceptingUndergradsObservations({ apply: args.apply });

  const report = {
    script: RETIRE_ACCEPTING_UNDERGRADS_SCRIPT_NAME,
    mode: args.apply ? 'apply' : 'dry-run',
    databaseName: mongoose.connection.db?.databaseName,
    ...counts,
  };
  console.log(JSON.stringify(report, null, 2));

  if (args.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(args.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Saved report to ${safeOutput}`);
  }

  await mongoose.disconnect();
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error instanceof Error ? error.message : error));
    process.exit(1);
  });
}
