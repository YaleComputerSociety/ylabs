import { describe, expect, it } from 'vitest';

import { buildResearchEntityPublicDescriptionRepresentation } from '../researchEntityPublicDescription';
import {
  BIOGRAPHY_WITHOUT_RESEARCH_REASON,
  CAREER_BIOGRAPHY_WITHOUT_RESEARCH_REASON,
  computeResearchEntityStudentVisibility,
  isStudentReadyHardBlockerReason,
} from '../studentVisibilityTier';
import { isBlockingVisibilityReason } from '../studentVisibilityGateService';

const CAREER_BIOGRAPHY =
  'Sam Example has previously taught at Example College. She enjoys exploring the outdoors.';
const CAREER_CARD = 'Professor at Synthetic University since 2001.';
const HOSPITALIST_BIOGRAPHY =
  'Sam Example, MD, is a board-certified hospitalist physician who currently serves as the Unit Medical Director of the Synthetic Cardiology Unit, and concurrently serves as an Assistant Clinical Professor in the Department of Medicine.';
const RESEARCH_CARD =
  'Studies hospital medicine quality improvement and cardiology unit care delivery.';

const leadMembers = [
  { role: 'pi', userId: 'fixture-lead', user: { fname: 'Sam', lname: 'Example' } },
];

const facultyRow = (overrides: Record<string, any>): Record<string, any> => ({
  _id: 'fixture-career-biography-hold',
  slug: 'fixture-career-biography-hold',
  name: 'Sam Example Faculty Research',
  kind: 'individual',
  entityType: 'FACULTY_RESEARCH_AREA',
  researchAreas: [],
  sourceUrls: ['https://example.edu/fixture-career-biography-hold'],
  activeAtYaleCache: true,
  ...overrides,
});

const verdictFor = (entity: Record<string, any>) =>
  computeResearchEntityStudentVisibility({
    entity,
    leadMembers,
    accessSignalCount: 1,
    actionablePathwayCount: 1,
  });

const servedBodyOf = (entity: Record<string, any>): string =>
  buildResearchEntityPublicDescriptionRepresentation({ entity, leadMembers }).fullDescription;

describe('a row whose only description is a career biography with no research (#4928)', () => {
  const biographyOnly = facultyRow({
    fullDescription: CAREER_BIOGRAPHY,
    shortDescription: CAREER_CARD,
  });

  it('is held out of student_ready under its own reason, not suppressed', () => {
    const verdict = verdictFor(biographyOnly);

    expect(verdict.reasons).toContain(CAREER_BIOGRAPHY_WITHOUT_RESEARCH_REASON);
    expect(verdict.reasons).not.toContain(BIOGRAPHY_WITHOUT_RESEARCH_REASON);
    expect(verdict.tier).toBe('operator_review');
  });

  it('is held when its only field-naming sentence is a service appointment', () => {
    const verdict = verdictFor(
      facultyRow({
        fullDescription:
          'Sam Example has previously taught at Example College. She is a former Associate Editor at the Review of Synthetic Studies and Management Science and member of the Synthetic Reserve Advisory Round Table.',
        shortDescription: CAREER_CARD,
      }),
    );

    expect(verdict.reasons).toContain(CAREER_BIOGRAPHY_WITHOUT_RESEARCH_REASON);
    expect(verdict.tier).toBe('operator_review');
  });

  it('is a hard blocker the gate treats as blocking', () => {
    expect(isStudentReadyHardBlockerReason(CAREER_BIOGRAPHY_WITHOUT_RESEARCH_REASON)).toBe(true);
    expect(isBlockingVisibilityReason(CAREER_BIOGRAPHY_WITHOUT_RESEARCH_REASON)).toBe(true);
  });

  it('returns the row once research evidence exists, because the hold is re-derived', () => {
    const verdict = verdictFor({
      ...biographyOnly,
      fullDescription: `${CAREER_BIOGRAPHY} Her research examines how hiking trails reshape alpine plant communities.`,
    });

    expect(verdict.reasons).not.toContain(CAREER_BIOGRAPHY_WITHOUT_RESEARCH_REASON);
  });
});

describe('a row with research text the serve chain serves is not held for its biography', () => {
  it('serves a thin research line body', () => {
    const entity = facultyRow({
      fullDescription: 'Studies hospital medicine.',
      shortDescription: 'Studies hospital medicine.',
      researchAreas: ['Hospital Medicine'],
    });

    expect(verdictFor(entity).reasons).not.toContain(CAREER_BIOGRAPHY_WITHOUT_RESEARCH_REASON);
    expect(verdictFor(entity).tier).toBe('student_ready');
  });

  it('serves a research card in place of a biography body', () => {
    const entity = facultyRow({
      fullDescription: HOSPITALIST_BIOGRAPHY,
      shortDescription: RESEARCH_CARD,
    });

    expect(servedBodyOf(entity)).toBe(RESEARCH_CARD);
    expect(verdictFor(entity).reasons).not.toContain(CAREER_BIOGRAPHY_WITHOUT_RESEARCH_REASON);
    expect(verdictFor(entity).tier).toBe('student_ready');
  });

  it('serves a topics-derived research line in place of a biography body', () => {
    const entity = facultyRow({
      fullDescription: HOSPITALIST_BIOGRAPHY,
      shortDescription: '',
      researchAreas: ['Hospital Medicine'],
    });

    expect(servedBodyOf(entity)).toMatch(/^Studies hospital medicine\.$/i);
    expect(verdictFor(entity).reasons).not.toContain(CAREER_BIOGRAPHY_WITHOUT_RESEARCH_REASON);
    expect(verdictFor(entity).tier).toBe('student_ready');
  });

  it('is not held when the biography body states its research later', () => {
    const entity = facultyRow({
      fullDescription: `${HOSPITALIST_BIOGRAPHY} Her research examines quality improvement in cardiology unit care delivery.`,
      shortDescription: '',
      researchAreas: ['Hospital Medicine'],
    });

    expect(verdictFor(entity).reasons).not.toContain(CAREER_BIOGRAPHY_WITHOUT_RESEARCH_REASON);
    expect(verdictFor(entity).tier).toBe('student_ready');
  });
});
