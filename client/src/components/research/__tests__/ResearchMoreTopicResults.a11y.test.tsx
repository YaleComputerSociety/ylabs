import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, it, vi } from 'vitest';

import ResearchMoreTopicResults, {
  type MoreTopicResultsAccessFilter,
} from '../ResearchMoreTopicResults';
import { buildGroupedSearchResults } from '../../../utils/researchDiscoveryAdapters';
import type { ResearchEntity } from '../../../types/researchEntity';
import { expectNoAxeViolations } from '../../../testUtils/axe';

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

describe('ResearchMoreTopicResults accessibility', () => {
  it('conforms under the hosting note and under the welcomes note', async () => {
    const hosting = renderSection('hostsUndergrads');
    await expectNoAxeViolations(hosting.container);
    hosting.unmount();

    const welcomes = renderSection('welcomesUndergrads');
    await expectNoAxeViolations(welcomes.container);
  });
});
