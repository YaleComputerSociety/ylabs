import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import ResearchHomeCard from '../ResearchHomeCard';
import ResearchResultsBackLink from '../ResearchResultsBackLink';
import { useRestoreOpenedResearchResultFocus } from '../../../hooks/useRestoreOpenedResearchResultFocus';
import {
  deeperResearchResultsReturnState,
  forgetOpenedResearchResults,
} from '../../../utils/researchResultsReturn';
import type { ResearchCluster } from '../../../utils/researchDiscoveryAdapters';

afterEach(() => {
  cleanup();
  forgetOpenedResearchResults();
});

const resultCard = (slug: string, label: string): ResearchCluster => ({
  id: slug,
  label,
  description: 'Studies an example topic.',
  contextState: 'complete',
  contextLabel: 'Research description',
  contextLine: 'Example Department',
  entityCount: 1,
  pathwayCount: 0,
  peopleCount: 0,
  labels: [],
  metadataTags: [],
  entities: [
    {
      _id: `${slug}-id`,
      slug,
      name: label,
      kind: 'lab',
      websiteUrl: '',
      departments: ['Example Department'],
      researchAreas: [],
      school: '',
      contactEmail: '',
      contactName: '',
      contactRole: '',
      sourceUrls: [],
    },
  ],
  pathways: [],
  evidence: [],
});

const ResultsPage = () => {
  useRestoreOpenedResearchResultFocus();
  const location = useLocation();
  return (
    <main>
      <output aria-label="Current location">{`${location.pathname}${location.search}`}</output>
      {[
        resultCard('first-example-lab', 'First Example Lab'),
        resultCard('second-example-lab', 'Second Example Lab'),
      ].map((home) => (
        <ResearchHomeCard key={home.id} home={home} variant="compact" openSource="search" />
      ))}
    </main>
  );
};

const DetailPage = () => {
  const location = useLocation();
  return (
    <main>
      <output aria-label="Current location">{location.pathname}</output>
      <ResearchResultsBackLink />
      <Link
        to="/research/related-example-lab"
        state={deeperResearchResultsReturnState(location.state)}
      >
        Related example lab
      </Link>
    </main>
  );
};

const renderJourney = (initialEntry: string) =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/research" element={<ResultsPage />} />
        <Route path="/research/:slug" element={<DetailPage />} />
      </Routes>
    </MemoryRouter>,
  );

const currentLocation = () => screen.getByLabelText('Current location').textContent;

describe('returning from a research profile to its results', () => {
  it('links back to the exact query and filters and refocuses the opened card', async () => {
    renderJourney('/research?q=example&department=Example');

    fireEvent.click(screen.getByRole('link', { name: 'Second Example Lab' }));
    expect(currentLocation()).toBe('/research/second-example-lab');

    const backLink = screen.getByRole('link', { name: 'Back to results' });
    expect(backLink.getAttribute('href')).toBe('/research?q=example&department=Example');

    fireEvent.click(backLink);
    expect(currentLocation()).toBe('/research?q=example&department=Example');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Second Example Lab' })),
    );
  });

  it('returns past every related profile opened on the way', async () => {
    renderJourney('/research?q=example');

    fireEvent.click(screen.getByRole('link', { name: 'First Example Lab' }));
    fireEvent.click(screen.getByRole('link', { name: 'Related example lab' }));
    expect(currentLocation()).toBe('/research/related-example-lab');

    fireEvent.click(screen.getByRole('link', { name: 'Back to results' }));
    expect(currentLocation()).toBe('/research?q=example');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('link', { name: 'First Example Lab' })),
    );
  });

  it('offers plain browsing when the profile was not opened from results', () => {
    renderJourney('/research/first-example-lab');

    const browseLink = screen.getByRole('link', { name: 'Browse research' });
    expect(browseLink.getAttribute('href')).toBe('/research');
    fireEvent.click(browseLink);
    expect(currentLocation()).toBe('/research');
    expect(document.activeElement).toBe(document.body);
  });

  it('leaves a modified click to the browser so it can open the results in a new tab', () => {
    renderJourney('/research?q=example');

    fireEvent.click(screen.getByRole('link', { name: 'First Example Lab' }));
    const backLink = screen.getByRole('link', { name: 'Back to results' });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true });
    backLink.dispatchEvent(click);

    expect(currentLocation()).toBe('/research/first-example-lab');
  });
});
