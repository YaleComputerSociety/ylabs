/**
 * Run-scoped latest-wins for `user` `email` observations (#5705).
 *
 * A lane's read is every row it wrote for one subject from one page in one run. When the
 * newest read of a page states one or more emails for a subject, the same lane's earlier
 * reads of that page stop counting for every address the newest read no longer states.
 * Every address the newest read states stays live, so a page listing two addresses keeps
 * both, and rows of the same run never retire each other.
 *
 * A read that states no email is not a read here at all: silence is not absence (#2647),
 * so nothing is retired on the strength of a page that merely omits an address.
 *
 * The value-free latest-wins fingerprint is deliberately not used for this field: it keeps
 * only the single newest row per (lane, subject, field), which would retire the second
 * address a page states in the same read.
 */

export const RUN_SCOPED_EMAIL_RETIREMENT_REASON =
  "a newer read of the same page by the same lane states this person's email and no longer states this address (#5705)";

export interface RunScopedEmailRow {
  id: string;
  sourceName: string;
  entityKey?: string;
  entityId?: string;
  sourceUrl?: string;
  scrapeRunId?: string;
  observedAt: unknown;
  value: unknown;
}

export interface RunScopedEmailRetirement {
  id: string;
  sourceName: string;
  sourceUrl: string;
  entityKey?: string;
  entityId?: string;
  retiredByRunId: string;
}

export function isRunScopedLatestWinsEmail(row: { entityType?: unknown; field?: unknown }) {
  return row.entityType === 'user' && row.field === 'email';
}

export function statedEmailKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const key = value.trim().toLowerCase();
  return key.length > 0 ? key : undefined;
}

function observedTime(value: unknown): number | undefined {
  const time =
    value instanceof Date ? value.getTime() : new Date(value as string | number).getTime();
  return Number.isFinite(time) ? time : undefined;
}

function trimmed(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text.length > 0 ? text : undefined;
}

interface EvaluableRow {
  row: RunScopedEmailRow;
  sourceUrl: string;
  runId: string;
  time: number;
  identityNodes: string[];
}

function evaluable(row: RunScopedEmailRow): EvaluableRow | undefined {
  const sourceName = trimmed(row.sourceName);
  const sourceUrl = trimmed(row.sourceUrl);
  const runId = trimmed(row.scrapeRunId);
  const time = observedTime(row.observedAt);
  if (!sourceName || !sourceUrl || !runId || time === undefined) return undefined;
  const entityKey = trimmed(row.entityKey);
  const entityId = trimmed(row.entityId);
  const identityNodes = [
    ...(entityKey ? [`${sourceName}\u0000key:${entityKey}`] : []),
    ...(entityId ? [`${sourceName}\u0000id:${entityId}`] : []),
  ];
  if (identityNodes.length === 0) return undefined;
  return { row, sourceUrl, runId, time, identityNodes };
}

class SubjectClusters {
  private readonly parent = new Map<string, string>();

  find(node: string): string {
    let root = node;
    while (this.parent.has(root) && this.parent.get(root) !== root) {
      root = this.parent.get(root) as string;
    }
    this.parent.set(node, root);
    return root;
  }

  join(nodes: string[]): void {
    const [first, ...rest] = nodes.map((node) => this.find(node));
    for (const other of rest) if (other !== first) this.parent.set(other, first);
  }
}

interface Read {
  runId: string;
  rows: EvaluableRow[];
  earliest: number;
  latest: number;
  stated: Set<string>;
}

function readsOf(rows: EvaluableRow[]): Read[] {
  const byRun = new Map<string, Read>();
  for (const entry of rows) {
    const read = byRun.get(entry.runId) ?? {
      runId: entry.runId,
      rows: [],
      earliest: entry.time,
      latest: entry.time,
      stated: new Set<string>(),
    };
    read.rows.push(entry);
    read.earliest = Math.min(read.earliest, entry.time);
    read.latest = Math.max(read.latest, entry.time);
    const key = statedEmailKey(entry.row.value);
    if (key) read.stated.add(key);
    byRun.set(entry.runId, read);
  }
  return [...byRun.values()];
}

function newestStatingRead(reads: Read[]): Read | undefined {
  const stating = reads
    .filter((read) => read.stated.size > 0)
    .sort((left, right) => right.latest - left.latest);
  const [newest, runnerUp] = stating;
  if (!newest) return undefined;
  if (runnerUp && runnerUp.latest >= newest.earliest) return undefined;
  return newest;
}

/**
 * Pure: takes live `user` `email` rows of any lanes, pages and runs, and returns the rows a
 * newer read of the same (lane, subject, page) replaced. A subject is every identity form a
 * row carries, joined across rows, so a row stored under `entityId` and one under `entityKey`
 * for the same person are one subject whenever any row carries both.
 */
export function planRunScopedEmailSupersede(
  rows: ReadonlyArray<RunScopedEmailRow>,
): RunScopedEmailRetirement[] {
  const entries = rows.flatMap((row) => {
    const entry = evaluable(row);
    return entry ? [entry] : [];
  });
  const clusters = new SubjectClusters();
  for (const entry of entries) clusters.join(entry.identityNodes);

  const groups = new Map<string, EvaluableRow[]>();
  for (const entry of entries) {
    const group = `${clusters.find(entry.identityNodes[0])}\u0000${entry.sourceUrl}`;
    groups.set(group, [...(groups.get(group) ?? []), entry]);
  }

  const retirements: RunScopedEmailRetirement[] = [];
  for (const groupRows of groups.values()) {
    const reads = readsOf(groupRows);
    const newest = newestStatingRead(reads);
    if (!newest) continue;
    for (const read of reads) {
      if (read === newest || read.latest >= newest.earliest) continue;
      for (const entry of read.rows) {
        const key = statedEmailKey(entry.row.value);
        if (key && newest.stated.has(key)) continue;
        retirements.push({
          id: entry.row.id,
          sourceName: entry.row.sourceName,
          sourceUrl: entry.sourceUrl,
          ...(trimmed(entry.row.entityKey) ? { entityKey: trimmed(entry.row.entityKey) } : {}),
          ...(trimmed(entry.row.entityId) ? { entityId: trimmed(entry.row.entityId) } : {}),
          retiredByRunId: newest.runId,
        });
      }
    }
  }
  return retirements;
}

export function subjectsToRederive(
  retirements: ReadonlyArray<RunScopedEmailRetirement>,
): Array<{ entityKey?: string; entityId?: string }> {
  const seen = new Map<string, { entityKey?: string; entityId?: string }>();
  for (const retirement of retirements) {
    const identifier = retirement.entityKey
      ? { entityKey: retirement.entityKey }
      : { entityId: retirement.entityId };
    seen.set(JSON.stringify(identifier), identifier);
  }
  return [...seen.values()];
}
