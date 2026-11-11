import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { retireObservations } from '../scrapers/observationStore';
import {
  fetchHtml as fetchOfficialProfileHtml,
  officialProfilePageStatedFields,
} from '../scrapers/sources/officialProfilePiBackfillScraper';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  GLUED_PROFILE_TEXT_SOURCE_NAME,
  gluedProfileTextKinds,
  hostOf,
  hostTally,
  planGluedProfileTextRetirement,
  readTargetPagesSequentially,
  selectGluedProfileTextTargets,
  type FetchProfileHtml,
  type GluedProfileTextCounts,
  type GluedProfileTextKind,
  type GluedTitleRetirement,
  type StoredProfileObservation,
} from './retireGluedProfileTextCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const SCRIPT_NAME = 'observations:retire-glued-profile-text';
export const CONFIRM_FLAG = '--confirm-retire-glued-profile-text';
export const GLUED_PROFILE_TEXT_ROLLBACK_REASON =
  'value read from block text that cheerio .text() glued to an adjacent field; the page re-read with the fixed extractor no longer yields it (#5720)';
const PAUSE_BETWEEN_PAGES_MS = 1500;

export interface RetireGluedProfileTextOptions {
  dryRun: boolean;
  confirmed: boolean;
  skipHosts: string[];
  kinds?: GluedProfileTextKind[];
  detailOutput?: string;
}

const isGluedProfileTextKind = (value: string): value is GluedProfileTextKind =>
  (gluedProfileTextKinds as readonly string[]).includes(value);

export function parseRetireGluedProfileTextArgs(argv: string[]): RetireGluedProfileTextOptions {
  const options: RetireGluedProfileTextOptions = {
    dryRun: true,
    confirmed: false,
    skipHosts: [],
  };
  const valueOf = (arg: string, flag: string, index: number): [string, number] =>
    arg === flag ? [argv[index + 1] ?? '', index + 1] : [arg.slice(flag.length + 1), index];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.dryRun = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === CONFIRM_FLAG) options.confirmed = true;
    else if (arg === '--skip-host' || arg.startsWith('--skip-host=')) {
      const [value, next] = valueOf(arg, '--skip-host', i);
      if (!value.trim()) throw new Error('--skip-host needs a host name');
      options.skipHosts.push(value.trim().toLowerCase());
      i = next;
    } else if (arg === '--kinds' || arg.startsWith('--kinds=')) {
      const [value, next] = valueOf(arg, '--kinds', i);
      const kinds = value
        .split(',')
        .map((kind) => kind.trim())
        .filter(Boolean);
      const unknown = kinds.filter((kind) => !isGluedProfileTextKind(kind));
      if (kinds.length === 0 || unknown.length > 0) {
        throw new Error(`--kinds takes a comma list of ${gluedProfileTextKinds.join(', ')}`);
      }
      options.kinds = [...new Set(kinds as GluedProfileTextKind[])];
      i = next;
    } else if (arg === '--detail-output' || arg.startsWith('--detail-output=')) {
      const [value, next] = valueOf(arg, '--detail-output', i);
      options.detailOutput = resolveSafeJsonReportOutputPath(value, '--detail-output');
      i = next;
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  if (!options.dryRun && !options.kinds) {
    throw new Error(
      `${SCRIPT_NAME} --apply requires --kinds, so an apply names exactly what it retires`,
    );
  }
  return options;
}

type LeanObservation = {
  _id: unknown;
  entityType?: string;
  entityKey?: string;
  field?: string;
  value?: unknown;
  sourceUrl?: string;
};

const toStored = (row: LeanObservation): StoredProfileObservation[] => {
  const id = serializedDocumentId(row._id);
  if (!id || (row.entityType !== 'user' && row.entityType !== 'researchEntity')) return [];
  return [
    {
      id,
      entityType: row.entityType,
      entityKey: row.entityKey ?? '',
      field: row.field ?? '',
      value: row.value,
      sourceUrl: row.sourceUrl ?? '',
    },
  ];
};

async function loadLaneObservations(): Promise<StoredProfileObservation[]> {
  const rows = (await Observation.find({
    sourceName: GLUED_PROFILE_TEXT_SOURCE_NAME,
    superseded: { $ne: true },
    $or: [{ entityType: 'user' }, { entityType: 'researchEntity', field: 'inferredPiUserKey' }],
  })
    .select('_id entityType entityKey field value sourceUrl')
    .lean()) as unknown as LeanObservation[];
  return rows.flatMap(toStored);
}

