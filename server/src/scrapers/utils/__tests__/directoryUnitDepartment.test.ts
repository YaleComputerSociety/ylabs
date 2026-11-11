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
    ['MEDNEU Multiple Sclerosis', 'Neurology'],
    ['FASHIS History', 'History'],
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
    'Other Departments & Organizations',
    'LAWFAF Academic Faculty',
    '',
    '   ',
  ])('refuses the administrative unit %j', (unit) => {
    expect(directoryUnitDepartment(unit)).toBeUndefined();
  });

  it('refuses a value that is not a string', () => {
    expect(directoryUnitDepartment(undefined)).toBeUndefined();
    expect(directoryUnitDepartment(42)).toBeUndefined();
  });

  it('reads a unit under a one-department unit class as that department', () => {
    expect(directoryUnitDepartment('Multiple Sclerosis', 'MEDNEU')).toBe('Neurology');
    expect(directoryUnitDepartment('Epilepsy', 'MEDNEU')).toBe('Neurology');
    expect(directoryUnitDepartment('Cardiology', 'MEDINT')).toBe('Cardiology');
  });
});
