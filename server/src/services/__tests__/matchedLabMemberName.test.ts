import { describe, expect, it } from 'vitest';
import { matchedLabMemberName } from '../researchGroupService';

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
