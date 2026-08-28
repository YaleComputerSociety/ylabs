import { describe, expect, it } from 'vitest';

import { isTraineeLevelTitle, leadRoleFamily, leadSectionHeading } from '../leadRoleDisplay';
import type { LabMember, LabMemberRole } from '../../types/labDetail';

const lead = (role: LabMemberRole, title?: string): LabMember => ({
  role,
  user: { fname: 'Fixture', lname: 'Person', title },
});

describe('isTraineeLevelTitle', () => {
  it('flags postdoctoral and research assistant titles', () => {
    expect(isTraineeLevelTitle('Postdoctoral Associate')).toBe(true);
    expect(isTraineeLevelTitle('Postdoctoral Fellow')).toBe(true);
    expect(isTraineeLevelTitle('Research Assistant')).toBe(true);
  });

  it('does not flag faculty ranks or empty titles', () => {
    expect(isTraineeLevelTitle('Research Assistant Professor')).toBe(false);
    expect(isTraineeLevelTitle('Professor')).toBe(false);
    expect(isTraineeLevelTitle('')).toBe(false);
    expect(isTraineeLevelTitle(undefined)).toBe(false);
  });
});

describe('leadRoleFamily', () => {
  it('demotes trainee-titled leads out of the pi and director families', () => {
    expect(leadRoleFamily(lead('pi', 'Postdoctoral Associate'))).toBe('other');
    expect(leadRoleFamily(lead('director', 'Research Assistant'))).toBe('other');
  });

  it('classifies genuine pi and director roles by family', () => {
    expect(leadRoleFamily(lead('pi', 'Professor'))).toBe('pi');
    expect(leadRoleFamily(lead('co-pi', 'Professor'))).toBe('pi');
    expect(leadRoleFamily(lead('director', 'Professor'))).toBe('director');
    expect(leadRoleFamily(lead('co-director', 'Professor'))).toBe('director');
  });
});

describe('leadSectionHeading', () => {
  it('uses Principal Investigator headings only for genuine PI-role leads', () => {
    expect(leadSectionHeading([lead('pi', 'Professor')])).toBe('Principal Investigator');
    expect(leadSectionHeading([lead('pi', 'Professor'), lead('co-pi', 'Professor')])).toBe(
      'Principal Investigators',
    );
  });

  it('uses Director headings for director-role leads', () => {
    expect(leadSectionHeading([lead('director', 'Professor')])).toBe('Director');
    expect(
      leadSectionHeading([lead('director', 'Professor'), lead('co-director', 'Professor')]),
    ).toBe('Directors');
  });

  it('falls back to a neutral Leadership heading for mixed or trainee-titled leads', () => {
    expect(leadSectionHeading([lead('pi', 'Professor'), lead('director', 'Professor')])).toBe(
      'Leadership',
    );
    expect(leadSectionHeading([lead('pi', 'Postdoctoral Associate')])).toBe('Leadership');
  });

  it('keeps the Principal Investigator heading for the empty attached-lead state', () => {
    expect(leadSectionHeading([])).toBe('Principal Investigator');
  });
});
