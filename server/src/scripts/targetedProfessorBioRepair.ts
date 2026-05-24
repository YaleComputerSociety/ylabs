import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { Source } from '../models/source';
import { User } from '../models/user';
import {
  buildTargetedProfessorBioRepair,
  dedupeObservationBulkOps,
  parseTargetedProfessorBioRepairArgs,
  type TargetedProfessorBioRepairSource,
  type TargetedProfessorBioRepairUser,
} from './targetedProfessorBioRepairCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;
const SOURCE_NAME = 'official-profile-enrichment';

dotenv.config({ path: '.env' });

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new Error(`Unsupported content-type: ${contentType}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function loadSource(): Promise<TargetedProfessorBioRepairSource> {
  const source = await Source.findOne({ name: SOURCE_NAME }).lean();
  if (!source) throw new Error(`Missing Source row: ${SOURCE_NAME}`);
  return {
    _id: source._id,
    name: String((source as any).name),
    defaultWeight: Number((source as any).defaultWeight) || 0.7,
  };
}

async function loadUser(netid: string): Promise<TargetedProfessorBioRepairUser> {
  const user = await User.findOne({ netid })
    .select(
      '_id netid fname lname bio profileUrls confidenceByField dataSources manuallyLockedFields',
    )
    .lean();
  if (!user) throw new Error(`No user found for netid: ${netid}`);
  return {
    _id: user._id,
    netid: String((user as any).netid),
    fname: (user as any).fname,
    lname: (user as any).lname,
    bio: (user as any).bio,
    profileUrls: (user as any).profileUrls,
    confidenceByField: (user as any).confidenceByField,
    dataSources: (user as any).dataSources,
    manuallyLockedFields: (user as any).manuallyLockedFields,
  };
}

async function main(): Promise<void> {
  const args = parseTargetedProfessorBioRepairArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'profiles:repair-bio',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const [user, source, html] = await Promise.all([
    loadUser(args.netid),
    loadSource(),
    fetchHtml(args.url),
  ]);

  const repair = buildTargetedProfessorBioRepair({
    user,
    profileUrl: args.url,
    html,
    source,
  });

  if (!repair.ok) {
    console.log(
      JSON.stringify(
        {
          mode: args.apply ? 'apply' : 'dry-run',
          netid: args.netid,
          url: args.url,
          repaired: false,
          reason: repair.reason,
        },
        null,
        2,
      ),
    );
    return;
  }

  let observationWrites = 0;
  let userWrites = 0;

  if (args.apply) {
    const observationResult = await Observation.bulkWrite(
      dedupeObservationBulkOps(repair.observations),
      { ordered: false },
    );
    observationWrites =
      (observationResult.upsertedCount || 0) + (observationResult.modifiedCount || 0);
    const userResult = await User.updateOne({ _id: user._id }, repair.userUpdate);
    userWrites = userResult.modifiedCount || 0;
  }

  console.log(
    JSON.stringify(
      {
        mode: args.apply ? 'apply' : 'dry-run',
        netid: args.netid,
        url: args.url,
        repaired: true,
        sourceUrl: repair.sourceUrl,
        bioLength: repair.bio.length,
        bioPreview: repair.bio.slice(0, 220),
        observationCount: repair.observations.length,
        observationFields: repair.observations.map((observation) => observation.field),
        writes: {
          observations: observationWrites,
          users: userWrites,
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
