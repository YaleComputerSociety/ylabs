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

  it('renders a non-interactive card when no lead profile URL is provided', () => {
    const { container } = renderMembers([
      member('', {
        profileUrls: {
          official: 'https://medicine.yale.edu/profile/fixture-scholar/',
        },
        website: 'https://fixture-scholar.example.test/',
      }),
    ]);

    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('Fixture Advisor');
  });

  it('links a single lead card to the official profile the resolver returns', () => {
    const { getByRole } = render(
      <MemoryRouter>
        <LabMembersList
          members={[member('')]}
          resolveMemberProfileUrl={() => 'https://medicine.yale.edu/profile/fixture-advisor/'}
        />
      </MemoryRouter>,
    );

    const link = getByRole('link', { name: "Open Fixture Advisor's official profile" });
    expect(link.getAttribute('href')).toBe('https://medicine.yale.edu/profile/fixture-advisor/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('links each lead card to its own official profile when several leads render', () => {
    const { getByRole } = render(
      <MemoryRouter>
        <LabMembersList
          members={[
            member('', { publicKey: 'lead-one', displayName: 'Lead One' }),
            member('', { publicKey: 'lead-two', displayName: 'Lead Two' }),
          ]}
          resolveMemberProfileUrl={(m) =>
            `https://medicine.yale.edu/profile/${(m.user.displayName || '')
              .toLowerCase()
              .replace(/\s+/g, '-')}/`
          }
        />
      </MemoryRouter>,
    );

    expect(
      getByRole('link', { name: "Open Lead One's official profile" }).getAttribute('href'),
    ).toBe('https://medicine.yale.edu/profile/lead-one/');
    expect(
      getByRole('link', { name: "Open Lead Two's official profile" }).getAttribute('href'),
    ).toBe('https://medicine.yale.edu/profile/lead-two/');
  });

  it('links the lead card directly to the official profile and never to a person page', () => {
    const { getByRole, queryByRole } = render(
      <MemoryRouter>
        <LabMembersList
          members={[member('')]}
          resolveMemberProfileUrl={() => 'https://medicine.yale.edu/profile/fixture-advisor/'}
        />
      </MemoryRouter>,
    );

    expect(
      queryByRole('link', { name: "View Fixture Advisor's Yale Research profile" }),
    ).toBeNull();

    const officialLink = getByRole('link', { name: "Open Fixture Advisor's official profile" });
    expect(officialLink.getAttribute('href')).toBe(
      'https://medicine.yale.edu/profile/fixture-advisor/',
    );
    expect(officialLink.getAttribute('target')).toBe('_blank');
  });

  it('does not link a card when the resolver returns an unsafe URL', () => {
    const { container } = render(
      <MemoryRouter>
        <LabMembersList
          members={[member('')]}
          resolveMemberProfileUrl={() => 'javascript:alert(1)'}
        />
      </MemoryRouter>,
    );

    expect(container.querySelector('a')).toBeNull();
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

  it('does not label a postdoctoral trainee as Principal Investigator even when role is PI', () => {
    const { container } = renderMembers([member('', { title: 'Postdoctoral Associate' })]);

    expect(container.textContent).not.toContain('Principal Investigator');
    expect(container.textContent).toContain('Researcher');
    expect(container.textContent).toContain('Postdoctoral Associate');
  });

  it('does not label a research assistant lead as Principal Investigator', () => {
    const { container } = renderMembers([member('', { title: 'Research Assistant' })]);

    expect(container.textContent).not.toContain('Principal Investigator');
    expect(container.textContent).toContain('Researcher');
  });

  it('keeps the Principal Investigator label for a research assistant professor', () => {
    const { container } = renderMembers([member('', { title: 'Research Assistant Professor' })]);

    expect(container.textContent).toContain('Principal Investigator');
  });

  it('keeps the Principal Investigator label for a full professor lead', () => {
    const { container } = renderMembers([member('', { title: 'Professor' })]);

    expect(container.textContent).toContain('Principal Investigator');
  });

  it('renders the department pill text at an AA-contrast gray on the muted panel', () => {
    const { container } = renderMembers([member('')]);

    const departmentPill = Array.from(container.querySelectorAll('span')).find(
      (element) => element.textContent === 'Computer Science',
    );

    expect(departmentPill).toBeTruthy();
    expect(departmentPill?.className).toContain('bg-[var(--yr-panel-muted)]');
    expect(departmentPill?.className).toContain('text-gray-700');
    expect(departmentPill?.className).not.toContain('text-gray-500');
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
