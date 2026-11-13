export interface HostReadOutcome {
  answered: number;
  refused: number;
  skipped: number;
  failed: number;
}

export interface RunHostReadOutcomes {
  startedAt: Date;
  hostReadOutcomes: Readonly<Record<string, HostReadOutcome>>;
}

export interface SustainedHostRefusal {
  host: string;
  firstRefusedAt: Date;
  confirmingRefusalAt: Date;
  runs: number;
}

export const SUSTAINED_REFUSAL_MIN_RUNS = 3;
export const SUSTAINED_REFUSAL_MIN_SPAN_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Hosts that have refused this lane for a sustained period (#6195): walking back from the newest
 * run, every run that sent the host a request was refused and none was answered, across at least
 * `SUSTAINED_REFUSAL_MIN_RUNS` such runs spanning at least `SUSTAINED_REFUSAL_MIN_SPAN_MS`.
 *
 * A run that asked the host nothing, or only skipped it while it was paused, or met only transport
 * failures, neither extends nor breaks the episode, because none of those says whether the host
 * would read us. Any answer, a 404 included, ends it. A site-stated wait is honoured as a pause, so
 * its days arrive as skipped runs and never count. The episode is a flag for an operator, never a
 * reason to retire a reading.
 */
export function sustainedHostRefusals(
  runsNewestFirst: readonly RunHostReadOutcomes[],
): SustainedHostRefusal[] {
  const hosts = new Set(runsNewestFirst.flatMap((run) => Object.keys(run.hostReadOutcomes)));
  const sustained: SustainedHostRefusal[] = [];
  for (const host of [...hosts].sort()) {
    let runs = 0;
    let confirmingRefusalAt: Date | undefined;
    let firstRefusedAt: Date | undefined;
    for (const run of runsNewestFirst) {
      const outcome = run.hostReadOutcomes[host];
      if (!outcome) continue;
      if (outcome.answered > 0) break;
      if (outcome.refused === 0) continue;
      runs += 1;
      confirmingRefusalAt ??= run.startedAt;
      firstRefusedAt = run.startedAt;
    }
    if (
      firstRefusedAt &&
      confirmingRefusalAt &&
      runs >= SUSTAINED_REFUSAL_MIN_RUNS &&
      confirmingRefusalAt.getTime() - firstRefusedAt.getTime() >= SUSTAINED_REFUSAL_MIN_SPAN_MS
    ) {
      sustained.push({ host, firstRefusedAt, confirmingRefusalAt, runs });
    }
  }
  return sustained;
}
