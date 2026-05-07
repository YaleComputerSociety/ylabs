import dotenv from 'dotenv';
import mongoose from '../server/node_modules/mongoose';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../server/.env') });

export interface MigrationOptions {
  apply: boolean;
  limit?: number;
}

export function parseMigrationOptions(): MigrationOptions {
  const apply = process.argv.includes('--apply') || process.argv.includes('--live');
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;
  return {
    apply,
    limit: Number.isFinite(limit) && limit && limit > 0 ? Math.floor(limit) : undefined,
  };
}

export async function connectForMigration(title: string, options: MigrationOptions): Promise<void> {
  const url = process.env.MONGODBURL;
  if (!url) {
    throw new Error('MONGODBURL not set in server/.env');
  }
  console.log(`\n=== ${title} ===`);
  console.log(`Mode: ${options.apply ? 'APPLY' : 'DRY RUN'}`);
  if (options.limit) console.log(`Limit: ${options.limit}`);
  console.log('');
  await mongoose.connect(url);
}

export async function disconnectForMigration(): Promise<void> {
  await mongoose.disconnect();
}

export function fullName(first?: string, last?: string, fallback = 'Unknown'): string {
  const name = [first, last].filter(Boolean).join(' ').trim();
  return name || fallback;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
