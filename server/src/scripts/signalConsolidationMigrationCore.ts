/**
 * Pure transforms for the AccessSignal + UndergraduateLogisticsClaim -> Signal
 * data migration (#362). The runner (signalConsolidationMigration.ts) reads the
 * legacy collections and upserts the results into `signals`; this module holds
 * the deterministic per-document mapping so it can be unit-tested without a DB.
 */
import {
  accessSignalTypes,
  undergraduateLogisticsSignalTypes,
} from '../models/researchAccessTypes';

type LegacyDoc = Record<string, unknown>;

export interface MigratedSignalSource {
  name: string;
  url: string;
  excerpt: string;
  evidenceIds: unknown[];
  scrapeRunIds: unknown[];
}

export interface MigratedSignal {
  _id?: unknown;
  researchEntityId: unknown;
  entryPathwayId?: unknown;
  type: string;
  value?: unknown;
  confidence?: unknown;
  confidenceScore?: unknown;
  originalConfidence?: unknown;
  status?: unknown;
  source: MigratedSignalSource;
  observedAt?: unknown;
  expiresAt?: unknown;
  derivationKey?: unknown;
  lastMaterializedAt?: unknown;
  archived: boolean;
  review?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

const ACCESS_SIGNAL_TYPE_SET = new Set<string>(accessSignalTypes);
const LOGISTICS_SIGNAL_TYPE_SET = new Set<string>(undergraduateLogisticsSignalTypes);

const compactIds = (...values: unknown[]): unknown[] =>
  values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value) => value !== undefined && value !== null);

const stringOrEmpty = (value: unknown): string => (typeof value === 'string' ? value : '');

export function accessSignalToSignal(doc: LegacyDoc): MigratedSignal | null {
  const type = stringOrEmpty(doc.signalType);
  if (!ACCESS_SIGNAL_TYPE_SET.has(type)) return null;
  return {
    _id: doc._id,
    researchEntityId: doc.researchEntityId,
    entryPathwayId: doc.entryPathwayId ?? undefined,
    type,
    confidence: doc.confidence,
    confidenceScore: doc.confidenceScore,
    originalConfidence: doc.originalConfidence,
    source: {
      name: stringOrEmpty(doc.sourceName),
      url: stringOrEmpty(doc.sourceUrl),
      excerpt: stringOrEmpty(doc.excerpt),
      evidenceIds: compactIds(doc.sourceEvidenceId, doc.observationId),
      scrapeRunIds: [],
    },
    observedAt: doc.observedAt,
    derivationKey: doc.derivationKey,
    lastMaterializedAt: doc.lastMaterializedAt,
    archived: doc.archived === true,
    review: doc.review,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function logisticsClaimToSignal(doc: LegacyDoc): MigratedSignal | null {
  const type = stringOrEmpty(doc.claimType);
  if (!LOGISTICS_SIGNAL_TYPE_SET.has(type)) return null;
  return {
    _id: doc._id,
    researchEntityId: doc.researchEntityId,
    type,
    value: doc.value,
    status: doc.status,
    source: {
      name: stringOrEmpty(doc.sourceName),
      url: stringOrEmpty(doc.sourceUrl),
      excerpt: stringOrEmpty(doc.evidenceExcerpt),
      evidenceIds: compactIds(doc.sourceEvidenceIds),
      scrapeRunIds: compactIds(doc.sourceScrapeRunIds),
    },
    observedAt: doc.observedAt,
    expiresAt: doc.expiresAt,
    derivationKey: `logistics:${type}`,
    lastMaterializedAt: doc.materializedAt,
    archived: doc.archived === true,
    review: doc.review,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export interface SignalConsolidationPlan {
  accessSignalsMapped: number;
  accessSignalsSkipped: number;
  logisticsClaimsMapped: number;
  logisticsClaimsSkipped: number;
  signals: MigratedSignal[];
}

export function planSignalConsolidation(
  accessSignals: LegacyDoc[],
  logisticsClaims: LegacyDoc[],
): SignalConsolidationPlan {
  const signals: MigratedSignal[] = [];
  let accessSignalsSkipped = 0;
  let logisticsClaimsSkipped = 0;

  for (const doc of accessSignals) {
    const mapped = accessSignalToSignal(doc);
    if (mapped) signals.push(mapped);
    else accessSignalsSkipped += 1;
  }
  for (const doc of logisticsClaims) {
    const mapped = logisticsClaimToSignal(doc);
    if (mapped) signals.push(mapped);
    else logisticsClaimsSkipped += 1;
  }

  return {
    accessSignalsMapped: accessSignals.length - accessSignalsSkipped,
    accessSignalsSkipped,
    logisticsClaimsMapped: logisticsClaims.length - logisticsClaimsSkipped,
    logisticsClaimsSkipped,
    signals,
  };
}
