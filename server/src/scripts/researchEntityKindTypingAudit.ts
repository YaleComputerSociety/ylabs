/**
 * research-entity:audit-kind-typing - reports the rows whose `entityType`
 * contradicts the shape of their own name, and the people who lead both a `LAB`
 * and a `FACULTY_RESEARCH_AREA` (#2884).
 *
 * Read-only: opens a connection, reads `research_entities` and `role_assignments`,
 * writes nothing. Emits machine-readable JSON and a non-zero exit code while any
 * contradiction stands, so a mis-typed row is detectable instead of emergent.
 *
 *   yarn --cwd server research-entity:audit-kind-typing
 *   yarn --cwd server research-entity:audit-kind-typing --served-only
 *   yarn --cwd server research-entity:audit-kind-typing --output=/tmp/kind-typing.json
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { LIVE_ENTITY_FILTER } from '../models/entityArchival';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { RoleAssignment } from '../models/roleAssignment';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  KIND_TYPING_CONTRADICTION_EXIT_CODE,
  summarizeResearchEntityKindTyping,
  type KindTypingEntityInput,
  type KindTypingLabAssertionInput,
  type KindTypingLeadEdgeInput,
} from './researchEntityKindTypingAuditCore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface KindTypingAuditOptions {
  output?: string;
  servedOnly: boolean;
}

export function parseResearchEntityKindTypingAuditArgs(argv: string[]): KindTypingAuditOptions {
  const options: KindTypingAuditOptions = { servedOnly: false };
  for (const arg of argv) {
    if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else if (arg === '--served-only') {
      options.servedOnly = true;
    } else {
      throw new Error(`Unknown research-entity:audit-kind-typing argument: ${arg}`);
    }
  }
  return options;
}

async function main() {
  const options = parseResearchEntityKindTypingAuditArgs(process.argv.slice(2));
  await initializeConnections();

  const match: Record<string, unknown> = {
    ...LIVE_ENTITY_FILTER,
    entityType: { $in: ['LAB', 'FACULTY_RESEARCH_AREA'] },
  };
  if (options.servedOnly) match.studentVisibilityTier = 'student_ready';

  const rows = (await ResearchEntity.find(match, {
    slug: 1,
    name: 1,
    displayName: 1,
    entityType: 1,
    kind: 1,
    studentVisibilityTier: 1,
    websiteUrl: 1,
  }).lean()) as Array<Record<string, any>>;

  const entities: KindTypingEntityInput[] = rows.map((row) => ({
    id: String(row._id),
    slug: row.slug,
    name: row.name,
    displayName: row.displayName,
    entityType: row.entityType,
    kind: row.kind,
    studentVisibilityTier: row.studentVisibilityTier,
    websiteUrl: row.websiteUrl,
  }));

  // `target.id` is an ObjectId, and a String() comparison here matches nothing while
  // reporting a confident zero (#2558's measurement note).
  const edges = (await RoleAssignment.find(
    {
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': { $in: rows.map((row) => row._id) },
      archived: { $ne: true },
    },
    { personId: 1, role: 1, 'target.id': 1 },
  ).lean()) as Array<Record<string, any>>;

  const leadEdges: KindTypingLeadEdgeInput[] = edges.map((edge) => ({
    personId: String(edge.personId),
    role: edge.role,
    entityId: String(edge.target?.id),
  }));

  // Read on the whole scanned set rather than on the contradicting subset, because the
  // writer-keyed cohort is by definition not contradicting: the lane wrote the name and
  // the type together, so they agree (#3252).
  const labAssertionDocs = (await Observation.find(
    {
      entityType: 'researchEntity',
      entityKey: { $in: rows.map((row) => String(row.slug)) },
      field: { $in: ['name', 'displayName', 'kind', 'entityType'] },
      superseded: { $ne: true },
    },
    { entityKey: 1, field: 1, value: 1, sourceName: 1 },
  ).lean()) as Array<Record<string, any>>;

  const labAssertions: KindTypingLabAssertionInput[] = labAssertionDocs.map((doc) => ({
    entityKey: doc.entityKey,
    field: doc.field,
    value: doc.value,
    sourceName: doc.sourceName,
  }));

  const report = {
    generatedAt: new Date().toISOString(),
    db: mongoose.connection.name,
    servedOnly: options.servedOnly,
    ...summarizeResearchEntityKindTyping({ entities, leadEdges, labAssertions }),
  };

  console.log(JSON.stringify(report, null, 2));
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  }

  await mongoose.disconnect();
  if (report.status === 'contradictions') {
    process.exitCode = KIND_TYPING_CONTRADICTION_EXIT_CODE;
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
  main().catch((error) => {
    console.error('Failed to audit research-entity kind typing:', sanitizeLogValue(error));
    process.exitCode = 1;
  });
}
