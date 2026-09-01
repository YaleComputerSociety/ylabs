import { describe, expect, it } from 'vitest';
import { actionablePlanningUrl } from '../planningContextService';

describe('planningContextService qualification policy', () => {
  it.each([
    'https://research.yale.edu/apply',
    'https://research.yale.edu/programs/summer-fellowship',
    'https://research.yale.edu/opportunities/undergraduate-research',
    'https://research.yale.edu/get-involved/participation?registration=open',
  ])('accepts actionable planning destination %s', (url) => {
    expect(actionablePlanningUrl(url)).toBe(url);
  });

  it.each([
    'https://medicine.yale.edu/profile/person',
    'https://research.yale.edu/labs/neuroscience',
    'https://research.yale.edu/publications/applications-of-ai',
    'https://research.yale.edu/grants/program-evaluation',
    'https://research.yale.edu/team/members',
    'https://research.yale.edu/faculty-directory',
    'https://research.yale.edu/about',
  ])('rejects provenance-only planning destination %s', (url) => {
    expect(actionablePlanningUrl(url)).toBeUndefined();
  });

  it('requires a positive actionable cue', () => {
    expect(actionablePlanningUrl('https://research.yale.edu/undergraduate')).toBeUndefined();
  });

  it('ignores positive cues in tracking parameters', () => {
    expect(
      actionablePlanningUrl('https://research.yale.edu/?utm_campaign=summer-program'),
    ).toBeUndefined();
  });
});
