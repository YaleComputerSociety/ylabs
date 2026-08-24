import { describe, expect, it } from 'vitest';
import { planPrimaryDepartmentReplacement } from '../backfillYibsAffiliateDepartmentLeakCore';

const LEAKED = 'Biospheric Studies';

describe('planPrimaryDepartmentReplacement', () => {
  it('leaves an unaffected primaryDepartment unchanged', () => {
    const result = planPrimaryDepartmentReplacement({
      currentPrimaryDepartment: 'Mechanical Engineering',
      leaked: LEAKED,
      ownObserved: [],
      latestOwnPrimaryDepartment: undefined,
      fallbackDepartments: [],
    });
    expect(result).toEqual({ changed: false, to: 'Mechanical Engineering' });
  });

  it('keeps the leaked value when independently corroborated by the user own observations', () => {
    const result = planPrimaryDepartmentReplacement({
      currentPrimaryDepartment: LEAKED,
      leaked: LEAKED,
      ownObserved: ['Biospheric Studies'],
      latestOwnPrimaryDepartment: undefined,
      fallbackDepartments: [],
    });
    expect(result).toEqual({ changed: false, to: LEAKED });
  });

  it('restores the most recent own primaryDepartment observation', () => {
    const result = planPrimaryDepartmentReplacement({
      currentPrimaryDepartment: LEAKED,
      leaked: LEAKED,
      ownObserved: ['Mechanical Engineering'],
      latestOwnPrimaryDepartment: 'Mechanical Engineering',
      fallbackDepartments: ['Mechanical Engineering'],
    });
    expect(result).toEqual({ changed: true, to: 'Mechanical Engineering' });
  });

  it('falls back to the first surviving department when no own primaryDepartment observation exists', () => {
    const result = planPrimaryDepartmentReplacement({
      currentPrimaryDepartment: LEAKED,
      leaked: LEAKED,
      ownObserved: [],
      latestOwnPrimaryDepartment: undefined,
      fallbackDepartments: ['Epidemiology'],
    });
    expect(result).toEqual({ changed: true, to: 'Epidemiology' });
  });

  it('clears the field when there is no own evidence at all', () => {
    const result = planPrimaryDepartmentReplacement({
      currentPrimaryDepartment: LEAKED,
      leaked: LEAKED,
      ownObserved: [],
      latestOwnPrimaryDepartment: undefined,
      fallbackDepartments: [],
    });
    expect(result).toEqual({ changed: true, to: undefined });
  });
});
