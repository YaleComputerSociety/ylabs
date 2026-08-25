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

const activeYaleFacultyEmeritusElsewhereEntity = {
  name: 'Stephen Darwall - Research',
  shortDescription: 'Studies moral philosophy, second-personal ethics, and moral reasoning.',
  fullDescription:
    'Stephen Darwall is the Andrew Downey Orrick Professor of Philosophy at Yale University and the John Dewey Distinguished University Professor Emeritus at the University of Michigan. His research interests include moral philosophy, particularly second-personal ethics.',
  sourceUrls: ['https://philosophy.yale.edu/faculty'],
  activeAtYaleCache: true,
  yaleStatusCache: 'unknown',
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

  it('does not flag active Yale faculty who hold emeritus status at another institution', () => {
    expect(deriveResearchEntityYaleStatus(activeYaleFacultyEmeritusElsewhereEntity)).toBeNull();

    const result = computeResearchEntityStudentVisibility({
      entity: activeYaleFacultyEmeritusElsewhereEntity,
      leadMembers: [{ userId: 'user-2', role: 'pi' }],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
    });

    expect(result.reasons).not.toContain('inactive_at_yale');
    expect(result.tier).toBe('student_ready');
  });
});
