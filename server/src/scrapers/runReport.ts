/**
 * ScrapeRun reporting helpers.
 *
 * The report command is intentionally read-only. It turns a run plus its
 * Observations into an operator-friendly QA artifact: counts, field coverage,
 * conflict candidates, materialization counters, and warnings.
 */
import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ScrapeRun } from '../models/scrapeRun';
import { Source } from '../models/source';
import type { ScraperFetchMetrics, ScraperMetrics } from './types';
import { resolveField, type ResolverObservation } from './confidenceResolver';
import { redactDirectContactInfo } from '../utils/contactRedaction';

export interface ReportObservation {
  entityType: string;
  entityId?: unknown;
  entityKey?: string;
  field: string;
  value: unknown;
  sourceName?: string;
  confidence?: number;
  sourceUrl?: string;
  observedAt?: Date | string;
  superseded?: boolean;
  observationFingerprint?: string;
}

export interface ReportScrapeRun {
  _id: unknown;
  sourceId?: unknown;
  sourceName: string;
  status: string;
  triggeredBy?: string;
  startedAt?: Date | string;
  finishedAt?: Date | string;
  observationCount?: number;
  entitiesObserved?: number;
  entitiesCreated?: number;
  entitiesUpdated?: number;
  entitiesArchived?: number;
  materializationSkipped?: number;
  materializationConflicts?: number;
  materializationErrors?: number;
  postMaterializationMetrics?: ReportPostMaterializationMetrics;
  errors?: Array<{ message?: string; context?: unknown; at?: Date | string }>;
  options?: Record<string, unknown>;
  fetchMetrics?: ScraperFetchMetrics;
  metrics?: ScraperMetrics;
  invalidated?: boolean;
}

export interface ReportSourceCoverage {
  priority?: number;
  tier?: string;
  artifactTypes?: string[];
  evidenceCategories?: string[];
  defaultConfidence?: string;
  notes?: string;
}

export interface ReportPostMaterializationMetrics {
  entryPathways?: number;
  accessSignals?: number;
  contactRoutes?: number;
  postedOpportunities?: number;
  guardedContactRoutes?: number;
  staleEvidenceSkipped?: number;
  conflicts?: number;
  errors?: number;
}

export interface ReportPostMaterializationSummary {
  entryPathways: number;
  accessSignals: number;
  contactRoutes: number;
  postedOpportunities: number;
  guardedContactRoutes: number;
  staleEvidenceSkipped: number;
  conflicts: number;
  errors: number;
  totalAccessArtifacts: number;
  expectedArtifactTypes: string[];
  missingExpectedArtifactTypes: string[];
}

export interface SourceEvidenceGapReviewInput {
  sourceName: string;
  sourceCoverage?: ReportSourceCoverage;
  postMaterializationMetrics?: ReportPostMaterializationMetrics;
}

export interface SourceEvidenceGapReviewRow {
  sourceName: string;
  expectedArtifactTypes: string[];
  actualArtifactCounts: {
    entryPathways: number;
    accessSignals: number;
    contactRoutes: number;
    postedOpportunities: number;
  };
  missingExpectedArtifactTypes: string[];
  totalAccessArtifacts: number;
  hasGap: boolean;
  coverageKnown: boolean;
}

export interface MaterializationConflictReviewSample {
  entityType: string;
  entity: string;
  field: string;
  reviewCategory: string;
  reviewQueue: MaterializationConflictReviewQueue;
  sourceConflictScope: 'single_source' | 'cross_source';
  distinctValues: number;
  activeObservationCount: number;
  sourceNames: string[];
  resolvedConfidence: number;
  contributingSources: string[];
  conflictingValuePreviews: string[];
}

export type MaterializationConflictReviewQueue =
  | 'priority_review'
  | 'context_review'
  | 'metadata_review';

export interface MaterializationConflictReview {
  required: boolean;
  available: boolean;
  materializationConflictCount: number;
  activeObservationConflictCount: number;
  actionableConflictCount: number;
  sameSourceConflictCount: number;
  crossSourceConflictCount: number;
  sampledConflictCount: number;
  fieldCounts: Array<{ field: string; count: number }>;
  categoryCounts: Array<{ category: string; count: number }>;
  sourceCounts: Array<{ sourceName: string; count: number }>;
  samples: MaterializationConflictReviewSample[];
  truncated?: boolean;
  unavailableReason?: string;
}

