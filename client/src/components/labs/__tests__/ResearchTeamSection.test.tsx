import { fireEvent, render, screen, within } from '@testing-library/react';
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
    expect(
      screen.getByRole('link', { name: /Fixture Scholar 1.*official public profile/ }),
    ).toHaveAttribute('href', 'https://medicine.yale.edu/lab/fixture/profile/scholar-1/');
    expect(screen.getByText(/not a recommendation to contact/)).toBeTruthy();
  });

  it('renders the affiliated members the server actually labels `affiliated`', () => {
    render(<ResearchTeamSection members={[member(1, 'affiliated')]} roster={roster()} />);
    expect(screen.getByRole('heading', { name: 'Affiliated members' })).toBeTruthy();
    expect(screen.getByText('Fixture Scholar 1')).toBeTruthy();
  });

  it('renders nothing when no verified members are present, regardless of roster status', () => {
    const { container, rerender } = render(
      <ResearchTeamSection members={[]} roster={roster({ status: 'no-verified-data' })} />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<ResearchTeamSection members={[]} roster={roster({ status: 'withheld' })} />);
    expect(container).toBeEmptyDOMElement();
    rerender(
      <ResearchTeamSection members={[]} roster={roster({ status: 'optional-source-failure' })} />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(
      <ResearchTeamSection
        members={[{ ...member(1), rosterEvidence: undefined }]}
        roster={roster({ status: 'current' })}
      />,
    );
    expect(container).toBeEmptyDOMElement();
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

  it('lists undergraduates first, as cards when they have a profile and lines when not', () => {
    render(
      <ResearchTeamSection
        members={[member(1), member(2, 'undergrad')]}
        roster={roster({
          undergraduates: [
            {
              name: 'Linked Undergrad',
              status: 'current',
              startYear: 2024,
              profileUrl: 'https://fixturelab.yale.edu/profile/linked-undergrad',
            },
            { name: 'Listed Undergrad', status: 'current', startYear: 2022 },
          ],
        })}
      />,
    );
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Undergraduate researchers', 'Graduate students']);
    expect(
      screen.getByRole('link', { name: /Linked Undergrad.*official public profile/ }),
    ).toHaveAttribute('href', 'https://fixturelab.yale.edu/profile/linked-undergrad');
    expect(screen.getByText('Listed Undergrad').closest('a')).toBeNull();
    expect(screen.getByText('2022 - present')).toBeTruthy();
    expect(screen.getByText(/can tell you what research in this lab is like/)).toBeTruthy();
    expect(screen.queryByText('Fixture Scholar 2')).toBeNull();
  });

  it('shows the newest past undergraduates first and expands to the rest', () => {
    const past = Array.from({ length: 8 }, (_, index) => ({
      name: `Former ${index}`,
      status: 'past' as const,
      startYear: 2010 + index,
      endYear: 2011 + index,
    }));
    render(
      <ResearchTeamSection
        members={[]}
        roster={roster({ status: 'current', undergraduates: past })}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Research team' })).toBeTruthy();
    expect(screen.getByText('Past undergraduate researchers (8)')).toBeTruthy();
    const list = () => screen.getByRole('list');
    expect(within(list()).getAllByRole('listitem')).toHaveLength(6);
    expect(within(list()).getAllByRole('listitem')[0].textContent).toBe('Former 72017 - 2018');
    fireEvent.click(screen.getByRole('button', { name: 'Show all 8' }));
    expect(within(list()).getAllByRole('listitem')).toHaveLength(8);
    expect(screen.queryByText(/can tell you what research/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Official roster source' })).toBeTruthy();
  });

  it('orders past undergraduates by year, newest first, then by last name', () => {
    render(
      <ResearchTeamSection
        members={[]}
        roster={roster({
          status: 'current',
          undergraduates: [
            { name: 'Zoe Adams', status: 'past', endYear: 2022 },
            { name: 'Avery Quill', status: 'past', endYear: 2024 },
            { name: 'Harper Wren Jr.', status: 'past' },
            { name: 'Rowan Baker', status: 'past', endYear: 2024 },
            { name: 'Ellis Álvarez', status: 'past', startYear: 2021, endYear: 2024 },
            { name: 'Parker Moss', status: 'past', endYear: 2022 },
          ],
        })}
      />,
    );
    expect(
      within(screen.getByRole('list'))
        .getAllByRole('listitem')
        .map((item) => item.firstChild?.textContent),
    ).toEqual([
      'Ellis Álvarez',
      'Rowan Baker',
      'Avery Quill',
      'Zoe Adams',
      'Parker Moss',
      'Harper Wren Jr.',
    ]);
  });
});
