import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import LabMembersList from '../LabMembersList';
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
});