export interface MaterializationConflictReviewOptions {
  activeObservations?: ReportObservation[];
  sampleLimit?: number;
  truncated?: boolean;
  unavailableReason?: string;
}

export interface ScrapeRunReport {
  run: {
    id: string;
    sourceName: string;
    status: string;
    triggeredBy?: string;
    startedAt?: string;
    finishedAt?: string;
    durationSeconds?: number;
    invalidated: boolean;
    options: Record<string, unknown>;
  };
  observations: {
    total: number;
    entitiesObserved: number;
    byEntityType: Record<string, number>;
    byField: Record<string, number>;
    topFields: Array<{ field: string; count: number }>;
    active: number;
    superseded: number;
    duplicateRate: number;
  };
  materialization: {
    created: number;
    updated: number;
    archived: number;
    skipped: number;
    conflicts: number;
    errors: number;
  };
  fetchMetrics?: ScraperFetchMetrics;
  metrics?: ScraperMetrics;
  coverage: {
    source?: {
      priority?: number;
      tier?: string;
      artifactTypes: {
        total: number;
        values: string[];
      };
      evidenceCategories: {
        total: number;
        values: string[];
      };
      defaultConfidence?: string;
      notes?: string;
    };
    fetch: {
      pagesVisited?: number;
      pagesFetched?: number;
      attempts: number;
      succeeded: number;
      failed: number;
      blocked: number;
      selectorBreakages: number;
      byMode: Record<
        string,
        {
          total: number;
          succeeded: number;
          blocked: number;
          selectorBreakages: number;
          averageLatencyMs: number;
        }
      >;
    };
    observationsEmitted: number;
    materializationWrites: number;
    postMaterialization?: ReportPostMaterializationSummary;
    workPlanner?: ScraperMetrics['workPlanner'];
  };
  quality: {
    conflictCandidateCount: number;
    conflictCandidates: Array<{
      entityType: string;
      entity: string;
      field: string;
      distinctValues: number;
    }>;
    missingEntityIdentifierCount: number;
    missingSourceUrlCount: number;
    lowConfidenceCount: number;
    materializationConflictReview?: MaterializationConflictReview;
  };
  warnings: string[];
  errors: Array<{ message: string; at?: string; context?: unknown }>;
}

const MATERIALIZATION_CONFLICT_REVIEW_ENTITY_LIMIT = 2000;
const MATERIALIZATION_CONFLICT_REVIEW_SAMPLE_LIMIT = 20;
const MATERIALIZER_MANAGED_CONFLICT_FIELDS = new Set(['lastObservedAt']);
const ADDITIVE_METADATA_CONFLICT_FIELDS = new Set([
  'sourceUrls',
  'profileUrls',
  'dataSources',
  'departments',
  'researchAreas',
  'fundingAgencies',
]);
const IDENTITY_OR_ROUTING_CONFLICT_FIELDS = new Set([
  'inferredPiUserId',
  'inferredPiUserKey',
  'websiteUrl',
  'profileUrl',
  'slug',
  'name',
  'kind',
  'entityType',
  'netid',
  'email',
  'fname',
  'lname',
  'title',
  'userType',
]);
const CONTENT_CONFLICT_FIELDS = new Set([
  'description',
  'fullDescription',
  'shortDescription',
]);
const ACCESS_EVIDENCE_CONFLICT_FIELDS = new Set([
  'undergradAccessEvidence',
  'undergradEvidenceQuote',
  'undergradRoleEvidenceQuote',
  'contactInstructionsQuote',
  'undergradConstraintQuote',
  'acceptingUndergrads',
  'contactEmail',
  'contactName',
  'contactRole',
  'joinPageUrl',
  'applicationUrl',
]);
const FUNDING_CONTEXT_CONFLICT_FIELDS = new Set([
  'recentGrants',
  'recentGrantCount',
]);

function stringifyId(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return String(value);
}

