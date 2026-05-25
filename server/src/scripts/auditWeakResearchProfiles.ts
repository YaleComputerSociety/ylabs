import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { User } from '../models/user';
import { AccessSignal } from '../models/accessSignal';
import { ContactRoute } from '../models/contactRoute';
import { EntryPathway } from '../models/entryPathway';
import { Observation } from '../models/observation';
import {
  assessResearchEntityDescriptionQuality,
  type DescriptionQualityFlag,
} from '../utils/researchEntityDescriptionQuality';
import { deriveAccessArtifactsFromObservations } from '../scrapers/accessMaterializer';
import { buildTwoFieldDescriptionRepair } from './repairResearchEntityDescriptionsTwoFieldCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface CliOptions {
  limit: number;
  skip: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { limit: 50, skip: 0 };
  for (const arg of argv) {
    if (arg.startsWith('--limit=')) {
      const parsed = Number(arg.slice('--limit='.length));
      if (!Number.isInteger(parsed) || parsed < 1) throw new Error('--limit must be positive');
      options.limit = parsed;
    } else if (arg.startsWith('--skip=')) {
      const parsed = Number(arg.slice('--skip='.length));
      if (!Number.isInteger(parsed) || parsed < 0) throw new Error('--skip must be non-negative');
      options.skip = parsed;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function textArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(textValue).filter(Boolean) : [];
}

function uniqueStrings(values: unknown[], limit = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = textValue(value);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function primaryFailure(flags: DescriptionQualityFlag[]): string {
  if (flags.includes('blank')) return 'missing-description';
  if (flags.includes('full-not-useful')) return 'missing-or-weak-full-description';
  return flags[0] || 'unknown';
}

function observationKey(observation: any): string {
  if (observation._id) return String(observation._id);
  return [
    observation.field,
    observation.entityId ? String(observation.entityId) : '',
    observation.entityKey || '',
    observation.sourceName || '',
    observation.sourceUrl || '',
    JSON.stringify(observation.value),
  ].join(':');
}

function dedupeObservations(observations: any[]): any[] {
  const byKey = new Map<string, any>();
  for (const observation of observations) {
    byKey.set(observationKey(observation), observation);
  }
  return [...byKey.values()];
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await initializeConnections();

  const weakFilter = {
    archived: { $ne: true },
    $or: [
      { shortDescription: { $exists: false } },
      { shortDescription: '' },
      { shortDescription: null },
      { fullDescription: { $exists: false } },
      { fullDescription: '' },
      { fullDescription: null },
    ],
  };

  const docs = await ResearchEntity.find(weakFilter)
    .select(
      [
        '_id',
        'slug',
        'name',
        'displayName',
        'kind',
        'entityType',
        'departments',
        'researchAreas',
        'sourceUrls',
        'websiteUrl',
        'shortDescription',
        'fullDescription',
        'description',
        'profileSynthesisDescription',
        'descriptionSource',
        'acceptingUndergrads',
        'currentUndergradCount',
        'undergradEvidenceQuote',
      ].join(' '),
    )
    .sort({ lastObservedAt: 1, _id: 1 })
    .skip(options.skip)
    .limit(options.limit)
    .lean();

  const entityIds = docs.map((doc: any) => doc._id);
  const members = await ResearchGroupMember.find({
    researchEntityId: { $in: entityIds },
    role: { $in: ['pi', 'director', 'co-director', 'core-faculty'] },
    isCurrentMember: { $ne: false },
    userId: { $exists: true, $ne: null },
  })
    .select('researchEntityId userId role')
    .lean();
  const users = await User.find({
    _id: { $in: [...new Set(members.map((member: any) => String(member.userId)))] },
  })
    .select('netid fname lname bio topics researchInterests profileUrls website')
    .lean();
  const usersById = new Map(users.map((user: any) => [String(user._id), user]));
  const membersByEntityId = new Map<string, any[]>();
  for (const member of members as any[]) {
    const key = String(member.researchEntityId);
    membersByEntityId.set(key, [...(membersByEntityId.get(key) || []), member]);
  }

  const [accessCounts, pathwayCounts, contactCounts] = await Promise.all([
    AccessSignal.aggregate([
      { $match: { researchEntityId: { $in: entityIds }, archived: { $ne: true } } },
      { $group: { _id: '$researchEntityId', count: { $sum: 1 } } },
    ]),
    EntryPathway.aggregate([
      { $match: { researchEntityId: { $in: entityIds }, archived: { $ne: true } } },
      { $group: { _id: '$researchEntityId', count: { $sum: 1 } } },
    ]),
    ContactRoute.aggregate([
      { $match: { researchEntityId: { $in: entityIds }, archived: { $ne: true } } },
      { $group: { _id: '$researchEntityId', count: { $sum: 1 } } },
    ]),
  ]);
  const countMap = (rows: any[]) => new Map(rows.map((row) => [String(row._id), row.count]));
  const accessByEntityId = countMap(accessCounts);
  const pathwaysByEntityId = countMap(pathwayCounts);
  const contactsByEntityId = countMap(contactCounts);
  const accessObservations = await Observation.find({
    entityType: { $in: ['researchEntity', 'researchGroup'] },
    superseded: false,
    $or: [
      { entityId: { $in: entityIds } },
      { entityKey: { $in: docs.map((doc: any) => doc.slug).filter(Boolean) } },
    ],
    field: {
      $in: [
        'acceptingUndergrads',
        'currentUndergradCount',
        'undergradEvidenceQuote',
        'undergradAccessEvidence',
        'undergradRoleEvidenceQuote',
        'contactInstructionsQuote',
        'undergradConstraintQuote',
        'joinPageUrl',
        'contactEmail',
        'contactName',
        'contactRole',
      ],
    },
  })
    .select('_id entityId entityKey field value sourceName sourceUrl confidence observedAt')
    .lean();
  const observationsByEntityId = new Map<string, any[]>();
  const observationsBySlug = new Map<string, any[]>();
  for (const observation of accessObservations as any[]) {
    if (observation.entityId) {
      const key = String(observation.entityId);
      observationsByEntityId.set(key, [...(observationsByEntityId.get(key) || []), observation]);
    }
    if (observation.entityKey) {
      const key = String(observation.entityKey);
      observationsBySlug.set(key, [...(observationsBySlug.get(key) || []), observation]);
    }
  }

  const rows = docs.map((doc: any) => {
    const entityMembers = membersByEntityId.get(String(doc._id)) || [];
    const memberUsers = entityMembers
      .map((member) => usersById.get(String(member.userId)))
      .filter(Boolean);
    const profileUrls = uniqueStrings(
      memberUsers.flatMap((user: any) => [
        ...Object.values(user.profileUrls || {}),
        user.website,
      ]),
      8,
    );
    const profileResearchAreas = uniqueStrings(
      memberUsers.flatMap((user: any) => [
        ...textArray(user.topics),
        ...textArray(user.researchInterests),
      ]),
      8,
    );
    const profileBio = memberUsers
      .map((user: any) => textValue(user.bio))
      .find(Boolean) || '';
    const quality = assessResearchEntityDescriptionQuality(doc);
    const repair = buildTwoFieldDescriptionRepair({
      ...doc,
      profileResearchAreas,
      profileBio,
      repairWeakPlaceholders: true,
    });
    const accessCount = accessByEntityId.get(String(doc._id)) || 0;
    const pathwayCount = pathwaysByEntityId.get(String(doc._id)) || 0;
    const contactCount = contactsByEntityId.get(String(doc._id)) || 0;
    const sourceUrls = textArray(doc.sourceUrls);
    const observations = dedupeObservations([
      ...(observationsByEntityId.get(String(doc._id)) || []),
      ...(observationsBySlug.get(String(doc.slug)) || []),
    ]);
    const observationFields = observations.reduce<Record<string, number>>((acc, observation) => {
      acc[observation.field] = (acc[observation.field] || 0) + 1;
      return acc;
    }, {});
    const derived = deriveAccessArtifactsFromObservations(String(doc._id), observations);

    return {
      slug: doc.slug,
      name: doc.displayName || doc.name,
      descriptionFailure: primaryFailure([...quality.short.flags, ...quality.full.flags]),
      shortFlags: quality.short.flags,
      fullFlags: quality.full.flags,
      sourceUrlCount: sourceUrls.length,
      profileUrlCount: profileUrls.length,
      hasProfileBio: Boolean(profileBio),
      profileResearchAreas: profileResearchAreas.slice(0, 4),
      accessCount,
      pathwayCount,
      contactCount,
      entityCache: {
        acceptingUndergrads: doc.acceptingUndergrads,
        currentUndergradCount: doc.currentUndergradCount,
        undergradEvidenceQuote: textValue(doc.undergradEvidenceQuote).slice(0, 120),
      },
      observationFields,
      derivedArtifacts: {
        accessSignals: derived.accessSignals.length,
        entryPathways: derived.entryPathways.length,
        contactRoutes: derived.contactRoutes.length,
      },
      proposedRepair: repair.update,
      repairReasons: repair.reasons,
    };
  });

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        filters: options,
        scanned: docs.length,
        categoryCounts: rows.reduce<Record<string, number>>((acc, row) => {
          acc[row.descriptionFailure] = (acc[row.descriptionFailure] || 0) + 1;
          return acc;
        }, {}),
        repairableCount: rows.filter((row) => Object.keys(row.proposedRepair).length > 0).length,
        rows,
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
