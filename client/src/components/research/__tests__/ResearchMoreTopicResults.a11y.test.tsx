import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

const SYNTHETIC_SECONDARY_SCHOOL = 'School of the Environment';

const jointAppointmentEntity = (): ResearchEntity => ({
  ...syntheticEntity(99),
  schools: ['Faculty of Arts and Sciences', SYNTHETIC_SECONDARY_SCHOOL],
});

const clustersOf = (count: number, extra: ResearchEntity[] = []) =>
  buildGroupedSearchResults({
    query: '',
    researchEntities: [
      ...Array.from({ length: count }, (_, index) => syntheticEntity(index)),
      ...extra,
    ],
    pathways: [],
  }).clusters;

const renderSection = (
  accessFilter: MoreTopicResultsAccessFilter,
  count = 2,
  options: { filteredSchool?: string; extra?: ResearchEntity[] } = {},
) =>
  render(
    <MemoryRouter>
      <main>
        <ResearchMoreTopicResults
          clusters={clustersOf(count, options.extra)}
          accessFilter={accessFilter}
          onSelect={vi.fn()}
          filteredSchool={options.filteredSchool}
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

  it('conforms when a School filter card names a secondary appointment', async () => {
    const filtered = renderSection('hostsUndergrads', 1, {
      filteredSchool: SYNTHETIC_SECONDARY_SCHOOL,
      extra: [jointAppointmentEntity()],
    });
    expect(screen.getAllByText(`Also in ${SYNTHETIC_SECONDARY_SCHOOL}`)).toHaveLength(1);
    await expectNoAxeViolations(filtered.container);
  });
});
