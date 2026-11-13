import { describe, expect, it } from 'vitest';
import { decodeDirectoryExportDepartment } from '../directoryExportDepartment';

const CATALOG = new Map(
  [
    'History',
    'Neurology',
    'Internal Medicine',
    'Pediatrics',
    'Obstetrics, Gynecology & Reproductive Sciences',
    'Radiology & Biomedical Imaging',
    'Architecture',
    'Chronic Disease Epidemiology',
    'Environmental Health Sciences',
    'Psychiatry',
    'English Language & Literature',
    'Emergency Medicine',
    'Electrical & Computer Engineering',
    'Earth & Planetary Sciences',
  ].map((name) => [name.toLowerCase(), name]),
);
const canonical = (name: string) => CATALOG.get(name.toLowerCase());
const decode = (value: unknown) => decodeDirectoryExportDepartment(value, canonical);

describe('decodeDirectoryExportDepartment (#5796)', () => {
  it.each([
    ['FASHIS History', 'History'],
    ['HIST - History', 'History'],
    ['ENGL - English Language & Literature', 'English Language & Literature'],
    ['MEDNEU Multiple Sclerosis', 'Neurology'],
    ['MEDNEU Neurology - All', 'Neurology'],
    ['MEDINT Cardiology', 'Internal Medicine'],
    ['MEDCCC Medical Oncology', 'Internal Medicine'],
    ['MEDCCC Hematology', 'Internal Medicine'],
    ['MEDPED Neonatology', 'Pediatrics'],
    ['MEDOBG Reproductive Sciences', 'Obstetrics, Gynecology & Reproductive Sciences'],
    ['MEDDRA Radiology', 'Radiology & Biomedical Imaging'],
    ['ARCSCH School of Architecture - All', 'Architecture'],
    ['SPHDPT Chronic Disease Epidemiology (CDE)', 'Chronic Disease Epidemiology'],
    ['SPHDPT Environmental Health Sciences (EHS)', 'Environmental Health Sciences'],
    ['MEDPSY Psych Divisions-CNRU', 'Psychiatry'],
    ['EM - Emergency Medicine', 'Emergency Medicine'],
    ['ECE - Electrical & Computer Engineering', 'Electrical & Computer Engineering'],
    ['EPS - Earth & Planetary Sciences', 'Earth & Planetary Sciences'],
  ])('reads %j as the catalog department %j', (value, department) => {
    expect(decode(value)).toEqual({ status: 'canonical', department });
  });

  it.each([
    'FRESH Collaborative',
    'ADVANCE Study',
    'ABIM Physician-Scientist Research Pathway',
    'CPIRT - Center for Pulmonary Injury, Repair, and Therapeutics',
    'MACEAS Council on East Asian Studies',
    'PRVAIT Institution for Social and Policy Studies (ISPS)',
    'FASCOG Digital Ethics Center',
    'ENVOTH Other Units',
    'MEDINT Administration',
    'MEDCSC Developmental Disabilities',
    'MEDNEU Neurology Neuroscience',
    'NURS - Nursing',
    'MEDINT Sleep Medicine',
    'LAW - Law',
    'MGT - Management',
  ])('refuses %j, which maps to no catalog department', (value) => {
    expect(decode(value)).toEqual({ status: 'refused' });
  });

  it('leaves a value that is not an export code alone', () => {
    expect(decode('History')).toEqual({ status: 'not-export-code' });
    expect(decode('Obstetrics, Gynecology & Reproductive Sciences')).toEqual({
      status: 'not-export-code',
    });
    expect(decode(undefined)).toEqual({ status: 'not-export-code' });
    expect(decode('EM Fixture Studies')).toEqual({ status: 'not-export-code' });
    expect(decode('A - Fixture Studies')).toEqual({ status: 'not-export-code' });
  });
});