function iso(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function durationSeconds(start?: Date | string, finish?: Date | string): number | undefined {
  if (!start || !finish) return undefined;
  const s = new Date(start).getTime();
  const f = new Date(finish).getTime();
  if (Number.isNaN(s) || Number.isNaN(f)) return undefined;
  return Math.max(0, Math.round((f - s) / 1000));
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] || 0) + 1;
}

function serializeValue(value: unknown): string {
  if (value === null || value === undefined) return '__null__';
  if (typeof value === 'string') return `s:${value.trim().toLowerCase()}`;
  if (typeof value === 'number' || typeof value === 'boolean') return `p:${String(value)}`;
  try {
    return `j:${JSON.stringify(value)}`;
  } catch {
    return `x:${String(value)}`;
  }
}

function previewValue(value: unknown): string {
  let raw: string;
  if (typeof value === 'string') raw = value;
  else {
    try {
      raw = JSON.stringify(value);
    } catch {
      raw = String(value);
    }
  }
  const redacted = redactDirectContactInfo(raw).replace(/\s+/g, ' ').trim();
  return redacted.length > 240 ? `${redacted.slice(0, 237)}...` : redacted;
}

function sourceNameForObservation(obs: ReportObservation): string {
  return obs.sourceName?.trim() || 'unknown';
}

function observedAtForResolver(value: Date | string | undefined): Date {
  if (value instanceof Date) return value;
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(0);
}

function topEntries(map: Record<string, number>, limit: number): Array<{ field: string; count: number }> {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([field, count]) => ({ field, count }));
}

function topSourceEntries(
  map: Record<string, number>,
  limit: number,
): Array<{ sourceName: string; count: number }> {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([sourceName, count]) => ({ sourceName, count }));
}

function topCategoryEntries(
  map: Record<string, number>,
  limit: number,
): Array<{ category: string; count: number }> {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([category, count]) => ({ category, count }));
}

function entityLabelForObservation(obs: ReportObservation): string | undefined {
  const entityId = stringifyId(obs.entityId);
  const entityKey = stringifyId(obs.entityKey);
  return entityId || entityKey;
}

function reviewCategoryForConflictField(field: string): string {
  if (ADDITIVE_METADATA_CONFLICT_FIELDS.has(field)) return 'additive_metadata';
  if (IDENTITY_OR_ROUTING_CONFLICT_FIELDS.has(field)) return 'identity_or_routing';
  if (CONTENT_CONFLICT_FIELDS.has(field)) return 'content';
  if (ACCESS_EVIDENCE_CONFLICT_FIELDS.has(field)) return 'access_evidence';
  if (FUNDING_CONTEXT_CONFLICT_FIELDS.has(field)) return 'funding_context';
  return 'other';
}

function isActionableConflictCategory(category: string): boolean {
  return category !== 'additive_metadata';
}

function reviewQueueForConflictCategory(category: string): MaterializationConflictReviewQueue {
  if (
    category === 'identity_or_routing' ||
    category === 'access_evidence' ||
    category === 'content'
  ) {
    return 'priority_review';
  }
  if (category === 'additive_metadata') return 'metadata_review';
  return 'context_review';
}

function reviewQueueRank(queue: MaterializationConflictReviewQueue): number {
  if (queue === 'priority_review') return 0;
  if (queue === 'context_review') return 1;
  return 2;
}

