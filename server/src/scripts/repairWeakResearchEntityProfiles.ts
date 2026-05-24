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
import { PostedOpportunity } from '../models/postedOpportunity';
import { syncEntity } from '../services/meiliSyncService';
import { publicResearchEntityDescriptionText } from '../utils/researchEntityDescriptionText';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface CliOptions {
  apply: boolean;
  limit: number;
  slugs: string[];
  syncMeili: boolean;
  archiveUnfixable: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    limit: 50,
    slugs: [],
    syncMeili: false,
    archiveUnfixable: false,
  };
  for (const arg of argv) {
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--sync-meili') {
      options.syncMeili = true;
    } else if (arg === '--archive-unfixable') {
      options.archiveUnfixable = true;
    } else if (arg.startsWith('--limit=')) {
      const parsed = Number(arg.slice('--limit='.length));
      if (!Number.isInteger(parsed) || parsed < 1) throw new Error('--limit must be positive');
      options.limit = parsed;
    } else if (arg.startsWith('--slug=')) {
      const slug = arg.slice('--slug='.length).trim();
      if (slug) options.slugs.push(slug);
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

function uniqueStrings(values: unknown[], limit = 20): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = textValue(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function token(value: unknown): string {
  return textValue(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)[0] || '';
}

function normalizedNameKey(value: unknown): string {
  return textValue(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function slugNetid(slug: string): string {
  const parts = textValue(slug).split('-').filter(Boolean);
  return parts[parts.length - 1] || '';
}

function baseName(entity: any): string {
  return textValue(entity.name)
    .replace(/\s+Lab$/i, '')
    .replace(/\s+[-–—]\s+Research$/i, '')
    .trim();
}

function nameMatchesUser(entity: any, user: any): boolean {
  const entityBaseName = baseName(entity);
  const parts = entityBaseName.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return false;
  const entityKey = normalizedNameKey(entityBaseName);
  const fullUserKey = normalizedNameKey(`${user?.fname || ''} ${user?.lname || ''}`);
  const lastUserKey = normalizedNameKey(user?.lname);
  if (entityKey && (entityKey === fullUserKey || entityKey === lastUserKey)) return true;
  const userFirst = token(user?.fname);
  const userLast = token(user?.lname);
  const first = token(parts[0]);
  const last = token(parts[parts.length - 1]);
  if (!userLast) return false;
  if (parts.length === 1) return first === userLast;
  return first === userFirst && last === userLast;
}

function sourceUrlsFromUser(user: any): string[] {
  const profileUrls =
    user?.profileUrls && typeof user.profileUrls === 'object'
      ? Object.values(user.profileUrls)
      : [];
  return uniqueStrings([...profileUrls, user?.website], 8).filter((url) => /^https?:/i.test(url));
}

function weakPlaceholderFilter(options: CliOptions): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    archived: { $ne: true },
    sourceUrls: { $in: [[], null] },
    $or: [
      { shortDescription: /^research home connected to/i },
      { shortDescription: /(?:\sand\s\.)|\bconnected to \.$/i },
      { fullDescription: /indexed Yale metadata/i },
      {
        $and: [
          {
            $or: [
              { shortDescription: { $exists: false } },
              { shortDescription: '' },
            ],
          },
          {
            $or: [
              { fullDescription: { $exists: false } },
              { fullDescription: '' },
            ],
          },
          {
            $or: [
              { description: { $exists: false } },
              { description: '' },
            ],
          },
        ],
      },
    ],
  };
  if (options.slugs.length > 0) filter.slug = { $in: options.slugs };
  return filter;
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

function clearWeakPlaceholderUpdate(entity: any, now: Date): Record<string, unknown> {
  const update: Record<string, unknown> = { updatedAt: now };
  for (const field of ['shortDescription', 'fullDescription', 'description'] as const) {
    if (isWeakPlaceholderText(entity[field])) update[field] = '';
  }
  return update;
}

function profileUpdate(entity: any, user: any, now: Date): Record<string, unknown> {
  const sourceUrls = uniqueStrings([
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
    ...sourceUrlsFromUser(user),
  ], 10);
  const departments = uniqueStrings([
    ...textArray(entity.departments),
    ...textArray(user.departments),
    user.primaryDepartment,
    ...textArray(user.secondaryDepartments),
  ], 10);
  const researchAreas = uniqueStrings([
    ...textArray(entity.researchAreas),
    ...textArray(user.topics),
    ...textArray(user.researchInterests),
  ], 12);
  const profileDescription = publicResearchEntityDescriptionText(user.bio);

  const update: Record<string, unknown> = { updatedAt: now };
  if (sourceUrls.length > 0) update.sourceUrls = sourceUrls;
  if (departments.length > 0) update.departments = departments;
  if (researchAreas.length > 0) update.researchAreas = researchAreas;
  if (profileDescription) {
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

async function hasAnyResearchEntityEvidence(entity: any): Promise<boolean> {
  const id = entity._id;
  const slug = textValue(entity.slug);
  const [
    accessSignals,
    contactRoutes,
    entryPathways,
    postedOpportunities,
    observations,
  ] = await Promise.all([
    AccessSignal.countDocuments({ researchEntityId: id, archived: { $ne: true } }),
    ContactRoute.countDocuments({ researchEntityId: id, archived: { $ne: true } }),
    EntryPathway.countDocuments({ researchEntityId: id, archived: { $ne: true } }),
    PostedOpportunity.countDocuments({ researchEntityId: id, archived: { $ne: true } }),
    Observation.countDocuments({
      entityType: 'researchEntity',
      $or: [{ entityId: id }, ...(slug ? [{ entityKey: slug }] : [])],
    }),
  ]);

  return (
    accessSignals > 0 ||
    contactRoutes > 0 ||
    entryPathways > 0 ||
    postedOpportunities > 0 ||
    observations > 0
  );
}

async function maybeArchiveUnfixableStub({
  entity,
  options,
  now,
}: {
  entity: any;
  options: CliOptions;
  now: Date;
}): Promise<{ archived: boolean; reason?: string }> {
  if (!options.archiveUnfixable) return { archived: false };
  if (await hasAnyResearchEntityEvidence(entity)) {
    return { archived: false, reason: 'has-research-evidence' };
  }

  const update = {
    archived: true,
    updatedAt: now,
    archivedReason: 'weak-source-less-profile-stub',
  };
  if (options.apply) {
    await ResearchEntity.updateOne({ _id: entity._id }, { $set: update });
    if (options.syncMeili) {
      const updated = await ResearchEntity.findById(entity._id).lean();
      if (updated) await syncEntity('researchEntity', updated);
    }
  }
  return { archived: true };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'research-entity:repair-weak-profiles',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const entities = await ResearchEntity.find(weakPlaceholderFilter(options))
    .sort({ lastObservedAt: 1, _id: 1 })
    .limit(options.limit)
    .lean();
  const now = new Date();
  const results: any[] = [];

  for (const entity of entities as any[]) {
    const netid = slugNetid(entity.slug);
    const user = netid
      ? await User.findOne({ netid })
          .select('netid fname lname departments primaryDepartment secondaryDepartments topics researchInterests profileUrls website bio')
          .lean()
      : null;
    if (!user || !nameMatchesUser(entity, user)) {
      const update = clearWeakPlaceholderUpdate(entity, now);
      const fields = Object.keys(update).filter((field) => field !== 'updatedAt');
      if (fields.length > 0) {
        const archive = await maybeArchiveUnfixableStub({ entity, options, now });
        if (options.apply) {
          if (!archive.archived) {
            await ResearchEntity.updateOne({ _id: entity._id }, { $set: update });
          }
          if (options.syncMeili) {
            const updated = await ResearchEntity.findById(entity._id).lean();
            if (updated) await syncEntity('researchEntity', updated);
          }
        }
        results.push({
          slug: entity.slug,
          action: archive.archived
            ? 'archive-unfixable-weak-placeholder-without-profile-match'
            : 'clear-weak-placeholder-without-profile-match',
          netid,
          userId: user?._id ? String(user._id) : null,
          archiveSkipReason: archive.reason,
          fields,
        });
        continue;
      }
      const archive = await maybeArchiveUnfixableStub({ entity, options, now });
      results.push({
        slug: entity.slug,
        action: archive.archived
          ? 'archive-unfixable-without-profile-match'
          : 'skip-no-matching-user',
        netid,
        userId: user?._id ? String(user._id) : null,
        archiveSkipReason: archive.reason,
      });
      continue;
    }

    const update = profileUpdate(entity, user, now);
    const fields = Object.keys(update).filter((field) => field !== 'updatedAt');
    if (fields.length === 0 || !hasSourceBackedProfileEvidence(update)) {
      const cleanup = clearWeakPlaceholderUpdate(entity, now);
      const cleanupFields = Object.keys(cleanup).filter((field) => field !== 'updatedAt');
      if (cleanupFields.length > 0) {
        const archive = await maybeArchiveUnfixableStub({ entity, options, now });
        if (options.apply) {
          if (!archive.archived) {
            await ResearchEntity.updateOne({ _id: entity._id }, { $set: cleanup });
          }
          if (options.syncMeili) {
            const updated = await ResearchEntity.findById(entity._id).lean();
            if (updated) await syncEntity('researchEntity', updated);
          }
        }
        results.push({
          slug: entity.slug,
          action: archive.archived
            ? 'archive-unfixable-weak-placeholder'
            : fields.length === 0
              ? 'clear-weak-placeholder-without-profile-data'
              : 'clear-weak-placeholder-without-source-profile-data',
          netid,
          userId: String(user._id),
          archiveSkipReason: archive.reason,
          fields: cleanupFields,
          rejectedFields: fields.length === 0 ? undefined : fields,
        });
        continue;
      }
      const archive = await maybeArchiveUnfixableStub({ entity, options, now });
      results.push({
        slug: entity.slug,
        action: archive.archived
          ? 'archive-unfixable-without-source-profile-data'
          : fields.length === 0
            ? 'skip-no-profile-data'
            : 'skip-profile-data-without-source-evidence',
        netid,
        userId: String(user._id),
        archiveSkipReason: archive.reason,
        rejectedFields: fields.length === 0 ? undefined : fields,
      });
      continue;
    }

    if (options.apply) {
      await ResearchEntity.updateOne({ _id: entity._id }, { $set: update });
      await ResearchGroupMember.updateOne(
        { researchEntityId: entity._id, userId: user._id, role: 'pi' },
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
    results.push({
      slug: entity.slug,
      action: 'enrich-from-user-profile',
      netid,
      userId: String(user._id),
      fields,
    });
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
