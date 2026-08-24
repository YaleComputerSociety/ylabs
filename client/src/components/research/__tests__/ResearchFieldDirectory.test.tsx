import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ResearchFieldDirectory from '../ResearchFieldDirectory';
import type { ResearchFieldDirectoryDomain } from '../../../utils/researchFieldDirectory';

const domains: ResearchFieldDirectoryDomain[] = [
  {
    field: 'Computing & AI',
    colorKey: 'blue',
    areas: [
      { name: 'Machine Learning', count: 9 },
      { name: 'Robotics', count: 3 },
    ],
  },
  {
    field: 'Life Sciences',
    colorKey: 'green',
    areas: [{ name: 'Genomics', count: 5 }],
  },
];

afterEach(cleanup);

describe('ResearchFieldDirectory', () => {
  it('renders nothing when there are no domains', () => {
    const { container } = render(
      <ResearchFieldDirectory domains={[]} selectedAreas={[]} onSelectArea={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders each domain with its areas and per-area home counts', () => {
    render(
      <ResearchFieldDirectory domains={domains} selectedAreas={[]} onSelectArea={() => {}} />,
    );

    expect(screen.getByRole('heading', { name: 'Browse by field' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Computing & AI' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Browse Machine Learning, 9 research homes' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Browse Genomics, 5 research homes' })).toBeTruthy();
  });

  it('invokes onSelectArea with the area name when an area is clicked', () => {
    const onSelectArea = vi.fn();
    render(
      <ResearchFieldDirectory
        domains={domains}
        selectedAreas={[]}
        onSelectArea={onSelectArea}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Browse Machine Learning, 9 research homes' }),
    );
    expect(onSelectArea).toHaveBeenCalledWith('Machine Learning');
  });

  it('exposes a field-page button and invokes onSelectField when provided', () => {
    const onSelectField = vi.fn();
    render(
      <ResearchFieldDirectory
        domains={domains}
        selectedAreas={[]}
        onSelectArea={() => {}}
        onSelectField={onSelectField}
      />,
    );

    const fieldButton = screen.getByRole('button', {
      name: 'View the Computing & AI field page',
    });
    fireEvent.click(fieldButton);
    expect(onSelectField).toHaveBeenCalledWith('Computing & AI');
  });

  it('renders the field as static text when onSelectField is omitted', () => {
    render(
      <ResearchFieldDirectory domains={domains} selectedAreas={[]} onSelectArea={() => {}} />,
    );
    expect(
      screen.queryByRole('button', { name: 'View the Computing & AI field page' }),
    ).toBeNull();
    expect(screen.getByRole('heading', { name: 'Computing & AI' })).toBeTruthy();
  });

  it('marks a selected area as pressed', () => {
    render(
      <ResearchFieldDirectory
        domains={domains}
        selectedAreas={['machine learning']}
        onSelectArea={() => {}}
      />,
    );

    expect(
      screen
        .getByRole('button', { name: 'Browse Machine Learning, 9 research homes' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('collapses areas beyond the per-domain cap behind a show-all toggle', () => {
    const bigDomain: ResearchFieldDirectoryDomain[] = [
      {
        field: 'Computing & AI',
        colorKey: 'blue',
        areas: [
          { name: 'Alpha', count: 5 },
          { name: 'Bravo', count: 4 },
          { name: 'Charlie', count: 3 },
        ],
      },
    ];
    render(
      <ResearchFieldDirectory
        domains={bigDomain}
        selectedAreas={[]}
        onSelectArea={() => {}}
        initialAreasPerDomain={2}
      />,
    );

    expect(screen.queryByRole('button', { name: /Browse Charlie/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Show all 3/ }));
    const domainCard = screen.getByRole('heading', { name: 'Computing & AI' }).closest('div')!
      .parentElement!;
    expect(within(domainCard).getByRole('button', { name: /Browse Charlie/ })).toBeTruthy();
  });
});
