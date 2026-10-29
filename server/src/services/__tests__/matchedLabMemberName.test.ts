import { describe, expect, it } from 'vitest';
import { matchedLabMember, matchedLabMemberName } from '../researchGroupService';

const names = {
  leadProfessorNames: ['Robin Fixture'],
  professorNames: ['Robin Fixture', 'Casey Example', 'Jordan Q. Sample'],
};

describe('matchedLabMemberName', () => {
  it('names the member every query word belongs to', () => {
    expect(matchedLabMemberName('Casey Example', names)).toBe('Casey Example');
    expect(matchedLabMemberName('casey  EXAMPLE', names)).toBe('Casey Example');
    expect(matchedLabMemberName('Jordan Sample', names)).toBe('Jordan Q. Sample');
  });

  it('never marks a lead on the row they lead', () => {
    expect(matchedLabMemberName('Robin Fixture', names)).toBeUndefined();
  });

  it('needs a whole name, so a lone surname or a topic word claims nobody', () => {
    expect(matchedLabMemberName('Example', names)).toBeUndefined();
    expect(matchedLabMemberName('Casey neuroscience', names)).toBeUndefined();
    expect(matchedLabMemberName('autism research', names)).toBeUndefined();
  });

  it('does not join words across two members', () => {
    expect(matchedLabMemberName('Casey Sample', names)).toBeUndefined();
  });
});

describe('matchedLabMember', () => {
  const members = {
    leadProfessorNames: ['Robin Fixture'],
    members: [
      { name: 'Casey Example', role: 'core-faculty' as const },
      { name: 'Avery Postdoc-Sample', role: 'postdoc' as const },
      { name: 'Morgan Undergrad', role: 'undergrad' as const },
      { name: 'Riley Alumna', role: 'past-undergrad' as const },
    ],
  };

  it('names a student or postdoc with the role the lab page lists them under', () => {
    expect(matchedLabMember('Morgan Undergrad', members)).toEqual({
      name: 'Morgan Undergrad',
      role: 'undergrad',
    });
    expect(matchedLabMember('riley alumna', members)?.role).toBe('past-undergrad');
    expect(matchedLabMember('Avery Postdoc Sample', members)?.role).toBe('postdoc');
  });

  it('still needs a whole name for a student', () => {
    expect(matchedLabMember('Morgan', members)).toBeUndefined();
  });
});
