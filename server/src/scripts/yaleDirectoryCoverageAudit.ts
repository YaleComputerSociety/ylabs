import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { AccessSignal } from '../models/accessSignal';
import { ContactRoute } from '../models/contactRoute';
import { EntryPathway } from '../models/entryPathway';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { User } from '../models/user';
import { parseDirectoryCsv } from '../scrapers/sources/yaleDirectoryCsv';
import { buildYaleDirectoryCoverageAudit } from './yaleDirectoryCoverageAuditCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function parseArgs(argv: string[]): { limitUnits: number; csvPath: string } {
  const flags: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [rawKey, rawValue] = arg.slice(2).split('=');
    if (rawValue !== undefined) {
      flags[rawKey] = rawValue;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[rawKey] = next;
      i++;
    } else {
      flags[rawKey] = 'true';
    }
  }
  return {
    limitUnits: flags['limit-units'] ? Number(flags['limit-units']) : 25,
    csvPath: flags.csv || path.resolve(__dirname, '../../../yale_directory_all.csv'),
  };
}

function id(value: unknown): string {
  return String(value);
}

async function main(): Promise<void> {
  const { limitUnits, csvPath } = parseArgs(process.argv);
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) {
    console.error('ERROR: MONGODBURL not set');
    process.exit(1);
  }
  const rows = parseDirectoryCsv(await fs.readFile(csvPath, 'utf8'));
  await mongoose.connect(mongoUrl);
  try {
    const [
      users,
      researchEntityMembers,
      researchEntities,
      entryPathways,
      accessSignals,
      contactRoutes,
    ] = await Promise.all([
      User.find({}).select('_id netid').lean(),
      ResearchGroupMember.find({ isCurrentMember: { $ne: false } })
        .select('_id userId researchEntityId')
        .lean(),
      ResearchEntity.find({ archived: { $ne: true } }).select('_id name departments').lean(),
      EntryPathway.find({ archived: { $ne: true } }).select('_id researchEntityId').lean(),
      AccessSignal.find({ archived: { $ne: true } }).select('_id researchEntityId').lean(),
      ContactRoute.find({ archived: { $ne: true } }).select('_id researchEntityId').lean(),
    ]);

    const result = buildYaleDirectoryCoverageAudit({
      rows,
      facultyMembers: [],
      users: users.map((user: any) => ({ id: id(user._id), netid: user.netid })),
      researchEntityMembers: researchEntityMembers.map((member: any) => ({
        id: id(member._id),
        userId: member.userId ? id(member.userId) : undefined,
        researchEntityId: member.researchEntityId ? id(member.researchEntityId) : undefined,
      })),
      researchEntities: researchEntities.map((entity: any) => ({
        id: id(entity._id),
        name: entity.name,
        departments: entity.departments || [],
      })),
      paperEntityLinks: [],
      grants: [],
      entryPathways: entryPathways.map((record: any) => ({
        id: id(record._id),
        researchEntityId: record.researchEntityId ? id(record.researchEntityId) : undefined,
      })),
      accessSignals: accessSignals.map((record: any) => ({
        id: id(record._id),
        researchEntityId: record.researchEntityId ? id(record.researchEntityId) : undefined,
      })),
      contactRoutes: contactRoutes.map((record: any) => ({
        id: id(record._id),
        researchEntityId: record.researchEntityId ? id(record.researchEntityId) : undefined,
      })),
      limitUnits,
    });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
