import {
  fullDescriptionQuality,
  shortDescriptionQuality,
  programCardShortDescriptionQuality,
} from '../../utils/researchEntityDescriptionQuality';
import { isProgramLikeResearchEntity } from '../../utils/researchEntityProgramLike';
import {
  resolveGroundedCardDescription,
  synthesizeGroundedCardDescription,
  defaultCardSynthesisLLM,
  CARD_SYNTHESIS_MODEL,
} from '../../utils/groundedCardSynthesis';
import {
  normalizeWebsiteUrlIdentityKey,
  specificProfileLabUrlIdentityKey,
  normalizeOrgDedupeName,
} from '../researchEntityPiDedupeCore';
import { scoreAccuracy, type AccuracyMetrics, type ScorableEntity } from './pipelineEvalMetrics';

export interface EvalEntity {
  id: string;
  slug?: string;
  name?: string;
  entityType?: unknown;
  kind?: unknown;
  fullDescription?: unknown;
  shortDescription?: unknown;
  researchAreas?: unknown;
  sourceUrls?: unknown;
  websiteUrl?: unknown;
  studentVisibilityTier?: string;
  canonicalGroupId?: string | null;
  archived?: boolean;
  inferredPiUserId?: string | null;
  departments?: unknown;
}

export interface IdentityKeyOptions {
  rich?: boolean;
  orcidByUserId?: Map<string, string>;
}

export interface DescriptionObservation {
  entityKey?: string;
  entityId?: string;
  field: string;
  value: unknown;
  sourceName: string;
  confidence: number;
  observedAt: Date;
  superseded?: boolean;
}

interface DescriptionContext {
  researchAreas?: unknown;
  entityType?: unknown;
  isProgramLike: boolean;
}

const HALF_LIFE_DAYS = 90;
const MS_PER_DAY = 86_400_000;
const MAX_BLOCK_SIZE = 8;

function recencyWeight(obs: DescriptionObservation, now: number): number {
  const ageDays = (now - (obs.observedAt instanceof Date ? obs.observedAt.getTime() : 0)) / MS_PER_DAY;
  const confidence = typeof obs.confidence === 'number' ? obs.confidence : 0;
  return confidence * Math.pow(0.5, Math.max(0, ageDays) / HALF_LIFE_DAYS);
}

function chooseQualityPreferred(
  candidates: DescriptionObservation[],
  isUseful: (value: unknown) => boolean,
  now: number,
): unknown {
  if (candidates.length === 0) return undefined;
  const useful = candidates.filter((c) => isUseful(c.value));
  const pool = useful.length > 0 ? useful : candidates;
  let best = pool[0];
  let bestWeight = recencyWeight(best, now);
  for (const candidate of pool.slice(1)) {
    const weight = recencyWeight(candidate, now);
    if (weight > bestWeight) {
      best = candidate;
      bestWeight = weight;
    }
  }
  return best.value;
}

export function projectDescriptions(
  obs: DescriptionObservation[],
  includeSuperseded: boolean,
  ctx: DescriptionContext,
): { fullDescription?: unknown; shortDescription?: unknown } {
  const pool = includeSuperseded ? obs : obs.filter((o) => !o.superseded);
  const now = Date.now();
  const fulls = pool.filter((o) => o.field === 'fullDescription');
  const fullDescription = chooseQualityPreferred(
    fulls,
    (value) => fullDescriptionQuality(value, ctx.researchAreas, ctx.entityType).isUseful,
    now,
  );
  const shorts = pool.filter((o) => o.field === 'shortDescription');
  const shortDescription = chooseQualityPreferred(
    shorts,
    (value) =>
      ctx.isProgramLike
        ? programCardShortDescriptionQuality(value, fullDescription).isUseful
        : shortDescriptionQuality(value, fullDescription, ctx.researchAreas, { entityType: ctx.entityType }).isUseful,
    now,
  );
  return { fullDescription, shortDescription };
}

const textVal = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

function shortIsUseful(ctx: DescriptionContext, short: unknown, full: unknown): boolean {
  if (textVal(short) === '') return false;
  return ctx.isProgramLike
    ? programCardShortDescriptionQuality(short, full).isUseful
    : shortDescriptionQuality(short, full, ctx.researchAreas, { entityType: ctx.entityType }).isUseful;
}

