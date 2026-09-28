import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { DERIVED_RESEARCH_AREA_SOURCE_NAME } from '../models/fieldProvenanceBacking';
import { ResearchEntity } from '../models/researchEntity';
import { DESCRIPTION_AREA_DERIVATION_ENTITY_TYPES } from '../scrapers/entityMaterializer';
import { getResearchAreaCanonicalizer } from '../scrapers/researchAreaCanonicalization';
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
  includeUnserved: boolean;
  includeDerivable: boolean;
}

export function parseListUnbackedResearchAreaArgs(argv: string[]): ListUnbackedResearchAreaOptions {
  let output: string | undefined;
  let includeUnserved = false;
  let includeDerivable = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--include-unserved') includeUnserved = true;
    else if (arg === '--include-derivable') includeDerivable = true;
    else if (arg === '--output') {
      output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  if (!output) throw new Error(`${SCRIPT_NAME} requires --output <path.json>`);
  return { output, includeUnserved, includeDerivable };
}

export interface UnbackedResearchAreaDoc extends CandidateAreaEntityDoc {
  entityType?: string;
  shortDescription?: string;
  fullDescription?: string;
  fieldProvenance?: Record<string, { sourceName?: string } | undefined>;
}

export type DeriveResearchAreasFromText = (text: string) => string[];

const foldedArea = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLocaleLowerCase() : '';

export function storedResearchAreasAreDerivable(
  doc: UnbackedResearchAreaDoc,
  deriveResearchAreasFromText: DeriveResearchAreasFromText,
): boolean {
  if (doc.fieldProvenance?.researchAreas?.sourceName === DERIVED_RESEARCH_AREA_SOURCE_NAME) {
    return true;
  }
  if (!doc.entityType || !DESCRIPTION_AREA_DERIVATION_ENTITY_TYPES.has(doc.entityType)) {
    return false;
  }
  const textBlob = [doc.name ?? doc.displayName, doc.shortDescription, doc.fullDescription]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n');
  if (!textBlob) return false;
  const derived = new Set(deriveResearchAreasFromText(textBlob).map(foldedArea));
  const stored = (Array.isArray(doc.researchAreas) ? doc.researchAreas : [])
    .map(foldedArea)
    .filter(Boolean);
  return stored.length > 0 && stored.every((area) => derived.has(area));
}

export interface UnbackedResearchAreaCandidateReport {
  generatedAt: string;
  predicate: string;
  storedNonEmptyRows: number;
  unbackedRows: number;
  derivableUnbackedRows: number;
  candidateCount: number;
  only: string;
}

export function unbackedResearchAreaCandidateReport(
  docs: UnbackedResearchAreaDoc[],
  evidenceBackedRowIds: ReadonlySet<string>,
  context: {
    generatedAt: Date;
    includeUnserved: boolean;
    includeDerivable: boolean;
    deriveResearchAreasFromText: DeriveResearchAreasFromText;
  },
): UnbackedResearchAreaCandidateReport {
  const unbacked = docs.filter(
    (doc) => !evidenceBackedRowIds.has(serializedDocumentId(doc._id) || ''),
  );
  const derivable = unbacked.filter((doc) =>
    storedResearchAreasAreDerivable(doc, context.deriveResearchAreasFromText),
  );
  const derivableIds = new Set(derivable.map((doc) => serializedDocumentId(doc._id) || ''));
  const selected = context.includeDerivable
    ? docs
    : docs.filter((doc) => !derivableIds.has(serializedDocumentId(doc._id) || ''));
  const keys = candidateAreaEntitiesFromDocs(selected, { evidenceBackedRowIds })
    .map((candidate) => candidate.slug || serializedDocumentId(candidate._id) || '')
    .filter(Boolean);
  return {
    generatedAt: context.generatedAt.toISOString(),
    predicate: [
      context.includeUnserved ? 'every unarchived row' : 'unarchived student_ready rows',
      'whose researchAreas is non-empty and not manually locked,',
      'backed by no live researchAreas observation on the row or any merged-in key,',
      context.includeDerivable
        ? ''
        : 'whose stored areas the description derivation neither recorded nor reproduces,',
      'with at least one usable source url',
    ]
      .filter(Boolean)
      .join(' '),
    storedNonEmptyRows: docs.length,
    unbackedRows: unbacked.length,
    derivableUnbackedRows: derivable.length,
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
      ...(options.includeUnserved ? {} : { studentVisibilityTier: 'student_ready' }),
    },
    {
      _id: 1,
      slug: 1,
      name: 1,
      displayName: 1,
      entityType: 1,
      shortDescription: 1,
      fullDescription: 1,
      fieldProvenance: 1,
      websiteUrl: 1,
      website: 1,
      sourceUrls: 1,
      researchAreas: 1,
      manuallyLockedFields: 1,
    },
  )
    .sort({ _id: 1 })
    .lean()) as UnbackedResearchAreaDoc[];
  const evidenceBackedRowIds = await loadResearchAreaEvidenceBackedRowIds(docs);
  const canonicalizer = await getResearchAreaCanonicalizer();
  const report = unbackedResearchAreaCandidateReport(docs, evidenceBackedRowIds, {
    generatedAt: new Date(),
    includeUnserved: options.includeUnserved,
    includeDerivable: options.includeDerivable,
    deriveResearchAreasFromText: (text) => canonicalizer.deriveResearchAreasFromText(text),
  });

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, JSON.stringify(report, null, 2));
  console.log(
    `${SCRIPT_NAME}: ${report.storedNonEmptyRows} rows store areas, ${report.unbackedRows} have no live evidence, ${report.derivableUnbackedRows} of those are description-derivable, ${report.candidateCount} selected with a usable url. Saved to ${options.output}`,
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
