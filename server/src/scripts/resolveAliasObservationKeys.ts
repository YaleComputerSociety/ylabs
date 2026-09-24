/**
 * Resolves alias-keyed person observations to the netid the Yale directory holds.
 *
 *   yarn --cwd server identity:resolve-alias-keys
 *   yarn --cwd server identity:resolve-alias-keys --apply --confirm
 *   yarn --cwd server identity:resolve-alias-keys --directory-cache ./tmp/yalies.json
 *
 * Writes only `email` observations under the `directory-alias-resolution` source, keyed by the
 * real netid. Reads every other collection.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { Source } from '../models/source';
import { buildObservationFingerprint } from '../scrapers/observationStore';
import { listYalies, type YaliesPerson } from '../services/yaliesService';
import { userLookupValueForInferredPiUserKey } from '../scrapers/entityMaterializer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  aliasFromObservationKey,
  emailLocalPart,
  indexDirectory,
  planAliasResolutions,
  summarizeAliasResolutions,
  type AliasObservationKey,
  type DirectoryIdentity,
} from './resolveAliasObservationKeysCore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'identity:resolve-alias-keys';
const SOURCE_NAME = 'directory-alias-resolution';
const CONFIDENCE = 0.9;
const DIRECTORY_PAGE_SIZE = 100;
const DIRECTORY_MAX_PAGES = 600;
const DIRECTORY_PAGE_DELAY_MS = 120;
const WRITE_BATCH_SIZE = 500;

interface Args {
  apply: boolean;
  confirm: boolean;
  directoryCache?: string;
  output?: string;
}

export function parseArgs(argv: readonly string[]): Args {
  const valueOf = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    apply: argv.includes('--apply'),
    confirm: argv.includes('--confirm'),
    directoryCache: valueOf('--directory-cache'),
    output: valueOf('--output'),
  };
}

const toDirectoryIdentity = (person: YaliesPerson): DirectoryIdentity => ({
  netid: person.netid,
  email: person.email,
  firstName: (person as { first_name?: string }).first_name,
  lastName: (person as { last_name?: string }).last_name,
  schoolCode: (person as { school_code?: string }).school_code,
});

async function loadDirectory(cachePath?: string): Promise<YaliesPerson[]> {
  if (cachePath && fs.existsSync(cachePath)) {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as YaliesPerson[];
    console.log(`directory loaded from cache: ${cached.length} rows`);
    return cached;
  }
  const people: YaliesPerson[] = [];
  for (let page = 1; page <= DIRECTORY_MAX_PAGES; page += 1) {
    const rows = await listYalies({ page, pageSize: DIRECTORY_PAGE_SIZE });
    people.push(...rows);
    if (rows.length < DIRECTORY_PAGE_SIZE) break;
    await new Promise((resolve) => setTimeout(resolve, DIRECTORY_PAGE_DELAY_MS));
  }
  console.log(`directory fetched: ${people.length} rows`);
  if (cachePath) fs.writeFileSync(cachePath, JSON.stringify(people));
  return people;
}

/**
 * The aliases the corpus can already resolve from its own email observations. Read through
 * `userLookupValueForInferredPiUserKey` rather than off the raw key, and dropping a
 * self-match, so this agrees with `resolveNetidForRosterEmailAlias` instead of becoming a
 * second opinion about the same question.
 */
async function corpusResolvableAliases(): Promise<Set<string>> {
  const emails = (await Observation.find(
    { entityType: 'user', field: 'email', superseded: false },
    { entityKey: 1, value: 1 },
  ).lean()) as Array<{ entityKey?: unknown; value?: unknown }>;

  const netidsByAlias = new Map<string, Set<string>>();
  for (const row of emails) {
    const alias = emailLocalPart(row.value);
    if (!alias) continue;
    const netid = String(userLookupValueForInferredPiUserKey(row.entityKey) ?? '').toLowerCase();
    if (!netid || netid === alias) continue;
    const bucket = netidsByAlias.get(alias);
    if (bucket) bucket.add(netid);
    else netidsByAlias.set(alias, new Set([netid]));
  }
  return new Set(
    [...netidsByAlias].filter(([, netids]) => netids.size === 1).map(([alias]) => alias),
  );
}