export type SynthesisCache = Map<string, string>;

export interface SynthesisTarget {
  fullText: string;
  entityName: string;
  researchAreas: unknown;
  entityType: unknown;
  isProgramLike: boolean;
}

function ctxFor(entity: EvalEntity): DescriptionContext {
  return {
    researchAreas: entity.researchAreas,
    entityType: entity.entityType,
    isProgramLike: isProgramLikeResearchEntity(entity as Record<string, unknown>),
  };
}

export function collectSynthesisTargets(
  liveEntities: EvalEntity[],
  obsByEntity: Map<string, DescriptionObservation[]>,
): SynthesisTarget[] {
  const byFull = new Map<string, SynthesisTarget>();
  for (const entity of liveEntities) {
    const obs = (entity.slug && obsByEntity.get(entity.slug)) || obsByEntity.get(entity.id) || [];
    const ctx = ctxFor(entity);
    for (const includeSuperseded of [false, true]) {
      const projected = projectDescriptions(obs, includeSuperseded, ctx);
      const full = textVal(projected.fullDescription);
      if (!full) continue;
      if (shortIsUseful(ctx, projected.shortDescription, projected.fullDescription)) continue;
      if (!fullDescriptionQuality(full, ctx.researchAreas, ctx.entityType).isUseful) continue;
      if (!byFull.has(full)) {
        byFull.set(full, {
          fullText: full,
          entityName: typeof entity.name === 'string' ? entity.name : '',
          researchAreas: entity.researchAreas,
          entityType: entity.entityType,
          isProgramLike: ctx.isProgramLike,
        });
      }
    }
  }
  return Array.from(byFull.values());
}

export async function synthesizeCardShort(target: SynthesisTarget, apiKey: string): Promise<string> {
  return resolveGroundedCardDescription({
    fullDescription: target.fullText,
    researchAreas: target.researchAreas,
    entityType: target.entityType,
    isProgramLike: target.isProgramLike,
    synthesize: (full) =>
      synthesizeGroundedCardDescription({
        fullDescription: full,
        entityName: target.entityName,
        researchAreas: target.researchAreas,
        entityType: target.entityType,
        callLLM: ({ fullDescription, entityName }) =>
          defaultCardSynthesisLLM({ model: CARD_SYNTHESIS_MODEL, apiKey, fullDescription, entityName }),
      }),
  });
}

function applySynthesizedShort(
  entity: EvalEntity,
  ctx: DescriptionContext,
  projected: { fullDescription?: unknown; shortDescription?: unknown },
  synthCache?: SynthesisCache,
): { fullDescription?: unknown; shortDescription?: unknown } {
  if (!synthCache) return projected;
  if (shortIsUseful(ctx, projected.shortDescription, projected.fullDescription)) return projected;
  const full = textVal(projected.fullDescription);
  if (!full) return projected;
  const synthesized = synthCache.get(full);
  if (synthesized && shortIsUseful(ctx, synthesized, projected.fullDescription)) {
    return { ...projected, shortDescription: synthesized };
  }
  return projected;
}

function scorableFromProjection(
  entity: EvalEntity,
  projected: { fullDescription?: unknown; shortDescription?: unknown },
): ScorableEntity {
  return {
    slug: entity.slug,
    entityType: entity.entityType,
    kind: entity.kind,
    fullDescription: projected.fullDescription,
    shortDescription: projected.shortDescription,
    researchAreas: entity.researchAreas,
    sourceUrls: entity.sourceUrls,
    websiteUrl: entity.websiteUrl,
    studentVisibilityTier: entity.studentVisibilityTier,
    canonicalGroupId: entity.canonicalGroupId ?? undefined,
    archived: entity.archived,
  };
}

export interface DescriptionProjectionResult {
  accuracy: AccuracyMetrics;
  activeOnlyCardCompleteRate: number;
  entitiesWithObservations: number;
  changedFromActiveOnly: number;
  cardRecovered: number;
  cardRegressed: number;
  cardRecoveredAmongNotReady: number;
}