async function loadAddressMaps(input: { subjectKeys: string[]; pageUrls: string[] }): Promise<{
  bySubject: Map<string, Set<string>>;
  byPage: Map<string, Set<string>>;
}> {
  const rows = (await Observation.find({
    entityType: 'user',
    field: 'email',
    superseded: { $ne: true },
    $or: [{ entityKey: { $in: input.subjectKeys } }, { sourceUrl: { $in: input.pageUrls } }],
  })
    .select('entityKey value sourceUrl')
    .lean()) as unknown as LeanObservation[];
  const bySubject = new Map<string, Set<string>>();
  const byPage = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, address: string) => {
    const addresses = map.get(key) ?? new Set<string>();
    addresses.add(address);
    map.set(key, addresses);
  };
  for (const row of rows) {
    if (typeof row.value !== 'string') continue;
    const address = row.value.trim().toLowerCase();
    if (row.entityKey) add(bySubject, row.entityKey.toLowerCase(), address);
    if (row.sourceUrl) add(byPage, row.sourceUrl, address);
  }
  return { bySubject, byPage };
}

export interface GluedProfileTextRunResult {
  mode: 'dry-run' | 'apply';
  skipHosts: string[];
  kinds: GluedProfileTextKind[];
  titleRetirements: GluedTitleRetirement[];
  counts: GluedProfileTextCounts;
  retiredObservations: number;
  candidateHosts: {
    email: Record<string, number>;
    title: Record<string, number>;
    phantomSubject: Record<string, number>;
  };
}

export async function runGluedProfileTextRetirement(input: {
  dryRun: boolean;
  skipHosts: string[];
  kinds?: readonly GluedProfileTextKind[];
  pauseMs: number;
  fetchHtml: FetchProfileHtml;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}): Promise<GluedProfileTextRunResult> {
  const laneObservations = await loadLaneObservations();
  const laneEmails = laneObservations.filter(
    (row) => row.entityType === 'user' && row.field === 'email',
  );
  const addresses = await loadAddressMaps({
    subjectKeys: [...new Set(laneEmails.map((row) => row.entityKey))],
    pageUrls: [...new Set(laneEmails.map((row) => row.sourceUrl).filter(Boolean))],
  });
  const targets = selectGluedProfileTextTargets({
    laneObservations,
    otherAddressesBySubject: addresses.bySubject,
    otherAddressesByPage: addresses.byPage,
  });
  const reads = await readTargetPagesSequentially(targets, {
    fetchHtml: input.fetchHtml,
    readFields: officialProfilePageStatedFields,
    skipHosts: input.skipHosts,
    pauseMs: input.pauseMs,
    sleep: input.sleep,
    onFailure: (url, error) =>
      input.log?.(`page read failed on ${hostOf(url)}: ${sanitizeLogValue(error)}`),
  });
  const plan = planGluedProfileTextRetirement(targets, reads, input.kinds);

  let retiredObservations = 0;
  if (!input.dryRun && plan.observationIdsToRetire.length > 0) {
    const { retired } = await retireObservations(
      {
        _id: { $in: plan.observationIdsToRetire.map((id) => new mongoose.Types.ObjectId(id)) },
        sourceName: GLUED_PROFILE_TEXT_SOURCE_NAME,
      },
      GLUED_PROFILE_TEXT_ROLLBACK_REASON,
    );
    retiredObservations = retired;
  }

  const pagesWith = (pick: (target: (typeof targets)[number]) => number) =>
    hostTally(
      targets.flatMap((target) => Array(pick(target)).fill({ sourceUrl: target.sourceUrl })),
    );
  return {
    mode: input.dryRun ? 'dry-run' : 'apply',
    skipHosts: input.skipHosts,
    kinds: [...(input.kinds ?? gluedProfileTextKinds)],
    titleRetirements: plan.titleRetirements,
    counts: plan.counts,
    retiredObservations,
    candidateHosts: {
      email: pagesWith((target) => target.emails.length),
      title: pagesWith((target) => target.titles.length),
      phantomSubject: pagesWith((target) =>
        target.phantoms.reduce(
          (sum, phantom) =>
            sum + phantom.userObservationIds.length + phantom.piKeyObservationIds.length,
          0,
        ),
      ),
    },
  };
}

async function main(): Promise<void> {
  const options = parseRetireGluedProfileTextArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: !options.dryRun,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (!options.dryRun && !options.confirmed) {
    throw new Error(`${SCRIPT_NAME} apply requires ${CONFIRM_FLAG}`);
  }

  await initializeConnections();
  const { titleRetirements, ...result } = await runGluedProfileTextRetirement({
    dryRun: options.dryRun,
    skipHosts: options.skipHosts,
    kinds: options.kinds,
    pauseMs: PAUSE_BETWEEN_PAGES_MS,
    fetchHtml: (url) => fetchOfficialProfileHtml(url, false, GLUED_PROFILE_TEXT_SOURCE_NAME),
    log: (message) => console.error(message),
  });
  if (options.detailOutput) {
    fs.mkdirSync(path.dirname(options.detailOutput), { recursive: true });
    fs.writeFileSync(options.detailOutput, `${JSON.stringify(titleRetirements, null, 2)}\n`, {
      mode: 0o600,
    });
    fs.chmodSync(options.detailOutput, 0o600);
  }
  console.log(JSON.stringify({ script: SCRIPT_NAME, ...result }, null, 2));
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
