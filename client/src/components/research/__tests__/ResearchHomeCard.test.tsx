import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ResearchHomeCard from '../ResearchHomeCard';
import type { ResearchCluster } from '../../../utils/researchDiscoveryAdapters';
import { sanitizeResearchEntityCopy } from '../../../utils/researchEntityCopy';
import ConfigContext, {
  defaultConfigContext,
  type ResearchAreaConfig,
} from '../../../contexts/ConfigContext';

const CANONICAL_AREAS: ResearchAreaConfig[] = [
  { name: 'Systems Neuroscience', field: 'Life Sciences', colorKey: 'blue', isDefault: false },
];
const areaByLowerName = new Map(CANONICAL_AREAS.map((area) => [area.name.toLowerCase(), area]));
const researchAreaConfigValue = {
  ...defaultConfigContext,
  researchAreas: CANONICAL_AREAS,
  getResearchAreaByName: (name: string) => areaByLowerName.get(name.toLowerCase()),
};

vi.mock('../../../utils/researchEntityCopy', async () => {
  const actual = await vi.importActual<typeof import('../../../utils/researchEntityCopy')>(
    '../../../utils/researchEntityCopy',
  );
  return {
    ...actual,
    sanitizeResearchEntityCopy: vi.fn(actual.sanitizeResearchEntityCopy),
  };
});

