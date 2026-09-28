import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { loadResearchAreaEvidenceBackedRowIds } from '../scrapers/researchAreaEvidence';
import {
  candidateAreaEntitiesFromDocs,
  type CandidateAreaEntityDoc,
} from '../scrapers/sources/researchAreaSourceExtractor';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-areas:list-unbacked-candidates';

export interface ListUnbackedResearchAreaOptions {
  output: string;
}

export function parseListUnbackedResearchAreaArgs(argv: string[]): ListUnbackedResearchAreaOptions {
  let output: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--output') {
      output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  if (!output) throw new Error(`${SCRIPT_NAME} requires --output <path.json>`);
  return { output };
}

export interface UnbackedResearchAreaCandidateReport {
  generatedAt: string;
  predicate: string;
  storedNonEmptyRows: number;
  unbackedRows: number;
  candidateCount: number;
  only: string;
}

export function unbackedResearchAreaCandidateReport(
  docs: CandidateAreaEntityDoc[],
  evidenceBackedRowIds: ReadonlySet<string>,
  generatedAt: Date,
): UnbackedResearchAreaCandidateReport {
  const unbackedRows = docs.filter(
    (doc) => !evidenceBackedRowIds.has(serializedDocumentId(doc._id) || ''),
  ).length;
  const keys = candidateAreaEntitiesFromDocs(docs, { evidenceBackedRowIds })
    .map((candidate) => candidate.slug || serializedDocumentId(candidate._id) || '')
    .filter(Boolean);
  return {
    generatedAt: generatedAt.toISOString(),
    predicate: [
      'unarchived student_ready rows',
      'whose researchAreas is non-empty and not manually locked,',
      'backed by no live researchAreas observation on the row or any merged-in key,',
      'with at least one usable source url',
    ].join(' '),
    storedNonEmptyRows: docs.length,
    unbackedRows,
    candidateCount: keys.length,
    only: keys.join(','),
  };
}

async function main(): Promise<void> {
  const options = parseListUnbackedResearchAreaArgs(process.argv.slice(2));
  await initializeConnections();
  const docs = (await ResearchEntity.find(
    {
      archived: { $ne: true },
      manuallyLockedFields: { $ne: 'researchAreas' },
      'researchAreas.0': { $exists: true },
      studentVisibilityTier: 'student_ready',
    },
    {
      _id: 1,
      slug: 1,
      name: 1,
      displayName: 1,
      websiteUrl: 1,
      website: 1,
      sourceUrls: 1,
      researchAreas: 1,
      manuallyLockedFields: 1,
    },
  )
    .sort({ _id: 1 })
    .lean()) as CandidateAreaEntityDoc[];
  const evidenceBackedRowIds = await loadResearchAreaEvidenceBackedRowIds(docs);
  const report = unbackedResearchAreaCandidateReport(docs, evidenceBackedRowIds, new Date());

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, JSON.stringify(report, null, 2));
  console.log(
    `${SCRIPT_NAME}: ${report.storedNonEmptyRows} rows store areas, ${report.unbackedRows} have no live evidence, ${report.candidateCount} selected with a usable url. Saved to ${options.output}`,
  );
  await mongoose.disconnect();
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error instanceof Error ? error.message : error));
    process.exit(1);
  });
}
