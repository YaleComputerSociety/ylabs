import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import { listYalies, type YaliesPerson } from '../services/yaliesService';
import { isFacultyPerson } from '../scrapers/sources/yaleDirectoryScraper';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { serializedDocumentId } from '../utils/idSerialization';
import {
  indexNetidByEmail,
  planLeadNetidResolution,
  summarizePlannedTiers,
  summarizeRefusals,
  type LeadEmailEvidence,
  type NetidlessLead,
} from './resolveLeadNetidsFromDirectoryCore';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:resolve-lead-netids';
const LEAD_ROLES = ['PI', 'DIRECTOR'];
const LEAD_ENTITY_TYPES = ['LAB', 'FACULTY_RESEARCH_AREA'];
const DIRECTORY_PAGE_SIZE = 100;
const DIRECTORY_PAGE_DELAY_MS = 150;
const DIRECTORY_MAX_PAGES = 500;
const DIRECTORY_PAGE_ATTEMPTS = 4;
const DIRECTORY_RETRY_BASE_MS = 500;

interface Args {
  apply: boolean;
  confirm: boolean;
  maxApply: number;
  output?: string;
  directoryCache?: string;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, confirm: false, maxApply: 200 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.apply = false;
    else if (arg === '--confirm-resolve-lead-netids') args.confirm = true;
    else if (arg === '--max-apply') args.maxApply = Number(argv[++index]);
    else if (arg.startsWith('--max-apply='))
      args.maxApply = Number(arg.slice('--max-apply='.length));
    else if (arg === '--output') args.output = argv[++index];
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else if (arg === '--directory-cache') args.directoryCache = argv[++index];
    else if (arg.startsWith('--directory-cache='))
      args.directoryCache = arg.slice('--directory-cache='.length);
    else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  if (!Number.isSafeInteger(args.maxApply) || args.maxApply < 1) {
    throw new Error('--max-apply must be a safe positive integer');
  }
  return args;
}

function profileUrlsOf(value: unknown): string[] {
  if (typeof value === 'string') return /^https?:\/\//i.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((entry) => profileUrlsOf(entry));
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap((entry) =>
      typeof entry === 'string' && /^https?:\/\//i.test(entry) ? [entry] : [],
    );
  }
  return [];
}

async function fetchDirectoryPageWithRetry(page: number): Promise<YaliesPerson[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= DIRECTORY_PAGE_ATTEMPTS; attempt += 1) {
    try {
      return await listYalies({ page, pageSize: DIRECTORY_PAGE_SIZE });
    } catch (error) {
      lastError = error;
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      console.log(
        `directory page ${page} attempt ${attempt} failed${status ? ` (status ${status})` : ''}`,
      );
      if (attempt === DIRECTORY_PAGE_ATTEMPTS) break;
      await new Promise((resolve) => setTimeout(resolve, DIRECTORY_RETRY_BASE_MS * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`directory page ${page} failed`);
}

async function loadFacultyDirectory(cachePath?: string): Promise<YaliesPerson[]> {
  if (cachePath && fs.existsSync(cachePath)) {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as YaliesPerson[];
    console.log(`directory loaded from cache: ${cached.length} rows`);
    return cached.filter((person) => isFacultyPerson(person));
  }

  const people: YaliesPerson[] = [];
  for (let page = 1; page <= DIRECTORY_MAX_PAGES; page += 1) {
    const records = await fetchDirectoryPageWithRetry(page);
    people.push(...records);
    if (records.length < DIRECTORY_PAGE_SIZE) break;
    await new Promise((resolve) => setTimeout(resolve, DIRECTORY_PAGE_DELAY_MS));
  }

  if (cachePath) {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(people));
    console.log(`directory cached: ${people.length} rows`);
  }
  return people.filter((person) => isFacultyPerson(person));
}

async function loadLeadPersonIds(): Promise<Set<string>> {
  const rows = await ResearchEntity.find({
    archived: { $ne: true },
    entityType: { $in: LEAD_ENTITY_TYPES },
  })
    .select('_id')
    .lean();
  const rowIds = new Set(rows.map((row) => serializedDocumentId(row._id)));

  const assignments = await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    role: { $in: LEAD_ROLES },
    state: { $ne: 'HISTORICAL' },
    archived: { $ne: true },
  })
    .select('target personId')
    .lean();

  const personIds = new Set<string>();
  for (const assignment of assignments) {
    const target = assignment.target as { id?: unknown } | undefined;
    if (!rowIds.has(serializedDocumentId(target?.id))) continue;
    const personId = serializedDocumentId(assignment.personId);
    if (personId) personIds.add(personId);
  }
  return personIds;
}

