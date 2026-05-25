import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { AccessSignal } from '../models/accessSignal';
import { ContactRoute } from '../models/contactRoute';
import { EntryPathway } from '../models/entryPathway';
import { Observation } from '../models/observation';
import { PostedOpportunity } from '../models/postedOpportunity';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { User } from '../models/user';
import { deleteFromIndex, syncEntity } from '../services/meiliSyncService';
import { publicResearchEntityDescriptionText } from '../utils/researchEntityDescriptionText';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import { isRepairableFundingOnlyShell } from './repairFundingOnlyResearchEntitiesCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const FUNDING_ENTITY_SLUG_RE = /^(?:nsf|nih)-pi-/i;
const SYNTHETIC_FUNDING_NETID_RE = /^(?:nsf|nih)-pi:/i;

interface CliOptions {
  apply: boolean;
  limit: number;
  slug?: string;
  syncMeili: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false, limit: 100, syncMeili: false };

  for (const arg of argv) {
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--sync-meili') {
      options.syncMeili = true;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      const parsed = Number(arg.slice('--limit='.length));
      if (!Number.isInteger(parsed) || parsed < 1) throw new Error('--limit must be positive');
      options.limit = parsed;
      continue;
    }
    if (arg.startsWith('--slug=')) {
      const slug = arg.slice('--slug='.length).trim();
      if (slug) options.slug = slug;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = textValue(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function nameToken(value: unknown): string {
  return textValue(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)[0] || '';
}

function firstNameCompatible(sourceFirstName: unknown, candidateFirstName: unknown): boolean {
  const sourceToken = nameToken(sourceFirstName);
  const candidateToken = nameToken(candidateFirstName);
  if (!sourceToken || !candidateToken) return false;
  if (sourceToken === candidateToken) return true;
  if (sourceToken.length === 1) return candidateToken.startsWith(sourceToken);
  if (sourceToken.length < 3) return false;
  return candidateToken.startsWith(sourceToken) || sourceToken.startsWith(candidateToken);
}

function splitDisplayName(value: unknown): { first: string; last: string } {
  const cleaned = textValue(value)
    .replace(/\s+Lab$/i, '')
    .replace(/\s+[-–—]\s+Research$/i, '');
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { first: '', last: '' };
  if (tokens.length === 1) return { first: tokens[0], last: '' };
  return { first: tokens.slice(0, -1).join(' '), last: tokens[tokens.length - 1] };
}

function inferredPiNameMatchesEntity(entity: any, user: any): boolean {
  const expected = splitDisplayName(entity.name);
  if (!expected.last) return true;
  const expectedLast = nameToken(expected.last);
  const userLast = nameToken(user?.lname);
  if (expectedLast && userLast && expectedLast !== userLast) return false;
  return firstNameCompatible(expected.first, user?.fname);
}

function objectId(value: unknown): mongoose.Types.ObjectId {
  return value instanceof mongoose.Types.ObjectId
    ? value
    : new mongoose.Types.ObjectId(String(value));
}

function sourceUrlsFromUser(user: any): string[] {
  const profileUrls =
    user?.profileUrls && typeof user.profileUrls === 'object'
      ? Object.values(user.profileUrls)
      : [];
  return uniqueStrings([...profileUrls, user?.website]).filter((url) => /^https?:/i.test(url));
}

function sourceUrlsFromRecentGrants(entity: any): string[] {
  return uniqueStrings(
    Array.isArray(entity?.recentGrants) ? entity.recentGrants.map((grant: any) => grant?.url) : [],
  ).filter((url) => /^https?:/i.test(url));
}

function isWeakPlaceholderText(value: unknown): boolean {
  const text = textValue(value);
  return (
    /^research home (?:focused on|connected to)(?:\s|\.|$)/i.test(text) ||
    /^.+ is a yale research home(?: connected to .*)?\./i.test(text) ||
    /(?:\sand\s\.)|\bconnected to \.$/i.test(text) ||
    /indexed Yale metadata/i.test(text)
  );
}

async function inferredPiUserIdFor(entity: any): Promise<string> {
  const member = await ResearchGroupMember.findOne({
    researchEntityId: entity._id,
    userId: { $exists: true, $ne: null },
    isCurrentMember: { $ne: false },
    role: 'pi',
  })
    .select('userId')
    .lean();
  if (member?.userId) return String(member.userId);

  const observation = await Observation.findOne({
    entityType: 'researchEntity',
    entityKey: entity.slug,
    field: 'inferredPiUserId',
    superseded: { $ne: true },
  })
    .sort({ confidence: -1, observedAt: -1 })
    .select('value')
    .lean();
  return textValue(observation?.value);
}

function updateFromRealUser(entity: any, user: any, now: Date): Record<string, unknown> {
  const departments = uniqueStrings([
    ...(Array.isArray(entity.departments) ? entity.departments : []),
    ...(Array.isArray(user.departments) ? user.departments : []),
    user.primaryDepartment,
    ...(Array.isArray(user.secondaryDepartments) ? user.secondaryDepartments : []),
  ]);
  const researchAreas = uniqueStrings([
    ...(Array.isArray(entity.researchAreas) ? entity.researchAreas : []),
    ...(Array.isArray(user.topics) ? user.topics : []),
    ...(Array.isArray(user.researchInterests) ? user.researchInterests : []),
  ]).slice(0, 12);
  const sourceUrls = uniqueStrings([
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
    ...sourceUrlsFromRecentGrants(entity),
    ...sourceUrlsFromUser(user),
  ]);

  const update: Record<string, unknown> = {
    updatedAt: now,
    lastObservedAt: entity.lastObservedAt || now,
  };
  if (departments.length > 0) update.departments = departments;
  if (researchAreas.length > 0) update.researchAreas = researchAreas;
  if (sourceUrls.length > 0) update.sourceUrls = sourceUrls;
  for (const field of ['shortDescription', 'fullDescription', 'description'] as const) {
    if (isWeakPlaceholderText(entity[field])) update[field] = '';
  }

  const profileDescription = publicResearchEntityDescriptionText(user.bio);
  if (
    profileDescription &&
    !textValue(entity.description) &&
    !textValue(entity.fullDescription) &&
    !textValue(entity.profileSynthesisDescription)
  ) {
    update.profileSynthesisDescription = profileDescription;
    update.descriptionSource = 'PI_PROFILE_SYNTHESIS';
  }

  return update;
}

function hasSourceBackedProfileEvidence(update: Record<string, unknown>): boolean {
  return (
    (Array.isArray(update.sourceUrls) && update.sourceUrls.length > 0) ||
    Boolean(update.profileSynthesisDescription) ||
    update.descriptionSource === 'PI_PROFILE_SYNTHESIS'
  );
}

async function archiveChildArtifacts(researchEntityId: mongoose.Types.ObjectId, now: Date) {
  const filter = { researchEntityId, archived: { $ne: true } };
  const update = { $set: { archived: true, lastMaterializedAt: now } };
  const [entryPathways, accessSignals, contactRoutes, postedOpportunities, currentMembers] =
    await Promise.all([
      EntryPathway.updateMany(filter, update),
      AccessSignal.updateMany(filter, update),
      ContactRoute.updateMany(filter, update),
      PostedOpportunity.updateMany(filter, update),
      ResearchGroupMember.updateMany(
        { researchEntityId, isCurrentMember: { $ne: false } },
        { $set: { isCurrentMember: false, endedAt: now, updatedAt: now } },
      ),
    ]);
  return {
    entryPathways: entryPathways.modifiedCount || 0,
    accessSignals: accessSignals.modifiedCount || 0,
    contactRoutes: contactRoutes.modifiedCount || 0,
    postedOpportunities: postedOpportunities.modifiedCount || 0,
    currentMembers: currentMembers.modifiedCount || 0,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'research-entity:repair-funding-only',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const query: Record<string, unknown> = {
    archived: { $ne: true },
    slug: options.slug || FUNDING_ENTITY_SLUG_RE,
  };
  const entities = await ResearchEntity.find(query).limit(options.limit).lean();
  const now = new Date();
  const results: any[] = [];

  for (const entity of entities) {
    const userId = await inferredPiUserIdFor(entity);
    const user =
      userId && mongoose.Types.ObjectId.isValid(userId)
        ? await User.findById(userId)
            .select('netid fname lname departments primaryDepartment secondaryDepartments topics researchInterests profileUrls website bio')
            .lean()
        : null;
    const syntheticUser = !!user && SYNTHETIC_FUNDING_NETID_RE.test(textValue((user as any).netid));
    const sparse = isRepairableFundingOnlyShell(entity);
    const mismatchedUser = !!user && !inferredPiNameMatchesEntity(entity, user);

    if (!user || syntheticUser || mismatchedUser) {
      const shouldArchive = sparse;
      const result: any = {
        slug: entity.slug,
        action: shouldArchive ? 'archive-funding-only-shell' : 'skip-non-sparse-unmatched',
        userId,
        syntheticUser,
        mismatchedUser,
      };
      if (options.apply && shouldArchive) {
        await ResearchEntity.updateOne(
          { _id: entity._id },
          {
            $set: {
              archived: true,
              archivedAt: now,
              archiveReason: mismatchedUser
                ? 'funding-only-shell-pi-user-name-mismatch'
                : syntheticUser
                  ? 'funding-only-shell-synthetic-pi-user'
                  : 'funding-only-shell-unmatched-pi',
              updatedAt: now,
            },
          },
        );
        result.childArtifactsArchived = await archiveChildArtifacts(objectId(entity._id), now);
        if (options.syncMeili) await deleteFromIndex('researchEntity', String(entity._id));
      }
      results.push(result);
      continue;
    }

    const update = updateFromRealUser(entity, user, now);
    const hasSourceBackedEvidence = hasSourceBackedProfileEvidence(update);
    const result: any = {
      slug: entity.slug,
      action:
        Object.keys(update).length > 2 && hasSourceBackedEvidence
          ? 'enrich-from-real-pi-profile'
          : hasSourceBackedEvidence
            ? 'skip-no-profile-enrichment'
            : 'skip-profile-enrichment-without-source-evidence',
      userId,
      fields: Object.keys(update).filter((field) => !['updatedAt', 'lastObservedAt'].includes(field)),
    };
    if (options.apply && Object.keys(update).length > 2 && hasSourceBackedEvidence) {
      await ResearchEntity.updateOne({ _id: entity._id }, { $set: update });
      await ResearchGroupMember.updateOne(
        { researchEntityId: entity._id, userId: user._id },
        {
          $set: {
            researchEntityId: entity._id,
            researchGroupId: entity._id,
            userId: user._id,
            role: 'pi',
            isCurrentMember: true,
            lastObservedAt: now,
          },
          $setOnInsert: {
            startedAt: now,
            confidence: 0.7,
          },
        },
        { upsert: true },
      );
      if (options.syncMeili) {
        const updated = await ResearchEntity.findById(entity._id).lean();
        if (updated) await syncEntity('researchEntity', updated);
      }
    }
    results.push(result);
  }

  console.log(
    JSON.stringify(
      {
        mode: options.apply ? 'apply' : 'preview',
        count: results.length,
        results,
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