export function buildMaterializationConflictReview(
  materializationConflictCount: number,
  options: MaterializationConflictReviewOptions = {},
): MaterializationConflictReview | undefined {
  const required = materializationConflictCount > 0;
  const activeObservations = options.activeObservations;
  if (!required && !activeObservations && !options.unavailableReason) return undefined;

  if (!activeObservations) {
    return {
      required,
      available: false,
      materializationConflictCount,
      activeObservationConflictCount: 0,
      actionableConflictCount: 0,
      sameSourceConflictCount: 0,
      crossSourceConflictCount: 0,
      sampledConflictCount: 0,
      fieldCounts: [],
      categoryCounts: [],
      sourceCounts: [],
      samples: [],
      ...(options.truncated ? { truncated: true } : {}),
      unavailableReason: options.unavailableReason || 'active-observation-scan-not-run',
    };
  }

  const groups = new Map<
    string,
    {
      entityType: string;
      entity: string;
      field: string;
      observations: ReportObservation[];
    }
  >();

  for (const obs of activeObservations) {
    if (obs.superseded) continue;
    if (!obs.entityType || !obs.field) continue;
    if (MATERIALIZER_MANAGED_CONFLICT_FIELDS.has(obs.field)) continue;
    const entity = entityLabelForObservation(obs);
    if (!entity) continue;
    const key = JSON.stringify([obs.entityType, entity, obs.field]);
    let group = groups.get(key);
    if (!group) {
      group = {
        entityType: obs.entityType,
        entity,
        field: obs.field,
        observations: [],
      };
      groups.set(key, group);
    }
    group.observations.push(obs);
  }

  const conflictSamples: MaterializationConflictReviewSample[] = [];
  const fieldCountMap: Record<string, number> = {};
  const categoryCountMap: Record<string, number> = {};
  const sourceCountMap: Record<string, number> = {};
  let actionableConflictCount = 0;
  let sameSourceConflictCount = 0;
  let crossSourceConflictCount = 0;

  for (const group of groups.values()) {
    const distinctValues = new Set(group.observations.map((obs) => serializeValue(obs.value)));
    if (distinctValues.size < 2) continue;

    const resolverObservations: ResolverObservation[] = group.observations.map((obs) => ({
      field: obs.field,
      value: obs.value,
      sourceName: sourceNameForObservation(obs),
      confidence: typeof obs.confidence === 'number' ? obs.confidence : 0.5,
      observedAt: observedAtForResolver(obs.observedAt),
    }));
    const resolved = resolveField(group.field, resolverObservations);
    if (!resolved?.hasConflict) continue;

    increment(fieldCountMap, group.field);
    const reviewCategory = reviewCategoryForConflictField(group.field);
    const reviewQueue = reviewQueueForConflictCategory(reviewCategory);
    increment(categoryCountMap, reviewCategory);
    if (isActionableConflictCategory(reviewCategory)) actionableConflictCount++;
    const sourceNames = Array.from(new Set(group.observations.map(sourceNameForObservation))).sort();
    const sourceConflictScope = sourceNames.length > 1 ? 'cross_source' : 'single_source';
    if (sourceConflictScope === 'cross_source') crossSourceConflictCount++;
    else sameSourceConflictCount++;
    for (const sourceName of sourceNames) increment(sourceCountMap, sourceName);

    conflictSamples.push({
      entityType: group.entityType,
      entity: group.entity,
      field: group.field,
      reviewCategory,
      reviewQueue,
      sourceConflictScope,
      distinctValues: distinctValues.size,
      activeObservationCount: group.observations.length,
      sourceNames,
      resolvedConfidence: resolved.confidence,
      contributingSources: resolved.contributingSources.slice().sort(),
      conflictingValuePreviews: (resolved.conflictingValues || [])
        .slice(0, 3)
        .map(previewValue),
    });
  }

  conflictSamples.sort(
    (a, b) =>
      reviewQueueRank(a.reviewQueue) - reviewQueueRank(b.reviewQueue) ||
      b.distinctValues - a.distinctValues ||
      b.activeObservationCount - a.activeObservationCount ||
      a.entityType.localeCompare(b.entityType) ||
      a.entity.localeCompare(b.entity) ||
      a.field.localeCompare(b.field),
  );

  const sampleLimit = options.sampleLimit || MATERIALIZATION_CONFLICT_REVIEW_SAMPLE_LIMIT;
  const samples = conflictSamples.slice(0, sampleLimit);

  return {
    required,
    available: true,
    materializationConflictCount,
    activeObservationConflictCount: conflictSamples.length,
    actionableConflictCount,
    sameSourceConflictCount,
    crossSourceConflictCount,
    sampledConflictCount: samples.length,
    fieldCounts: topEntries(fieldCountMap, 15),
    categoryCounts: topCategoryEntries(categoryCountMap, 15),
    sourceCounts: topSourceEntries(sourceCountMap, 15),
    samples,
    ...(options.truncated || conflictSamples.length > samples.length ? { truncated: true } : {}),
    ...(options.unavailableReason ? { unavailableReason: options.unavailableReason } : {}),
  };
}

