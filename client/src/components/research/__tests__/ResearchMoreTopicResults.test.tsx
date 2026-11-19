import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ResearchMoreTopicResults, {
  MORE_TOPIC_RESULTS_HEADING,
  type MoreTopicResultsAccessFilter,
} from '../ResearchMoreTopicResults';
import { buildGroupedSearchResults } from '../../../utils/researchDiscoveryAdapters';
import type { ResearchEntity } from '../../../types/researchEntity';

const syntheticEntity = (index: number): ResearchEntity =>
  ({
    _id: `synthetic-more-${index}`,
    slug: `synthetic-glacier-group-${index}`,
    name: `Synthetic Glacier Group ${index}`,
    displayName: `Synthetic Glacier Group ${index}`,
    kind: 'lab',
    fullDescription: `Studies synthetic glacier melt in setting ${index}.`,
    websiteUrl: '',
    departments: ['Earth & Planetary Sciences'],
    researchAreas: ['Glaciology'],
    school: 'Faculty of Arts and Sciences',
    sourceUrls: [`https://example.yale.edu/synthetic-glacier-${index}`],
  }) as ResearchEntity;

const clustersOf = (count: number) =>
  buildGroupedSearchResults({
    query: '',
    researchEntities: Array.from({ length: count }, (_, index) => syntheticEntity(index)),
    pathways: [],
  }).clusters;

const renderSection = (accessFilter: MoreTopicResultsAccessFilter, count = 2) =>
  render(
    <MemoryRouter>
      <main>
        <ResearchMoreTopicResults
          clusters={clustersOf(count)}
          accessFilter={accessFilter}
          onSelect={vi.fn()}
        />
      </main>
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
});

describe('ResearchMoreTopicResults', () => {
  it('labels the section with a real heading and the hosting note, then lists each card', () => {
    renderSection('hostsUndergrads', 3);

    const section = screen.getByRole('region', { name: MORE_TOPIC_RESULTS_HEADING });
    expect(within(section).getByRole('heading', { level: 2 }).textContent).toBe(
      'More research on this topic',
    );
    expect(section.getAttribute('aria-describedby')).toBeTruthy();
    expect(
      within(section).getByText(
        "These don't list undergraduate researchers yet. Many still take students; reach out to ask.",
      ),
    ).toBeTruthy();
    expect(
      within(section)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual([
      'Synthetic Glacier Group 0',
      'Synthetic Glacier Group 1',
      'Synthetic Glacier Group 2',
    ]);
  });

  it('words the note for the welcomes filter', () => {
    renderSection('welcomesUndergrads');

    expect(
      screen.getByText(
        "These don't say they welcome undergraduates yet. Many still take students; reach out to ask.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/list undergraduate researchers/)).toBeNull();
  });

  it('renders nothing without rows', () => {
    const { container } = renderSection('hostsUndergrads', 0);

    expect(container.querySelector('section')).toBeNull();
    expect(screen.queryByText(MORE_TOPIC_RESULTS_HEADING)).toBeNull();
  });
});
