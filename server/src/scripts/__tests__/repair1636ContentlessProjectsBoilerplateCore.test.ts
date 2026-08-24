import { describe, expect, it } from 'vitest';
import {
  planContentlessProjectsBoilerplateRepair,
  type BoilerplateRepairObservation,
} from '../repair1636ContentlessProjectsBoilerplateCore';

const BOILERPLATE =
  'I have 3 research projects that are focused on fabrication, measurement, and/or theory, depending on student interest and experience.';
const SPECIFIC =
  'Dr. Konezny investigates experimental and theoretical studies of energy-relevant materials and charge transport.';

describe('planContentlessProjectsBoilerplateRepair (#1636)', () => {
  it('supersedes live boilerplate and reactivates the specific observation it buried', () => {
    const observations: BoilerplateRepairObservation[] = [
      {
        id: 'good',
        entityKey: 'dept-physics-steven-konezny',
        field: 'fullDescription',
        value: SPECIFIC,
        superseded: true,
        supersededBy: 'boiler',
      },
      {
        id: 'boiler',
        entityKey: 'dept-physics-steven-konezny',
        field: 'fullDescription',
        value: BOILERPLATE,
        superseded: false,
        supersededBy: null,
      },
    ];
    const plan = planContentlessProjectsBoilerplateRepair(observations);
    expect(plan.supersedeIds).toEqual(['boiler']);
    expect(plan.reactivateIds).toEqual(['good']);
    expect(plan.affectedEntityKeys).toEqual(['dept-physics-steven-konezny']);
  });

  it('never reactivates a boilerplate observation that another boilerplate superseded', () => {
    const observations: BoilerplateRepairObservation[] = [
      {
        id: 'old-boiler',
        entityKey: 'dept-physics-daisuke-nagai',
        field: 'fullDescription',
        value: BOILERPLATE,
        superseded: true,
        supersededBy: 'new-boiler',
      },
      {
        id: 'new-boiler',
        entityKey: 'dept-physics-daisuke-nagai',
        field: 'fullDescription',
        value: BOILERPLATE,
        superseded: false,
        supersededBy: null,
      },
    ];
    const plan = planContentlessProjectsBoilerplateRepair(observations);
    expect(plan.supersedeIds).toEqual(['new-boiler']);
    expect(plan.reactivateIds).toEqual([]);
  });

  it('is idempotent: already-superseded boilerplate yields an empty plan', () => {
    const observations: BoilerplateRepairObservation[] = [
      {
        id: 'good',
        entityKey: 'e',
        field: 'fullDescription',
        value: SPECIFIC,
        superseded: false,
        supersededBy: null,
      },
      {
        id: 'boiler',
        entityKey: 'e',
        field: 'fullDescription',
        value: BOILERPLATE,
        superseded: true,
        supersededBy: null,
      },
    ];
    const plan = planContentlessProjectsBoilerplateRepair(observations);
    expect(plan.supersedeIds).toEqual([]);
    expect(plan.reactivateIds).toEqual([]);
  });

  it('ignores non-prose fields', () => {
    const observations: BoilerplateRepairObservation[] = [
      { id: 'x', entityKey: 'e', field: 'name', value: BOILERPLATE, superseded: false, supersededBy: null },
    ];
    const plan = planContentlessProjectsBoilerplateRepair(observations);
    expect(plan.supersedeIds).toEqual([]);
  });
});
