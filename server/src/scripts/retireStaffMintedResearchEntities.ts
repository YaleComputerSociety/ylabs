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
import { archivedEntityUpdate, LIVE_ENTITY_FILTER } from '../models/entityArchival';
import { RESEARCH_ENTITY_SEARCH_INDEX_NAME } from '../services/researchEntitySearchIndexService';
import { getMeiliIndex } from '../utils/meiliClient';
import { OPERATOR_AUTHORED_SOURCE_NAMES } from '../scrapers/seedSources';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  STAFF_MINTED_ENTITY_ARCHIVE_REASON,
  isPersonProfileIdentityUrl,
  planStaffMintedEntityRetirement,
  summarizeStaffMintedEntityReasons,
  summarizeStaffMintedEntityRefusals,
  type StaffMintedEntityCandidate,
} from './retireStaffMintedResearchEntitiesCore';

dotenv.config();

const SCRIPT_NAME = 'research-entity:retire-staff-minted-entities';
const DEFAULT_MAX_APPLY = 200;

export interface RetireStaffMintedEntitiesCliOptions {
  apply: boolean;
  confirm: boolean;
  maxApply: number;
  output?: string;
  outputRequested?: boolean;
}

export function parseRetireStaffMintedEntitiesArgs(
  argv: string[],
): RetireStaffMintedEntitiesCliOptions {
  const options: RetireStaffMintedEntitiesCliOptions = {
    apply: false,
    confirm: false,
    maxApply: DEFAULT_MAX_APPLY,
  };

  for (const arg of argv) {
    if (arg === '--' || arg === '') continue;
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.apply = false;
      continue;
    }
    if (arg === '--confirm-staff-minted-entity-retirement') {
      options.confirm = true;
      continue;
    }
    if (arg.startsWith('--max-apply=')) {
      const raw = arg.slice('--max-apply='.length).trim();
      const parsed = /^\d+$/.test(raw) ? Number(raw) : NaN;
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error('--max-apply must be a safe positive integer');
      }
      options.maxApply = parsed;
      continue;
    }
    if (arg.startsWith('--output=')) {
      // The raw value, empty included, so `--output=` reaches the resolver and throws
      // rather than silently producing no report for a whole apply (#3380).
      options.output = arg.slice('--output='.length);
      options.outputRequested = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

const provenanceOf = (
  entity: { fieldProvenance?: unknown },
  field: string,
): { sourceUrl?: unknown } | undefined => {
  const provenance =
    entity.fieldProvenance && typeof entity.fieldProvenance === 'object'
      ? (entity.fieldProvenance as Record<string, { sourceUrl?: unknown } | undefined>)
      : {};
  return provenance[field];
};

/**
 * The citation that gave the row its identity, which is the only one whose person's
 * title may speak for the row.
 *
 * `slug` provenance only. Both mint gates write `slug` and `name` from the same
 * base, so for this population a `name` fallback adds nothing, and where it does
 * fire the row's `name` is by definition a value some other lane wrote - the
 * name-graft class this repo already tracks separately. It fired for 255 live rows
 * on Development, so dropping it is a real narrowing of what may be archived, in
 * the conservative direction.
 */
export function identityProfileUrlOf(entity: { fieldProvenance?: unknown }): string | undefined {
  const url = provenanceOf(entity, 'slug')?.sourceUrl;
  return isPersonProfileIdentityUrl(url) ? String(url) : undefined;
}

/**
 * Whether the row populates a website its identity page did not supply.
 *
 * A website whose provenance IS the identity page is the lab link off the person's own
 * profile, which is the graft being retired rather than an identity of the row's own,
 * so it must not spare the row. Anything else is an identity that did not come from
 * this page, and one such field is enough, because archival cannot be undone by
 * re-scraping. A row with no website at all has nothing foreign.
 */
export function hasForeignWebsite(
  entity: { fieldProvenance?: unknown; websiteUrl?: unknown; website?: unknown },
  identityProfileUrl: string | undefined,
): boolean {
  const fields = populatedWebsiteFieldsOf(entity);
  if (fields.length === 0) return false;
  if (!identityProfileUrl) return true;
  return fields.some((field) => provenanceOf(entity, field)?.sourceUrl !== identityProfileUrl);
}

export const WEBSITE_FIELDS = ['websiteUrl', 'website'] as const;

/**
 * Every website field the row actually populates. All of them, not the first: a row
 * can hold `websiteUrl` from its own identity page and `website` from another lane,
 * and reading only the first would let the foreign one through unexamined.
 */
export function populatedWebsiteFieldsOf(entity: {
  websiteUrl?: unknown;
  website?: unknown;
}): (typeof WEBSITE_FIELDS)[number][] {
  return WEBSITE_FIELDS.filter((field) => {
    const value = (entity as Record<string, unknown>)[field];
    return typeof value === 'string' && value.trim() !== '';
  });
}

/**
 * Provenance entries naming a person rather than a lane. An admin edit leaves
 * `manuallyLockedFields` empty, so this is the other half of "an operator has already
 * decided something about this row" (#3357).
 *
 * `OPERATOR_AUTHORED_SOURCE_NAMES` is the repo's single definition, derived from the
 * `isManualLock` seeds, and it deliberately excludes `manual-data-repair` and
 * `manual-data-correction`: those are a repair script's own prior write, and reading
 * them as operator intent would stop any later repair from correcting a row an earlier
 * one touched. A name-prefix test of this module's own would have inverted
 * that decision, so this reads the constant.
 */
export function operatorProvenanceSourceNamesOf(entity: { fieldProvenance?: unknown }): string[] {
  const provenance =
    entity.fieldProvenance && typeof entity.fieldProvenance === 'object'
      ? (entity.fieldProvenance as Record<string, { sourceName?: unknown } | undefined>)
      : {};
  const operatorAuthored = new Set<string>(OPERATOR_AUTHORED_SOURCE_NAMES);
  return [
    ...new Set(
      Object.values(provenance)
        .map((record) => (typeof record?.sourceName === 'string' ? record.sourceName : ''))
        .filter((name) => operatorAuthored.has(name)),
    ),
  ];
}

async function deleteSearchDocuments(
  ids: string[],
): Promise<{ requested: number; deleted: boolean; error?: string }> {
  if (ids.length === 0) return { requested: 0, deleted: false };
  try {
    const index = await getMeiliIndex(RESEARCH_ENTITY_SEARCH_INDEX_NAME);
    await index.deleteDocuments(ids);
    return { requested: ids.length, deleted: true };
  } catch (error) {
    return { requested: ids.length, deleted: false, error: String(sanitizeLogValue(error)) };
  }
}

async function main(): Promise<void> {
  const args = parseRetireStaffMintedEntitiesArgs(process.argv.slice(2));
  // Resolved before the database is opened, so an unwritable report path fails the
  // run instead of failing after the archive it was meant to make reviewable (#3380).
  const outputPath = args.outputRequested
    ? resolveSafeJsonReportOutputPath(args.output)
    : undefined;
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (args.apply && !args.confirm) {
    throw new Error(`${SCRIPT_NAME} apply requires --confirm-staff-minted-entity-retirement`);
  }

  await initializeConnections();

  const rows = await ResearchEntity.find(LIVE_ENTITY_FILTER)
    .select(
      '_id archived entityType studentVisibilityTier studentVisibilityOverrideTier fieldProvenance manuallyLockedFields websiteUrl website',
    )
    .lean();

  const identityUrlById = new Map<string, string>();
  for (const row of rows) {
    const id = serializedDocumentId(row._id);
    const url = identityProfileUrlOf(row as { fieldProvenance?: unknown });
    if (id && url) identityUrlById.set(id, url);
  }

  const identityUrls = [...new Set(identityUrlById.values())];
  const titlesByUrl = new Map<string, Set<string>>();
  // Every live title, from every lane, rather than the most recent one: the verdict
  // is unanimity across them, so the set matters and recency does not. Live only is
  // the pair every other retirement pass carries when it reads a stored value as
  // current, because a superseded or rolled-back title is a claim the lane has
  // withdrawn. On Development it changes no verdict and moves 33 identity pages into
  // `no-stored-title`, which refuses.
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

  // Which people the identity page itself names, so a role edge attaching that
  // person can be told from one attaching somebody else. `profileLinks` is the join,
  // because it is where the person's own primary-identity URL is stored.
  const identityPersonIdsByUrl = new Map<string, string[]>();
  for (const person of await Researcher.find({
    archived: { $ne: true },
    'profileLinks.url': { $in: identityUrls },
  })
    .select('_id profileLinks')
    .lean()) {
    const personId = serializedDocumentId(person._id);
    if (!personId) continue;
    const links = Array.isArray(person.profileLinks) ? person.profileLinks : [];
    for (const link of links as Array<{ url?: unknown }>) {
      const url = typeof link?.url === 'string' ? link.url : '';
      if (!url) continue;
      const held = identityPersonIdsByUrl.get(url) || [];
      if (!held.includes(personId)) held.push(personId);
      identityPersonIdsByUrl.set(url, held);
    }
  }

  const roleEdgePersonIdsById = new Map<string, string[]>();
  for (const edge of await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    archived: { $ne: true },
  })
    .select('target personId')
    .lean()) {
    const entityId = serializedDocumentId(edge.target?.id);
    const personId = serializedDocumentId(edge.personId);
    if (!entityId || !personId) continue;
    const held = roleEdgePersonIdsById.get(entityId) || [];
    held.push(personId);
    roleEdgePersonIdsById.set(entityId, held);
  }

  const candidates: StaffMintedEntityCandidate[] = rows.flatMap((row) => {
    const id = serializedDocumentId(row._id);
    if (!id) return [];
    const identityProfileUrl = identityUrlById.get(id);
    return [
      {
        id,
        entityType: typeof row.entityType === 'string' ? row.entityType : undefined,
        tier: typeof row.studentVisibilityTier === 'string' ? row.studentVisibilityTier : undefined,
        identityProfileUrl,
        storedTitles: identityProfileUrl ? [...(titlesByUrl.get(identityProfileUrl) || [])] : [],
        manuallyLockedFields: Array.isArray(row.manuallyLockedFields)
          ? (row.manuallyLockedFields as string[])
          : [],
        visibilityOverrideTier:
          typeof row.studentVisibilityOverrideTier === 'string'
            ? row.studentVisibilityOverrideTier
            : null,
        operatorProvenanceSourceNames: operatorProvenanceSourceNamesOf(
          row as { fieldProvenance?: unknown },
        ),
        // Both fields, because the floor has to read what rows actually carry:
        // Development has 1,695 live rows populating `websiteUrl` against 454
        // populating `website`, and the mints being retired here write the former.
        hasForeignWebsite: hasForeignWebsite(
          row as { fieldProvenance?: unknown; websiteUrl?: unknown; website?: unknown },
          identityProfileUrl,
        ),
        identityPersonIds: identityProfileUrl
          ? identityPersonIdsByUrl.get(identityProfileUrl) || []
          : [],
        roleEdgePersonIds: roleEdgePersonIdsById.get(id) || [],
      },
    ];
  });

  const plan = planStaffMintedEntityRetirement(candidates);
  const toApply = plan.toArchive.slice(0, args.maxApply);

  const report: Record<string, unknown> = {
    script: SCRIPT_NAME,
    mode: args.apply ? 'apply' : 'dry-run',
    liveRows: rows.length,
    rowsWithAPersonProfileIdentity: identityUrlById.size,
    plannedToArchive: plan.toArchive.length,
    plannedByReason: summarizeStaffMintedEntityReasons(plan.toArchive),
    plannedServed: plan.toArchive.filter((entry) => entry.wasServed).length,
    plannedCarryingOnlySelfRoleEdges: plan.toArchive.filter((entry) => entry.selfRoleEdges > 0)
      .length,
    plannedByEntityType: plan.toArchive.reduce<Record<string, number>>((counts, entry) => {
      counts[entry.entityType] = (counts[entry.entityType] || 0) + 1;
      return counts;
    }, {}),
    refusedByReason: summarizeStaffMintedEntityRefusals(plan.refused),
    appliedLimit: args.maxApply,
    // The pre-apply state of exactly the rows this run touches. A peer session
    // writes Development concurrently, so a post-hoc tier delta over the corpus
    // cannot be attributed to this run without it.
    targets: toApply.map((entry) => ({
      id: entry.id,
      reason: entry.reason,
      entityType: entry.entityType,
      tierBefore: entry.tier,
    })),
  };

  const writeReport = () => {
    if (!outputPath) return;
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  };

  writeReport();

  let archived = 0;
  let search: { requested: number; deleted: boolean; error?: string } = {
    requested: 0,
    deleted: false,
  };

  if (args.apply && toApply.length > 0) {
    const objectIds = toApply
      .map((entry) => entry.id)
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    const result = await ResearchEntity.updateMany(
      { _id: { $in: objectIds }, ...LIVE_ENTITY_FILTER },
      archivedEntityUpdate(STAFF_MINTED_ENTITY_ARCHIVE_REASON),
    );
    archived = result.modifiedCount ?? 0;
    search = await deleteSearchDocuments(toApply.map((entry) => entry.id));
  }

  report.archived = archived;
  report.search = {
    ...search,
    rebuildGuidance:
      'If search documents were not deleted, prune with meili:prune-archived-research-entities.',
  };
  writeReport();

  console.log(JSON.stringify(report, null, 2));
  if (outputPath) console.log(`Saved report to ${outputPath}`);

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
