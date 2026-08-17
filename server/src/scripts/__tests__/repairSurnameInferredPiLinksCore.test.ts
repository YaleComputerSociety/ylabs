import { describe, it, expect } from 'vitest';
import {
  classifySurnameInferredPiMember,
  summarizeSurnameInferredPiClassifications,
} from '../repairSurnameInferredPiLinksCore';

const medicineDixit = {
  id: 'vishwa',
  firstName: 'Vishwa',
  lastName: 'Dixit',
  primaryDepartment: 'Comparative Medicine',
};
const engineeringDixit = {
  id: 'purushottam',
  firstName: 'Purushottam',
  lastName: 'Dixit',
  primaryDepartment: 'Biomedical Engineering',
};

describe('classifySurnameInferredPiMember', () => {
  it('keeps a surname-only link that is the unique medicine-department match', () => {
    const result = classifySurnameInferredPiMember({
      memberId: 'm1',
      entityId: 'e1',
      entitySlug: 'ysm-dixit',
      entityName: 'Dixit Lab',
      linkedUser: medicineDixit,
      sameSurnameFaculty: [medicineDixit, engineeringDixit],
    });

    expect(result.verdict).toBe('keep');
    expect(result.reason).toBe('unique_medicine_department_surname_match');
  });

  it('retires a surname-only link that points to a non-medicine same-surname person', () => {
    const result = classifySurnameInferredPiMember({
      memberId: 'm1',
      entityId: 'e1',
      entitySlug: 'ysm-dixit',
      entityName: 'Dixit Lab',
      linkedUser: engineeringDixit,
      sameSurnameFaculty: [medicineDixit, engineeringDixit],
    });

    expect(result.verdict).toBe('retire');
    expect(result.reason).toBe('surname_only_link_points_to_wrong_medicine_faculty');
    expect(result.correctedUserId).toBe('vishwa');
  });

  it('retires an ambiguous surname-only link across multiple medicine faculty', () => {
    const otherMedicineDixit = { ...engineeringDixit, primaryDepartment: 'Internal Medicine' };
    const result = classifySurnameInferredPiMember({
      memberId: 'm1',
      entityId: 'e1',
      entityName: 'Dixit Lab',
      linkedUser: medicineDixit,
      sameSurnameFaculty: [medicineDixit, otherMedicineDixit],
    });

    expect(result.verdict).toBe('retire');
    expect(result.reason).toBe('surname_only_link_is_ambiguous_across_medicine_faculty');
  });

  it('retires a surname-only link when no same-surname person is in a medicine department', () => {
    const result = classifySurnameInferredPiMember({
      memberId: 'm1',
      entityId: 'e1',
      entityName: 'Dixit Lab',
      linkedUser: engineeringDixit,
      sameSurnameFaculty: [engineeringDixit],
    });

    expect(result.verdict).toBe('retire');
    expect(result.reason).toBe('surname_only_link_has_no_medicine_department_match');
  });

  it('keeps a link whose lab-name full name matches the linked person', () => {
    const result = classifySurnameInferredPiMember({
      memberId: 'm1',
      entityId: 'e1',
      entityName: 'Vishwa Dixit Lab',
      linkedUser: medicineDixit,
      sameSurnameFaculty: [medicineDixit, engineeringDixit],
    });

    expect(result.verdict).toBe('keep');
    expect(result.reason).toBe('lab_name_full_name_matches_linked_pi');
  });

  it('retires a link whose lab-name first name differs from the linked person', () => {
    const result = classifySurnameInferredPiMember({
      memberId: 'm1',
      entityId: 'e1',
      entityName: 'Purushottam Dixit Lab',
      linkedUser: medicineDixit,
      sameSurnameFaculty: [medicineDixit, engineeringDixit],
    });

    expect(result.verdict).toBe('retire');
    expect(result.reason).toBe('lab_name_first_name_differs_from_linked_pi');
  });

  it('retires a link whose surname does not match the lab name surname', () => {
    const result = classifySurnameInferredPiMember({
      memberId: 'm1',
      entityId: 'e1',
      entityName: 'Arnsten Lab',
      linkedUser: medicineDixit,
      sameSurnameFaculty: [medicineDixit],
    });

    expect(result.verdict).toBe('retire');
    expect(result.reason).toBe('linked_pi_surname_differs_from_lab_name_surname');
  });

  it('retires a PI member with no resolvable user', () => {
    const result = classifySurnameInferredPiMember({
      memberId: 'm1',
      entityId: 'e1',
      entityName: 'Dixit Lab',
      linkedUser: null,
      sameSurnameFaculty: [],
    });

    expect(result.verdict).toBe('retire');
    expect(result.reason).toBe('pi_member_has_no_resolvable_user');
  });

  it('keeps a link when the entity name yields no surname hint', () => {
    const result = classifySurnameInferredPiMember({
      memberId: 'm1',
      entityId: 'e1',
      entityName: '3D imaging center',
      linkedUser: medicineDixit,
      sameSurnameFaculty: [medicineDixit],
    });

    expect(result.verdict).toBe('keep');
    expect(result.reason).toBe('entity_name_yields_no_surname_hint');
  });
});

describe('summarizeSurnameInferredPiClassifications', () => {
  it('counts keep and retire verdicts by reason', () => {
    const summary = summarizeSurnameInferredPiClassifications([
      { memberId: 'a', entityId: 'e', verdict: 'keep', reason: 'unique_medicine_department_surname_match' },
      { memberId: 'b', entityId: 'e', verdict: 'retire', reason: 'surname_only_link_points_to_wrong_medicine_faculty' },
      { memberId: 'c', entityId: 'e', verdict: 'retire', reason: 'surname_only_link_points_to_wrong_medicine_faculty' },
      { memberId: 'd', entityId: 'e', verdict: 'retire', reason: 'surname_only_link_is_ambiguous_across_medicine_faculty' },
    ]);

    expect(summary).toEqual({
      total: 4,
      keep: 1,
      retire: 3,
      retireByReason: {
        surname_only_link_points_to_wrong_medicine_faculty: 2,
        surname_only_link_is_ambiguous_across_medicine_faculty: 1,
      },
    });
  });
});
