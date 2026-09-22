import { describe, expect, it } from 'vitest';
import { isNonResearchStaffTitle } from '../nonResearchStaffTitle';
import { isNonResearchStaffTitle as clientIsNonResearchStaffTitle } from '../../../../client/src/utils/leadRoleDisplay';

/**
 * The cases both copies must agree on. Parity is pinned by behaviour rather than by
 * sharing a file, because client and server are separate packages (#2433).
 */
const PARITY_CASES = [
  'Program Manager',
  'Program Administrator',
  'Data Analyst',
  'IT, Business Systems Analyst 4',
  'Programmer Analyst 2',
  'Biostatistician',
  'Statistician 2',
  'Center Coordinator',
  'Didactic Curriculum Coordinator',
  'Geospatial Research Analyst',
  'Clinical Research Analyst',
  'Lab Manager',
  'Lab Technician',
  'Research Specialist',
  'Research Affiliates',
  'Clinical Research Affiliates',
  'Research Scientist',
  'Senior Research Scientist',
  'Associate Research Scientist',
  'Senior Research Scholar',
  'Research Associate 2, HSS',
  'Associate Research Scientist, Anthropology; Coordinator, InterAsia Initiative',
  'Professor of Epidemiology',
  'Director of the Data Coordinating Center',
  'Program Director',
  'Postdoctoral Associate',
  'Data Scientist',
  '',
  '   ',
];

describe('isNonResearchStaffTitle', () => {
  it('refuses an administrative, financial or technical staff appointment', () => {
    expect(isNonResearchStaffTitle('Program Manager')).toBe(true);
    expect(isNonResearchStaffTitle('Program Administrator')).toBe(true);
    expect(isNonResearchStaffTitle('Data Analyst')).toBe(true);
    expect(isNonResearchStaffTitle('IT, Business Systems Analyst 4')).toBe(true);
    expect(isNonResearchStaffTitle('Biostatistician')).toBe(true);
    expect(isNonResearchStaffTitle('Statistician 2')).toBe(true);
    expect(isNonResearchStaffTitle('Center Coordinator')).toBe(true);
    expect(isNonResearchStaffTitle('Lab Manager')).toBe(true);
    expect(isNonResearchStaffTitle('Lab Technician')).toBe(true);
    expect(isNonResearchStaffTitle('Research Specialist')).toBe(true);
  });

  it('refuses a courtesy research-affiliate appointment', () => {
    expect(isNonResearchStaffTitle('Research Affiliates')).toBe(true);
    expect(isNonResearchStaffTitle('Clinical Research Affiliates')).toBe(true);
  });

  it('keeps the whole Yale research-scientist and research-scholar ladder', () => {
    expect(isNonResearchStaffTitle('Associate Research Scientist')).toBe(false);
    expect(isNonResearchStaffTitle('Research Scientist')).toBe(false);
    expect(isNonResearchStaffTitle('Senior Research Scientist')).toBe(false);
    expect(isNonResearchStaffTitle('Senior Research Scholar')).toBe(false);
    expect(isNonResearchStaffTitle('Research Associate 2, HSS')).toBe(false);
  });

  it('keeps a research appointment that also carries a staff duty', () => {
    expect(
      isNonResearchStaffTitle(
        'Associate Research Scientist, Anthropology; Coordinator, InterAsia Initiative',
      ),
    ).toBe(false);
  });

  it('exempts a supervisory title, which can own a research home whatever else it says', () => {
    expect(isNonResearchStaffTitle('Director of the Data Coordinating Center')).toBe(false);
    expect(isNonResearchStaffTitle('Program Director')).toBe(false);
    expect(isNonResearchStaffTitle('Professor of Epidemiology')).toBe(false);
  });

  it('says nothing about a title naming no staff role', () => {
    expect(isNonResearchStaffTitle('Postdoctoral Associate')).toBe(false);
    expect(isNonResearchStaffTitle('Data Scientist')).toBe(false);
    expect(isNonResearchStaffTitle('')).toBe(false);
    expect(isNonResearchStaffTitle(undefined)).toBe(false);
  });

  it('agrees with the client copy on every pinned case', () => {
    for (const title of PARITY_CASES) {
      expect(isNonResearchStaffTitle(title), `disagreed on "${title}"`).toBe(
        clientIsNonResearchStaffTitle(title),
      );
    }
  });
});
