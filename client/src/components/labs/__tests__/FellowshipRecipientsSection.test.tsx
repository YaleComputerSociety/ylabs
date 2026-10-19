import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import FellowshipRecipientsSection from '../FellowshipRecipientsSection';
import type { FellowshipRecipient } from '../../../types/researchGroup';

const recipient = (
  studentName: string,
  year: number,
  projectTitle?: string,
): FellowshipRecipient => ({
  studentName,
  year,
  programName: 'STARS II (Science, Technology and Research Scholars)',
  ...(projectTitle ? { projectTitle } : {}),
  sourceUrl: 'https://example.yale.edu/2025-symposium.pdf',
});

describe('FellowshipRecipientsSection', () => {
  it('renders nothing without recipients', () => {
    const { container } = render(<FellowshipRecipientsSection recipients={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists fellows by year, newest first, then last name, with their project and booklet link', () => {
    render(
      <FellowshipRecipientsSection
        recipients={[
          recipient('Zoe Adams', 2024),
          recipient('Rowan Thistle', 2025, 'Mapping Circuit Activity'),
          recipient('Avery Baker', 2025),
        ]}
      />,
    );
    expect(
      screen.getByRole('heading', { name: 'STARS II fellows mentored here (3)' }),
    ).toBeTruthy();
    const names = within(screen.getByRole('list'))
      .getAllByRole('listitem')
      .map((item) => item.querySelector('p')?.textContent);
    expect(names).toEqual(['Avery Baker', 'Rowan Thistle', 'Zoe Adams']);
    expect(screen.getByText('Mapping Circuit Activity')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'STARS II symposium booklet' })).toHaveAttribute(
      'href',
      'https://example.yale.edu/2025-symposium.pdf',
    );
  });

  it('shows six first and expands to the rest', () => {
    render(
      <FellowshipRecipientsSection
        recipients={Array.from({ length: 8 }, (_, index) =>
          recipient(`Fixture Person${index}`, 2025),
        )}
      />,
    );
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 8' }));
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(8);
  });
});
