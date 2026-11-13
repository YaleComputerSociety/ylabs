import { describe, expect, it } from 'vitest';
import {
  orgUnitLabelWords,
  ownOrgUnitLabelsFromObservations,
  restatesAnOwnOrgUnitLabel,
} from '../ownOrgUnitLabelTopics';

describe('restatesAnOwnOrgUnitLabel', () => {
  it('drops a topic equal to an own label across case, "&", the unit words and plurals', () => {
    expect(restatesAnOwnOrgUnitLabel('ophthalmology', ['Ophthalmology'])).toBe(true);
    expect(restatesAnOwnOrgUnitLabel('Pediatrics', ['Department of Pediatrics'])).toBe(true);
    expect(restatesAnOwnOrgUnitLabel('Neurology', ['Neurology Department'])).toBe(true);
    expect(restatesAnOwnOrgUnitLabel('nursing', ['Yale School of Nursing'])).toBe(true);
    expect(restatesAnOwnOrgUnitLabel('Movement Disorder', ['Movement Disorders'])).toBe(true);
    expect(
      restatesAnOwnOrgUnitLabel('occupational and environmental medicine', [
        'Section of Occupational & Environmental Medicine',
      ]),
    ).toBe(true);
    expect(
      restatesAnOwnOrgUnitLabel('Ecology & Evolutionary Biology', [
        'Ecology and Evolutionary Biology',
      ]),
    ).toBe(true);
  });

  it('keeps a topic named by a program appointment, in either word order (#5957)', () => {
    expect(restatesAnOwnOrgUnitLabel('scleroderma', ['Scleroderma Program'])).toBe(false);
    expect(restatesAnOwnOrgUnitLabel('liver cancer', ['Liver Cancer Programs'])).toBe(false);
    expect(restatesAnOwnOrgUnitLabel('neuroinflammation', ['Program for Neuroinflammation'])).toBe(
      false,
    );
    expect(restatesAnOwnOrgUnitLabel('sarcoma', ['Yale Program in Sarcoma'])).toBe(false);
  });

  it('still drops a topic that also restates a department beside a program', () => {
    expect(
      restatesAnOwnOrgUnitLabel('Cardiology', ['Cardiology Program', 'Section of Cardiology']),
    ).toBe(true);
    expect(restatesAnOwnOrgUnitLabel('Program Evaluation', ['Program Evaluation'])).toBe(true);
  });

  it('keeps a subfield that only contains the department word', () => {
    expect(restatesAnOwnOrgUnitLabel('Molecular Biology', ['Biology'])).toBe(false);
    expect(restatesAnOwnOrgUnitLabel('Biology', ['Molecular Biology'])).toBe(false);
    expect(restatesAnOwnOrgUnitLabel('cancer immunology', ['Immunobiology'])).toBe(false);
    expect(restatesAnOwnOrgUnitLabel('health policy', ['Health Policy & Management'])).toBe(false);
    expect(restatesAnOwnOrgUnitLabel('Neuroscience', ['Psychiatry'])).toBe(false);
  });

  it('keeps a topic whose leading word is a unit word that is not a unit name', () => {
    expect(restatesAnOwnOrgUnitLabel('School Psychology', ['Psychology'])).toBe(false);
    expect(restatesAnOwnOrgUnitLabel('Division algebras', ['Algebras'])).toBe(false);
  });

  it('keeps every topic when the row has no own labels', () => {
    expect(restatesAnOwnOrgUnitLabel('Ophthalmology', [])).toBe(false);
    expect(restatesAnOwnOrgUnitLabel('', ['Ophthalmology'])).toBe(false);
  });
});

describe('orgUnitLabelWords', () => {
  it('reads only the unit name', () => {
    expect(orgUnitLabelWords('Yale University Department of the History of Art')).toEqual([
      'history',
      'of',
      'art',
    ]);
    expect(orgUnitLabelWords('Program in Ethnicity, Race & Migration')).toEqual([
      'ethnicity',
      'race',
      'and',
      'migration',
    ]);
  });
});

describe('ownOrgUnitLabelsFromObservations', () => {
  it('collects live department and school values and nothing else', () => {
    expect(
      ownOrgUnitLabelsFromObservations([
        { field: 'departments', value: ['Ophthalmology', ' Movement Disorders '] },
        { field: 'school', value: 'School of Medicine' },
        { field: 'departments', value: ['Retired Unit'], superseded: true },
        {
          field: 'departments',
          value: ['Rolled Back Unit'],
          rollback: { rolledBackAt: new Date() },
        },
        { field: 'researchAreas', value: ['Glaucoma'] },
        { field: 'departments', value: [42, ''] },
      ]),
    ).toEqual(['Ophthalmology', 'Movement Disorders', 'School of Medicine']);
  });
});
