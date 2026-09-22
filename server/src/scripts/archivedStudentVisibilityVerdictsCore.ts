import { studentVisibilityTiers } from '../models/studentVisibility';

export const UNSET_TIER_LABEL = 'unset';

export const HELD_STUDENT_VISIBILITY_TIERS: readonly string[] = ['operator_review', 'suppressed'];

export interface ArchivedVerdictTierRow {
  tier?: string | null;
  archived: boolean;
  count: number;
}

export interface ArchivedVerdictHeldRow {
  archived: boolean;
  hasHardBlocker: boolean;
}

export interface ArchivedVerdictCensusInput {
  totalRows: number;
  archivedRows: number;
  archivedRowsStoringVerdict: number;
  archivedRowsByField: Record<string, number>;
  tierRows: readonly ArchivedVerdictTierRow[];
  heldRows: readonly ArchivedVerdictHeldRow[];
  liveRowsNeverGated: number;
}

export interface ArchivedVerdictTierCount {
  tier: string;
  allRows: number;
  liveRows: number;
}

export interface ArchivedVerdictHeldCounts {
  allRows: number;
  liveRows: number;
  zeroHardBlockerAllRows: number;
  zeroHardBlockerLiveRows: number;
}

export interface ArchivedVerdictCensus {
  totalRows: number;
  archivedRows: number;
  liveRows: number;
  archivedRowsStoringVerdict: number;
  archivedRowsByField: Record<string, number>;
  tierCounts: ArchivedVerdictTierCount[];
  untieredRows: { allRows: number; liveRows: number };
  heldRows: ArchivedVerdictHeldCounts;
  liveRowsNeverGated: number;
  violations: string[];
}

const tierLabel = (tier: string | null | undefined): string =>
  typeof tier === 'string' && tier.length > 0 ? tier : UNSET_TIER_LABEL;

export function summarizeArchivedVerdictCensus(
  input: ArchivedVerdictCensusInput,
): ArchivedVerdictCensus {
  const all = new Map<string, number>();
  const live = new Map<string, number>();
  for (const row of input.tierRows) {
    const label = tierLabel(row.tier);
    all.set(label, (all.get(label) || 0) + row.count);
    if (!row.archived) live.set(label, (live.get(label) || 0) + row.count);
  }

  const labels = [...studentVisibilityTiers.filter((tier) => all.has(tier) || live.has(tier))];
  const tierCounts = labels.map((tier) => ({
    tier,
    allRows: all.get(tier) || 0,
    liveRows: live.get(tier) || 0,
  }));

  const untieredRows = {
    allRows: all.get(UNSET_TIER_LABEL) || 0,
    liveRows: live.get(UNSET_TIER_LABEL) || 0,
  };

  const heldRows: ArchivedVerdictHeldCounts = {
    allRows: input.heldRows.length,
    liveRows: input.heldRows.filter((row) => !row.archived).length,
    zeroHardBlockerAllRows: input.heldRows.filter((row) => !row.hasHardBlocker).length,
    zeroHardBlockerLiveRows: input.heldRows.filter((row) => !row.archived && !row.hasHardBlocker)
      .length,
  };

  const violations: string[] = [];
  if (input.archivedRowsStoringVerdict > 0) {
    violations.push(
      `${input.archivedRowsStoringVerdict} archived rows still store a student-visibility verdict, so a count grouped by tier over-reports`,
    );
  }
  for (const count of tierCounts) {
    if (count.allRows !== count.liveRows) {
      violations.push(
        `tier ${count.tier} counts ${count.allRows} over all rows and ${count.liveRows} over live rows`,
      );
    }
  }
  if (untieredRows.liveRows > 0) {
    violations.push(
      `${untieredRows.liveRows} live rows store no tier, so an unset tier no longer means archived`,
    );
  }
  if (heldRows.zeroHardBlockerAllRows !== heldRows.zeroHardBlockerLiveRows) {
    violations.push(
      `the zero-hard-blocker held population reads ${heldRows.zeroHardBlockerAllRows} over all rows and ${heldRows.zeroHardBlockerLiveRows} over live rows`,
    );
  }

  return {
    totalRows: input.totalRows,
    archivedRows: input.archivedRows,
    liveRows: input.totalRows - input.archivedRows,
    archivedRowsStoringVerdict: input.archivedRowsStoringVerdict,
    archivedRowsByField: input.archivedRowsByField,
    tierCounts,
    untieredRows,
    heldRows,
    liveRowsNeverGated: input.liveRowsNeverGated,
    violations,
  };
}

export function formatArchivedVerdictCensus(census: ArchivedVerdictCensus): string {
  const lines: string[] = [];
  lines.push(
    `rows ${census.totalRows} (live ${census.liveRows}, archived ${census.archivedRows})`,
    `archived rows storing a verdict: ${census.archivedRowsStoringVerdict}`,
  );
  for (const [field, count] of Object.entries(census.archivedRowsByField)) {
    lines.push(`  ${field}: ${count}`);
  }
  lines.push('tier                  allRows  liveRows');
  for (const count of census.tierCounts) {
    lines.push(
      `  ${count.tier.padEnd(20)}${String(count.allRows).padStart(7)}${String(count.liveRows).padStart(10)}`,
    );
  }
  lines.push(
    `  ${UNSET_TIER_LABEL.padEnd(20)}${String(census.untieredRows.allRows).padStart(7)}${String(census.untieredRows.liveRows).padStart(10)}`,
    `held rows (${HELD_STUDENT_VISIBILITY_TIERS.join(', ')}): allRows ${census.heldRows.allRows}, liveRows ${census.heldRows.liveRows}`,
    `held rows carrying zero hard blockers: allRows ${census.heldRows.zeroHardBlockerAllRows}, liveRows ${census.heldRows.zeroHardBlockerLiveRows}`,
    `live rows never gated: ${census.liveRowsNeverGated}`,
  );
  if (census.violations.length === 0)
    lines.push('invariant holds: every count by tier is live-only');
  else for (const violation of census.violations) lines.push(`VIOLATION: ${violation}`);
  return lines.join('\n');
}
