import { describe, expect, it } from 'vitest';

import {
  programDeadlineIsSettled,
  programSettledStageBadge,
  researchPlanStageLabel,
  researchPlanStageOptions,
  researchPlanStages,
} from '../researchPlanStages';

describe('researchPlanStages', () => {
  it('keeps every stored stage valid and ranks the results after Applied and before Closed', () => {
    expect(researchPlanStages).toEqual([
      'SAVED',
      'EXPLORING',
      'PREPARING',
      'CONTACTED',
      'APPLIED',
      'AWARDED',
      'NOT_SELECTED',
      'CLOSED',
    ]);
  });

  it('offers the outreach stages on research and the application stages on programs', () => {
    expect(researchPlanStageOptions('research')).toEqual([
      'SAVED',
      'EXPLORING',
      'PREPARING',
      'CONTACTED',
      'APPLIED',
      'CLOSED',
    ]);
    expect(researchPlanStageOptions('program')).toEqual([
      'SAVED',
      'PREPARING',
      'APPLIED',
      'AWARDED',
      'NOT_SELECTED',
      'CLOSED',
    ]);
  });

  it('keeps a stored stage outside the surface listed in its pipeline position', () => {
    expect(researchPlanStageOptions('program', 'CONTACTED')).toEqual([
      'SAVED',
      'PREPARING',
      'CONTACTED',
      'APPLIED',
      'AWARDED',
      'NOT_SELECTED',
      'CLOSED',
    ]);
    expect(researchPlanStageOptions('research', 'AWARDED')).toContain('AWARDED');
  });

  it('labels Closed as no longer applying on programs only', () => {
    expect(researchPlanStageLabel('CLOSED')).toBe('Closed');
    expect(researchPlanStageLabel('CLOSED', 'research')).toBe('Closed');
    expect(researchPlanStageLabel('CLOSED', 'program')).toBe('No longer applying');
    expect(researchPlanStageLabel('NOT_SELECTED', 'program')).toBe('Not selected');
    expect(researchPlanStageLabel('AWARDED', 'program')).toBe('Awarded');
  });

  it('treats Applied, both results, and Closed as a settled program deadline', () => {
    expect(['APPLIED', 'AWARDED', 'NOT_SELECTED', 'CLOSED'].map(programDeadlineIsSettled)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(['SAVED', 'PREPARING', 'EXPLORING', 'CONTACTED'].map(programDeadlineIsSettled)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(programSettledStageBadge('CLOSED')?.label).toBe('No longer applying');
    expect(programSettledStageBadge('AWARDED')?.label).toBe('Awarded');
    expect(programSettledStageBadge('PREPARING')).toBeUndefined();
  });
});
