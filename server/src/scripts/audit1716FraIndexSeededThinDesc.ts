import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const INDEX_SOURCE_RE = /\/people(?:\/faculty)?\/?(?:\?page=\d+)?$/i;

interface Doc {
  _id: unknown;
  slug?: string;
  name?: string;
  displayName?: string;
  entityType?: string;
  studentVisibilityTier?: string;
  archived?: boolean;
  fullDescription?: string;
  shortDescription?: string;
  researchAreas?: string[];
  sourceUrls?: string[];
  websiteUrl?: string;
  website?: string;
}

const AREA_ECHO_FULL_RE = /^(?:Studies|Examines|Investigates|Focuses on)\s/i;
const DANGLING_TEMPLATE_RE = /(?:and\s+research\s+areas:?\.?)$/i;

function isDirectoryThin(doc: Doc): boolean {
  const full = (doc.fullDescription || '').trim();
  const short = (doc.shortDescription || '').trim();
  if (full.length === 0) return true;
  if (full.length < 160) return true;
  if (AREA_ECHO_FULL_RE.test(full)) return true;
  if (DANGLING_TEMPLATE_RE.test(full)) return true;
  if (short && full && short === full) return true;
  return false;
}

function seededFromIndex(doc: Doc): string | null {
  const urls = [doc.websiteUrl, doc.website, ...(doc.sourceUrls || [])].filter(
    (u): u is string => typeof u === 'string' && u.length > 0,
  );
  return urls.find((u) => INDEX_SOURCE_RE.test(new URL(u).pathname + (new URL(u).search || ''))) || null;
}

async function main(): Promise<void> {
  await initializeConnections();
  try {
    const docs = (await ResearchEntity.find(
      { entityType: 'FACULTY_RESEARCH_AREA', archived: { $ne: true } },
      {
        _id: 1,
        slug: 1,
        name: 1,
        displayName: 1,
        entityType: 1,
        studentVisibilityTier: 1,
        archived: 1,
        fullDescription: 1,
        shortDescription: 1,
        researchAreas: 1,
        sourceUrls: 1,
        websiteUrl: 1,
        website: 1,
      },
    ).lean()) as unknown as Doc[];

    const studentReady = docs.filter((d) => d.studentVisibilityTier === 'student_ready');
    console.log(`FRA total (archived!=true): ${docs.length}`);
    console.log(`FRA student_ready: ${studentReady.length}`);

    const indexSeeded: Array<{ doc: Doc; indexUrl: string }> = [];
    for (const doc of studentReady) {
      const indexUrl = seededFromIndex(doc);
      if (indexUrl) indexSeeded.push({ doc, indexUrl });
    }
    console.log(`FRA student_ready index-seeded: ${indexSeeded.length}`);

    const thin = indexSeeded.filter(({ doc }) => isDirectoryThin(doc));
    console.log(`FRA student_ready index-seeded AND directory-thin: ${thin.length}`);

    for (const { doc, indexUrl } of thin) {
      const richer = (doc.sourceUrls || []).filter((u) => u !== indexUrl);
      console.log('---');
      console.log(`_id: ${String(doc._id)}`);
      console.log(`name: ${doc.displayName || doc.name}`);
      console.log(`indexUrl: ${indexUrl}`);
      console.log(`richerSourceUrls: ${JSON.stringify(richer)}`);
      console.log(`short: ${(doc.shortDescription || '').slice(0, 160)}`);
      console.log(`full: ${(doc.fullDescription || '').slice(0, 160)}`);
      console.log(`researchAreas: ${JSON.stringify(doc.researchAreas)}`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
