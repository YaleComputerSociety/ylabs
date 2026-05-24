import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { User } from '../models/user';
import {
  buildTwoFieldDescriptionRepair,
  type TwoFieldDescriptionRepair,
} from './repairResearchEntityDescriptionsTwoFieldCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import { syncEntity } from '../services/meiliSyncService';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface CliOptions {
  apply: boolean;
  limit: number;
  slug?: string;
  repairWeakPlaceholders: boolean;
  onlyWeakPlaceholders: boolean;
  syncMeili: boolean;
}

export function parseRepairResearchEntityDescriptionsTwoFieldArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    limit: 100,
    repairWeakPlaceholders: false,
    onlyWeakPlaceholders: false,
    syncMeili: false,
  };

  for (const arg of argv) {
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--repair-weak-placeholders') {
      options.repairWeakPlaceholders = true;
      continue;
    }
    if (arg === '--only-weak-placeholders') {
      options.onlyWeakPlaceholders = true;
      continue;
    }
    if (arg === '--sync-meili') {
      options.syncMeili = true;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      const parsed = Number(arg.slice('--limit='.length));
      if (Number.isFinite(parsed) && parsed > 0) options.limit = Math.floor(parsed);
      continue;
    }
    if (arg.startsWith('--slug=')) {
      const value = arg.slice('--slug='.length).trim();
      if (value) options.slug = value;
    }
  }

  return options;
}

function hasUpdate(repair: TwoFieldDescriptionRepair): boolean {
  return Object.keys(repair.update).length > 0;
}

async function attachProfileContext(docs: any[]): Promise<any[]> {
  const entityIds = docs.map((doc) => doc._id).filter(Boolean);
  if (entityIds.length === 0) return docs;

  const members = await ResearchGroupMember.find({
    researchEntityId: { $in: entityIds },
    role: { $in: ['pi', 'director', 'co-director', 'core-faculty'] },
    isCurrentMember: { $ne: false },
    userId: { $exists: true, $ne: null },
  })
    .select('researchEntityId userId')
    .lean();
  if (members.length === 0) return docs;

  const userIds = [...new Set(members.map((member: any) => String(member.userId)))];
  const users = await User.find({ _id: { $in: userIds } })
    .select('researchInterests topics bio')
    .lean();
  const usersById = new Map(users.map((user: any) => [String(user._id), user]));
  const membersByEntityId = new Map<string, any[]>();
  for (const member of members as any[]) {
    const key = String(member.researchEntityId);
    membersByEntityId.set(key, [...(membersByEntityId.get(key) || []), member]);
  }

  return docs.map((doc: any) => {
    const entityMembers = membersByEntityId.get(String(doc._id)) || [];
    const profileResearchAreas = entityMembers.flatMap((member: any) => {
      const user = usersById.get(String(member.userId));
      return [
        ...(Array.isArray(user?.topics) ? user.topics : []),
        ...(Array.isArray(user?.researchInterests) ? user.researchInterests : []),
      ];
    });
    const profileBio = entityMembers
      .map((member: any) => usersById.get(String(member.userId))?.bio)
      .find((bio: unknown) => typeof bio === 'string' && bio.trim());

    return {
      ...doc,
      profileResearchAreas,
      profileBio,
    };
  });
}

async function main(): Promise<void> {
  const options = parseRepairResearchEntityDescriptionsTwoFieldArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'research-entity:repair-two-field-descriptions',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const filter: Record<string, unknown> = {
    archived: { $ne: true },
  };
  if (options.slug) filter.slug = options.slug;
  if (options.onlyWeakPlaceholders) {
    filter.$or = [
      { shortDescription: /^research home (?:focused on|connected to)(?:\s|\.|$)/i },
      { shortDescription: /(?:\sand\s\.)|\bconnected to \.$/i },
      { fullDescription: /^.+ is a yale research home(?: connected to .*)?\./i },
      { fullDescription: /(?:\sand\s\.)|\bconnected to \./i },
    ];
  }

  const docs = await ResearchEntity.find(filter)
    .select(
      [
        '_id',
        'slug',
        'name',
        'displayName',
        'shortDescription',
        'description',
        'fullDescription',
        'profileSynthesisDescription',
        'departments',
        'researchAreas',
        'school',
        'schools',
        'sourceUrls',
      ].join(' '),
    )
    .sort({ _id: 1 })
    .limit(options.limit)
    .lean();

  const docsWithProfileContext = await attachProfileContext(docs);

  const repairs = docsWithProfileContext
    .map((doc: any) => ({
      id: doc._id,
      repair: buildTwoFieldDescriptionRepair({
        ...doc,
        repairWeakPlaceholders: options.repairWeakPlaceholders,
      }),
    }))
    .filter(({ repair }) => hasUpdate(repair));

  if (options.apply) {
    for (const { id, repair } of repairs) {
      await ResearchEntity.updateOne({ _id: id }, { $set: repair.update });
      if (options.syncMeili) {
        const updated = await ResearchEntity.findById(id).lean();
        if (updated) await syncEntity('researchEntity', updated);
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        apply: options.apply,
        filters: {
          slug: options.slug || null,
          limit: options.limit,
          repairWeakPlaceholders: options.repairWeakPlaceholders,
          onlyWeakPlaceholders: options.onlyWeakPlaceholders,
          syncMeili: options.syncMeili,
        },
        scanned: docs.length,
        plannedUpdateCount: repairs.length,
        reasonCounts: repairs.reduce<Record<string, number>>((acc, { repair }) => {
          for (const reason of repair.reasons) {
            acc[reason] = (acc[reason] || 0) + 1;
          }
          return acc;
        }, {}),
        samples: repairs.slice(0, 20).map(({ repair }) => repair),
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
