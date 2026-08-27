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
  precision: number;
  recall: number;
  f1: number;
  tp: number;
  fp: number;
  fn: number;
}

const ratio = (n: number, d: number): number => (d === 0 ? 0 : Number((n / d).toFixed(4)));

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
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const f1 =
    precision + recall === 0
      ? 0
      : Number(((2 * precision * recall) / (precision + recall)).toFixed(4));
  return { precision, recall, f1, tp, fp, fn };
}

export function pairCompleteness(candidatePairs: Iterable<string>, positives: Set<string>): number {
  const candidateSet = new Set(candidatePairs);
  let covered = 0;
  for (const p of positives) if (candidateSet.has(p)) covered += 1;
  return ratio(covered, positives.size);
}

export interface BcubedMetrics {
  precision: number;
  recall: number;
  f1: number;
}

function clusterIndex(clusters: string[][]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const cluster of clusters) {
    const members = new Set(cluster);
    for (const node of cluster) index.set(node, members);
  }
  return index;
}

export function clusterBcubed(
  predictedClusters: string[][],
  truthClusters: string[][],
): BcubedMetrics {
  const predicted = clusterIndex(predictedClusters);
  const truth = clusterIndex(truthClusters);
  const elements = new Set<string>([...predicted.keys(), ...truth.keys()]);
  if (elements.size === 0) return { precision: 0, recall: 0, f1: 0 };

  let precisionSum = 0;
  let recallSum = 0;
  for (const element of elements) {
    const predMembers = predicted.get(element) ?? new Set([element]);
    const truthMembers = truth.get(element) ?? new Set([element]);
    let correct = 0;
    for (const member of predMembers) if (truthMembers.has(member)) correct += 1;
    precisionSum += correct / predMembers.size;
    recallSum += correct / truthMembers.size;
  }
  const precision = Number((precisionSum / elements.size).toFixed(4));
  const recall = Number((recallSum / elements.size).toFixed(4));
  const f1 =
    precision + recall === 0
      ? 0
      : Number(((2 * precision * recall) / (precision + recall)).toFixed(4));
  return { precision, recall, f1 };
}
