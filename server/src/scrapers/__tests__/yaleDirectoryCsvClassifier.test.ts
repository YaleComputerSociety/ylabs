import { describe, expect, it } from 'vitest';
import { classifyDirectoryCsvRow } from '../sources/yaleDirectoryCsvClassifier';

describe('classifyDirectoryCsvRow', () => {
  it('auto-accepts clear academic research people', () => {
    const result = classifyDirectoryCsvRow({
      netid: 'fixturehist001',
      name: 'Historian, Ada',
      firstName: 'Ada',
      lastName: 'Historian',
      title: 'Assistant Professor of History',
      department: 'FASHIS History',
      departmentUnit: 'FASHIS History',
      school: 'Faculty of Arts and Sciences',
      schoolCode: 'FAS',
      physicalLocation: '',
    });

    expect(result.decision).toBe('AUTO_RESEARCH_PERSON');
    expect(result.reasons).toEqual(expect.arrayContaining(['faculty-title', 'academic-unit']));
  });

  it('suppresses operational noise', () => {
    const result = classifyDirectoryCsvRow({
      netid: 'fixtureops001',
      name: 'Worker, Casey',
      firstName: 'Casey',
      lastName: 'Worker',
      title: 'Custodian',
      department: 'Facilities',
      departmentUnit: 'Facilities Operations',
      school: '',
      schoolCode: '',
      physicalLocation: '',
    });

    expect(result.decision).toBe('SUPPRESS_NOISE');
    expect(result.reasons).toContain('hard-suppress-title');
  });

  it('reviews ambiguous research-adjacent rows', () => {
    const result = classifyDirectoryCsvRow({
      netid: 'fixturecrc001',
      name: 'Coordinator, Robin',
      firstName: 'Robin',
      lastName: 'Coordinator',
      title: 'Clinical Research Coordinator 2',
      department: 'MED Internal Medicine',
      departmentUnit: 'MEDINT Rheumatology',
      school: 'MED School of Medicine',
      schoolCode: 'MED',
      physicalLocation: '',
    });

    expect(result.decision).toBe('REVIEW_RESEARCH_ADJACENT');
    expect(result.reasons).toContain('research-adjacent-title');
  });

  it('reviews generic research affiliates', () => {
    const result = classifyDirectoryCsvRow({
      netid: 'fixtureaff001',
      name: 'Affiliate, Reed',
      firstName: 'Reed',
      lastName: 'Affiliate',
      title: 'Research Affiliates',
      department: 'School of Public Health',
      departmentUnit: '',
      school: 'School of Public Health',
      schoolCode: 'SPH',
      physicalLocation: '',
    });

    expect(result.decision).toBe('REVIEW_RESEARCH_ADJACENT');
    expect(result.reasons).toContain('generic-affiliate-title');
  });

  it('reviews library and curatorial research support instead of suppressing it', () => {
    const result = classifyDirectoryCsvRow({
      netid: 'fixturelib001',
      name: 'Curator, Lee',
      firstName: 'Lee',
      lastName: 'Curator',
      title: 'Curator of Rare Books and Manuscripts',
      department: 'Yale University Library',
      departmentUnit: 'Beinecke Rare Book and Manuscript Library',
      school: '',
      schoolCode: '',
      physicalLocation: '',
    });

    expect(result.decision).toBe('REVIEW_RESEARCH_ADJACENT');
    expect(result.reasons).toContain('library-collections-signal');
  });

  it('does not auto-accept blank-title medical or public health rows', () => {
    const result = classifyDirectoryCsvRow({
      netid: 'fixturemed001',
      name: 'Blank, Bailey',
      firstName: 'Bailey',
      lastName: 'Blank',
      title: '',
      department: 'MED School of Medicine',
      departmentUnit: 'MED Internal Medicine',
      school: 'MED School of Medicine',
      schoolCode: 'MED',
      physicalLocation: '',
    });

    expect(result.decision).toBe('IDENTITY_ONLY');
    expect(result.reasons).toContain('blank-title');
  });
});