const renderSpy = vi.mocked(sanitizeResearchEntityCopy);

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
  matchReason: 'Matched systems neuroscience.',
  entityCount: 1,
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
      websiteUrl: '',
      location: '',
      departments: ['Neuroscience'],
      researchAreas: ['Systems neuroscience'],
      school: 'School of Medicine',
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
    expect(container.textContent).not.toContain('Evidence limited');
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

  it('sanitizes faculty research card descriptions without changing lab names', () => {
    const { container } = render(
      <MemoryRouter>
        <ResearchHomeCard
          home={researchHome({
            label: 'Fixture Faculty Research',
            description:
              'The Fixture Lab conducts research focused on synthetic systems. Review the lab site before contacting this lab.',
            entities: [
              {
                ...researchHome().entities[0],
                name: 'Fixture Faculty Research',
                displayName: 'Fixture Faculty Research',
                kind: 'individual',
                entityType: 'FACULTY_RESEARCH_AREA',
              },
            ],
          })}
        />
      </MemoryRouter>,
    );

    expect(container.textContent).toContain('Fixture Faculty Research');
    expect(container.textContent).toContain("Fixture's research focuses on synthetic systems");
    expect(container.textContent).toContain(
      'research website before contacting this research profile',
    );
    expect(container.textContent).not.toContain('lab site');
    expect(container.textContent).not.toContain('this lab');
  });

  it('puts department and topic badges before the coverage warning and the summary', () => {
    const { container } = render(
      <MemoryRouter>
        <ResearchHomeCard
          variant="compact"
          home={researchHome({
            labels: ['social cognition'],
            metadataTags: ['computational modeling'],
            contextState: 'sparse',
            contextLabel: 'Summary limited',
          })}
        />
      </MemoryRouter>,
    );

    const text = container.textContent || '';
    expect(text.indexOf('Computational Modeling')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('Computational Modeling')).toBeLessThan(text.indexOf('Social Cognition'));
    expect(text.indexOf('Social Cognition')).toBeLessThan(text.indexOf('Summary limited'));
    expect(text.indexOf('Summary limited')).toBeLessThan(
      text.indexOf('Studies systems neuroscience'),
    );
  });

  it('surfaces duplicate review flags for admin quality review', () => {
    render(
      <MemoryRouter>
        <ResearchHomeCard
          showAdminQuality
          home={researchHome({
            entities: [
              {
                ...researchHome().entities[0],
                qualitySummary: {
                  descriptionState: 'missing',
                  leadState: 'lead_missing',
                  repairFlags: ['duplicate_risk', 'missing_description'],
                  score: 94,
                },
              },
            ],
          })}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Duplicate review')).toBeTruthy();
    expect(screen.getByText('Needs description')).toBeTruthy();
  });

  it('elevates a genuine undergrad-hosting signal to the prominent lead line', () => {
    render(
      <MemoryRouter>
        <ResearchHomeCard
          home={researchHome({ wayInBadges: ['Contact route', 'Undergrad evidence'] })}
        />
      </MemoryRouter>,
    );

    const lead = screen.getByText('Has hosted undergraduate researchers');
    expect(lead.className).toContain('font-semibold');
    expect(lead.className).not.toContain('yr-pill');
    expect(screen.getByText('Open to inquiries').className).toContain('yr-pill');
  });

  it('does not elevate a fallback contact route to the prominent lead line', () => {
    render(
      <MemoryRouter>
        <ResearchHomeCard home={researchHome({ wayInBadges: ['Contact route'] })} />
      </MemoryRouter>,
    );

    const chip = screen.getByText('Open to inquiries');
    expect(chip.className).toContain('yr-pill');
    expect(chip.className).not.toContain('font-semibold');
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

  it('renders research-area topic chips in blue to match the entity-page "Best fit for" chips', () => {
    render(
      <MemoryRouter>
        <ResearchHomeCard
          home={researchHome({
            labels: [
              'alpha topic modeling',
              'beta field methods',
              'gamma archive analysis',
              'delta source review',
            ],
            metadataTags: ['Fixture Department'],
          })}
        />
      </MemoryRouter>,
    );

    const alwaysVisibleChip = screen.getByText('Alpha Topic Modeling');
    expect(alwaysVisibleChip.className).toContain('yr-pill');
    expect(alwaysVisibleChip.className).toContain('yr-pill-blue');

    const desktopOnlyChip = screen.getByText('Delta Source Review');
    expect(desktopOnlyChip.className).toContain('yr-pill');
    expect(desktopOnlyChip.className).toContain('yr-pill-blue');
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

  it('does not link principal investigators to internal profiles from Yale email alone', () => {
    render(
      <MemoryRouter>
        <ResearchHomeCard
          home={researchHome({
            peopleCount: 1,
            entities: [
              {
                ...researchHome().entities[0],
                contactName: 'Fixture Researcher',
                contactRole: 'Principal investigator',
                contactEmail: 'fixture.researcher@yale.edu',
              },
            ],
          })}
          variant="compact"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Principal Investigator:')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Fixture Researcher' })).toBeNull();
  });

  it('links principal investigators to official profile sources when no Yale email is present', () => {
    render(
      <MemoryRouter>
        <ResearchHomeCard
          home={researchHome({
            peopleCount: 1,
            entities: [
              {
                ...researchHome().entities[0],
                contactName: 'Fixture Scholar',
                contactRole: 'Principal investigator',
                contactEmail: '',
                sourceUrls: ['https://medicine.yale.edu/profile/fixture-scholar/'],
              },
            ],
          })}
          variant="compact"
        />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: 'Fixture Scholar' });
    expect(link.getAttribute('href')).toBe('https://medicine.yale.edu/profile/fixture-scholar/');
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

    const description = screen.getByText(
      /Studies how synthetic signals move through fixture workflows/,
    );
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
                ...researchHome().entities[0],
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

  it('shows sparse research context as a coverage state on the compact browse card', () => {
    const { container } = render(
      <MemoryRouter>
        <ResearchHomeCard
          variant="compact"
          home={researchHome({
            description:
              'Review evidence and official source links for research homes connected to Computer Science.',
            contextState: 'sparse',
            contextLabel: 'Summary limited',
            metadataTags: ['Computer Science'],
            entities: [],
          })}
        />
      </MemoryRouter>,
    );

    expect(container.textContent).toContain('Summary limited');
    expect(container.textContent).not.toContain('Evidence limited');
    expect(container.textContent).not.toContain('Source-backed profile context');
    expect(container.textContent).toContain('Review evidence and official source links');
    expect(container.textContent).toContain('Computer Science');
  });

  it('badges no coverage state when the summary is the research home own description', () => {
    const { container } = render(
      <MemoryRouter>
        <ResearchHomeCard
          variant="compact"
          home={researchHome({ contextState: 'complete', contextLabel: 'Research description' })}
        />
      </MemoryRouter>,
    );

    expect(container.textContent).toContain('Studies systems neuroscience');
    expect(container.textContent).not.toContain('Research description');
    expect(container.textContent).not.toContain('Summary limited');
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
                websiteUrl: '',
                location: '',
                departments: ['Computer Science'],
                researchAreas: ['Data Science'],
                school: 'Yale College',
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

  it('renders a canonical research-area label as an inert display pill', () => {
    render(
      <MemoryRouter initialEntries={['/research']}>
        <ConfigContext.Provider value={researchAreaConfigValue}>
          <ResearchHomeCard home={researchHome()} />
        </ConfigContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('link', { name: /Systems Neuroscience/ })).toBeNull();
    expect(screen.getByText('Systems Neuroscience').tagName).toBe('SPAN');
  });

  it('keeps non-area topic labels as inert display pills', () => {
    render(
      <MemoryRouter initialEntries={['/research']}>
        <ConfigContext.Provider value={researchAreaConfigValue}>
          <ResearchHomeCard home={researchHome({ labels: ['bespoke method label'] })} />
        </ConfigContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getByText('Bespoke Method Label').tagName).toBe('SPAN');
  });

  it('does not re-render an unchanged home when its parent re-renders on append', () => {
    const stableHome = researchHome();
    const stableSelect = vi.fn();

    const AppendingGrid = () => {
      const [appendedCount, setAppendedCount] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setAppendedCount((count) => count + 1)}>
            Append page
          </button>
          <output aria-label="Appended pages">{appendedCount}</output>
          <ResearchHomeCard home={stableHome} onSelect={stableSelect} />
        </>
      );
    };

    render(
      <MemoryRouter>
        <AppendingGrid />
      </MemoryRouter>,
    );

    const rendersAfterMount = renderSpy.mock.calls.length;
    expect(rendersAfterMount).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Append page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Append page' }));

    expect(screen.getByLabelText('Appended pages').textContent).toBe('2');
    expect(renderSpy.mock.calls.length).toBe(rendersAfterMount);
  });
});
