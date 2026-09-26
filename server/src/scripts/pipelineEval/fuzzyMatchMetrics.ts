import { harmonicMean, ratioOrNull, type MetricRatio } from './metricRatio';

export interface IdEdge {
  from: string;
  to: string;
}

export interface RedirectRecord {
  mergedEntityId?: unknown;
  canonicalEntityId?: unknown;
}

export interface CanonicalGroupRecord {
  entityId?: unknown;
  canonicalGroupId?: unknown;
}

export interface ResearcherDedupeRecord {
  researcherId?: unknown;
  dedupedIntoResearcherId?: unknown;
}

export interface SameNameQuarantineLike {
  normalizedName: string;
  entities: Array<{ id?: unknown; personId?: unknown }>;
}

const idString = (value: unknown): string =>
  value === undefined || value === null ? '' : String(value).trim();

export function pairKey(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    const seen = this.parent.get(x);
    if (seen === undefined) {
      this.parent.set(x, x);
      return x;
    }
    if (seen === x) return x;
    const root = this.find(seen);
    this.parent.set(x, root);
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export function clustersFromEdges(edges: IdEdge[]): string[][] {
  const uf = new UnionFind();
  for (const { from, to } of edges) {
    if (!from || !to) continue;
    uf.union(from, to);
  }
  const groups = new Map<string, string[]>();
  for (const node of new Set(edges.flatMap((e) => [e.from, e.to]).filter(Boolean))) {
    const root = uf.find(node);
    const arr = groups.get(root) ?? [];
    arr.push(node);
    groups.set(root, arr);
  }
  return Array.from(groups.values());
}

export function buildGroundTruthClusters(
  redirects: RedirectRecord[],
  canonicalGroupRows: CanonicalGroupRecord[],
  researcherDedupes: ResearcherDedupeRecord[] = [],
): string[][] {
  const entityEdges: IdEdge[] = [];
  for (const r of redirects) {
    const from = idString(r.mergedEntityId);
    const to = idString(r.canonicalEntityId);
    if (from && to) entityEdges.push({ from, to });
  }
  for (const g of canonicalGroupRows) {
    const from = idString(g.entityId);
    const to = idString(g.canonicalGroupId);
    if (from && to) entityEdges.push({ from, to });
  }
  const researcherEdges: IdEdge[] = [];
  for (const d of researcherDedupes) {
    const from = idString(d.researcherId);
    const to = idString(d.dedupedIntoResearcherId);
    if (from && to) researcherEdges.push({ from: `researcher:${from}`, to: `researcher:${to}` });
  }
  return [...clustersFromEdges(entityEdges), ...clustersFromEdges(researcherEdges)];
}

export function clusterPairs(clusters: string[][]): Set<string> {
  const pairs = new Set<string>();
  for (const cluster of clusters) {
    for (let i = 0; i < cluster.length; i += 1) {
      for (let j = i + 1; j < cluster.length; j += 1) {
        pairs.add(pairKey(cluster[i], cluster[j]));
      }
    }
  }
  return pairs;
}

export function buildLabeledNegatives(quarantines: SameNameQuarantineLike[]): Set<string> {
  const negatives = new Set<string>();
  for (const quarantine of quarantines) {
    const entities = quarantine.entities.map((e) => ({
      id: idString(e.id),
      personId: idString(e.personId),
    }));
    for (let i = 0; i < entities.length; i += 1) {
      for (let j = i + 1; j < entities.length; j += 1) {
        const a = entities[i];
        const b = entities[j];
        if (!a.id || !b.id) continue;
        if (a.personId && b.personId && a.personId !== b.personId) {
          negatives.add(pairKey(a.id, b.id));
        }
      }
    }
  }
  return negatives;
}

export interface PairwiseMetrics {
  precision: MetricRatio;
  precisionLowerBound: MetricRatio;
  precisionUpperBound: MetricRatio;
  recall: MetricRatio;
  f1: MetricRatio;
  tp: number;
  fp: number;
  fn: number;
  predicted: number;
  judged: number;
  unlabeled: number;
  judgedShare: MetricRatio;
}

export function pairwiseMetrics(
  predicted: Iterable<string>,
  positives: Set<string>,
  negatives: Set<string>,
): PairwiseMetrics {
  const predictedSet = new Set(predicted);
  let tp = 0;
  let fp = 0;
  for (const p of predictedSet) {
    if (positives.has(p)) tp += 1;
    else if (negatives.has(p)) fp += 1;
  }
  let fn = 0;
  for (const p of positives) if (!predictedSet.has(p)) fn += 1;
  const judged = tp + fp;
  const unlabeled = predictedSet.size - judged;
  const precision = ratioOrNull(tp, judged);
  const recall = ratioOrNull(tp, tp + fn);
  return {
    precision,
    precisionLowerBound: ratioOrNull(tp, predictedSet.size),
    precisionUpperBound: ratioOrNull(tp + unlabeled, predictedSet.size),
    recall,
    f1: harmonicMean(precision, recall),
    tp,
    fp,
    fn,
    predicted: predictedSet.size,
    judged,
    unlabeled,
    judgedShare: ratioOrNull(judged, predictedSet.size),
  };
}

export function pairCompleteness(
  candidatePairs: Iterable<string>,
  positives: Set<string>,
): MetricRatio {
  const candidateSet = new Set(candidatePairs);
  let covered = 0;
  for (const p of positives) if (candidateSet.has(p)) covered += 1;
  return ratioOrNull(covered, positives.size);
}

export interface BcubedMetrics {
  precision: MetricRatio;
  recall: MetricRatio;
  f1: MetricRatio;
  predictedElements: number;
  truthElements: number;
  truthElementsPredicted: number;
  truthCoverage: MetricRatio;
}

function clusterIndex(clusters: string[][]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const cluster of clusters) {
    const members = new Set(cluster);
    for (const node of cluster) index.set(node, members);
  }
  return index;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const member of a) if (b.has(member)) shared += 1;
  return shared;
}

export function clusterBcubed(
  predictedClusters: string[][],
  truthClusters: string[][],
): BcubedMetrics {
  const predicted = clusterIndex(predictedClusters);
  const truth = clusterIndex(truthClusters);

  let precisionSum = 0;
  for (const [element, predMembers] of predicted) {
    const truthMembers = truth.get(element) ?? new Set([element]);
    precisionSum += overlap(predMembers, truthMembers) / predMembers.size;
  }

  let recallSum = 0;
  let truthElementsPredicted = 0;
  for (const [element, truthMembers] of truth) {
    if (predicted.has(element)) truthElementsPredicted += 1;
    const predMembers = predicted.get(element) ?? new Set([element]);
    recallSum += overlap(predMembers, truthMembers) / truthMembers.size;
  }

  const precision = ratioOrNull(precisionSum, predicted.size);
  const recall = ratioOrNull(recallSum, truth.size);
  return {
    precision,
    recall,
    f1: harmonicMean(precision, recall),
    predictedElements: predicted.size,
    truthElements: truth.size,
    truthElementsPredicted,
    truthCoverage: ratioOrNull(truthElementsPredicted, truth.size),
  };
}
