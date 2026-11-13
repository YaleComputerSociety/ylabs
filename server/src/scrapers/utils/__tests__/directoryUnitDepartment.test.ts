import { describe, expect, it } from 'vitest';
import { directoryUnitDepartment } from '../directoryUnitDepartment';

describe('directoryUnitDepartment (#5741)', () => {
  it.each([
    ['Computer Science', 'Computer Science'],
    ['Genetics-All', 'Genetics'],
    ['Emergency Medicine - All', 'Emergency Medicine'],
    ['Digestive Diseases Other', 'Digestive Diseases'],
    [' Biostatistics (BIS)', 'Biostatistics (BIS)'],
    ['Dept of Spanish and Portuguese', 'Department of Spanish and Portuguese'],
    ['MNBIO Neuroscience Department', 'Neuroscience Department'],
    ['MB and B-All', 'Molecular Biophysics and Biochemistry'],
    ['MPATH-All', 'Pathology'],
    ['ECE Faculty', 'Electrical and Computer Engineering'],
    ['Psych Divisions-CNRU', 'Psychiatry'],
  ])('reads %j as the department %j', (unit, department) => {
    expect(directoryUnitDepartment(unit)).toBe(department);
  });

  it.each([
    'Administration',
    'Department Administration',
    'Other Units',
    'Academic Faculty',
    'Clinical Faculty',
    'Research and Teaching Unit',
    'Physics Research Unit',
    'Business Office',
    'Deputy Dean Office',
    "UG Education Dean's Office",
    'MSN Program',
    'Child & Adolescent Training Program (CAP)',
    'Divinity General',
    'Naval ROTC',
    'Trumbull Head of College',
    'DEI (Diversity Equity & Inclusion)',
    'YSM Central',
    'IPE',
    'MEDPSY Psychiatry Administration & General',
    '',
    '   ',
  ])('refuses the administrative unit %j', (unit) => {
    expect(directoryUnitDepartment(unit)).toBeUndefined();
  });

  it('refuses a value that is not a string', () => {
    expect(directoryUnitDepartment(undefined)).toBeUndefined();
    expect(directoryUnitDepartment(42)).toBeUndefined();
  });

  it.each([
    ['Department Administration', 'FASPSY', 'Psychology'],
    ['Research Unit', 'FASEPS', 'Earth & Planetary Sciences'],
    ['Linguistics-Research Unit', 'FASLIN', 'Linguistics'],
    ['Administration', 'MEDINT', 'Internal Medicine'],
    ['Department Administration', 'faspsy', 'Psychology'],
  ])(
    'reads the administrative unit %j under class %j as %j (#6028)',
    (unit, unitClass, department) => {
      expect(directoryUnitDepartment(unit, unitClass)).toBe(department);
    },
  );

  it('keeps an administrative unit refused when its class is unknown or absent (#6028)', () => {
    expect(directoryUnitDepartment('Department Administration')).toBeUndefined();
    expect(directoryUnitDepartment('Department Administration', 'FASXYZ')).toBeUndefined();
    expect(directoryUnitDepartment('Other Units', 'ENVOTH')).toBeUndefined();
    expect(directoryUnitDepartment('', 'FASPSY')).toBeUndefined();
  });

  it('lets a unit that names its own department win over its class (#6028)', () => {
    expect(directoryUnitDepartment('Cardiology', 'MEDINT')).toBe('Cardiology');
  });
});
