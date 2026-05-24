import { describe, expect, it } from 'vitest';
import {
  classifyResearchPersonRole,
  canOwnResearchEntity,
  canSurfaceAsContactRoute,
  canSurfaceAsMember,
} from '../roleClassifier';

describe('roleClassifier', () => {
  it('allows professor and PI-like roles to own research entities', () => {
    for (const title of [
      'Assistant Professor of Computer Science',
      'Associate Professor of Psychology',
      'Professor of Molecular Biology',
      'Principal Investigator',
      'Faculty Director',
      'Director of the Lab',
    ]) {
      const role = classifyResearchPersonRole(title);
      expect(role.category).toBe('pi');
      expect(canOwnResearchEntity(role)).toBe(true);
    }
  });

  it('blocks students, postdocs, lab managers, and administrative roles from owning labs', () => {
    for (const title of [
      'PhD Student',
      'Graduate Student',
      'Doctoral Candidate',
      'Postdoctoral Associate',
      'Postdoctoral Fellow',
      'Lab Manager',
      'Senior Administrative Assistant',
      'Administrative Assistant',
      'Program Coordinator',
      'Operations Manager',
    ]) {
      const role = classifyResearchPersonRole(title);
      expect(canOwnResearchEntity(role)).toBe(false);
    }
  });

  it('classifies representative blocked roles without contact routes or ownership', () => {
    for (const [title, category, memberRole] of [
      ['Postdoctoral Associate', 'postdoc', 'postdoc'],
      ['Administrative Assistant', 'admin', 'staff'],
      ['Program Coordinator', 'admin', 'staff'],
      ['Operations Manager', 'admin', 'staff'],
    ] as const) {
      const role = classifyResearchPersonRole(title);
      expect(role.category).toBe(category);
      expect(role.memberRole).toBe(memberRole);
      expect(role.contactRouteType).toBeUndefined();
      expect(canSurfaceAsMember(role)).toBe(true);
      expect(canSurfaceAsContactRoute(role)).toBe(false);
      expect(canOwnResearchEntity(role)).toBe(false);
    }
  });

  it('does not let ambiguous administrative director or faculty-affairs titles own labs', () => {
    for (const title of [
      'Director of Operations',
      'Administrative Director',
      'Assistant Director',
      'Assistant Director of the Lab',
      'Program Director',
      'Faculty Affairs Coordinator',
    ]) {
      const role = classifyResearchPersonRole(title);
      expect(role.category).toBe('admin');
      expect(role.memberRole).toBe('staff');
      expect(role.contactRouteType).toBeUndefined();
      expect(canOwnResearchEntity(role)).toBe(false);
      expect(canSurfaceAsContactRoute(role)).toBe(false);
    }
  });

  it('does not let generic research scientist titles own labs', () => {
    const role = classifyResearchPersonRole('Research Scientist');
    expect(role.category).toBe('unknown');
    expect(role.memberRole).toBeUndefined();
    expect(role.contactRouteType).toBeUndefined();
    expect(canSurfaceAsMember(role)).toBe(false);
    expect(canSurfaceAsContactRoute(role)).toBe(false);
    expect(canOwnResearchEntity(role)).toBe(false);
  });

  it('keeps postdoctoral research scientists as postdocs only', () => {
    const role = classifyResearchPersonRole('Postdoctoral Research Scientist');
    expect(role.category).toBe('postdoc');
    expect(role.memberRole).toBe('postdoc');
    expect(role.contactRouteType).toBeUndefined();
    expect(canSurfaceAsMember(role)).toBe(true);
    expect(canSurfaceAsContactRoute(role)).toBe(false);
    expect(canOwnResearchEntity(role)).toBe(false);
  });

  it('keeps graduate student research scientists as students only', () => {
    const role = classifyResearchPersonRole('Graduate Student Research Scientist');
    expect(role.category).toBe('student');
    expect(role.memberRole).toBe('grad-student');
    expect(role.contactRouteType).toBeUndefined();
    expect(canSurfaceAsMember(role)).toBe(true);
    expect(canSurfaceAsContactRoute(role)).toBe(false);
    expect(canOwnResearchEntity(role)).toBe(false);
  });

  it('keeps lab managers as contactable staff but not owners', () => {
    const role = classifyResearchPersonRole('Lab Manager');
    expect(role.category).toBe('lab-manager');
    expect(role.memberRole).toBe('staff');
    expect(role.contactRouteType).toBe('LAB_MANAGER');
    expect(canSurfaceAsMember(role)).toBe(true);
    expect(canSurfaceAsContactRoute(role)).toBe(true);
    expect(canOwnResearchEntity(role)).toBe(false);
  });

  it('keeps PhD students as members only', () => {
    const role = classifyResearchPersonRole('PhD Student');
    expect(role.category).toBe('student');
    expect(role.memberRole).toBe('grad-student');
    expect(canSurfaceAsMember(role)).toBe(true);
    expect(canSurfaceAsContactRoute(role)).toBe(false);
    expect(canOwnResearchEntity(role)).toBe(false);
  });

  it('treats empty or unknown roles conservatively', () => {
    const role = classifyResearchPersonRole('');
    expect(role.category).toBe('unknown');
    expect(canOwnResearchEntity(role)).toBe(false);
    expect(canSurfaceAsContactRoute(role)).toBe(false);
  });

  it('treats non-empty unknown roles conservatively', () => {
    const role = classifyResearchPersonRole('Visiting Scholar');
    expect(role.category).toBe('unknown');
    expect(role.memberRole).toBeUndefined();
    expect(role.contactRouteType).toBeUndefined();
    expect(canSurfaceAsMember(role)).toBe(false);
    expect(canOwnResearchEntity(role)).toBe(false);
    expect(canSurfaceAsContactRoute(role)).toBe(false);
  });
});
