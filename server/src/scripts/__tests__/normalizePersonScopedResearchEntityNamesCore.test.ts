import { describe, expect, it } from 'vitest';
import {
  personScopedNamePlanIsEmpty,
  planPersonScopedNameNormalization,
} from '../normalizePersonScopedResearchEntityNamesCore';

describe('planPersonScopedNameNormalization', () => {
  it('plans the roster-convention rename for a bare person name on both name fields', () => {
    const plan = planPersonScopedNameNormalization({
      entityType: 'LAB',
      kind: 'lab',
      name: 'Robin Roster',
      displayName: 'Robin Roster',
    });
    expect(plan.renames).toEqual([
      { field: 'name', from: 'Robin Roster', to: 'Robin Roster Lab' },
      { field: 'displayName', from: 'Robin Roster', to: 'Robin Roster Lab' },
    ]);
    expect(plan.regateForUnusableName).toBe(false);
  });

  it('settles empty on a second run, because it reads the stored value not a recorded plan', () => {
    const first = planPersonScopedNameNormalization({
      entityType: 'FACULTY_RESEARCH_AREA',
      name: 'Rafferty Duchamp',
    });
    expect(first.renames).toHaveLength(1);
    const second = planPersonScopedNameNormalization({
      entityType: 'FACULTY_RESEARCH_AREA',
      name: first.renames[0].to,
    });
    expect(personScopedNamePlanIsEmpty(second)).toBe(true);
  });

  it('plans a re-gate and no rename for a name nothing derives a research record from', () => {
    const plan = planPersonScopedNameNormalization({
      entityType: 'FACULTY_RESEARCH_AREA',
      name: 'Rutherford Grange Professor of Economics',
    });
    expect(plan.renames).toEqual([]);
    expect(plan.regateForUnusableName).toBe(true);
  });

  it('reports a locked field as skipped rather than writing through the lock', () => {
    const plan = planPersonScopedNameNormalization({
      entityType: 'LAB',
      name: 'Robin Roster',
      manuallyLockedFields: ['name'],
    });
    expect(plan.renames).toEqual([]);
    expect(plan.skippedLockedFields).toEqual(['name']);
  });

  it('plans the suffix a retype left stale on a LAB row (#3252)', () => {
    const plan = planPersonScopedNameNormalization({
      entityType: 'LAB',
      kind: 'lab',
      name: 'Robin Roster Faculty Research',
      displayName: 'Robin Roster Faculty Research',
    });
    expect(plan.renames).toEqual([
      { field: 'name', from: 'Robin Roster Faculty Research', to: 'Robin Roster Lab' },
      { field: 'displayName', from: 'Robin Roster Faculty Research', to: 'Robin Roster Lab' },
    ]);
  });

  it('plans nothing for a person-scoped row whose name carries the lab suffix (#3252)', () => {
    expect(
      personScopedNamePlanIsEmpty(
        planPersonScopedNameNormalization({
          entityType: 'FACULTY_RESEARCH_AREA',
          kind: 'individual',
          name: 'Robin Roster Lab',
        }),
      ),
    ).toBe(true);
  });

  it('plans nothing for an organization-shaped record or a branded research name', () => {
    expect(
      personScopedNamePlanIsEmpty(
        planPersonScopedNameNormalization({ entityType: 'CENTER', name: 'Robin Roster' }),
      ),
    ).toBe(true);
    expect(
      personScopedNamePlanIsEmpty(
        planPersonScopedNameNormalization({ entityType: 'LAB', name: 'The Cogitorium' }),
      ),
    ).toBe(true);
  });
});
