import { fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import LabMembersList from '../LabMembersList';
import ConfigContext, { defaultConfigContext } from '../../../contexts/ConfigContext';
import type { DepartmentConfig } from '../../../contexts/ConfigContext';
import type { LabMember } from '../../../types/labDetail';

const member = (imageUrl: string, overrides: Partial<LabMember['user']> = {}): LabMember => ({
  role: 'pi',
  user: {
    _id: 'user-1',
    netid: 'fixture',
    fname: 'Fixture',
    lname: 'Advisor',
    displayName: 'Fixture Advisor',
    imageUrl,
    image_url: imageUrl,
    title: 'Professor',
    primaryDepartment: 'Computer Science',
    primary_department: 'Computer Science',
    ...overrides,
  },
});

const renderMembers = (members: LabMember[]) =>
  render(
    <MemoryRouter>
      <LabMembersList members={members} />
    </MemoryRouter>,
  );

const departmentTable: DepartmentConfig[] = [
  {
    abbreviation: 'PHYS',
    name: 'Physics',
    displayName: 'PHYS - Physics',
    categories: [],
    primaryCategory: '',
    colorKey: 0,
  },
];

const renderMembersWithConfig = (members: LabMember[], entityDepartments: string[] = []) =>
  render(
    <MemoryRouter>
      <ConfigContext.Provider value={{ ...defaultConfigContext, departments: departmentTable }}>
        <LabMembersList members={members} entityDepartments={entityDepartments} />
      </ConfigContext.Provider>
    </MemoryRouter>,
  );

describe('LabMembersList', () => {
  it('does not link member netids to internal faculty profiles', () => {
    const { container } = renderMembers([member('')]);

    expect(container.querySelector('a[href="/profile/fixture"]')).toBeNull();
  });

  it('renders lead-investigator cards as non-interactive (no profile link)', () => {
    const { container } = renderMembers([
      member('', {
        profileUrls: {
          official: 'https://medicine.yale.edu/profile/fixture-scholar/',
        },
        website: 'https://fixture-scholar.example.test/',
        internalProfilePath: '/profile/fx1001',
      }),
    ]);

    // The professor's official profile is reached via the decision-summary
    // action buttons, so the PI card itself must not be a (duplicate) link.
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('Fixture Advisor');
  });

  it('renders safe member profile images', () => {
    const { container } = renderMembers([member('https://yalies.io/images/fixture.jpg')]);

    const image = container.querySelector('img[alt="Fixture Advisor"]');
    expect(image?.getAttribute('src')).toBe('https://yalies.io/images/fixture.jpg');
  });

  it('does not render unsafe or credentialed member profile image URLs', () => {
    const unsafeCases = [
      'data:image/svg+xml,<svg onload=alert(1)>',
      'javascript:alert(1)',
      'https://user:pass@yalies.io/images/fixture.jpg',
    ];

    for (const imageUrl of unsafeCases) {
      const { container, unmount } = renderMembers([member(imageUrl)]);
      expect(container.querySelector('img')).toBeNull();
      expect(container.textContent).toContain('FA');
      unmount();
    }
  });

  it('does not link role-suffixed Yale Medicine member keys to official profiles', () => {
    const { container } = renderMembers([
      member('', {
        netid: '',
        publicKey: 'fixture-scholar-pi',
        fname: 'Fixture',
        lname: 'Scholar',
        displayName: 'Fixture Scholar',
      }),
    ]);

    expect(container.querySelector('a[href*="medicine.yale.edu/profile"]')).toBeNull();
  });

  it('does not use netids to link role-suffixed members', () => {
    const { container } = renderMembers([
      member('', {
        netid: 'fs123',
        publicKey: 'fixture-scholar-pi',
        fname: 'Fixture',
        lname: 'Scholar',
        displayName: 'Fixture Scholar',
      }),
    ]);

    expect(container.querySelector('a[href="/profile/fs123"]')).toBeNull();
  });

  it('does not invent profile links for member keys without role suffixes', () => {
    const { container } = renderMembers([
      member('', {
        publicKey: 'fixture',
      }),
    ]);

    expect(container.querySelector('a[href*="medicine.yale.edu/profile"]')).toBeNull();
  });

  it('falls back to the initials avatar when a member image fails to load', () => {
    const { container } = renderMembers([
      member('https://ysm-res.cloudinary.com/image/upload/dead-asset.jpg'),
    ]);

    const image = container.querySelector('img[alt="Fixture Advisor"]');
    expect(image).not.toBeNull();

    fireEvent.error(image as HTMLImageElement);

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('FA');
  });

  it('canonicalizes a raw HR org-unit department into a clean pill', () => {
    const { container } = renderMembersWithConfig([
      member('', {
        primaryDepartment: 'FASPHY Physics Business Operations',
        primary_department: 'FASPHY Physics Business Operations',
      }),
    ]);

    expect(container.textContent).toContain('Physics');
    expect(container.textContent).not.toContain('FASPHY');
    expect(container.textContent).not.toContain('Business Operations');
  });

  it('renders no department pill when the HR org unit is administrative chrome', () => {
    const { container } = renderMembersWithConfig([
      member('', {
        primaryDepartment: 'EASAPP Research Unit',
        primary_department: 'EASAPP Research Unit',
      }),
    ]);

    expect(container.textContent).not.toContain('EASAPP');
    expect(container.textContent).not.toContain('Research Unit');
  });
});
