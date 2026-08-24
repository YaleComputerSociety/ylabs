import { describe, expect, it } from 'vitest';
import { computeResearchEntityStudentVisibility } from '../studentVisibilityTier';
import { deriveResearchEntityYaleStatus } from '../../utils/researchEntityYaleStatus';

const otherwiseStudentReadyEntity = {
  name: 'Claude Rawson Research',
  shortDescription:
    'Studies eighteenth-century English literature, satire, and the works of Jonathan Swift.',
  fullDescription:
    'Claude Rawson, Professor Emeritus of English, studies eighteenth-century English literature, satire, and the works of Jonathan Swift. Current projects examine the reception of Swift among later satirists.',
  sourceUrls: ['https://english.yale.edu/people/professors-emeritus/claude-rawson'],
  activeAtYaleCache: true,
  yaleStatusCache: 'unknown',
};

const otherwiseStudentReadyDeceasedEntity = {
  ...otherwiseStudentReadyEntity,
  displayName: 'Pierre Demarque',
  fullDescription:
    'Pierre R. Demarque (1932 - 2025), Munson Professor of Astronomy, studied stellar evolution. Current projects, continued by former students, examine globular cluster ages.',
  sourceUrls: ['https://astronomy.yale.edu/people/pierre-demarque-1932-2025'],
};

describe('activeAtYaleCache producer gates studentVisibilityTier to suppressed', () => {
  it('would otherwise be student_ready before the yale-status signal is applied', () => {
    const before = computeResearchEntityStudentVisibility({
      entity: otherwiseStudentReadyEntity,
      leadMembers: [{ userId: 'user-1', role: 'pi' }],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
    });

    expect(before.tier).toBe('student_ready');
  });

  it('gates an emeritus-marked entity to suppressed once the derived signal is applied', () => {
    const signal = deriveResearchEntityYaleStatus(otherwiseStudentReadyEntity);
    expect(signal).toEqual({
      yaleStatusCache: 'departed',
      activeAtYaleCache: false,
      reason: 'emeritus',
    });

    const after = computeResearchEntityStudentVisibility({
      entity: {
        ...otherwiseStudentReadyEntity,
        yaleStatusCache: signal!.yaleStatusCache,
        activeAtYaleCache: signal!.activeAtYaleCache,
      },
      leadMembers: [{ userId: 'user-1', role: 'pi' }],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
    });

    expect(after.tier).toBe('suppressed');
    expect(after.computedTier).toBe('suppressed');
    expect(after.reasons).toContain('inactive_at_yale');
  });

  it('gates a deceased-lead entity to suppressed once the derived signal is applied', () => {
    const signal = deriveResearchEntityYaleStatus(otherwiseStudentReadyDeceasedEntity);
    expect(signal).toEqual({
      yaleStatusCache: 'departed',
      activeAtYaleCache: false,
      reason: 'deceased',
    });

    const after = computeResearchEntityStudentVisibility({
      entity: {
        ...otherwiseStudentReadyDeceasedEntity,
        yaleStatusCache: signal!.yaleStatusCache,
        activeAtYaleCache: signal!.activeAtYaleCache,
      },
      leadMembers: [{ userId: 'user-1', role: 'pi' }],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
    });

    expect(after.tier).toBe('suppressed');
    expect(after.reasons).toContain('inactive_at_yale');
  });
});
