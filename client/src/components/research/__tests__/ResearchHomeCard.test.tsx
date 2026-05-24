import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ResearchHomeCard from '../ResearchHomeCard';
import type { ResearchCluster } from '../../../utils/researchDiscoveryAdapters';

afterEach(() => {
  cleanup();
});

const LocationProbe = () => {
  const location = useLocation();
  return <output aria-label="Current path">{location.pathname}</output>;
};

const researchHome = (overrides: Partial<ResearchCluster> = {}): ResearchCluster => ({
  id: 'example-research-home',
  label: 'Example Research Home',
  description: 'Studies systems neuroscience.',
  contextState: 'complete',
  contextLabel: 'Research description',
  contextLine: 'Neuroscience · School of Medicine',
  evidenceStatus: {
    label: 'Official Yale source found',
    state: 'official',
  },
  matchReason: 'Matched systems neuroscience.',
  entityCount: 1,
  paperCount: 0,
  pathwayCount: 0,
  peopleCount: 0,
  labels: ['Systems neuroscience'],
  metadataTags: ['Neuroscience'],
  entities: [
    {
      _id: 'entity-1',
      slug: 'example-research-home',
      name: 'Example Research Home',
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
      sourceUrls: ['https://research-home.example.test'],
    },
  ],
  pathways: [],
  papers: [],
  evidence: [
    {
      claim: 'Matched systems neuroscience.',
      sourceType: 'Yale research source',
      confidence: 'indexed source',
    },
  ],
  ...overrides,
});