function uniqueTargetCount(
  attempts: ScraperFetchMetrics['attempts'] | undefined,
  predicate?: (attempt: ScraperFetchMetrics['attempts'][number]) => boolean,
): number | undefined {
  if (!attempts || attempts.length === 0) return undefined;
  const targets = new Set<string>();
  let untargetedCount = 0;
  for (const attempt of attempts) {
    if (predicate && !predicate(attempt)) continue;
    if (attempt.target) targets.add(attempt.target);
    else untargetedCount++;
  }
  return targets.size + untargetedCount;
}

function buildCoverageFetchSummary(fetchMetrics?: ScraperFetchMetrics): ScrapeRunReport['coverage']['fetch'] {
  const summary = fetchMetrics?.summary;
  const byMode: ScrapeRunReport['coverage']['fetch']['byMode'] = {};
  for (const [mode, metrics] of Object.entries(summary?.byMode || {})) {
    if (metrics) byMode[mode] = metrics;
  }
  return {
    pagesVisited: uniqueTargetCount(fetchMetrics?.attempts),
    pagesFetched: uniqueTargetCount(fetchMetrics?.attempts, (attempt) => attempt.success),
    attempts: summary?.total || 0,
    succeeded: summary?.succeeded || 0,
    failed: summary?.failed || 0,
    blocked: summary?.blocked || 0,
    selectorBreakages: summary?.selectorBreakages || 0,
    byMode,
  };
}

function buildCoverageSourceSummary(
  coverage?: ReportSourceCoverage,
): ScrapeRunReport['coverage']['source'] {
  if (!coverage) return undefined;
  const artifactTypes = coverage.artifactTypes || [];
  const evidenceCategories = coverage.evidenceCategories || [];
  const hasCoverageMetadata =
    coverage.priority !== undefined ||
    !!coverage.tier ||
    !!coverage.defaultConfidence ||
    artifactTypes.length > 0 ||
    evidenceCategories.length > 0;
  if (!hasCoverageMetadata) return undefined;
  return {
    priority: coverage.priority,
    tier: coverage.tier,
    artifactTypes: {
      total: artifactTypes.length,
      values: artifactTypes,
    },
    evidenceCategories: {
      total: evidenceCategories.length,
      values: evidenceCategories,
    },
    defaultConfidence: coverage.defaultConfidence,
    notes: coverage.notes,
  };
}

const ACCESS_ARTIFACT_TYPES = [
  'EntryPathway',
  'AccessSignal',
  'ContactRoute',
  'PostedOpportunity',
] as const;

function metricForArtifact(
  metrics: Required<ReportPostMaterializationMetrics>,
  artifactType: string,
): number {
  switch (artifactType) {
    case 'EntryPathway':
      return metrics.entryPathways;
    case 'AccessSignal':
      return metrics.accessSignals;
    case 'ContactRoute':
      return metrics.contactRoutes;
    case 'PostedOpportunity':
      return metrics.postedOpportunities;
    default:
      return 0;
  }
}

function buildPostMaterializationSummary(
  metrics: ReportPostMaterializationMetrics | undefined,
  sourceCoverage?: ScrapeRunReport['coverage']['source'],
): ReportPostMaterializationSummary | undefined {
  if (!metrics) return undefined;

  const normalized: Required<ReportPostMaterializationMetrics> = {
    entryPathways: metrics.entryPathways || 0,
    accessSignals: metrics.accessSignals || 0,
    contactRoutes: metrics.contactRoutes || 0,
    postedOpportunities: metrics.postedOpportunities || 0,
    guardedContactRoutes: metrics.guardedContactRoutes || 0,
    staleEvidenceSkipped: metrics.staleEvidenceSkipped || 0,
    conflicts: metrics.conflicts || 0,
    errors: metrics.errors || 0,
  };
  const expectedArtifactTypes = (sourceCoverage?.artifactTypes.values || []).filter((artifactType) =>
    (ACCESS_ARTIFACT_TYPES as readonly string[]).includes(artifactType),
  );
  const missingExpectedArtifactTypes = expectedArtifactTypes.filter(
    (artifactType) => metricForArtifact(normalized, artifactType) === 0,
  );

  return {
    ...normalized,
    totalAccessArtifacts:
      normalized.entryPathways +
      normalized.accessSignals +
      normalized.contactRoutes +
      normalized.postedOpportunities,
    expectedArtifactTypes,
    missingExpectedArtifactTypes,
  };
}

