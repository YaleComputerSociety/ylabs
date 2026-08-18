import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ResearchTeamSection from '../ResearchTeamSection';
import type { LabMember } from '../../../types/labDetail';

const member = (index: number, role: LabMember['role'] = 'grad-student'): LabMember => ({
  role,
  user: {
    publicKey: `member-${index}`,
    fname: 'Fixture',
    lname: `Scholar ${index}`,
    displayName: `Fixture Scholar ${index}`,
    title: role === 'postdoc' ? 'Postdoctoral Associate' : 'Graduate Student',
    profileUrls: { official: `https://medicine.yale.edu/profile/scholar-${index}/` },
  },
});

describe('ResearchTeamSection', () => {
  it('groups canonical members by honest role and links only official public profiles', () => {
    render(<ResearchTeamSection members={[member(1), member(2, 'postdoc')]} />);
    expect(screen.getByRole('heading', { name: 'Graduate students' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Postdoctoral researchers' })).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /Fixture Scholar 1.*official public profile/ }),
    ).toHaveAttribute('href', 'https://medicine.yale.edu/profile/scholar-1/');
    expect(screen.getByText(/not a recommendation to contact/)).toBeTruthy();
  });

  it('renders a member without an external profile as plain text', () => {
    render(
      <ResearchTeamSection
        members={[
          {
            role: 'grad-student',
            user: {
              publicKey: 'no-link',
              fname: 'Unlinked',
              lname: 'Member',
              displayName: 'Unlinked Member',
            },
          },
        ]}
      />,
    );
    expect(screen.getByText('Unlinked Member')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Unlinked Member/ })).toBeNull();
  });

  it('excludes lead roles from the team section', () => {
    render(<ResearchTeamSection members={[member(1, 'pi'), member(2, 'grad-student')]} />);
    expect(screen.getByText('Fixture Scholar 2')).toBeTruthy();
    expect(screen.queryByText('Fixture Scholar 1')).toBeNull();
  });

  it('presents a neutral empty state', () => {
    render(<ResearchTeamSection members={[]} />);
    expect(screen.getByText(/does not mean the team\s+is empty/)).toBeTruthy();
  });

  it('bounds dense roster presentation to 24 members', () => {
    render(
      <ResearchTeamSection members={Array.from({ length: 30 }, (_, index) => member(index))} />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(24);
    expect(screen.getByText(/Additional current members are not shown/)).toBeTruthy();
  });
});
