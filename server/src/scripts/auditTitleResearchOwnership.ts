import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { RoleAssignment } from '../models/roleAssignment';
import { Researcher } from '../models/researcher';
import { Observation } from '../models/observation';
import { LIVE_ENTITY_FILTER } from '../models/entityArchival';
import { serializedDocumentId } from '../utils/idSerialization';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { identityProfileUrlOf } from './retireStaffMintedResearchEntities';
import { isPersonProfileIdentityUrl } from './retireStaffMintedResearchEntitiesCore';
import {
  auditTitleResearchOwnership,
  type TitleOwnershipRow,
} from './auditTitleResearchOwnershipCore';

dotenv.config({ quiet: true });

const SCRIPT_NAME = 'research-entity:audit-title-research-ownership';

export interface AuditTitleResearchOwnershipCliOptions {
  output?: string;
  outputRequested?: boolean;
  findingsLimit: number;
}

export function parseAuditTitleResearchOwnershipArgs(
  argv: string[],
): AuditTitleResearchOwnershipCliOptions {
  const options: AuditTitleResearchOwnershipCliOptions = { findingsLimit: 50 };
  for (const arg of argv) {
    if (arg === '--' || arg === '') continue;
    if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length);
      options.outputRequested = true;
      continue;
    }
    if (arg.startsWith('--findings-limit=')) {
      const raw = arg.slice('--findings-limit='.length).trim();
      const parsed = /^\d+$/.test(raw) ? Number(raw) : NaN;
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error('--findings-limit must be a safe positive integer');
      }
      options.findingsLimit = parsed;
      continue;
    }
    // No --apply, deliberately: a title string is not a safe sole basis for an archive
    // (#3576), so this command has no writing arm to reach for.
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function main(): Promise<void> {
  const args = parseAuditTitleResearchOwnershipArgs(process.argv.slice(2));
  const outputPath = args.outputRequested
    ? resolveSafeJsonReportOutputPath(args.output)
    : undefined;

  await initializeConnections();

  const entities = await ResearchEntity.find(LIVE_ENTITY_FILTER)
    .select('_id slug entityType studentVisibilityTier fieldProvenance')
    .lean();

  const identityUrlById = new Map<string, string>();
  for (const row of entities) {
    const id = serializedDocumentId(row._id);
    const url = identityProfileUrlOf(row as { fieldProvenance?: unknown });
    if (id && url) identityUrlById.set(id, url);
  }
  const identityUrls = [...new Set(identityUrlById.values())];

  const titlesByUrl = new Map<string, Set<string>>();
  for (const observation of await Observation.find({
    field: 'title',
    entityType: 'user',
    sourceUrl: { $in: identityUrls },
    superseded: { $ne: true },
    'rollback.rolledBackAt': { $exists: false },
  })
    .select('sourceUrl value')
    .lean()) {
    const url = typeof observation.sourceUrl === 'string' ? observation.sourceUrl : '';
    const value = typeof observation.value === 'string' ? observation.value.trim() : '';
    if (!url || !value) continue;
    const held = titlesByUrl.get(url) || new Set<string>();
    held.add(value);
    titlesByUrl.set(url, held);
  }

  // The retired #3576 second-witness candidate, gathered for sizing only: a current
  // lead edge elsewhere shows the person leads research somewhere, which is not evidence
  // that this row belongs to somebody else's group, so it must never justify an archive.
  const personIdsByUrl = new Map<string, string[]>();
  for (const person of await Researcher.find({
    archived: { $ne: true },
    'profileLinks.url': { $in: identityUrls },
  })
    .select('_id profileLinks')
    .lean()) {
    const personId = serializedDocumentId(person._id);
    if (!personId) continue;
    for (const link of (Array.isArray(person.profileLinks) ? person.profileLinks : []) as Array<{
      url?: unknown;
    }>) {
      const url = typeof link?.url === 'string' ? link.url : '';
      if (!url) continue;
      const held = personIdsByUrl.get(url) || [];
      if (!held.includes(personId)) held.push(personId);
      personIdsByUrl.set(url, held);
    }
  }

  const leadTargetsByPerson = new Map<string, Set<string>>();
  for (const edge of await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    role: { $in: ['PI', 'CO_PI', 'DIRECTOR', 'CO_DIRECTOR'] },
    state: 'CURRENT',
    archived: { $ne: true },
  })
    .select('target personId')
    .lean()) {
    const personId = serializedDocumentId(edge.personId);
    const entityId = serializedDocumentId(edge.target?.id);
    if (!personId || !entityId) continue;
    const held = leadTargetsByPerson.get(personId) || new Set<string>();
    held.add(entityId);
    leadTargetsByPerson.set(personId, held);
  }

  const rows: TitleOwnershipRow[] = entities.flatMap((entity) => {
    const id = serializedDocumentId(entity._id);
    if (!id) return [];
    const identityProfileUrl = identityUrlById.get(id);
    const persons = identityProfileUrl ? personIdsByUrl.get(identityProfileUrl) || [] : [];
    const leadEdgesElsewhere = persons.reduce((total, personId) => {
      const targets = leadTargetsByPerson.get(personId);
      if (!targets) return total;
      return total + [...targets].filter((targetId) => targetId !== id).length;
    }, 0);
    return [
      {
        id,
        slug: typeof entity.slug === 'string' ? entity.slug : undefined,
        entityType: typeof entity.entityType === 'string' ? entity.entityType : undefined,
        tier:
          typeof entity.studentVisibilityTier === 'string'
            ? entity.studentVisibilityTier
            : undefined,
        identityProfileUrl: isPersonProfileIdentityUrl(identityProfileUrl)
          ? identityProfileUrl
          : null,
        storedTitles: identityProfileUrl ? [...(titlesByUrl.get(identityProfileUrl) || [])] : [],
        leadEdgesElsewhere,
      },
    ];
  });

  const audit = auditTitleResearchOwnership(rows);
  const report = {
    script: SCRIPT_NAME,
    mode: 'read-only',
    generatedAt: new Date().toISOString(),
    liveRows: rows.length,
    byBucket: audit.byBucket,
    servedByBucket: audit.servedByBucket,
    worksInAnotherGroup: audit.worksInAnotherGroup,
    interpretation: [
      'works_in_another_group is NOT a defect list. Measured on Development, 38 of its 39 served rows carry a non-trainee lead, so a student reaches the faculty lead and the row describes a real access route.',
      'Hostability is owned by isTraineeLevelTitle plus hasStrongLead (#2876/#2877), not by this bucket. This predicate is deliberately wider and disagrees with isTraineeLevelTitle on 59 of 103 rows, reading research staff such as an associate research scientist as working in another group when they are reachable through their PI.',
      'Subtract namingARankTheyServe: those titles name a rank as the population somebody serves.',
      'corroboratedByALeadEdgeElsewhere counts a retired second-witness candidate for sizing only; it is not archive evidence.',
    ],
    findings: audit.findings.slice(0, args.findingsLimit),
    findingsShown: Math.min(args.findingsLimit, audit.findings.length),
    findingsTotal: audit.findings.length,
  };

  console.log(JSON.stringify(report, null, 2));
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(`Saved report to ${outputPath}`);
  }

  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