export function buildSourceEvidenceGapReview(
  sources: SourceEvidenceGapReviewInput[],
): SourceEvidenceGapReviewRow[] {
  return sources.map((source) => {
    const coverageSource = buildCoverageSourceSummary(source.sourceCoverage);
    const summary = buildPostMaterializationSummary(
      source.postMaterializationMetrics || {},
      coverageSource,
    );
    const expectedArtifactTypes = summary?.expectedArtifactTypes || [];
    const missingExpectedArtifactTypes = summary?.missingExpectedArtifactTypes || [];
    const totalAccessArtifacts = summary?.totalAccessArtifacts || 0;

    return {
      sourceName: source.sourceName,
      expectedArtifactTypes,
      actualArtifactCounts: {
        entryPathways: summary?.entryPathways || 0,
        accessSignals: summary?.accessSignals || 0,
        contactRoutes: summary?.contactRoutes || 0,
        postedOpportunities: summary?.postedOpportunities || 0,
      },
      missingExpectedArtifactTypes,
      totalAccessArtifacts,
      hasGap: expectedArtifactTypes.length > 0 && missingExpectedArtifactTypes.length > 0,
      coverageKnown: !!coverageSource,
    };
  });
}

export function buildScrapeRunReport(
  run: ReportScrapeRun,
  observations: ReportObservation[],
  sourceCoverage?: ReportSourceCoverage,
  conflictReviewOptions?: MaterializationConflictReviewOptions,
): ScrapeRunReport {
  const byEntityType: Record<string, number> = {};
  const byField: Record<string, number> = {};
  const entities = new Set<string>();
  const valuesByEntityField = new Map<string, Set<string>>();
  const labelsByEntityField = new Map<
    string,
    { entityType: string; entity: string; field: string }
  >();
  let missingEntityIdentifierCount = 0;
  let missingSourceUrlCount = 0;
  let lowConfidenceCount = 0;
  let supersededCount = 0;

  for (const obs of observations) {
    increment(byEntityType, obs.entityType || 'unknown');
    increment(byField, obs.field || 'unknown');

    const entityId = stringifyId(obs.entityId);
    const entityKey = stringifyId(obs.entityKey);
    const entity = entityId || entityKey;
    if (entity) {
      entities.add(`${obs.entityType}:${entity}`);
      const fieldKey = JSON.stringify([obs.entityType, entity, obs.field]);
      labelsByEntityField.set(fieldKey, {
        entityType: obs.entityType,
        entity,
        field: obs.field,
      });
      let values = valuesByEntityField.get(fieldKey);
      if (!values) {
        values = new Set<string>();
        valuesByEntityField.set(fieldKey, values);
      }
      values.add(serializeValue(obs.value));
    } else {
      missingEntityIdentifierCount++;
    }

    if (!obs.sourceUrl) missingSourceUrlCount++;
    if (typeof obs.confidence === 'number' && obs.confidence < 0.5) lowConfidenceCount++;
    if (obs.superseded) supersededCount++;
  }

  const conflictCandidates = Array.from(valuesByEntityField.entries())
    .filter(([, values]) => values.size > 1)
    .map(([key, values]) => {
      const label = labelsByEntityField.get(key);
      return {
        entityType: label?.entityType || 'unknown',
        entity: label?.entity || 'unknown',
        field: label?.field || 'unknown',
        distinctValues: values.size,
      };
    })
    .sort((a, b) => b.distinctValues - a.distinctValues || a.field.localeCompare(b.field))
    .slice(0, 20);

  const errors = (run.errors || []).map((err) => ({
    message: err.message || 'Unknown scrape error',
    at: iso(err.at),
    context: err.context,
  }));
  const coverageFetch = buildCoverageFetchSummary(run.fetchMetrics);
  const coverageSource = buildCoverageSourceSummary(sourceCoverage);
  const postMaterialization = buildPostMaterializationSummary(
    run.postMaterializationMetrics,
    coverageSource,
  );
  const workPlanner = run.metrics?.workPlanner;
  const workPlannerSkippedAll =
    !!workPlanner &&
    workPlanner.planned > 0 &&
    workPlanner.fetched === 0 &&
    (workPlanner.skippedFresh || 0) +
      (workPlanner.skippedManualLock || 0) +
      (workPlanner.skippedNoIdentifier || 0) >=
      workPlanner.planned;
  const materializationWrites =
    (run.entitiesCreated || 0) + (run.entitiesUpdated || 0) + (run.entitiesArchived || 0);
  const materializationConflictReview = buildMaterializationConflictReview(
    run.materializationConflicts || 0,
    conflictReviewOptions,
  );

  const warnings: string[] = [];
  if (run.status === 'failure') warnings.push('Run failed; do not materialize without inspecting errors.');
  if (run.status === 'partial') warnings.push('Run completed partially; inspect source-level logs/errors.');
  if (run.invalidated) warnings.push('Run has been invalidated.');
  if (observations.length === 0 && !workPlannerSkippedAll) {
    warnings.push('Run produced zero observations.');
  }
  if (missingEntityIdentifierCount > 0) {
    warnings.push(`${missingEntityIdentifierCount} observation(s) lack entityId/entityKey.`);
  }
  if (conflictCandidates.length > 0) {
    warnings.push(`${conflictCandidates.length} entity-field conflict candidate(s) found within this run.`);
  }
  if (lowConfidenceCount > 0) {
    warnings.push(`${lowConfidenceCount} low-confidence observation(s) found.`);
  }
  if (supersededCount > 0) {
    warnings.push(`${supersededCount} duplicate observation(s) superseded in this run.`);
  }
  if (!coverageSource) {
    warnings.push(`No Source coverage metadata found for "${run.sourceName}".`);
  } else if (
    observations.length > 0 &&
    !coverageSource.artifactTypes.values.includes('Observation')
  ) {
    warnings.push(
      `Source coverage metadata does not list Observation artifacts, but run emitted ${observations.length} observation(s).`,
    );
  }
  if (
    coverageSource &&
    observations.length === 0 &&
    run.status === 'success' &&
    !workPlannerSkippedAll
  ) {
    warnings.push('Source coverage metadata exists, but successful run emitted zero observations.');
  }
  if (coverageFetch.succeeded > 0 && observations.length === 0) {
    warnings.push(
      `${coverageFetch.succeeded} fetch(es) succeeded, but run emitted zero observations.`,
    );
  }
  if (coverageFetch.attempts > 0 && coverageFetch.succeeded === 0 && observations.length > 0) {
    warnings.push(
      `Run emitted ${observations.length} observation(s), but fetch metrics report zero successful fetches.`,
    );
  }
  if (postMaterialization) {
    if (
      postMaterialization.expectedArtifactTypes.length > 0 &&
      postMaterialization.totalAccessArtifacts === 0 &&
      run.status === 'success'
    ) {
      warnings.push(
        `Source coverage expects access artifacts (${postMaterialization.expectedArtifactTypes.join(', ')}), but post-materialization metrics report zero access artifacts.`,
      );
    } else if (postMaterialization.missingExpectedArtifactTypes.length > 0) {
      warnings.push(
        `Post-materialization metrics are missing expected artifact type(s): ${postMaterialization.missingExpectedArtifactTypes.join(', ')}.`,
      );
    }
    if (postMaterialization.guardedContactRoutes > 0) {
      warnings.push(
        `${postMaterialization.guardedContactRoutes} contact route(s) were guarded from public exposure.`,
      );
    }
    if (postMaterialization.staleEvidenceSkipped > 0) {
      warnings.push(
        `${postMaterialization.staleEvidenceSkipped} stale evidence item(s) skipped during materialization.`,
      );
    }
  }

  return {
    run: {
      id: String(run._id),
      sourceName: run.sourceName,
      status: run.status,
      triggeredBy: run.triggeredBy,
      startedAt: iso(run.startedAt),
      finishedAt: iso(run.finishedAt),
      durationSeconds: durationSeconds(run.startedAt, run.finishedAt),
      invalidated: !!run.invalidated,
      options: run.options || {},
    },
    observations: {
      total: observations.length,
      entitiesObserved: entities.size,
      byEntityType,
      byField,
      topFields: topEntries(byField, 15),
      active: observations.length - supersededCount,
      superseded: supersededCount,
      duplicateRate: observations.length > 0 ? supersededCount / observations.length : 0,
    },
    materialization: {
      created: run.entitiesCreated || 0,
      updated: run.entitiesUpdated || 0,
      archived: run.entitiesArchived || 0,
      skipped: run.materializationSkipped || 0,
      conflicts: run.materializationConflicts || 0,
      errors: run.materializationErrors || 0,
    },
    fetchMetrics: run.fetchMetrics,
    metrics: run.metrics,
    coverage: {
      source: coverageSource,
      fetch: coverageFetch,
      observationsEmitted: observations.length,
      materializationWrites,
      postMaterialization,
      workPlanner: run.metrics?.workPlanner,
    },
    quality: {
      conflictCandidateCount: conflictCandidates.length,
      conflictCandidates,
      missingEntityIdentifierCount,
      missingSourceUrlCount,
      lowConfidenceCount,
      ...(materializationConflictReview ? { materializationConflictReview } : {}),
    },
    warnings,
    errors,
  };
}

