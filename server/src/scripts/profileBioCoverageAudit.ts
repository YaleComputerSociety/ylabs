import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import { User } from '../models/user';
import {
  isLikelySameNameContaminatedProfile,
  normalizePublicProfile,
} from '../services/profileService';
import {
  buildProfessorBioCoverageAudit,
  type ProfessorBioAuditResearchHomeInput,
  type ProfessorBioCoverageInput,
} from './profileBioCoverageAuditCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const VISIBLE_PROFILE_MEMBER_ROLES = ['pi', 'co-pi', 'director', 'co-director', 'core-faculty'];

export interface ProfessorBioCoverageAuditCliOptions {
  strict: boolean;
  sampleLimit: number;
  minBioLength: number;
  output?: string;
}

export function parseProfessorBioCoverageAuditArgs(
  argv: string[],
): ProfessorBioCoverageAuditCliOptions {
  const options: ProfessorBioCoverageAuditCliOptions = {
    strict: false,
    sampleLimit: 25,
    minBioLength: 120,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--strict') {
      options.strict = true;
      continue;
    }
    if (arg.startsWith('--sample-limit=')) {
      options.sampleLimit = parseInteger(arg.slice('--sample-limit='.length), '--sample-limit', {
        min: 0,
      });
      continue;
    }
    if (arg.startsWith('--min-bio-length=')) {
      options.minBioLength = parseInteger(arg.slice('--min-bio-length='.length), '--min-bio-length', {
        min: 1,
      });
      continue;
    }
    if (arg === '--output') {
      options.output = parseRequiredOutputPath(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.output = parseRequiredOutputPath(arg.slice('--output='.length));
      continue;
    }

    throw new Error(`Unknown professor bio coverage audit argument: ${arg}`);
  }

  return options;
}

function parseInteger(value: string, flag: string, options: { min: number }): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < options.min || String(parsed) !== value.trim()) {
    const descriptor = options.min === 0 ? 'a non-negative integer' : 'a positive integer';
    throw new Error(`${flag} requires ${descriptor}`);
  }
  return parsed;
}

function parseRequiredOutputPath(value: string | undefined): string {
  const output = value?.trim();
  if (!output || output.startsWith('--')) throw new Error('--output requires a path');
  return output;
}

export function writeProfessorBioCoverageAuditOutput(result: unknown, output?: string): void {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
}

export function buildProfessorBioCoverageAuditOutput<T extends object>(
  result: T,
  metadata: {
    environment?: string;
    db?: string;
    options: ProfessorBioCoverageAuditCliOptions;
  },
): T & {
  environment?: string;
  db?: string;
  options: ProfessorBioCoverageAuditCliOptions;
} {
  return {
    ...result,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

const idValue = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof (value as any).toHexString === 'function') return (value as any).toHexString();
  return String(value);
};

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

function publicDisplayName(user: Record<string, any>): string {
  return (
    [user.fname, user.lname].filter(Boolean).join(' ') ||
    textValue(user.displayName) ||
    textValue(user.name) ||
    textValue(user.netid)
  );
}

function researchHomeInput(entity: Record<string, any>, role: string): ProfessorBioAuditResearchHomeInput {
  return {
    name: entity.name || '',
    displayName: entity.displayName || '',
    role,
    kind: entity.kind || '',
    entityType: entity.entityType || '',
    website: entity.website || '',
    websiteUrl: entity.websiteUrl || '',
    summary: textValue(
      entity.shortDescription ||
        entity.fullDescription ||
        entity.description ||
        '',
    ),
  };
}

async function buildProfessorBioCoverageInputs(): Promise<ProfessorBioCoverageInput[]> {
  const visibleEntities = await ResearchEntity.find({
    archived: { $ne: true },
    studentVisibilityTier: { $in: publicStudentVisibilityTiers },
  })
    .select('_id')
    .lean();
  const visibleEntityIds = visibleEntities.map((entity: any) => entity._id);
  if (visibleEntityIds.length === 0) return [];

  const members = await ResearchGroupMember.find({
    researchEntityId: { $in: visibleEntityIds },
    archived: { $ne: true },
    isCurrentMember: { $ne: false },
    role: { $in: VISIBLE_PROFILE_MEMBER_ROLES },
    userId: { $exists: true, $ne: null },
  })
    .select('researchEntityId userId role')
    .lean();
  const userIds = [...new Set(members.map((member: any) => idValue(member.userId)).filter(Boolean))];
  const memberEntityIds = [
    ...new Set(members.map((member: any) => idValue(member.researchEntityId)).filter(Boolean)),
  ];
  if (userIds.length === 0) return [];

  const [users, researchHomes] = await Promise.all([
    User.find({ _id: { $in: userIds } })
      .select(
        '_id netid fname lname name displayName bio title website websiteUrl profileUrls researchInterests topics openAlexId openalex_id',
      )
      .lean(),
    ResearchEntity.find({ _id: { $in: memberEntityIds }, archived: { $ne: true } })
      .select(
        '_id slug name displayName kind entityType shortDescription fullDescription description departments researchAreas sourceUrls website websiteUrl',
      )
      .lean(),
  ]);

  const homeById = new Map((researchHomes as any[]).map((entity) => [idValue(entity._id), entity]));
  const membersByUserId = new Map<string, any[]>();
  for (const member of members as any[]) {
    const key = idValue(member.userId);
    if (!key) continue;
    const rows = membersByUserId.get(key) || [];
    rows.push(member);
    membersByUserId.set(key, rows);
  }

  return (users as any[]).map((user) => {
    const userId = idValue(user._id);
    const homes = (membersByUserId.get(userId) || [])
      .map((member) => {
        const entity = homeById.get(idValue(member.researchEntityId));
        return entity ? { ...entity, role: member.role || '' } : null;
      })
      .filter(Boolean);
    const publicProfile = normalizePublicProfile(user, {
      researchEntities: homes,
      trustedResearchEntities: true,
    });

    return {
      id: userId,
      netid: user.netid || '',
      name: publicDisplayName(user),
      title: user.title || '',
      publicBio: publicProfile.bio || '',
      sameNameContaminated: isLikelySameNameContaminatedProfile(user),
      website: user.website || '',
      websiteUrl: user.websiteUrl || '',
      profileUrls: user.profileUrls || {},
      researchHomes: homes.map((home) => researchHomeInput(home as any, (home as any).role || '')),
    };
  });
}

async function main() {
  dotenv.config({ path: '.env' });
  const options = parseProfessorBioCoverageAuditArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: false,
    scriptName: 'profiles:bio-coverage-audit',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const inputs = await buildProfessorBioCoverageInputs();
  const audit = buildProfessorBioCoverageAudit(inputs, {
    minBioLength: options.minBioLength,
    sampleLimit: options.sampleLimit,
  });
  const output = buildProfessorBioCoverageAuditOutput(
    {
      generatedAt: new Date().toISOString(),
      ...audit,
    },
    {
      environment: guard.environment,
      db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
      options,
    },
  );

  console.log(JSON.stringify(output, null, 2));
  writeProfessorBioCoverageAuditOutput(output, options.output);
  await mongoose.disconnect();

  if (options.strict && audit.counts.weakBio > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith('profileBioCoverageAudit.ts')) {
  main().catch(async (error) => {
    console.error('Failed to run professor bio coverage audit:', error);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
}
