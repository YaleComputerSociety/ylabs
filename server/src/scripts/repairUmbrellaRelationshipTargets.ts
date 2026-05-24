import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchEntityRelationship } from '../models/researchEntityRelationship';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { User } from '../models/user';
import {
  materializeEntity,
  syncProfileBackedFacultyResearchAreaMemberFromIdentity,
} from '../scrapers/entityMaterializer';
import {
  buildUmbrellaRelationshipTargetRepairPlan,
  type UmbrellaRelationshipTargetRepairCandidate,
  type UmbrellaRelationshipTargetRepairSkipReason,
} from './repairUmbrellaRelationshipTargetsCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DEFAULT_UMBRELLA_SLUGS = [
  'center-wu-tsai',
  'center-yale-cancer-center',
  'center-yale-quantum-institute',
];

interface CliOptions {
  apply: boolean;
  limit: number;
  slugs: string[];
}

export function parseRepairUmbrellaRelationshipTargetsArgs(argv: string[]): CliOptions {
  const slugArg = argv.find((arg) => arg.startsWith('--slugs='))?.slice('--slugs='.length);
  const limitValue = Number(argv.find((arg) => arg.startsWith('--limit='))?.slice('--limit='.length));
  return {
    apply: argv.includes('--apply'),
    limit: Number.isFinite(limitValue) && limitValue > 0 ? Math.floor(limitValue) : 5000,
    slugs: slugArg
      ? slugArg
          .split(',')
          .map((slug) => slug.trim())
          .filter(Boolean)
      : DEFAULT_UMBRELLA_SLUGS,
  };
}

function generatedFacultyResearchArea(slug: string | undefined): boolean {
  return (slug || '').startsWith('faculty-research-area-');
}

