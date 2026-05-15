import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ResearchHomeCard from '../ResearchHomeCard';
import type { ResearchCluster } from '../../../utils/researchDiscoveryAdapters';

afterEach(() => {
  cleanup();
});

const researchHome = (overrides: Partial<ResearchCluster> = {}): ResearchCluster => ({
  id: 'neuroscience',
  label: 'Neuroscience',
  description: 'Research homes connected by Yale department metadata for Neuroscience.',
  matchReason: 'Shared department: Neuroscience',
  entityCount: 2,
  paperCount: 4,
  pathwayCount: 1,
  peopleCount: 1,
  labels: ['Evidence-backed grouping'],
  metadataTags: ['Psychology', 'Systems neuroscience'],
  entities: [
    {
      _id: 'entity-1',
      slug: 'mccormick-lab',
      name: 'McCormick Lab',
      kind: 'lab',
      description: 'Studies systems neuroscience.',
      websiteUrl: '',
      location: '',
      departments: ['Neuroscience'],
      researchAreas: ['Systems neuroscience'],
      school: 'School of Medicine',
      openness: 'unknown',
      typicalUndergradRoles: [],
      prerequisiteCourses: [],
      creditOptions: [],
      fundingPrograms: [],
      contactEmail: '',
      contactName: '',
      contactRole: '',
      sourceUrls: [],
    },
  ],
  pathways: [],
  papers: [],
  evidence: [
    {
      claim: '2 Yale research profiles share Neuroscience metadata.',
      sourceType: 'Research metadata',
      confidence: 'metadata fallback',
    },
  ],
  ...overrides,
});

describe('ResearchHomeCard', () => {
  it('frames grouped profiles as research homes instead of clusters', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <ResearchHomeCard home={researchHome()} onSelect={onSelect} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Neuroscience' })).toBeTruthy();
    expect(container.textContent).toContain('Evidence-backed grouping');
    expect(container.textContent).toContain('Research homes');
    expect(container.textContent).toContain('Why this matches');
    expect(container.textContent).not.toContain('Cluster: experimental');
    expect(container.textContent).not.toContain('Cluster: metadata-grouped');
    expect(container.textContent).not.toContain('Profiles in this cluster');

    fireEvent.click(screen.getByRole('button', { name: 'Explore home' }));
    expect(onSelect).toHaveBeenCalledWith('Neuroscience');
    expect(container.querySelector('a[href="/research/mccormick-lab"]')).not.toBeNull();
  });

  it('renders homes without slugs without broken profile links', () => {
    render(
      <MemoryRouter>
        <ResearchHomeCard
          home={researchHome({
            entities: [
              {
                _id: 'legacy-entry',
                name: 'Legacy Entry',
                kind: 'lab',
                description: 'No slug yet.',
                websiteUrl: '',
                location: '',
                departments: ['Computer Science'],
                researchAreas: ['Data Science'],
                school: 'Yale College',
                openness: 'unknown',
                typicalUndergradRoles: [],
                prerequisiteCourses: [],
                creditOptions: [],
                fundingPrograms: [],
                contactEmail: '',
                contactName: '',
                contactRole: '',
                sourceUrls: [],
              },
            ],
          })}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('link', { name: 'Legacy Entry' })).toBeNull();
    expect(screen.getByText('Legacy Entry').getAttribute('title')).toBe(
      'Research profile link is not available yet.',
    );
  });
});
