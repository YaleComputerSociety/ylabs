import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { AnalyticsEvent } from '../models/analytics';
import { Observation } from '../models/observation';
import { User } from '../models/user';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config();

type NormalizeFacultyUserTypesArgs = {
  apply: boolean;
};

export type NormalizeFacultyUserTypesSummary = {
  apply: boolean;
  usersMatched: number;
  analyticsEventsMatched: number;
  observationsMatched: number;
  usersModified?: number;
  analyticsEventsModified?: number;
  observationsModified?: number;
};

export function parseNormalizeFacultyUserTypesArgs(
  argv: string[] = process.argv.slice(2),
): NormalizeFacultyUserTypesArgs {
  return {
    apply: argv.includes('--apply'),
  };
}

export async function buildNormalizeFacultyUserTypesSummary(
  args: NormalizeFacultyUserTypesArgs,
): Promise<NormalizeFacultyUserTypesSummary> {
  const usersFilter = { userType: 'faculty' };
  const analyticsEventsFilter = { userType: 'faculty' };
  const observationsFilter = {
    entityType: 'user',
    field: 'userType',
    value: 'faculty',
  };

  const [usersMatched, analyticsEventsMatched, observationsMatched] = await Promise.all([
    User.collection.countDocuments(usersFilter),
    AnalyticsEvent.collection.countDocuments(analyticsEventsFilter),
    Observation.collection.countDocuments(observationsFilter),
  ]);

  const summary: NormalizeFacultyUserTypesSummary = {
    apply: args.apply,
    usersMatched,
    analyticsEventsMatched,
    observationsMatched,
  };

  if (!args.apply) {
    return summary;
  }

  const [usersResult, analyticsEventsResult, observationsResult] = await Promise.all([
    User.collection.updateMany(usersFilter, { $set: { userType: 'professor' } }),
    AnalyticsEvent.collection.updateMany(analyticsEventsFilter, { $set: { userType: 'professor' } }),
    Observation.collection.updateMany(observationsFilter, { $set: { value: 'professor' } }),
  ]);

  return {
    ...summary,
    usersModified: usersResult.modifiedCount,
    analyticsEventsModified: analyticsEventsResult.modifiedCount,
    observationsModified: observationsResult.modifiedCount,
  };
}

async function main() {
  const args = parseNormalizeFacultyUserTypesArgs();
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'normalize-faculty-user-types',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const summary = await buildNormalizeFacultyUserTypesSummary(args);
  console.log(JSON.stringify({ ...guard, ...summary }, null, 2));
  await mongoose.disconnect();
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch(async (error) => {
    console.error(sanitizeLogValue(error));
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
}
