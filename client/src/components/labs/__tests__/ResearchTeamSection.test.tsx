import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ResearchTeamSection from '../ResearchTeamSection';
import type { LabMember, LabRosterDisclosure } from '../../../types/labDetail';

const member = (index: number, role: LabMember['role'] = 'grad-student'): LabMember => ({
  role,
  user: {
    publicKey: `member-${index}`,
    fname: 'Fixture',
    lname: `Scholar ${index}`,
    displayName: `Fixture Scholar ${index}`,
    title: role === 'postdoc' ? 'Postdoctoral Associate' : 'Graduate Student',
  },
  rosterEvidence: {
    sourceUrl: 'https://medicine.yale.edu/lab/fixture/members/',
    profileUrl: `https://medicine.yale.edu/lab/fixture/profile/scholar-${index}/`,
    observedAt: '2026-07-14T00:00:00Z',
  },
});

const roster = (overrides: Partial<LabRosterDisclosure> = {}): LabRosterDisclosure => ({
  status: 'current',
  returned: 1,
  truncated: false,
  withheldCount: 0,
  sourceUrl: 'https://medicine.yale.edu/lab/fixture/members/',
  observedAt: '2026-07-14T00:00:00Z',
  ...overrides,
});

describe('ResearchTeamSection', () => {
  it('presents the observed date as a UTC calendar date', () => {
    render(<ResearchTeamSection members={[member(1)]} roster={roster()} />);
    expect(screen.getByText('Official roster observed Jul 14, 2026')).toBeTruthy();
  });

  it('groups verified members by honest role and links only official public profiles', () => {
    render(<ResearchTeamSection members={[member(1), member(2, 'postdoc')]} roster={roster()} />);
    expect(screen.getByRole('heading', { name: 'Graduate students' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Postdoctoral researchers' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Fixture Scholar 1.*official public profile/ })).toHaveAttribute(
      'href',
      'https://medicine.yale.edu/lab/fixture/profile/scholar-1/',
    );
    expect(screen.getByText(/not a recommendation to contact/)).toBeTruthy();
  });

  it('presents neutral empty, withheld, and optional-source failure states', () => {
    const { rerender } = render(
      <ResearchTeamSection members={[]} roster={roster({ status: 'no-verified-data' })} />,
    );
    expect(screen.getByText(/does not mean the team is empty/)).toBeTruthy();
    rerender(<ResearchTeamSection members={[]} roster={roster({ status: 'withheld' })} />);
    expect(screen.getByText(/member names are withheld/)).toBeTruthy();
    rerender(
      <ResearchTeamSection members={[]} roster={roster({ status: 'optional-source-failure' })} />,
    );
    expect(screen.getByText(/Team size is unknown/)).toBeTruthy();
  });

  it('bounds dense roster presentation to 24 members', () => {
    render(
      <ResearchTeamSection
        members={Array.from({ length: 30 }, (_, index) => member(index))}
        roster={roster({ returned: 24, truncated: true })}
      />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(24);
    expect(screen.getByText(/Additional verified members are not shown/)).toBeTruthy();
  });
});