describe('ResearchHomeCard', () => {
  it('frames profile results as research homes instead of clusters', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <ResearchHomeCard home={researchHome()} onSelect={onSelect} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Example Research Home' })).toBeTruthy();
    expect(container.textContent).toContain('Neuroscience · School of Medicine');
    expect(container.textContent).toContain('Systems Neuroscience');
    expect(container.textContent).toContain('Official Yale source found');
    expect(screen.queryByText('Research homes')).toBeNull();
    expect(container.textContent).toContain('Why it might fit');
    expect(container.textContent).toContain('Matched systems neuroscience.');
    expect(container.textContent).not.toContain('Why this matches');
    expect(container.textContent).not.toContain('1 contact');
    expect(container.textContent).not.toContain('1 next step');
    expect(container.textContent).not.toContain('Based on visible Yale metadata');
    expect(container.textContent).not.toContain('Cluster: experimental');
    expect(container.textContent).not.toContain('Cluster: metadata-grouped');
    expect(container.textContent).not.toContain('Profiles in this cluster');

    expect(screen.getByRole('link', { name: 'View profile →' }).getAttribute('href')).toBe(
      '/research/example-research-home',
    );
    expect(screen.getByRole('link', { name: 'Example Research Home' }).getAttribute('href')).toBe(
      '/research/example-research-home',
    );
    expect(screen.queryByRole('button', { name: 'Search this area' })).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
    expect(container.querySelector('a[href="/research/example-research-home"]')).not.toBeNull();
  });

  it('puts department and topic badges before summary and evidence badges', () => {
    const { container } = render(
      <MemoryRouter>
        <ResearchHomeCard
          home={researchHome({
            labels: ['social cognition'],
            metadataTags: ['computational modeling'],
          })}
        />
      </MemoryRouter>,
    );

    const text = container.textContent || '';
    expect(text.indexOf('Computational Modeling')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('Computational Modeling')).toBeLessThan(text.indexOf('Social Cognition'));
    expect(text.indexOf('Social Cognition')).toBeLessThan(text.indexOf('Research description'));
    expect(text.indexOf('Research description')).toBeLessThan(
      text.indexOf('Official Yale source found'),
    );
  });

  it('uses responsive topic caps with more-count badges', () => {
    render(
      <MemoryRouter>
        <ResearchHomeCard
          home={researchHome({
            labels: [
              'alpha topic modeling',
              'beta field methods',
              'gamma archive analysis',
              'delta source review',
              'epsilon data curation',
              'zeta visualization',
            ],
            metadataTags: ['Fixture Department'],
          })}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Fixture Department')).toBeTruthy();
    expect(screen.getByText('Alpha Topic Modeling')).toBeTruthy();
    expect(screen.getByText('Beta Field Methods')).toBeTruthy();
    expect(screen.getByText('Gamma Archive Analysis')).toBeTruthy();
    expect(screen.getByText('Delta Source Review').className).toContain('hidden');
    expect(screen.getByText('Delta Source Review').className).toContain('sm:inline-flex');
    expect(screen.getByText('Epsilon Data Curation').className).toContain('hidden');
    expect(screen.getByText('Epsilon Data Curation').className).toContain('sm:inline-flex');
    expect(screen.queryByText('Zeta Visualization')).toBeNull();
    expect(screen.getByText('+3 more').className).toContain('sm:hidden');
    expect(screen.getByText('+1 more').className).toContain('sm:inline-flex');
  });

  it('opens the research profile when the card body is clicked', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/research']}>
        <ResearchHomeCard home={researchHome()} />
        <LocationProbe />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole('link', { name: 'Open Example Research Home research profile' }),
    ).toBeNull();

    const card = container.querySelector('article');
    expect(card?.getAttribute('role')).toBeNull();
    fireEvent.click(card!);
    expect(screen.getByLabelText('Current path').textContent).toBe(
      '/research/example-research-home',
    );
  });

  it('shows ways-in badges from pathway and access-summary data inline', () => {
    const { container } = render(
      <MemoryRouter>
        <ResearchHomeCard
          home={researchHome({
            entityCount: 1,
            pathwayCount: 1,
            entities: [
              {
                ...researchHome().entities[0],
                accessSummary: {
                  status: 'posted-opening',
                  confidence: 0.9,
                  evidence: [
                    {
                      signalType: 'CURRENT_UNDERGRADS',
                      confidence: 'HIGH',
                      excerpt: 'Undergraduates are listed on the lab roster.',
                    },
                  ],
                  signalTypes: ['CURRENT_UNDERGRADS'],
                  entryPathwayTypes: ['EXPLORATORY_CONTACT'],
                  hasActivePostedOpportunity: true,
                  bestNextStep: 'Apply',
                },
              },
            ],
            pathways: [
              {
                _id: 'pathway-1',
                pathwayType: 'POSTED_ROLE',
                status: 'ACTIVE',
                evidenceStrength: 'DIRECT',
                studentFacingLabel: 'Posted opening',
                bestNextStepCategory: 'apply',
                compensation: 'STIPEND',
                sourceUrls: ['https://program.example.test/opening'],
                researchEntity: {
                  _id: 'entity-1',
                  slug: 'example-research-home',
                  name: 'Example Research Home',
                  departments: ['Neuroscience'],
                  researchAreas: ['Systems neuroscience'],
                },
                activePostedOpportunity: {
                  _id: 'opportunity-1',
                  title: 'Summer RA role',
                  status: 'OPEN',
                  provenance: 'SCRAPER_DERIVED',
                },
                contactRoute: {
                  routeType: 'OFFICIAL_APPLICATION',
                  label: 'Apply through program page',
                  url: 'https://program.example.test/opening',
                },
                evidence: [
                  {
                    signalType: 'POSTED_OPENING',
                    confidence: 'HIGH',
                    confidenceScore: 1,
                    sourceUrl: 'https://program.example.test/opening',
                  },
                ],
              },
            ],
          })}
        />
      </MemoryRouter>,
    );

    expect(container.textContent).toContain('Posted route');
    expect(container.textContent).not.toContain('Open role');
    expect(container.textContent).not.toContain('Paid/funded');
    expect(container.textContent).toContain('Contact route');
    expect(container.textContent).toContain('Undergrad evidence');
    expect(screen.getByRole('link', { name: 'View posted opportunity' }).getAttribute('href')).toBe(
      '/opportunities/opportunity-1',
    );
  });

  it('uses compact browse cards to preserve more description before click-through', () => {
    render(
      <MemoryRouter>
        <ResearchHomeCard
          variant="compact"
          home={researchHome({
            description:
              'Studies how synthetic signals move through fixture workflows, using modeling, simulation, and validation steps that help students understand the questions before opening the profile.',
          })}
        />
      </MemoryRouter>,
    );

    const description = screen.getByText(/Studies how synthetic signals move through fixture workflows/);
    expect(description.className).toContain('line-clamp-4');
    expect(description.className).not.toContain('line-clamp-2');
    expect(screen.getByRole('link', { name: 'View profile →' })).toBeTruthy();
  });

  it('keeps the profile list for grouped homes with more than one linked profile', () => {
    render(
      <MemoryRouter>
        <ResearchHomeCard
          home={researchHome({
            entities: [
              ...(researchHome().entities || []),
              {
                ...(researchHome().entities[0]),
                _id: 'entity-2',
                slug: 'related-research-home',
                name: 'Related Research Home',
              },
            ],
          })}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Research homes')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Example Research Home' }).getAttribute('href')).toBe(
      '/research/example-research-home',
    );
    expect(screen.getByRole('link', { name: 'Related Research Home' }).getAttribute('href')).toBe(
      '/research/related-research-home',
    );
  });

  it('shows sparse research context as a coverage state', () => {
    const { container } = render(
      <MemoryRouter>
        <ResearchHomeCard
          home={researchHome({
            description:
              'Review evidence and official source links for research homes connected to Computer Science.',
            contextState: 'sparse',
            contextLabel: 'Summary limited',
            evidenceStatus: {
              label: 'Evidence limited',
              state: 'limited',
            },
            metadataTags: ['Computer Science'],
            entities: [],
          })}
        />
      </MemoryRouter>,
    );

    expect(container.textContent).toContain('Summary limited');
    expect(container.textContent).toContain('Evidence limited');
    expect(container.textContent).not.toContain('Source-backed profile context');
    expect(container.textContent).toContain(
      'Review evidence and official source links',
    );
    expect(container.textContent).toContain('Computer Science');
  });

  it('searches a browse-only area with a student-facing CTA', () => {
    const onSelect = vi.fn();
    render(
      <MemoryRouter>
        <ResearchHomeCard
          home={researchHome({
            label: 'Computer Science',
            entities: [],
            metadataTags: ['Computer Science'],
          })}
          onSelect={onSelect}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Search this area' }));

    expect(screen.queryByRole('button', { name: 'Explore department' })).toBeNull();
    expect(onSelect).toHaveBeenCalledWith('Computer Science');
  });

  it('searches a browse-only area when the card body is clicked', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <ResearchHomeCard
          home={researchHome({
            label: 'Computer Science',
            entities: [],
            metadataTags: ['Computer Science'],
          })}
          onSelect={onSelect}
        />
      </MemoryRouter>,
    );

    const card = container.querySelector('article');
    expect(card?.getAttribute('role')).toBeNull();

    fireEvent.click(card!);

    expect(onSelect).toHaveBeenCalledWith('Computer Science');
  });

  it('renders homes without slugs without broken profile links', () => {
    render(
      <MemoryRouter>
        <ResearchHomeCard
          home={researchHome({
            entities: [
              {
                _id: 'legacy-entry',
                slug: '',
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
