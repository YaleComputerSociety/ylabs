import type { LeadPiSchoolInheritanceResult } from '../scrapers/entityMaterializer';

export interface LeadDepartmentInheritanceOutcome {
  id: string;
  slug?: string;
  result: LeadPiSchoolInheritanceResult;
}

export interface LeadDepartmentInheritanceSummary {
  scanned: number;
  inherited: number;
  skipped: Record<string, number>;
  departmentsWritten: Array<[string, number]>;
  schoolsWritten: Array<[string, number]>;
}

/**
 * Tallies the run by the materializer's own skip reasons rather than by a single
 * total, because "nothing changed" has several distinct causes and only some are
 * fixable: `no-department` means the corpus does not know the lead's department,
 * `no-single-lead` means there is nobody to inherit from, and
 * `has-school-and-department` means the row never needed the pass. Ranking those
 * is what tells the next person which of the three jobs to fund.
 */
export function summarizeLeadDepartmentInheritance(
  outcomes: LeadDepartmentInheritanceOutcome[],
): LeadDepartmentInheritanceSummary {
  const skipped: Record<string, number> = {};
  const departments = new Map<string, number>();
  const schools = new Map<string, number>();
  let inherited = 0;

  for (const outcome of outcomes) {
    if (outcome.result.inherited) {
      inherited += 1;
      for (const department of outcome.result.departments ?? []) {
        departments.set(department, (departments.get(department) || 0) + 1);
      }
      if (outcome.result.school) {
        schools.set(outcome.result.school, (schools.get(outcome.result.school) || 0) + 1);
      }
      continue;
    }
    const reason = outcome.result.skipped ?? 'unknown';
    skipped[reason] = (skipped[reason] || 0) + 1;
  }

  const byCountDescending = (left: [string, number], right: [string, number]): number =>
    right[1] - left[1] || left[0].localeCompare(right[0]);

  return {
    scanned: outcomes.length,
    inherited,
    skipped,
    departmentsWritten: [...departments.entries()].sort(byCountDescending),
    schoolsWritten: [...schools.entries()].sort(byCountDescending),
  };
}

export type LeadPiProvenanceRebackVerdict =
  | 'reproduced'
  | 'not-reproducible'
  | 'value-diverged'
  | 'already-observed';

export interface LeadPiProvenanceRebackPlan {
  field: 'school' | 'departments';
  verdict: LeadPiProvenanceRebackVerdict;
  value?: unknown;
}

/**
 * Whether the lane can independently re-derive the value it once wrote.
 *
 * Backing is established only on reproduction. Asserting the stored value because it is
 * stored would manufacture evidence for a value whose origin we cannot establish, which
 * is the one thing the corpus must never do, so a diverged or unreproducible value is
 * reported rather than stamped.
 */
export function planLeadPiProvenanceReback(input: {
  field: 'school' | 'departments';
  storedValue: unknown;
  rederived: { school?: string; department?: string };
  alreadyObserved: boolean;
}): LeadPiProvenanceRebackPlan {
  const { field, storedValue, rederived } = input;
  if (input.alreadyObserved) return { field, verdict: 'already-observed' };
  if (field === 'school') {
    if (!rederived.school) return { field, verdict: 'not-reproducible' };
    return typeof storedValue === 'string' && storedValue === rederived.school
      ? { field, verdict: 'reproduced', value: rederived.school }
      : { field, verdict: 'value-diverged' };
  }
  if (!rederived.department) return { field, verdict: 'not-reproducible' };
  const stored = Array.isArray(storedValue)
    ? storedValue.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return stored.includes(rederived.department)
    ? { field, verdict: 'reproduced', value: stored }
    : { field, verdict: 'value-diverged' };
}
