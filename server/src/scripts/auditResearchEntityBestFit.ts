import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { User } from '../models/user';
import {
  classifyBestFitCoverage,
  summarizeBestFitCoverage,
  type BestFitAuditFacts,
  type BestFitAuditRow,
  type BestFitCoverageStatus,
} from './auditResearchEntityBestFitCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const LEAD_RESEARCH_AREA_ROLES = ['pi', 'co-pi', 'director', 'co-director'];
const ISSUE_STATUSES: BestFitCoverageStatus[] = [
  'missing',
  'genericOnly',
  'piFallbackOnly',
  'sparseProfile',
];

interface CliOptions {
  limit: number;
  includeArchived: boolean;
  json: boolean;
  slug?: string;
}

interface ResearchEntityRecord {
  _id: unknown;
  slug?: string;
  name?: string;
  displayName?: string;
  archived?: boolean;
  descriptionSource?: string;
  researchAreas?: unknown;
  profileResearchAreas?: unknown;
  researchAreaSource?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    limit: 25,
    includeArchived: false,
    json: false,
  };

  for (const arg of argv) {
    if (arg === '--include-archived') {
      options.includeArchived = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg.startsWith('--slug=')) {
      const value = arg.slice('--slug='.length).trim();
      if (value) options.slug = value;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      const parsed = Number(arg.slice('--limit='.length));
      if (Number.isFinite(parsed) && parsed >= 0) options.limit = Math.floor(parsed);
    }
  }

  return options;
}

function stringId(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function asArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

async function buildPiProfileTermMap(entityIds: string[]): Promise<Map<string, string[]>> {
  const members = await ResearchGroupMember.find({
    researchEntityId: { $in: entityIds },
    role: { $in: LEAD_RESEARCH_AREA_ROLES },
    isCurrentMember: { $ne: false },
    userId: { $exists: true, $ne: null },
  })
    .select('researchEntityId userId')
    .lean();

  const userIds = Array.from(new Set(members.map((member: any) => stringId(member.userId))));
  const users = await User.find({ _id: { $in: userIds } })
    .select('researchInterests topics')
    .lean();
  const usersById = new Map(users.map((user: any) => [stringId(user._id), user]));
  const termsByEntityId = new Map<string, string[]>();

  for (const member of members as any[]) {
    const entityId = stringId(member.researchEntityId);
    const user = usersById.get(stringId(member.userId));
    if (!entityId || !user) continue;
    const terms = [
      ...asArray(user.topics),
      ...asArray(user.researchInterests),
    ];
    if (terms.length === 0) continue;
    termsByEntityId.set(entityId, [...(termsByEntityId.get(entityId) || []), ...terms]);
  }

  return termsByEntityId;
}

function buildFacts(
  entity: ResearchEntityRecord,
  termsByEntityId: Map<string, string[]>,
): BestFitAuditFacts {
  const id = stringId(entity._id);
  return {
    id,
    slug: entity.slug || id,
    name: entity.displayName || entity.name || 'Untitled research entity',
    archived: entity.archived,
    descriptionSource: entity.descriptionSource,
    researchAreas: entity.researchAreas,
    profileResearchAreas: entity.profileResearchAreas,
    researchAreaSource: entity.researchAreaSource,
    piProfileTerms: termsByEntityId.get(id) || [],
  };
}

function sampleRows(rows: BestFitAuditRow[], status: BestFitCoverageStatus, limit: number) {
  return rows
    .filter((row) => row.status === status)
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      descriptionSource: row.descriptionSource,
      researchAreas: row.researchAreas,
      profileResearchAreas: row.profileResearchAreas,
      researchAreaSource: row.researchAreaSource,
      issues: row.issues,
    }));
}

function printTextReport(rows: BestFitAuditRow[], limit: number) {
  const summary = summarizeBestFitCoverage(rows);
  console.log('ResearchEntity best-fit audit');
  console.log(JSON.stringify(summary, null, 2));

  for (const status of ISSUE_STATUSES) {
    const samples = sampleRows(rows, status, limit);
    if (samples.length === 0) continue;
    console.log(`\n${status} samples:`);
    for (const sample of samples) {
      console.log(
        `- ${sample.name} (${sample.slug}) [${sample.issues.join(', ') || 'no issues'}]`,
      );
      console.log(`  researchAreas: ${sample.researchAreas.join(', ') || '(none)'}`);
      console.log(`  profileResearchAreas: ${sample.profileResearchAreas.join(', ') || '(none)'}`);
      console.log(`  descriptionSource: ${sample.descriptionSource || 'NONE'}`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await initializeConnections();

  const match: Record<string, unknown> = {};
  if (!options.includeArchived) match.archived = { $ne: true };
  if (options.slug) match.slug = options.slug;

  const entities = await ResearchEntity.find(match)
    .select(
      '_id slug name displayName archived descriptionSource researchAreas profileResearchAreas researchAreaSource',
    )
    .sort({ slug: 1 })
    .lean();
  const entityIds = entities.map((entity: any) => stringId(entity._id)).filter(Boolean);
  const termsByEntityId = await buildPiProfileTermMap(entityIds);
  const rows = (entities as ResearchEntityRecord[])
    .map((entity) => classifyBestFitCoverage(buildFacts(entity, termsByEntityId)))
    .sort((a, b) => a.status.localeCompare(b.status) || a.slug.localeCompare(b.slug));

  if (options.json) {
    const issueRows = rows.filter((row) => row.status !== 'usable');
    console.log(
      JSON.stringify(
        {
          summary: summarizeBestFitCoverage(rows),
          samples: Object.fromEntries(
            ISSUE_STATUSES.map((status) => [status, sampleRows(rows, status, options.limit)]),
          ),
          issueCount: issueRows.length,
        },
        null,
        2,
      ),
    );
  } else {
    printTextReport(rows, options.limit);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
