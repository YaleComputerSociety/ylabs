import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Researcher, type ResearcherProfileLink } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import { normalizeOfficialProfileDestination } from '../services/leadProfileIdentity';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  planWrongPersonOfficialProfileLinkRepoints,
  summarizeWrongPersonProfileLinkRefusals,
  wrongPersonProfileLinkRefusalBeforeEvidence,
  type WrongPersonProfileLinkRow,
} from './repointWrongPersonOfficialProfileLinksCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'researchers:repoint-wrong-person-official-profile-links';
export const CONFIRM_FLAG = '--confirm-repoint-wrong-person-official-profile-links';

export interface RepointWrongPersonProfileLinkOptions {
  dryRun: boolean;
  confirmed: boolean;
  output?: string;
}

export function parseRepointWrongPersonProfileLinkArgs(
  argv: string[],
): RepointWrongPersonProfileLinkOptions {
  const options: RepointWrongPersonProfileLinkOptions = { dryRun: true, confirmed: false };
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

const officialIdentityLink = (links: unknown): { url: string; index: number } | undefined => {
  if (!Array.isArray(links)) return undefined;
  const index = links.findIndex(
    (link: ResearcherProfileLink) =>
      link?.kind === 'YALE_OFFICIAL' &&
      link?.purpose === 'PRIMARY_IDENTITY' &&
      typeof link?.url === 'string' &&
      link.url.trim(),
  );
  return index < 0 ? undefined : { url: String(links[index].url).trim(), index };
};

interface CandidateRecord {
  researcherId: string;
  displayName: string;
  boundUrl: string;
  linkIndex: number;
}

async function loadCandidateRecords(): Promise<{
  rows: WrongPersonProfileLinkRow[];
  records: Map<string, CandidateRecord>;
  officialLinksScanned: number;
}> {
  const researchers = (await Researcher.find({ archived: { $ne: true } })
    .select('_id displayName profileLinks')
    .lean()) as unknown as Array<Record<string, any>>;

  const claimantNamesByDestination = new Map<string, string[]>();
  const candidates: CandidateRecord[] = [];
  let officialLinksScanned = 0;
  for (const row of researchers) {
    const researcherId = serializedDocumentId(row._id);
    const displayName = String(row.displayName || '').trim();
    const link = officialIdentityLink(row.profileLinks);
    if (!researcherId || !displayName || !link) continue;
    officialLinksScanned += 1;
    const destination = normalizeOfficialProfileDestination(link.url);
    claimantNamesByDestination.set(destination, [
      ...(claimantNamesByDestination.get(destination) || []),
      displayName,
    ]);
    candidates.push({ researcherId, displayName, boundUrl: link.url, linkIndex: link.index });
  }

  const records = new Map(candidates.map((row) => [row.researcherId, row]));
  const rows: WrongPersonProfileLinkRow[] = [];
  for (const candidate of candidates) {
    const claimantNames = (
      claimantNamesByDestination.get(normalizeOfficialProfileDestination(candidate.boundUrl)) || []
    ).filter((name) => name !== candidate.displayName);
    const row: WrongPersonProfileLinkRow = {
      researcherId: candidate.researcherId,
      displayName: candidate.displayName,
      boundUrl: candidate.boundUrl,
      ownPageCandidates: [],
      claimantNames,
    };
    rows.push(
      wrongPersonProfileLinkRefusalBeforeEvidence(row)
        ? row
        : {
            ...row,
            ownPageCandidates: await ownPageCandidatesForResearcher(candidate.researcherId),
          },
    );
  }
  return { rows, records, officialLinksScanned };
}

async function liveEntityAssignments(researcherId: string): Promise<Array<Record<string, any>>> {
  return (await RoleAssignment.find({
    personId: new mongoose.Types.ObjectId(researcherId),
    'target.kind': 'RESEARCH_ENTITY',
    archived: { $ne: true },
  })
    .select('target rosterProvenance.profileUrl rosterProvenance.sourceUrl')
    .lean()) as unknown as Array<Record<string, any>>;
}

async function ownPageCandidatesForResearcher(researcherId: string): Promise<string[]> {
  const assignments = await liveEntityAssignments(researcherId);
  const candidates = new Set<string>();
  for (const assignment of assignments) {
    for (const value of [
      assignment.rosterProvenance?.profileUrl,
      assignment.rosterProvenance?.sourceUrl,
    ]) {
      if (typeof value === 'string' && value.trim()) candidates.add(value.trim());
    }
  }
  const entities = (await ResearchEntity.find({
    _id: { $in: assignments.map((assignment) => assignment.target?.id).filter(Boolean) },
  })
    .select('sourceUrls')
    .lean()) as unknown as Array<Record<string, any>>;
  for (const entity of entities) {
    for (const value of Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []) {
      if (typeof value === 'string' && value.trim()) candidates.add(value.trim());
    }
  }
  return [...candidates];
}

export async function repointWrongPersonOfficialProfileLinks(options: {
  dryRun: boolean;
}): Promise<Record<string, unknown>> {
  const { rows, records, officialLinksScanned } = await loadCandidateRecords();
  const plan = planWrongPersonOfficialProfileLinkRepoints(rows);

  const entityIds = new Set<string>();
  for (const move of plan.repoint) {
    for (const assignment of await liveEntityAssignments(move.researcherId)) {
      const entityId = serializedDocumentId(assignment.target?.id);
      if (entityId) entityIds.add(entityId);
    }
  }

  let repointed = 0;
  let regatedEntities = 0;
  if (!options.dryRun && plan.repoint.length > 0) {
    const verifiedAt = new Date();
    for (const move of plan.repoint) {
      const record = records.get(move.researcherId);
      if (!record) continue;
      const result = await Researcher.updateOne(
        {
          _id: new mongoose.Types.ObjectId(move.researcherId),
          [`profileLinks.${record.linkIndex}.url`]: move.fromUrl,
        },
        {
          $set: {
            [`profileLinks.${record.linkIndex}.url`]: move.toUrl,
            [`profileLinks.${record.linkIndex}.verifiedAt`]: verifiedAt,
            // The page has not been probed under this record, and `UNKNOWN` is the
            // absence of a probed fact rather than a verdict, so the verify lane
            // settles it. It stays servable meanwhile, which is what keeps the row's
            // way in from disappearing at the moment of the move.
            [`profileLinks.${record.linkIndex}.healthStatus`]: 'UNKNOWN',
          },
        },
      );
      repointed += result.modifiedCount || 0;
    }

    // Re-gate through the ordinary gate rather than writing tiers here, so every other
    // blocker on those rows still applies and the release queue stays consistent.
    if (entityIds.size > 0) {
      await runStudentVisibilityGate({
        collection: 'research',
        mode: 'apply',
        recordIds: [...entityIds],
      });
      regatedEntities = entityIds.size;
    }
  }

  return {
    script: SCRIPT_NAME,
    mode: options.dryRun ? 'dry-run' : 'apply',
    officialIdentityLinksScanned: officialLinksScanned,
    plannedRepoints: plan.repoint.length,
    entitiesAffected: entityIds.size,
    refusedByReason: summarizeWrongPersonProfileLinkRefusals(plan.refused),
    repointed,
    regatedEntities,
  };
}

async function main(): Promise<void> {
  const options = parseRepointWrongPersonProfileLinkArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: !options.dryRun,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (!options.dryRun && !options.confirmed) {
    throw new Error(`${SCRIPT_NAME} apply requires ${CONFIRM_FLAG}`);
  }

  await initializeConnections();
  const report = await repointWrongPersonOfficialProfileLinks({ dryRun: options.dryRun });
  console.log(JSON.stringify(report, null, 2));

  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, JSON.stringify(report, null, 2));
    console.log(`Saved report to ${options.output}`);
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