function personNameFromGeneratedTarget(slug: string | undefined, name: string | undefined): string {
  const fromName = (name || '').replace(/\s+Research$/i, '').trim();
  if (fromName) return fromName;
  return (slug || '')
    .replace(/^faculty-research-area-/i, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compactPersonName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

async function resolveCanonicalTarget(
  target: { _id: unknown; slug?: string; name?: string },
): Promise<{
  canonicalTargetId?: string;
  canonicalTargetSlug?: string;
  profileUserId?: string;
  profileUserNetid?: string;
  skippedReason?: UmbrellaRelationshipTargetRepairSkipReason;
}> {
  if (!generatedFacultyResearchArea(target.slug)) return { skippedReason: 'not-generated-target' };

  const personName = personNameFromGeneratedTarget(target.slug, target.name);
  const parts = personName.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { skippedReason: 'no-user' };

  const first = parts.slice(0, -1).join(' ');
  const last = parts[parts.length - 1];
  const users = await User.find({
    lname: { $regex: new RegExp(`^\\s*${escapeRegExp(last)}\\s*$`, 'i') },
  })
    .select('_id fname lname netid profileUrls website bio topics')
    .limit(10)
    .lean();
  const expectedName = compactPersonName(`${first} ${last}`);
  const matchingUsers = users.filter((user: any) => {
    return compactPersonName(`${user.fname || ''} ${user.lname || ''}`) === expectedName;
  });
  if (matchingUsers.length !== 1) return { skippedReason: 'no-user' };
  const matchingUser = matchingUsers[0];

  const memberships = await ResearchGroupMember.find({
    userId: matchingUser._id,
    role: 'pi',
    isCurrentMember: { $ne: false },
    researchEntityId: { $exists: true, $ne: null },
  })
    .select('researchEntityId')
    .lean();
  const candidateIds = Array.from(
    new Set(memberships.map((member: any) => String(member.researchEntityId)).filter(Boolean)),
  );
  const hasProfileContext =
    Boolean(matchingUser.profileUrls && Object.keys(matchingUser.profileUrls).length > 0) ||
    Boolean((matchingUser.website || '').trim()) ||
    Boolean((matchingUser.bio || '').trim()) ||
    (Array.isArray(matchingUser.topics) && matchingUser.topics.length > 0);
  const profileBackedResult = {
    profileUserId: String(matchingUser._id),
    profileUserNetid: matchingUser.netid,
    skippedReason: hasProfileContext
      ? ('profile-backed-individual' as const)
      : ('exact-user-needs-profile-enrichment' as const),
  };

  if (candidateIds.length === 0) return profileBackedResult;

  const entities = await ResearchEntity.find({
    _id: { $in: candidateIds.map((id) => new mongoose.Types.ObjectId(id)) },
    archived: { $ne: true },
  })
    .select('_id slug name kind')
    .lean();
  const canonicalCandidates = entities.filter((entity: any) => {
    return (
      String(entity._id) !== String(target._id) &&
      !generatedFacultyResearchArea(entity.slug)
    );
  });
  if (canonicalCandidates.length === 0) return profileBackedResult;
  if (canonicalCandidates.length > 1) return { skippedReason: 'ambiguous-pi-lab' };

  return {
    canonicalTargetId: String(canonicalCandidates[0]._id),
    canonicalTargetSlug: canonicalCandidates[0].slug,
  };
}

async function loadRepairCandidates(options: CliOptions): Promise<UmbrellaRelationshipTargetRepairCandidate[]> {
  const umbrellaEntities = await ResearchEntity.find({
    slug: { $in: options.slugs },
    archived: { $ne: true },
  })
    .select('_id slug name')
    .lean();
  const umbrellaIds = umbrellaEntities.map((entity: any) => entity._id);
  const relationships = await ResearchEntityRelationship.find({
    sourceResearchEntityId: { $in: umbrellaIds },
    archived: { $ne: true },
  })
    .select('_id sourceResearchEntityId targetResearchEntityId relationshipType sourceUrl confidence')
    .limit(options.limit)
    .lean();
  const targetIds = Array.from(
    new Set(relationships.map((relationship: any) => String(relationship.targetResearchEntityId))),
  );
  const targets = await ResearchEntity.find({
    _id: { $in: targetIds.map((id) => new mongoose.Types.ObjectId(id)) },
  })
    .select('_id slug name')
    .lean();
  const targetById = new Map(targets.map((target: any) => [String(target._id), target]));

  const candidates: UmbrellaRelationshipTargetRepairCandidate[] = [];
  for (const relationship of relationships as any[]) {
    const target = targetById.get(String(relationship.targetResearchEntityId));
    const resolution = target
      ? await resolveCanonicalTarget(target)
      : { skippedReason: 'missing-canonical-target' as const };
    candidates.push({
      relationshipId: String(relationship._id),
      sourceResearchEntityId: String(relationship.sourceResearchEntityId),
      targetResearchEntityId: String(relationship.targetResearchEntityId),
      relationshipType: relationship.relationshipType,
      targetSlug: target?.slug,
      targetName: target?.name,
      sourceUrl: relationship.sourceUrl,
      confidence: relationship.confidence,
      canonicalTargetId: resolution.canonicalTargetId,
      canonicalTargetSlug: resolution.canonicalTargetSlug,
      profileUserId: resolution.profileUserId,
      profileUserNetid: resolution.profileUserNetid,
      skippedReason: resolution.skippedReason,
    });
  }
  return candidates;
}

async function applyPlan(plan: ReturnType<typeof buildUmbrellaRelationshipTargetRepairPlan>) {
  const archivedDuplicateResults = [];
  for (const duplicate of plan.archiveDuplicates) {
    const result = await ResearchEntityRelationship.updateOne(
      { _id: duplicate.relationshipId },
      { $set: { archived: true } },
    );
    archivedDuplicateResults.push({
      relationshipId: duplicate.relationshipId,
      modifiedCount: result.modifiedCount,
    });
  }

  const relinkResults = [];
  for (const relink of plan.relink) {
    const result = await ResearchEntityRelationship.updateOne(
      { _id: relink.relationshipId },
      {
        $set: {
          targetResearchEntityId: new mongoose.Types.ObjectId(relink.canonicalTargetId),
          archived: false,
        },
      },
    );
    relinkResults.push({
      relationshipId: relink.relationshipId,
      canonicalTargetSlug: relink.canonicalTargetSlug,
      modifiedCount: result.modifiedCount,
    });
  }

  const attachProfileBackedIndividualResults = [];
  for (const attach of plan.attachProfileBackedIndividuals) {
    const result = await syncProfileBackedFacultyResearchAreaMemberFromIdentity(
      attach.targetResearchEntityId,
      {
        entityKey: attach.targetSlug,
        name: attach.targetName,
        entityType: 'FACULTY_RESEARCH_AREA',
        userId: attach.userId,
        sourceUrl: attach.sourceUrl,
        confidence: attach.confidence,
      },
    );
    attachProfileBackedIndividualResults.push({
      relationshipId: attach.relationshipId,
      targetSlug: attach.targetSlug,
      userNetid: attach.userNetid,
      synced: result.synced,
      created: result.created,
      skipped: result.skipped,
    });
  }

  return { archivedDuplicateResults, relinkResults, attachProfileBackedIndividualResults };
}

async function materializeScopedRelationshipObservations(options: CliOptions) {
  const sourceAlternation = options.slugs.map(escapeRegExp).join('|');
  const entityKeyPattern = new RegExp(
    `^(${sourceAlternation}):faculty-research-area-.*:MEMBER_RESEARCH_AREA$`,
  );
  const keys = await Observation.distinct('entityKey', {
    entityType: 'researchEntityRelationship',
    entityKey: { $regex: entityKeyPattern },
  });
  const results = [];
  for (const key of keys.slice(0, options.limit)) {
    const result = await materializeEntity(
      'researchEntityRelationship',
      { entityKey: String(key) },
      { dryRun: false, syncMeilisearch: false },
    );
    results.push({
      entityKey: String(key),
      fieldsWritten: result.fieldsWritten,
      created: result.created,
      skipped: result.skipped,
    });
  }
  return results;
}

async function main(): Promise<void> {
  const options = parseRepairUmbrellaRelationshipTargetsArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'research-entity:repair-umbrella-relationships',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();
  const materializedObservationResults = options.apply
    ? await materializeScopedRelationshipObservations(options)
    : null;
  const candidates = await loadRepairCandidates(options);
  const plan = buildUmbrellaRelationshipTargetRepairPlan(candidates);
  const applyResults = options.apply ? await applyPlan(plan) : null;

  const skippedByReason = plan.skipped.reduce<Record<string, number>>((acc, row) => {
    acc[row.reason] = (acc[row.reason] || 0) + 1;
    return acc;
  }, {});

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        apply: options.apply,
        filters: {
          slugs: options.slugs,
          limit: options.limit,
        },
        counts: {
          materializedRelationshipObservationKeys: materializedObservationResults?.length || 0,
          candidates: candidates.length,
          generatedTargets: candidates.filter((candidate) =>
            generatedFacultyResearchArea(candidate.targetSlug),
          ).length,
          relink: plan.relink.length,
          archiveDuplicates: plan.archiveDuplicates.length,
          attachProfileBackedIndividuals: plan.attachProfileBackedIndividuals.length,
          skipped: plan.skipped.length,
          skippedByReason,
        },
        samples: {
          relink: plan.relink.slice(0, 10),
          archiveDuplicates: plan.archiveDuplicates.slice(0, 10),
          attachProfileBackedIndividuals: plan.attachProfileBackedIndividuals.slice(0, 10),
          skipped: plan.skipped.slice(0, 10),
        },
        materializedObservationSamples: materializedObservationResults?.slice(0, 10) || null,
        applyResults,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