export function scoreDescriptionStrategy(
  liveEntities: EvalEntity[],
  obsByEntity: Map<string, DescriptionObservation[]>,
  synthCache?: SynthesisCache,
): DescriptionProjectionResult {
  const chosenScorables: ScorableEntity[] = [];
  const activeScorables: ScorableEntity[] = [];
  let entitiesWithObservations = 0;
  let changedFromActiveOnly = 0;
  let cardRecovered = 0;
  let cardRegressed = 0;
  let cardRecoveredAmongNotReady = 0;

  for (const entity of liveEntities) {
    const obs = (entity.slug && obsByEntity.get(entity.slug)) || obsByEntity.get(entity.id) || [];
    const ctx = ctxFor(entity);
    const activeOnly = applySynthesizedShort(entity, ctx, projectDescriptions(obs, false, ctx), synthCache);
    const chosen = applySynthesizedShort(entity, ctx, projectDescriptions(obs, true, ctx), synthCache);
    if (obs.length > 0) entitiesWithObservations += 1;

    const activeComplete = scoreAccuracy([scorableFromProjection(entity, activeOnly)]).cardComplete === 1;
    const chosenComplete = scoreAccuracy([scorableFromProjection(entity, chosen)]).cardComplete === 1;
    if (
      JSON.stringify([activeOnly.fullDescription, activeOnly.shortDescription]) !==
      JSON.stringify([chosen.fullDescription, chosen.shortDescription])
    ) {
      changedFromActiveOnly += 1;
    }
    if (!activeComplete && chosenComplete) {
      cardRecovered += 1;
      if (entity.studentVisibilityTier !== 'student_ready') cardRecoveredAmongNotReady += 1;
    }
    if (activeComplete && !chosenComplete) cardRegressed += 1;

    chosenScorables.push(scorableFromProjection(entity, chosen));
    activeScorables.push(scorableFromProjection(entity, activeOnly));
  }

  return {
    accuracy: scoreAccuracy(chosenScorables),
    activeOnlyCardCompleteRate: scoreAccuracy(activeScorables).cardCompleteRate,
    entitiesWithObservations,
    changedFromActiveOnly,
    cardRecovered,
    cardRegressed,
    cardRecoveredAmongNotReady,
  };
}

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    let root = this.parent.get(x) ?? x;
    if (root === x) {
      this.parent.set(x, x);
      return x;
    }
    root = this.find(root);
    this.parent.set(x, root);
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export function identityKeysFor(entity: EvalEntity, opts: IdentityKeyOptions = {}): string[] {
  const keys: string[] = [];
  const own = typeof entity.websiteUrl === 'string' ? normalizeWebsiteUrlIdentityKey(entity.websiteUrl) : '';
  if (own) keys.push(`web:${own}`);

  const profileUrls: string[] = [];
  if (typeof entity.websiteUrl === 'string') profileUrls.push(entity.websiteUrl);
  if (Array.isArray(entity.sourceUrls)) {
    for (const u of entity.sourceUrls) if (typeof u === 'string') profileUrls.push(u);
  }
  for (const u of profileUrls) {
    const profile = specificProfileLabUrlIdentityKey(u);
    if (profile) keys.push(`profile:${profile}`);
  }

  if (entity.inferredPiUserId) keys.push(`pi:${String(entity.inferredPiUserId)}`);
  const type = String(entity.entityType ?? '');
  if (['CENTER', 'INSTITUTE', 'INITIATIVE'].includes(type) && typeof entity.name === 'string') {
    const org = normalizeOrgDedupeName(entity.name);
    if (org) keys.push(`org:${org}`);
  }

  if (opts.rich) {
    const normName = typeof entity.name === 'string' ? normalizeOrgDedupeName(entity.name) : '';
    if (normName && normName.length >= 4) {
      keys.push(`name:${normName}`);
      const depts = Array.isArray(entity.departments) ? entity.departments : [];
      for (const d of depts) {
        const nd = typeof d === 'string' ? normalizeOrgDedupeName(d) : '';
        if (nd) keys.push(`namedept:${normName}|${nd}`);
      }
    }
    if (entity.inferredPiUserId && opts.orcidByUserId) {
      const orcid = opts.orcidByUserId.get(String(entity.inferredPiUserId));
      if (orcid) keys.push(`orcid:${orcid}`);
    }
  }
  return Array.from(new Set(keys));
}

