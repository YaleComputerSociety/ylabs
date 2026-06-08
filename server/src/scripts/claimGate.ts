import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { AccessSignal } from '../models/accessSignal';
import { ContactRoute } from '../models/contactRoute';
import { EntryPathway } from '../models/entryPathway';
import { PostedOpportunity } from '../models/postedOpportunity';
import {
  buildClaimGateReport,
  type AccessArtifactCandidate,
  type ClaimGateReport,
} from '../services/claimValidation/accessClaims';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export type ClaimGateCollection = 'research';

export interface ClaimGateCliOptions {
  collection: ClaimGateCollection;
  includeSamples: boolean;
  strict: boolean;
  limit: number;
  output?: string;
}

function valueAfterEquals(arg: string, flag: string): string | undefined {
  return arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : undefined;
}

function consumeValue(argv: string[], index: number, flag: string): { value: string; nextIndex: number } {
  const arg = argv[index];
  const inline = valueAfterEquals(arg, flag);
  const value = inline !== undefined ? inline : arg === flag ? argv[index + 1] : undefined;
  if (value === undefined || value.trim() === '' || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return { value, nextIndex: inline !== undefined ? index : index + 1 };
}

function positiveInteger(value: string, flag: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

export function parseClaimGateArgs(argv: string[]): ClaimGateCliOptions {
  const options: ClaimGateCliOptions = {
    collection: 'research',
    includeSamples: false,
    strict: false,
    limit: 1000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--include-samples') {
      options.includeSamples = true;
      continue;
    }
    if (arg === '--strict') {
      options.strict = true;
      continue;
    }

    if (arg === '--collection' || arg.startsWith('--collection=')) {
      const { value: collectionValue, nextIndex } = consumeValue(argv, index, '--collection');
      if (collectionValue !== 'research') {
        throw new Error('--collection must be research');
      }
      options.collection = collectionValue;
      index = nextIndex;
      continue;
    }

    if (arg === '--limit' || arg.startsWith('--limit=')) {
      const { value: limitValue, nextIndex } = consumeValue(argv, index, '--limit');
      options.limit = positiveInteger(limitValue, '--limit');
      index = nextIndex;
      continue;
    }

    if (arg === '--output' || arg.startsWith('--output=')) {
      const { value: outputValue, nextIndex } = consumeValue(argv, index, '--output');
      options.output = outputValue;
      index = nextIndex;
      continue;
    }

    throw new Error(`Unknown claim-gate option: ${arg}`);
  }

  return options;
}

function strings(values: unknown[]): string[] {
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
}

function stringId(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

export async function loadResearchAccessArtifacts(limit: number): Promise<AccessArtifactCandidate[]> {
  const [pathways, signals, routes, opportunities] = await Promise.all([
    EntryPathway.find({ archived: { $ne: true } }).limit(limit).lean(),
    AccessSignal.find({ archived: { $ne: true } }).limit(limit).lean(),
    ContactRoute.find({ archived: { $ne: true } }).limit(limit).lean(),
    PostedOpportunity.find({ archived: { $ne: true } }).limit(limit).lean(),
  ]);

  return [
    ...pathways.map((pathway: any): AccessArtifactCandidate => ({
      artifactType: 'EntryPathway',
      id: stringId(pathway._id),
      researchEntityId: stringId(pathway.researchEntityId),
      derivationKey: pathway.derivationKey,
      pathwayType: pathway.pathwayType,
      sourceEvidenceIds: strings(pathway.sourceEvidenceIds?.map(stringId) || []),
      sourceUrls: strings(pathway.sourceUrls || []),
    })),
    ...signals.map((signal: any): AccessArtifactCandidate => ({
      artifactType: 'AccessSignal',
      id: stringId(signal._id),
      researchEntityId: stringId(signal.researchEntityId),
      entryPathwayId: stringId(signal.entryPathwayId),
      derivationKey: signal.derivationKey,
      signalType: signal.signalType,
      sourceEvidenceIds: strings([stringId(signal.sourceEvidenceId || signal.observationId)]),
      sourceUrls: strings([signal.sourceUrl]),
      sourceName: signal.sourceName,
      sourceUrl: signal.sourceUrl,
    })),
    ...routes.map((route: any): AccessArtifactCandidate => ({
      artifactType: 'ContactRoute',
      id: stringId(route._id),
      researchEntityId: stringId(route.researchEntityId),
      entryPathwayId: stringId(route.entryPathwayId),
      derivationKey: route.derivationKey,
      routeType: route.routeType,
      url: route.url,
      sourceEvidenceIds: strings([
        ...(route.sourceEvidenceIds?.map(stringId) || []),
        stringId(route.sourceEvidenceId),
      ]),
      sourceUrls: strings([route.sourceUrl]),
      sourceName: route.sourceName,
      sourceUrl: route.sourceUrl,
    })),
    ...opportunities.map((opportunity: any): AccessArtifactCandidate => ({
      artifactType: 'PostedOpportunity',
      id: stringId(opportunity._id),
      researchEntityId: stringId(opportunity.researchEntityId),
      entryPathwayId: stringId(opportunity.entryPathwayId),
      derivationKey: opportunity.derivationKey,
      title: opportunity.title,
      status: opportunity.status,
      applicationUrl: opportunity.applicationUrl,
      sourceEvidenceIds: strings(opportunity.sourceEvidenceIds?.map(stringId) || []),
      sourceUrls: strings(opportunity.sourceUrls || []),
    })),
  ];
}

export function shouldClaimGateFailStrict(report: Pick<ClaimGateReport, 'summary'>): boolean {
  return report.summary.rejected > 0;
}

export function buildClaimGateOutput(
  report: ClaimGateReport,
  metadata: {
    environment?: string;
    db?: string;
    options: ClaimGateCliOptions;
  },
): ClaimGateReport & {
  environment?: string;
  db?: string;
  options: ClaimGateCliOptions;
} {
  return {
    ...report,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

export function writeClaimGateOutput(value: unknown, output?: string): void {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is required');
  const options = parseClaimGateArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: false,
    scriptName: 'scraper:claim-gate',
    mongoUrl,
  });
  await mongoose.connect(mongoUrl);
  const artifacts = await loadResearchAccessArtifacts(options.limit);
  const report = buildClaimGateOutput(
    buildClaimGateReport({
      artifacts,
      includeSamples: options.includeSamples,
      sampleLimit: options.limit,
    }),
    {
      environment: guard.environment,
      db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
      options,
    },
  );
  writeClaimGateOutput(report, options.output);
  console.log(JSON.stringify(report, null, 2));
  if (options.strict && shouldClaimGateFailStrict(report)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
