import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { assessResearchEntityDescriptionQuality } from '../utils/researchEntityDescriptionQuality';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface CliOptions {
  limit: number;
  sampleLimit: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options = { limit: 5000, sampleLimit: 10 };
  for (const arg of argv) {
    if (arg.startsWith('--limit=')) {
      const parsed = Number(arg.slice('--limit='.length));
      if (Number.isFinite(parsed) && parsed > 0) options.limit = Math.floor(parsed);
    }
    if (arg.startsWith('--sample-limit=')) {
      const parsed = Number(arg.slice('--sample-limit='.length));
      if (Number.isFinite(parsed) && parsed > 0) options.sampleLimit = Math.floor(parsed);
    }
  }
  return options;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

function shortDescriptionFlags(doc: any): string[] {
  const quality = assessResearchEntityDescriptionQuality(doc);
  const flags = [
    ...quality.full.flags.map((flag) => `weak-full:${flag}`),
    ...quality.short.flags.map((flag) => `bad-short:${flag}`),
  ];
  if (quality.cardState === 'sparse') flags.push('card-sparse');
  return Array.from(new Set(flags));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await initializeConnections();

  const docs = await ResearchEntity.find({ archived: { $ne: true } })
    .select('slug name shortDescription fullDescription departments researchAreas website websiteUrl sourceUrls')
    .sort({ slug: 1 })
    .limit(options.limit)
    .lean();

  const flagCounts: Record<string, number> = {};
  const samples: Record<string, any[]> = {};
  let flaggedEntityCount = 0;
  let withUsableSourceCount = 0;

  for (const doc of docs as any[]) {
    const flags = shortDescriptionFlags(doc);
    if (flags.length === 0) continue;
    flaggedEntityCount += 1;
    if (
      textValue(doc.websiteUrl) ||
      textValue(doc.website) ||
      (Array.isArray(doc.sourceUrls) && doc.sourceUrls.some((url: unknown) => /^https?:/i.test(textValue(url))))
    ) {
      withUsableSourceCount += 1;
    }

    for (const flag of flags) {
      flagCounts[flag] = (flagCounts[flag] || 0) + 1;
      samples[flag] ||= [];
      if (samples[flag].length < options.sampleLimit) {
        samples[flag].push({
          slug: doc.slug,
          name: doc.name,
          shortDescription: textValue(doc.shortDescription),
          departments: doc.departments || [],
          researchAreas: doc.researchAreas || [],
          website: textValue(doc.websiteUrl) || textValue(doc.website),
        });
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        scanned: docs.length,
        flaggedEntityCount,
        withUsableSourceCount,
        flagCounts,
        samples,
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