export interface DedupeStrategyResult {
  entitiesConsidered: number;
  groundTruthMergedPairs: number;
  groundTruthCaught: number;
  recall: number;
  droppedGenericKeys: number;
  predictedClusters: number;
  predictedNewMergePairs: number;
  newMergeSamePi: number;
  newMergeDifferentPiOrUnknown: number;
  avoidedMints: number;
  survivorEntityIds: string[];
}

export function scoreDedupeStrategy(
  allEntities: EvalEntity[],
  opts: IdentityKeyOptions = {},
): DedupeStrategyResult {
  const byId = new Map<string, EvalEntity>();
  for (const e of allEntities) byId.set(e.id, e);

  const keyToEntities = new Map<string, string[]>();
  for (const e of allEntities) {
    for (const key of identityKeysFor(e, opts)) {
      const arr = keyToEntities.get(key) ?? [];
      arr.push(e.id);
      keyToEntities.set(key, arr);
    }
  }

  const uf = new UnionFind();
  for (const e of allEntities) uf.find(e.id);
  let droppedGenericKeys = 0;
  for (const ids of keyToEntities.values()) {
    if (ids.length > MAX_BLOCK_SIZE) {
      droppedGenericKeys += 1;
      continue;
    }
    for (let i = 1; i < ids.length; i += 1) uf.union(ids[0], ids[i]);
  }

  const groundTruthPairs: Array<[string, string]> = [];
  for (const e of allEntities) {
    if (e.canonicalGroupId && byId.has(String(e.canonicalGroupId))) {
      groundTruthPairs.push([e.id, String(e.canonicalGroupId)]);
    }
  }
  let groundTruthCaught = 0;
  for (const [shell, canonical] of groundTruthPairs) {
    if (uf.find(shell) === uf.find(canonical)) groundTruthCaught += 1;
  }
  const knownMergedKeys = new Set(
    groundTruthPairs.flatMap(([shell, canonical]) => [`${shell}|${canonical}`, `${canonical}|${shell}`]),
  );

  const clusters = new Map<string, string[]>();
  for (const e of allEntities) {
    const root = uf.find(e.id);
    const arr = clusters.get(root) ?? [];
    arr.push(e.id);
    clusters.set(root, arr);
  }

  let predictedNewMergePairs = 0;
  let newMergeSamePi = 0;
  let newMergeDifferentPiOrUnknown = 0;
  let multiClusterCount = 0;
  for (const ids of clusters.values()) {
    if (ids.length < 2) continue;
    multiClusterCount += 1;
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        if (knownMergedKeys.has(`${ids[i]}|${ids[j]}`)) continue;
        predictedNewMergePairs += 1;
        const pa = byId.get(ids[i])?.inferredPiUserId;
        const pb = byId.get(ids[j])?.inferredPiUserId;
        if (pa && pb && String(pa) === String(pb)) newMergeSamePi += 1;
        else newMergeDifferentPiOrUnknown += 1;
      }
    }
  }

  const survivorRoots = new Set<string>();
  const survivorEntityIds: string[] = [];
  for (const e of allEntities) {
    if (e.archived) continue;
    const root = uf.find(e.id);
    if (survivorRoots.has(root)) continue;
    survivorRoots.add(root);
    survivorEntityIds.push(e.id);
  }

  return {
    entitiesConsidered: allEntities.length,
    groundTruthMergedPairs: groundTruthPairs.length,
    groundTruthCaught,
    recall:
      groundTruthPairs.length === 0
        ? 0
        : Number((groundTruthCaught / groundTruthPairs.length).toFixed(4)),
    droppedGenericKeys,
    predictedClusters: multiClusterCount,
    predictedNewMergePairs,
    newMergeSamePi,
    newMergeDifferentPiOrUnknown,
    avoidedMints: groundTruthCaught,
    survivorEntityIds,
  };
}
