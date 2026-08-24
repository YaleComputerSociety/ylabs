/**
 * Pure helpers for the YIBS faculty-affiliates department leak backfill (#1427).
 *
 * The `dept-faculty-roster` scraper's `yibs` config stamped the institute's own
 * "Biospheric Studies" label onto every listed faculty affiliate as their
 * `departments`/`primaryDepartment`, overwriting each affiliate's real home
 * department (Mechanical Engineering, Epidemiology, Ecology and Evolutionary
 * Biology, ...) with the same cross-cutting institute label - the same
 * fabrication pattern as the `centers-institutes-index` leak this issue
 * originally reported. The scraper no longer emits these fields for the `yibs`
 * config, so this backfill restores the prior value from the affiliate's own
 * (non-YIBS) department observations, or clears the field when no such
 * observation exists.
 */
import { normalizeDeptToken } from './backfillCenterSeedDepartmentLeakCore';

export interface PlanPrimaryDepartmentReplacementInput {
  currentPrimaryDepartment: string | undefined;
  leaked: string;
  ownObserved: string[];
  latestOwnPrimaryDepartment: string | undefined;
  fallbackDepartments: string[];
}

export interface PlanPrimaryDepartmentReplacementResult {
  changed: boolean;
  to: string | undefined;
}

/**
 * Replace a scalar `primaryDepartment` only when it currently equals the
 * leaked institute label AND no other (non-leaking) observation independently
 * asserts that same label. Prefers the affiliate's own most recently observed
 * primary department; falls back to the first surviving `departments` entry;
 * clears the field (`to: undefined`) when neither is available.
 */
export function planPrimaryDepartmentReplacement(
  input: PlanPrimaryDepartmentReplacementInput,
): PlanPrimaryDepartmentReplacementResult {
  const current = (input.currentPrimaryDepartment || '').trim();
  if (!current || normalizeDeptToken(current) !== normalizeDeptToken(input.leaked)) {
    return { changed: false, to: input.currentPrimaryDepartment };
  }
  const ownSet = new Set(input.ownObserved.map(normalizeDeptToken));
  if (ownSet.has(normalizeDeptToken(input.leaked))) {
    return { changed: false, to: input.currentPrimaryDepartment };
  }
  const replacement = input.latestOwnPrimaryDepartment || input.fallbackDepartments[0];
  return { changed: true, to: replacement };
}
