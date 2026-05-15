import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import TopicClusterCard from '../TopicClusterCard';

describe('TopicClusterCard', () => {
  it('renders mandatory experimental and metadata-grouped labels', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <TopicClusterCard
          cluster={{
            id: 'machine-learning',
            label: 'Machine Learning',
            description: 'Research profiles grouped by visible Yale metadata.',
            matchReason: 'Shared research area metadata',
            entityCount: 2,
            paperCount: 0,
            pathwayCount: 1,
            peopleCount: 2,
            labels: ['Cluster: experimental', 'Cluster: metadata-grouped'],
            metadataTags: ['Computer Science', 'Statistics'],
            entities: [
              {
                _id: 'entity-1',
                slug: 'ai-lab',
                name: 'AI Lab',
                kind: 'lab',
                description: 'Studies ML.',
                websiteUrl: '',
                location: '',
                departments: ['Computer Science'],
                researchAreas: ['Machine Learning'],
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
            pathways: [],
            papers: [],
            evidence: [
              {
                claim: '2 Yale research profiles share Machine Learning metadata.',
                sourceType: 'Research metadata',
              },
            ],
          }}
          onSelect={onSelect}
        />
      </MemoryRouter>,
    );

    expect(container.textContent).toContain('Machine Learning');
    expect(screen.queryByRole('button', { name: 'Machine Learning' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Explore cluster' }));
    expect(onSelect).toHaveBeenCalledWith('Machine Learning');
    expect(container.textContent).toContain('Cluster: experimental');
    expect(container.textContent).toContain('Cluster: metadata-grouped');
    expect(container.textContent).not.toContain('Cluster: metadata-grouped (V1)');
    expect(container.textContent).toContain('2 profiles');
    expect(container.textContent).toContain('1 pathway');
    expect(container.textContent).toContain('AI Lab');
    expect(container.querySelector('a[href="/research/ai-lab"]')).not.toBeNull();
  });

  it('gracefully renders profiles without slugs without broken links', () => {
    const { container } = render(
      <MemoryRouter>
        <TopicClusterCard
          cluster={{
            id: 'data-driven',
            label: 'Data-Driven Discovery',
            description: 'Profiles grouped by metadata.',
            matchReason: 'Shared department: Computer Science',
            entityCount: 1,
            paperCount: 0,
            pathwayCount: 0,
            peopleCount: 0,
            labels: ['Cluster: metadata-grouped'],
            metadataTags: [],
            entities: [
              {
                _id: 'entity-1',
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
            pathways: [],
            papers: [],
            evidence: [{ claim: '1 profile', sourceType: 'Research metadata' }],
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('link', { name: 'Legacy Entry' })).toBeNull();
    const legacyLabel = screen.getByText('Legacy Entry');
    expect(legacyLabel).toBeTruthy();
    expect(legacyLabel.getAttribute('title')).toBe('Profile link is not available yet.');
  });
});