async function aliasObservationKeys(): Promise<AliasObservationKey[]> {
  const grouped = (await Observation.aggregate([
    { $match: { entityType: 'user', entityKey: { $regex: /^netid:[^:]*\./ } } },
    { $group: { _id: '$entityKey', observationCount: { $sum: 1 } } },
    { $sort: { observationCount: -1 } },
  ])) as Array<{ _id: string; observationCount: number }>;
  return grouped
    .filter((row) => aliasFromObservationKey(row._id))
    .map((row) => ({ entityKey: row._id, observationCount: row.observationCount }));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await initializeConnections();
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(`${SCRIPT_NAME}: mode ${args.apply ? 'apply' : 'dry-run'} against ${guard.dbLabel}`);

  const [directory, resolvableAliases, keys] = await Promise.all([
    loadDirectory(args.directoryCache),
    corpusResolvableAliases(),
    aliasObservationKeys(),
  ]);

  const outcome = planAliasResolutions(
    keys,
    indexDirectory(directory.map(toDirectoryIdentity)),
    resolvableAliases,
  );
  const summary = summarizeAliasResolutions(outcome);

  console.log(`\nalias-shaped person keys: ${keys.length}`);
  console.log(`  already resolvable from corpus emails: ${resolvableAliases.size} aliases`);
  console.log(
    `  planned resolutions: ${summary.planned} (${summary.plannedObservations} observations)`,
  );
  for (const [match, count] of Object.entries(summary.byMatch))
    console.log(`    by ${match}: ${count}`);
  console.log('  refused:');
  for (const [refusal, count] of Object.entries(summary.byRefusal)) {
    console.log(
      `    ${refusal}: ${count} keys (${summary.refusedObservations[refusal]} observations)`,
    );
  }

  if (args.output) {
    const outputPath = resolveSafeJsonReportOutputPath(args.output);
    fs.writeFileSync(
      outputPath,
      JSON.stringify({ summary, planned: outcome.planned, refused: outcome.refused }, null, 2),
    );
    console.log(`\nreport written to ${outputPath}`);
  }

  if (!args.apply) {
    console.log('\ndry run: no observation written. Re-run with --apply --confirm to write.');
    await mongoose.disconnect();
    return;
  }
  if (!args.confirm) {
    throw new Error(`${SCRIPT_NAME} --apply also requires --confirm.`);
  }

  const source = await Source.findOne({ name: SOURCE_NAME }).select('_id').lean();
  if (!source) {
    throw new Error(
      `${SOURCE_NAME} is not in the Source registry. Run yarn --cwd server scrape:seed-sources first, or the resolution writes an observation no source backs.`,
    );
  }

  let written = 0;
  for (let index = 0; index < outcome.planned.length; index += WRITE_BATCH_SIZE) {
    const batch = outcome.planned.slice(index, index + WRITE_BATCH_SIZE);
    const observedAt = new Date();
    const docs = batch.map((plan) => {
      const entityKey = `netid:${plan.netid}`;
      const value = `${plan.alias}@yale.edu`;
      return {
        entityType: 'user' as const,
        entityKey,
        field: 'email',
        value,
        sourceId: source._id,
        sourceName: SOURCE_NAME,
        confidence: CONFIDENCE,
        observedAt,
        observationFingerprint: buildObservationFingerprint({
          sourceName: SOURCE_NAME,
          entityType: 'user',
          entityKey,
          field: 'email',
          value,
        }),
      };
    });
    const result = await Observation.insertMany(docs, { ordered: false });
    written += result.length;
  }
  console.log(`\nwrote ${written} alias-resolution observations`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await mongoose.disconnect().catch(() => undefined);
  process.exitCode = 1;
});
