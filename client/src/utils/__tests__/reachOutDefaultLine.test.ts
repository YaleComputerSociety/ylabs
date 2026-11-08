import { describe, expect, it } from 'vitest';
import {
  reachOutDefaultLine,
  reachOutDiscipline,
  reachOutLineParts,
  reachOutLineText,
} from '../reachOutDefaultLine';

const ROW_CLAIMS = /\b(open|hiring|accepting|will reply|take students)\b/i;

describe('reachOutDiscipline (#5297)', () => {
  it('defaults to lab wording with no department signal', () => {
    expect(reachOutDiscipline({ entityType: 'FACULTY_RESEARCH' })).toBe('lab');
  });

  it('keeps lab wording for a lab even in a social-science department', () => {
    expect(reachOutDiscipline({ entityType: 'LAB' }, 'Social Sciences')).toBe('lab');
  });

  it('keeps lab wording for any group-shaped research whatever its department', () => {
    for (const entityType of ['CENTER', 'INSTITUTE', 'INITIATIVE', 'FACULTY_PROJECT', undefined]) {
      expect(reachOutDiscipline({ entityType }, 'Social Sciences')).toBe('lab');
      expect(reachOutDiscipline({ entityType }, 'Humanities & Arts')).toBe('lab');
    }
  });

  it('reads social science and economics from the first department category', () => {
    expect(reachOutDiscipline({ entityType: 'FACULTY_RESEARCH' }, 'Social Sciences')).toBe(
      'socialScience',
    );
    expect(reachOutDiscipline({ entityType: 'FACULTY_RESEARCH' }, 'Economics')).toBe(
      'socialScience',
    );
  });

  it('reads humanities from the department category or the creative-practice flag', () => {
    expect(reachOutDiscipline({ entityType: 'FACULTY_RESEARCH' }, 'Humanities & Arts')).toBe(
      'humanities',
    );
    expect(reachOutDiscipline({ entityType: 'LAB', creativePractice: true }, 'Life Sciences')).toBe(
      'humanities',
    );
  });
});

describe('reachOutDefaultLine (#5297)', () => {
  it('names the lead email in the line itself, so it reads the same wherever the card sits', () => {
    expect(
      reachOutLineParts({
        entity: { entityType: 'LAB' },
        firstDepartmentCategory: 'Life Sciences',
        renderedContact: 'leadCardEmail',
        leadEmail: ' lead@example.test ',
      }),
    ).toEqual({
      lead: 'Most undergraduates get started by emailing the lead at ',
      contactLinkText: 'lead@example.test',
      rest: ': name one project from this page and any related coursework, and ask if they have room for an undergraduate this term or next.',
    });
  });

  it('links the official profile in the line rather than pointing at the card', () => {
    const parts = reachOutLineParts({
      entity: { entityType: 'FACULTY_RESEARCH' },
      firstDepartmentCategory: 'Computing & AI',
      renderedContact: 'leadCardProfile',
    });
    expect(parts.lead).toBe('Most undergraduates get started by emailing the professor through ');
    expect(parts.contactLinkText).toBe('their official profile');
    expect(reachOutLineText(parts)).not.toMatch(/on their card|below|above/);
  });

  it('never says address when the card shows only a profile', () => {
    const line = reachOutDefaultLine({
      entity: { entityType: 'FACULTY_RESEARCH' },
      firstDepartmentCategory: 'Computing & AI',
      renderedContact: 'leadCardProfile',
    });
    expect(line).toContain('the professor through their official profile');
    expect(line).not.toMatch(/address/);
  });

  it('never says official profile when the card shows an email', () => {
    const line = reachOutDefaultLine({
      entity: { entityType: 'FACULTY_RESEARCH' },
      firstDepartmentCategory: 'Economics',
      renderedContact: 'leadCardEmail',
    });
    expect(line).not.toMatch(/official profile/);
    expect(line).toContain('research-assistant or data work');
  });

  it('gives humanities rows essay and office-hours wording, never lab wording', () => {
    const line = reachOutDefaultLine({
      entity: { entityType: 'FACULTY_RESEARCH' },
      firstDepartmentCategory: 'Humanities & Arts',
      renderedContact: 'leadCardProfile',
    });
    expect(line).toBe(
      'Most undergraduates get started by emailing the professor through their official profile, or by going to their office hours: name a topic from this page and ask whether they would advise a senior essay or independent study on it.',
    );
    expect(line).not.toMatch(/room for an undergraduate|this term or next/);
  });

  it('never gives a lab senior-essay wording', () => {
    const line = reachOutDefaultLine({
      entity: { entityType: 'LAB' },
      renderedContact: 'pageAction',
    });
    expect(line).not.toMatch(/senior essay/);
    expect(line).toContain('through the link below');
  });

  it('makes no claim about the row and uses no em dash in any variant', () => {
    const contacts = [
      'leadCardEmail',
      'leadCardProfile',
      'pageAction',
      'directorySearch',
      'officialPages',
    ] as const;
    const categories = [undefined, 'Social Sciences', 'Humanities & Arts'];
    for (const renderedContact of contacts) {
      for (const firstDepartmentCategory of categories) {
        const line = reachOutDefaultLine({
          entity: { entityType: 'FACULTY_RESEARCH' },
          firstDepartmentCategory,
          renderedContact,
        });
        expect(line).not.toMatch(ROW_CLAIMS);
        expect(line).not.toContain('—');
        expect(line).not.toMatch(/\bPI\b/);
      }
    }
  });
});
