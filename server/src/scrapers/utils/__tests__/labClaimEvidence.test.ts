import { describe, expect, it } from 'vitest';
import { evidenceAssertsALab, personScopedResearchRecordIdentity } from '../labClaimEvidence';

describe('evidenceAssertsALab', () => {
  it('accepts evidence that uses the word', () => {
    expect(evidenceAssertsALab('Quimby Lab')).toBe(true);
    expect(evidenceAssertsALab('Quimby Laboratory')).toBe(true);
    expect(evidenceAssertsALab('Quimby Research Group')).toBe(true);
    expect(evidenceAssertsALab('Quimby Research-Group')).toBe(true);
  });

  it('accepts a URL that names a lab', () => {
    expect(evidenceAssertsALab('Robin Quimby', 'https://quimbylab.yale.edu/')).toBe(true);
    expect(evidenceAssertsALab('Robin Quimby', 'https://example.edu/lab-quimby')).toBe(true);
  });

  it('refuses a bare person name, which is what a grant record and a page heading give', () => {
    expect(evidenceAssertsALab('Robin Quimby')).toBe(false);
    expect(evidenceAssertsALab('Robin Quimby', 'https://reporter.nih.gov/project-details/1')).toBe(
      false,
    );
    expect(evidenceAssertsALab('Robin Quimby', 'https://api.nsf.gov/services/v1/awards.json')).toBe(
      false,
    );
  });

  it('refuses empty and absent evidence rather than defaulting to a lab', () => {
    expect(evidenceAssertsALab()).toBe(false);
    expect(evidenceAssertsALab('')).toBe(false);
    expect(evidenceAssertsALab(null, undefined, '   ')).toBe(false);
  });
});

describe('personScopedResearchRecordIdentity', () => {
  it('names a lab only when the evidence asserts one', () => {
    expect(personScopedResearchRecordIdentity('Robin Quimby', true)).toEqual({
      name: 'Robin Quimby Lab',
      kind: 'lab',
      entityType: 'LAB',
    });
  });

  it('names a faculty research record otherwise, and types it to match', () => {
    expect(personScopedResearchRecordIdentity('Robin Quimby', false)).toEqual({
      name: 'Robin Quimby Faculty Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
    });
  });

  it('never returns a name that asserts a lab alongside a person-scoped type', () => {
    for (const assertsALab of [true, false]) {
      const identity = personScopedResearchRecordIdentity('Robin Quimby', assertsALab);
      const nameAssertsALab = /\bLab$/.test(identity.name);
      expect(nameAssertsALab).toBe(identity.entityType === 'LAB');
      expect(nameAssertsALab).toBe(identity.kind === 'lab');
    }
  });
});