function buildMaterializationConflictEntityClauses(
  observations: ReportObservation[],
): Array<Record<string, unknown>> {
  const clauses: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  for (const obs of observations) {
    if (!obs.entityType) continue;
    const entityId = stringifyId(obs.entityId);
    const entityKey = stringifyId(obs.entityKey);
    let key: string;
    let clause: Record<string, unknown>;
    if (entityId) {
      key = `${obs.entityType}:id:${entityId}`;
      clause = { entityType: obs.entityType, entityId: obs.entityId };
    } else if (entityKey) {
      key = `${obs.entityType}:key:${entityKey}`;
      clause = { entityType: obs.entityType, entityKey };
    } else {
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    clauses.push(clause);
  }

  return clauses;
}

async function getMaterializationConflictReviewOptions(
  run: ReportScrapeRun,
  observations: ReportObservation[],
): Promise<MaterializationConflictReviewOptions | undefined> {
  if (!run.materializationConflicts) return undefined;

  const clauses = buildMaterializationConflictEntityClauses(observations);
  if (clauses.length === 0) {
    return {
      activeObservations: [],
      unavailableReason: 'run-observations-have-no-entity-identifiers',
    };
  }
  if (clauses.length > MATERIALIZATION_CONFLICT_REVIEW_ENTITY_LIMIT) {
    return {
      truncated: true,
      unavailableReason: `run touches ${clauses.length} entities; active conflict review is capped at ${MATERIALIZATION_CONFLICT_REVIEW_ENTITY_LIMIT}`,
    };
  }

  const activeObservations = await Observation.find({
    superseded: false,
    $or: clauses,
  })
    .select('entityType entityId entityKey field value sourceName confidence sourceUrl observedAt superseded observationFingerprint')
    .lean();

  return {
    activeObservations: activeObservations as ReportObservation[],
  };
}

export async function getScrapeRunReport(scrapeRunId: string): Promise<ScrapeRunReport> {
  if (!mongoose.Types.ObjectId.isValid(scrapeRunId)) {
    throw new Error(`Invalid ScrapeRun id: ${scrapeRunId}`);
  }

  const run = await ScrapeRun.findById(scrapeRunId).lean();
  if (!run) throw new Error(`ScrapeRun not found: ${scrapeRunId}`);

  const sourceClauses: Array<Record<string, unknown>> = [{ name: (run as ReportScrapeRun).sourceName }];
  const sourceId = (run as ReportScrapeRun).sourceId;
  if (sourceId) sourceClauses.unshift({ _id: sourceId });

  const [observations, source] = await Promise.all([
    Observation.find({ scrapeRunId })
      .select('entityType entityId entityKey field value sourceName confidence sourceUrl observedAt superseded observationFingerprint')
      .lean(),
    Source.findOne({
      $or: sourceClauses,
    })
      .select('coverage')
      .lean(),
  ]);
  const conflictReviewOptions = await getMaterializationConflictReviewOptions(
    run as ReportScrapeRun,
    observations as ReportObservation[],
  );

  return buildScrapeRunReport(
    run as ReportScrapeRun,
    observations as ReportObservation[],
    source?.coverage as ReportSourceCoverage | undefined,
    conflictReviewOptions,
  );
}