async function loadEmailEvidenceByUrl(
  urls: readonly string[],
): Promise<Map<string, LeadEmailEvidence[]>> {
  const byUrl = new Map<string, LeadEmailEvidence[]>();
  const chunkSize = 500;
  for (let start = 0; start < urls.length; start += chunkSize) {
    const chunk = urls.slice(start, start + chunkSize);
    const rows = await Observation.find({
      entityType: 'user',
      field: 'email',
      sourceUrl: { $in: chunk },
    })
      .select('value sourceUrl entityKey')
      .lean();
    for (const row of rows) {
      const sourceUrl = typeof row.sourceUrl === 'string' ? row.sourceUrl : '';
      const email = typeof row.value === 'string' ? row.value : '';
      if (!sourceUrl || !email) continue;
      const entry: LeadEmailEvidence = {
        email,
        sourceUrl,
        entityKey: typeof row.entityKey === 'string' ? row.entityKey : '',
      };
      const bucket = byUrl.get(sourceUrl);
      if (bucket) bucket.push(entry);
      else byUrl.set(sourceUrl, [entry]);
    }
  }
  return byUrl;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (args.apply && !args.confirm) {
    throw new Error(`${SCRIPT_NAME} apply requires --confirm-resolve-lead-netids`);
  }

  await initializeConnections();

  const directory = await loadFacultyDirectory(
    args.directoryCache
      ? resolveSafeJsonReportOutputPath(args.directoryCache, '--directory-cache')
      : undefined,
  );
  const netidByEmail = indexNetidByEmail(directory);

  const personIds = await loadLeadPersonIds();
  const researchers = await Researcher.find({
    _id: { $in: [...personIds].map((id) => new mongoose.Types.ObjectId(id)) },
    $or: [
      { 'identifiers.netid': { $exists: false } },
      { 'identifiers.netid': { $in: ['', null] } },
    ],
  })
    .select('_id profileLinks')
    .lean();

  const urlsByResearcher = new Map<string, string[]>();
  const allUrls = new Set<string>();
  for (const researcher of researchers) {
    const researcherId = serializedDocumentId(researcher._id);
    if (!researcherId) continue;
    const urls = profileUrlsOf(researcher.profileLinks);
    urlsByResearcher.set(researcherId, urls);
    for (const url of urls) allUrls.add(url);
  }

  const evidenceByUrl = await loadEmailEvidenceByUrl([...allUrls]);

  const leads: NetidlessLead[] = [];
  for (const [researcherId, urls] of urlsByResearcher) {
    const emailEvidence = urls.flatMap((url) => evidenceByUrl.get(url) ?? []);
    leads.push({ researcherId, profileUrls: urls, emailEvidence });
  }

  const heldRows = await Researcher.find({
    'identifiers.netid': { $exists: true, $nin: ['', null] },
  })
    .select('identifiers.netid')
    .lean();
  const netidsAlreadyHeld = new Set(
    heldRows
      .map((row) => {
        const identifiers = row.identifiers as { netid?: unknown } | undefined;
        return typeof identifiers?.netid === 'string' ? identifiers.netid.toLowerCase() : '';
      })
      .filter((value) => value.length > 0),
  );

  const { planned, refused } = planLeadNetidResolution(leads, netidByEmail, netidsAlreadyHeld);

  const toApply = planned.slice(0, args.maxApply);
  let written = 0;
  if (args.apply) {
    for (const plan of toApply) {
      const result = await Researcher.updateOne(
        {
          _id: new mongoose.Types.ObjectId(plan.researcherId),
          $or: [
            { 'identifiers.netid': { $exists: false } },
            { 'identifiers.netid': { $in: ['', null] } },
          ],
        },
        { $set: { 'identifiers.netid': plan.netid } },
      );
      written += result.modifiedCount ?? 0;
    }
  }

  const report = {
    script: SCRIPT_NAME,
    mode: args.apply ? 'apply' : 'dry-run',
    directoryFacultyRows: directory.length,
    directoryDistinctEmails: netidByEmail.size,
    netidlessLeads: leads.length,
    planned: planned.length,
    plannedByTier: summarizePlannedTiers(planned),
    refusedByReason: summarizeRefusals(refused),
    appliedLimit: args.maxApply,
    written,
  };

  console.log(JSON.stringify(report, null, 2));

  if (args.output) {
    const outputPath = resolveSafeJsonReportOutputPath(args.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`Saved report to ${outputPath}`);
  }

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
