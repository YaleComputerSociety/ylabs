import { assessResearchEntityDescriptionQuality } from '../../utils/researchEntityDescriptionQuality';
import { isProgramLikeResearchEntity } from '../../utils/researchEntityProgramLike';

export interface ScorableEntity {
  slug?: string;
  entityType?: unknown;
  kind?: unknown;
  fullDescription?: unknown;
  shortDescription?: unknown;
  researchAreas?: unknown;
  sourceUrls?: unknown;
  websiteUrl?: unknown;
  studentVisibilityTier?: string;
  canonicalGroupId?: unknown;
  archived?: boolean;
}

export interface AccuracyMetrics {
  entityCount: number;
  fullUseful: number;
  shortUseful: number;
  cardComplete: number;
  cardCompleteRate: number;
  studentReady: number;
  studentReadyRate: number;
  byTier: Record<string, number>;
}

export interface ChurnMetrics {
  liveEntityCount: number;
  redirects: number;
  shellsWithCanonicalGroup: number;
  archivedMerged: number;
  releaseQueueItems: number;
  referenceRepairAudits: number;
  mintedThenMerged: number;
  mintedThenMergedRate: number;
}

export interface GroundTruthPair {
  mergedKey: string;
  canonicalKey: string;
}

const rate = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));

export function scoreAccuracy(entities: ScorableEntity[]): AccuracyMetrics {
  const byTier: Record<string, number> = {};
  let fullUseful = 0;
  let shortUseful = 0;
  let cardComplete = 0;
  let studentReady = 0;

  for (const entity of entities) {
    const tier = typeof entity.studentVisibilityTier === 'string' ? entity.studentVisibilityTier : 'unknown';
    byTier[tier] = (byTier[tier] ?? 0) + 1;
    if (tier === 'student_ready') studentReady += 1;

    const quality = assessResearchEntityDescriptionQuality({
      fullDescription: entity.fullDescription,
      shortDescription: entity.shortDescription,
      researchAreas: entity.researchAreas,
      sourceUrls: entity.sourceUrls,
      websiteUrl: entity.websiteUrl,
      entityType: entity.entityType,
      isProgramLike: isProgramLikeResearchEntity(entity as Record<string, unknown>),
    });
    if (quality.full.isUseful) fullUseful += 1;
    if (quality.short.isUseful) shortUseful += 1;
    if (quality.cardState === 'complete') cardComplete += 1;
  }

  const entityCount = entities.length;
  return {
    entityCount,
    fullUseful,
    shortUseful,
    cardComplete,
    cardCompleteRate: rate(cardComplete, entityCount),
    studentReady,
    studentReadyRate: rate(studentReady, entityCount),
    byTier,
  };
}

export function buildChurnMetrics(input: {
  liveEntityCount: number;
  redirects: number;
  shellsWithCanonicalGroup: number;
  archivedMerged: number;
  releaseQueueItems: number;
  referenceRepairAudits: number;
}): ChurnMetrics {
  const mintedThenMerged = input.shellsWithCanonicalGroup + input.archivedMerged;
  return {
    liveEntityCount: input.liveEntityCount,
    redirects: input.redirects,
    shellsWithCanonicalGroup: input.shellsWithCanonicalGroup,
    archivedMerged: input.archivedMerged,
    releaseQueueItems: input.releaseQueueItems,
    referenceRepairAudits: input.referenceRepairAudits,
    mintedThenMerged,
    mintedThenMergedRate: rate(mintedThenMerged, input.liveEntityCount + mintedThenMerged),
  };
}

export interface DedupeScore {
  groundTruthPairs: number;
  predictedPairs: number;
  truePositives: number;
  precision: number;
  recall: number;
  f1: number;
}

export function scoreDedupe(
  predicted: GroundTruthPair[],
  groundTruth: GroundTruthPair[],
): DedupeScore {
  const key = (pair: GroundTruthPair): string => `${pair.mergedKey}=>${pair.canonicalKey}`;
  const truthSet = new Set(groundTruth.map(key));
  const predictedSet = new Set(predicted.map(key));
  let truePositives = 0;
  for (const p of predictedSet) if (truthSet.has(p)) truePositives += 1;
  const precision = rate(truePositives, predictedSet.size);
  const recall = rate(truePositives, truthSet.size);
  const f1 = precision + recall === 0 ? 0 : Number(((2 * precision * recall) / (precision + recall)).toFixed(4));
  return {
    groundTruthPairs: truthSet.size,
    predictedPairs: predictedSet.size,
    truePositives,
    precision,
    recall,
    f1,
  };
}
