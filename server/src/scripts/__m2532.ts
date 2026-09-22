import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const EXTRA = ['independent.co.uk', 'insidehighered.com', 'nature.com'];
const hit = (host: string): string | undefined => {
  const h = host.toLowerCase().replace(/\.$/, '');
  return EXTRA.find((p) => h === p || h.endsWith(`.${p}`));
};

async function main(): Promise<void> {
  await initializeConnections();
  const counts = new Map<string, number>();
  const rows = await ResearchEntity.find(
    { archived: { $ne: true } },
    { websiteUrl: 1, sourceUrls: 1 },
  ).lean();
  for (const row of rows) {
    const values = [row.websiteUrl, ...(Array.isArray(row.sourceUrls) ? row.sourceUrls : [])];
    for (const value of values) {
      if (typeof value !== 'string') continue;
      try {
        const m = hit(new URL(value).hostname);
        if (m) counts.set(`entity ${m}`, (counts.get(`entity ${m}`) ?? 0) + 1);
      } catch {
        /* ignore */
      }
    }
  }
  const cursor = Observation.find(
    { field: { $in: ['websiteUrl', 'sourceUrls'] }, superseded: { $ne: true } },
    { value: 1 },
  )
    .lean()
    .cursor();
  for await (const obs of cursor) {
    const values: unknown[] = Array.isArray(obs.value) ? obs.value : [obs.value];
    for (const value of values) {
      if (typeof value !== 'string') continue;
      try {
        const m = hit(new URL(value).hostname);
        if (m) counts.set(`obs ${m}`, (counts.get(`obs ${m}`) ?? 0) + 1);
      } catch {
        /* ignore */
      }
    }
  }
  console.log(counts.size === 0 ? 'no hits for any extra host' : JSON.stringify([...counts]));
  await mongoose.disconnect();
}
void main();
