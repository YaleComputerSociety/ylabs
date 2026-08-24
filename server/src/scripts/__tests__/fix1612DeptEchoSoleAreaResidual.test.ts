import { describe, expect, it } from 'vitest';

import { planForEntity } from '../fix1612DeptEchoSoleAreaResidual';

describe('fix1612DeptEchoSoleAreaResidual planForEntity', () => {
  it('clears a LAB whose sole researchArea is its own department name', () => {
    const plan = planForEntity('ysm-sestan', 'id-1', 'LAB', ['Neuroscience'], ['Neuroscience']);
    expect(plan).not.toBeNull();
    expect(plan?.before).toEqual(['Neuroscience']);
  });

  it('clears a FACULTY_RESEARCH_AREA row whose areas are all department names', () => {
    const plan = planForEntity(
      'ysm-strittmatter',
      'id-2',
      'FACULTY_RESEARCH_AREA',
      ['Neurology', 'Neuroscience'],
      ['Neurology', 'Neuroscience'],
    );
    expect(plan).not.toBeNull();
    expect(plan?.before).toEqual(['Neurology', 'Neuroscience']);
  });

  it('is case/punctuation-insensitive like the write-time canonicalizer', () => {
    const plan = planForEntity('example', 'id-3', 'LAB', ['neuroscience.'], ['Neuroscience']);
    expect(plan).not.toBeNull();
  });

  it('leaves a row alone when a real, non-department topic survives alongside the echo', () => {
    expect(
      planForEntity('mixed-lab', 'id-4', 'LAB', ['Neurology', 'Public Health'], ['Neurology']),
    ).toBeNull();
  });

  it('leaves a row alone when researchAreas is empty', () => {
    expect(planForEntity('empty-lab', 'id-5', 'LAB', [], ['Neuroscience'])).toBeNull();
  });

  it('leaves a row alone when departments is empty (nothing to echo)', () => {
    expect(planForEntity('no-dept-lab', 'id-6', 'LAB', ['Neuroscience'], [])).toBeNull();
  });

  it('excludes PROGRAM rows even when the sole area echoes the department (#1281/#1460)', () => {
    expect(
      planForEntity(
        'department-undergrad-research-neuroscience',
        'id-7',
        'PROGRAM',
        ['Neuroscience'],
        ['Neuroscience'],
      ),
    ).toBeNull();
  });

  it('excludes entity types outside the LAB/FACULTY_RESEARCH_AREA scope', () => {
    expect(
      planForEntity('some-center', 'id-8', 'CENTER', ['Neuroscience'], ['Neuroscience']),
    ).toBeNull();
  });
});
