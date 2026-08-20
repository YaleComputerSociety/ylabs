export interface RosterLeadResolutionInput {
  resolvedLeadEntityCount: number;
  zeroLeadEntityCount: number;
  maxZeroLeadRatio?: number;
  minLeadRequiringEntities?: number;
}

export interface RosterLeadResolutionResult {
  resolvedLeadEntityCount: number;
  zeroLeadEntityCount: number;
  leadRequiringEntityCount: number;
  zeroLeadRatio: number;
  maxZeroLeadRatio: number;
  minLeadRequiringEntities: number;
  enforced: boolean;
  safe: boolean;
  blocker?: string;
}

export const DEFAULT_MAX_ZERO_LEAD_RATIO = 0.9;
export const DEFAULT_MIN_LEAD_REQUIRING_ENTITIES = 25;

function normalizeCount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a safe non-negative integer`);
  }
  return value;
}

function normalizeMaxZeroLeadRatio(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_ZERO_LEAD_RATIO;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('maxZeroLeadRatio must be a finite number between 0 and 1');
  }
  return value;
}

function normalizeMinLeadRequiringEntities(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MIN_LEAD_REQUIRING_ENTITIES;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('minLeadRequiringEntities must be a safe non-negative integer');
  }
  return value;
}

export function evaluateRosterLeadResolution(
  input: RosterLeadResolutionInput,
): RosterLeadResolutionResult {
  const resolvedLeadEntityCount = normalizeCount(
    input.resolvedLeadEntityCount,
    'resolvedLeadEntityCount',
  );
  const zeroLeadEntityCount = normalizeCount(input.zeroLeadEntityCount, 'zeroLeadEntityCount');
  const maxZeroLeadRatio = normalizeMaxZeroLeadRatio(input.maxZeroLeadRatio);
  const minLeadRequiringEntities = normalizeMinLeadRequiringEntities(
    input.minLeadRequiringEntities,
  );

  const leadRequiringEntityCount = resolvedLeadEntityCount + zeroLeadEntityCount;
  const zeroLeadRatio =
    leadRequiringEntityCount > 0 ? zeroLeadEntityCount / leadRequiringEntityCount : 0;
  const enforced = leadRequiringEntityCount >= minLeadRequiringEntities;
  const safe = !enforced || zeroLeadRatio <= maxZeroLeadRatio;

  const result: RosterLeadResolutionResult = {
    resolvedLeadEntityCount,
    zeroLeadEntityCount,
    leadRequiringEntityCount,
    zeroLeadRatio,
    maxZeroLeadRatio,
    minLeadRequiringEntities,
    enforced,
    safe,
  };

  if (!safe) {
    const percent = (zeroLeadRatio * 100).toFixed(1);
    result.blocker =
      `roster lead resolution is unhealthy: ${zeroLeadEntityCount} of ${leadRequiringEntityCount} ` +
      `lead-requiring research entities (${percent}%) resolve zero leads, above the ${(
        maxZeroLeadRatio * 100
      ).toFixed(
        0,
      )}% ceiling. Refusing to mass-suppress from a likely mid-migration empty-roster state; ` +
      `populate canonical Researcher (re-materialize scraped sources or backfill legacy identities) and re-run.`;
  }

  return result;
}
