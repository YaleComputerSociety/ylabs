import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Paper } from '../models/paper';
import { ResearchScholarlyAttribution } from '../models/researchScholarlyAttribution';
import { ResearchScholarlyLink } from '../models/researchScholarlyLink';
import {
  buildPaperQualityReportFromCounts,
  type PaperQualityCounts,
} from '../services/paperQualityService';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface CliOptions {
  sampleLimit: number;
}

const activePaperFilter = { archived: { $ne: true } };

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    sampleLimit: 20,
  };

  for (const arg of argv) {
    if (arg.startsWith('--sample-limit=')) {
      const parsed = Number(arg.slice('--sample-limit='.length));
      if (Number.isFinite(parsed) && parsed >= 0) options.sampleLimit = Math.floor(parsed);
    }
  }

  return options;
}

async function countDuplicateGroups(field: string): Promise<number> {
  const rows = await Paper.aggregate([
    {
      $match: {
        ...activePaperFilter,
        [field]: { $exists: true, $type: 'string', $ne: '' },
      },
    },
    {
      $group: {
        _id: { $toLower: `$${field}` },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $count: 'groups' },
  ]);

  return rows[0]?.groups || 0;
}

export async function buildPaperQualityCounts(): Promise<PaperQualityCounts> {
  const currentYear = new Date().getFullYear();
  const [
    totalActivePapers,
    totalActiveScholarlyLinks,
    totalScholarlyAttributions,
    missingTitle,
    genericTitle,
    htmlTitle,
    missingInspectableLink,
    missingYearOrDate,
    invalidYear,
    negativeCitationCount,
    missingSourceLabel,
    duplicateDoiGroups,
    duplicateOpenAlexGroups,
    duplicateArxivGroups,
    duplicateSemanticScholarGroups,
  ] = await Promise.all([
    Paper.countDocuments(activePaperFilter),
    ResearchScholarlyLink.countDocuments(activePaperFilter),
    ResearchScholarlyAttribution.countDocuments(activePaperFilter),
    Paper.countDocuments({
      ...activePaperFilter,
      $or: [{ title: { $exists: false } }, { title: null }, { title: /^\s*$/ }],
    }),
    Paper.countDocuments({
      ...activePaperFilter,
      title: /^\s*(untitled|unknown|n\/a|paper|publication|research activity)\s*$/i,
    }),
    Paper.countDocuments({
      ...activePaperFilter,
      title: /<[^>]+>/,
    }),
    Paper.countDocuments({
      ...activePaperFilter,
      doi: { $in: [null, ''] },
      openAlexId: { $in: [null, ''] },
      semanticScholarId: { $in: [null, ''] },
      arxivId: { $in: [null, ''] },
      url: { $in: [null, ''] },
      openAccessUrl: { $in: [null, ''] },
      landingPageUrl: { $in: [null, ''] },
      pdfUrl: { $in: [null, ''] },
    }),
    Paper.countDocuments({
      ...activePaperFilter,
      year: { $exists: false },
      publishedAt: { $exists: false },
      postedAt: { $exists: false },
      versionDate: { $exists: false },
    }),
    Paper.countDocuments({
      ...activePaperFilter,
      $or: [{ year: { $lt: 1500 } }, { year: { $gt: currentYear + 1 } }],
    }),
    Paper.countDocuments({
      ...activePaperFilter,
      citationCount: { $lt: 0 },
    }),
    Paper.countDocuments({
      ...activePaperFilter,
      $or: [{ sources: { $exists: false } }, { sources: { $size: 0 } }],
    }),
    countDuplicateGroups('doi'),
    countDuplicateGroups('openAlexId'),
    countDuplicateGroups('arxivId'),
    countDuplicateGroups('semanticScholarId'),
  ]);

  return {
    totalActivePapers,
    totalActiveScholarlyLinks,
    totalScholarlyAttributions,
    missingTitle,
    genericTitle,
    htmlTitle,
    missingInspectableLink,
    missingYearOrDate,
    invalidYear,
    negativeCitationCount,
    missingSourceLabel,
    duplicateDoiGroups,
    duplicateOpenAlexGroups,
    duplicateArxivGroups,
    duplicateSemanticScholarGroups,
  };
}

async function buildSamples(limit: number): Promise<unknown[]> {
  if (limit <= 0) return [];

  return Paper.find(activePaperFilter)
    .select('title doi openAlexId semanticScholarId arxivId year publishedAt sources')
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await initializeConnections();

  const counts = await buildPaperQualityCounts();
  const report = buildPaperQualityReportFromCounts(counts);
  const samples = await buildSamples(options.sampleLimit);

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        options,
        ...report,
        samples,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
