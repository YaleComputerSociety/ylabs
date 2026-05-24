import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LabDetail from '../labDetail';
import axios from '../../utils/axios';
import { LabDetailPayload } from '../../types/labDetail';

vi.mock('../../utils/axios', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const DEFAULT_SLUG = 'sample-research-profile';
const DEFAULT_ENTITY_NAME = 'Sample Research Profile';
const OFFICIAL_PROFILE_URL = 'https://profile.example.test/profile/sample-faculty';
const OFFICIAL_ROUTE_URL = 'https://official-route.example.test/contact';
const RESEARCH_WEBSITE_URL = 'https://research-home.example.test/sample-lab/';
const JOIN_LAB_WEBSITE_URL = 'https://join-lab.example.test/';
const JOIN_PAGE_URL = 'https://join-lab.example.test/join-us';
const FACULTY_ROSTER_URL = 'https://example.yale.edu/people/faculty';
const FACULTY_PROFILE_URL = 'https://profile.example.test/profile/example-person';
const FACULTY_AFFILIATED_PROFILE_URL =
  'https://profile.example.test/people/faculty-affiliated/example-person';
const FALLBACK_PROFILE_URL = 'https://source.example.test/profile/source-profile';
const EXAMPLE_MECHANISM_DOI = 'https://doi.org/10.1000/example-mechanism';
const EXAMPLE_SYSTEMS_DOI = 'https://doi.org/10.1000/example-systems';
const MATERIALS_LAB_WEBSITE_URL = 'https://lab-home.example.test/materials/';
const FACULTY_HOME_URL = 'https://faculty-home.example.test/research/';
const DEPARTMENT_HOME_URL = 'https://department.example.test/';
const DEPARTMENT_PEOPLE_URL = 'https://department.example.test/people?page=18';

const basePayload: LabDetailPayload = {
  group: {
    _id: 'entity-1',
    slug: DEFAULT_SLUG,
    name: DEFAULT_ENTITY_NAME,
    kind: 'individual',
    entityType: 'FACULTY_RESEARCH_AREA',
    description: 'Studies mechanisms of neurological disease.',
    websiteUrl: OFFICIAL_PROFILE_URL,
    location: '',
    departments: ['Neurology'],
    researchAreas: ['Neuroscience'],
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
  members: [],
  recentPapers: [],
  recentArxivPreprints: [],
  activeListings: [],
  entryPathways: [],
  accessSignals: [],
  contactRoutes: [],
  postedOpportunities: [],
};

function renderLabDetail(payload: LabDetailPayload = basePayload) {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url === '/users/savedResearchPlanIds') {
      return Promise.resolve({ data: { savedResearchPlanIds: [] } });
    }
    if (url === `/research/${DEFAULT_SLUG}`) {
      return Promise.resolve({ data: payload });
    }
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });

  return render(
    <MemoryRouter initialEntries={[`/research/${DEFAULT_SLUG}`]}>
      <Routes>
        <Route path="/research/:slug" element={<LabDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe('LabDetail page', () => {
  it('shows an official-profile next step when no pathways or contact routes exist', async () => {
    renderLabDetail();

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(
      screen.getByText('Review the official profile first, then decide whether targeted outreach is appropriate.'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open official profile' }).getAttribute('href')).toBe(
      OFFICIAL_PROFILE_URL,
    );
    expect(screen.getByText('Profile status')).toBeTruthy();
    expect(screen.getByText('Source-backed details')).toBeTruthy();
    expect(screen.getByText('Still missing')).toBeTruthy();
    expect(
      screen.getByText('No action-ready or evidence-backed ways in are indexed yet.'),
    ).toBeTruthy();
    expect(screen.queryByText('Ways In')).toBeNull();
    expect(screen.queryByText('Evidence')).toBeNull();
  });

  it('lets students save an indexed pathway as a research plan from the profile summary', async () => {
    mockedAxios.put.mockResolvedValue({ data: {} });

    renderLabDetail({
      ...basePayload,
      entryPathways: [
        {
          _id: 'pathway-1',
          pathwayType: 'EXPLORATORY_CONTACT',
          status: 'PLAUSIBLE',
          evidenceStrength: 'MODERATE',
          studentFacingLabel: 'Plan careful outreach',
          explanation: 'An official Yale faculty profile is available.',
          bestNextStep: 'Review the profile before outreach.',
          sourceUrls: [OFFICIAL_PROFILE_URL],
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    const saveButton = screen.getByRole('button', { name: 'Save research plan' });
    fireEvent.click(saveButton);

    expect(mockedAxios.put).toHaveBeenCalledWith('/users/savedResearchPlans', {
      withCredentials: true,
      data: { savedResearchPlans: ['pathway-1'] },
    });
    expect(screen.getByRole('button', { name: 'Saved to Dashboard' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Research plan saved');
  });

  it('saves the research plan when students click the visible save row label', async () => {
    mockedAxios.put.mockResolvedValue({ data: {} });

    renderLabDetail({
      ...basePayload,
      entryPathways: [
        {
          _id: 'pathway-1',
          pathwayType: 'EXPLORATORY_CONTACT',
          status: 'PLAUSIBLE',
          evidenceStrength: 'MODERATE',
          studentFacingLabel: 'Plan careful outreach',
          explanation: 'An official Yale faculty profile is available.',
          bestNextStep: 'Review the profile before outreach.',
          sourceUrls: [OFFICIAL_PROFILE_URL],
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    fireEvent.click(screen.getByText('Save research plan'));

    expect(mockedAxios.put).toHaveBeenCalledWith('/users/savedResearchPlans', {
      withCredentials: true,
      data: { savedResearchPlans: ['pathway-1'] },
    });
    expect(screen.getByRole('button', { name: 'Saved to Dashboard' })).toBeTruthy();
  });

  it('shows the research-plan save action with the student decision summary', async () => {
    renderLabDetail({
      ...basePayload,
      entryPathways: [
        {
          _id: 'pathway-1',
          pathwayType: 'EXPLORATORY_CONTACT',
          status: 'PLAUSIBLE',
          evidenceStrength: 'MODERATE',
          studentFacingLabel: 'Plan careful outreach',
          explanation: 'An official Yale faculty profile is available.',
          bestNextStep: 'Review the profile before outreach.',
          sourceUrls: [OFFICIAL_PROFILE_URL],
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.getByRole('button', { name: 'Save research plan' })).toBeTruthy();
    expect(screen.getByText('Student decision')).toBeTruthy();
  });

  it('surfaces the lead professor profile in the student decision panel', async () => {
    renderLabDetail({
      ...basePayload,
      members: [
        {
          role: 'pi',
          user: {
            netid: 'fixture.faculty',
            fname: 'Jordan',
            lname: 'Researcher',
            displayName: 'Jordan Researcher',
            title: 'Professor of Example Studies',
            primary_department: 'Example Studies',
          },
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    const leadProfessorLabel = screen.getByText('Lead professor');
    const profileLinks = screen.getAllByRole('link', { name: /Jordan Researcher/ });

    expect(leadProfessorLabel).toBeTruthy();
    expect(profileLinks[0].getAttribute('href')).toBe('/profile/fixture.faculty');
    expect(screen.getByText('Professor of Example Studies · Example Studies')).toBeTruthy();
    expect(screen.getByText('Recommended next step')).toBeTruthy();
  });

  it('labels the sidebar as a contact route instead of repeating next-step language', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        contactEmail: 'lab-contact@example.test',
      },
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.getByRole('heading', { name: 'Contact route' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Plan your next step' })).toBeNull();
  });

  it('falls back to a source URL when no official website is available', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        websiteUrl: '',
        sourceUrls: [FALLBACK_PROFILE_URL],
      },
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.getByRole('link', { name: 'Open official profile' }).getAttribute('href')).toBe(
      FALLBACK_PROFILE_URL,
    );
  });

  it('keeps richer next-step behavior when pathways and contact routes exist', async () => {
    renderLabDetail({
      ...basePayload,
      entryPathways: [
        {
          _id: 'pathway-1',
          pathwayType: 'EXPLORATORY_CONTACT',
          status: 'ACTIVE',
          evidenceStrength: 'SOURCE_BACKED',
          studentFacingLabel: 'Plan careful outreach',
          explanation: 'Review the profile before outreach.',
          bestNextStep: 'Contact the program manager through the listed route.',
          sourceUrls: [OFFICIAL_PROFILE_URL],
        },
      ],
      contactRoutes: [
        {
          _id: 'route-1',
          routeType: 'PROGRAM_MANAGER',
          label: 'Program manager',
          rationale: 'This route is listed by the program.',
          url: OFFICIAL_ROUTE_URL,
          sourceUrl: OFFICIAL_PROFILE_URL,
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.getAllByText('Contact the program manager through the listed route.')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Open official route' }).getAttribute('href')).toBe(
      OFFICIAL_ROUTE_URL,
    );
    expect(screen.getByRole('link', { name: 'Open official profile' }).getAttribute('href')).toBe(
      OFFICIAL_PROFILE_URL,
    );
  });

  it('uses the research website as the first public next step for exploratory profile routes', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        slug: 'example-field-lab',
        name: 'Example Field Lab',
        websiteUrl: RESEARCH_WEBSITE_URL,
        sourceUrls: [
          FACULTY_ROSTER_URL,
          FACULTY_AFFILIATED_PROFILE_URL,
          RESEARCH_WEBSITE_URL,
        ],
      },
      entryPathways: [
        {
          _id: 'pathway-1',
          pathwayType: 'EXPLORATORY_CONTACT',
          status: 'PLAUSIBLE',
          evidenceStrength: 'MODERATE',
          studentFacingLabel: 'Explore the PI profile',
          explanation: 'An official Yale faculty profile is available.',
          bestNextStep: 'Review the PI profile and lab site first.',
          sourceUrls: [
            FACULTY_AFFILIATED_PROFILE_URL,
            RESEARCH_WEBSITE_URL,
          ],
        },
      ],
      contactRoutes: [
        {
          _id: 'route-1',
          routeType: 'FACULTY_PI',
          label: 'Example Faculty',
          rationale: 'Official Yale faculty profile for the PI; review it before outreach.',
          url: FACULTY_AFFILIATED_PROFILE_URL,
          sourceUrl: FACULTY_AFFILIATED_PROFILE_URL,
        },
      ],
      accessSignals: [
        {
          _id: 'signal-1',
          signalType: 'REACH_OUT_PLAUSIBLE',
          confidence: 'MEDIUM',
          sourceUrl: FACULTY_AFFILIATED_PROFILE_URL,
        },
      ],
    });

    await screen.findByText('Example Field Lab');

    expect(screen.getByRole('link', { name: 'Open official profile' }).getAttribute('href')).toBe(
      FACULTY_AFFILIATED_PROFILE_URL,
    );
    expect(screen.queryByText('Faculty page')).toBeNull();
    expect(screen.queryByText('Example Person page')).toBeNull();
    expect(screen.getByText('Research website')).toBeTruthy();
  });

  it('links official profile to the PI profile and never surfaces the faculty roster list', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        slug: 'example-roster-filtered-lab',
        name: 'Example Roster Filtered Lab',
        websiteUrl: RESEARCH_WEBSITE_URL,
        sourceUrls: [
          FACULTY_ROSTER_URL,
          FACULTY_PROFILE_URL,
          RESEARCH_WEBSITE_URL,
        ],
      },
      contactRoutes: [
        {
          _id: 'route-1',
          routeType: 'FACULTY_PI',
          label: 'Example Faculty',
          rationale: 'Official Yale faculty profile for the PI; review it before outreach.',
          url: FACULTY_PROFILE_URL,
          sourceUrl: FACULTY_PROFILE_URL,
        },
      ],
    });

    const { container } = await waitFor(() => {
      expect(screen.getByText('Example Roster Filtered Lab')).toBeTruthy();
      return { container: document.body };
    });

    expect(screen.getByRole('link', { name: 'Open official profile' }).getAttribute('href')).toBe(
      FACULTY_PROFILE_URL,
    );
    expect(screen.getByRole('link', { name: 'Visit lab website' }).getAttribute('href')).toBe(
      RESEARCH_WEBSITE_URL,
    );
    expect(container.textContent).toContain('profile.example.test source');
    expect(container.textContent).not.toContain('Faculty page');
    expect(
      Array.from(container.querySelectorAll('a')).some(
        (link) => link.getAttribute('href') === FACULTY_ROSTER_URL,
      ),
    ).toBe(false);
  });

  it('leads sparse profiles with a student decision summary before evidence details', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        slug: 'example-sparse-lab',
        name: 'Example Sparse Lab',
        kind: 'lab',
        entityType: 'LAB',
        description: 'Studies fixture evolution, population models, and synthetic DNA examples.',
        websiteUrl: RESEARCH_WEBSITE_URL,
        departments: ['Ecology and Evolutionary Biology'],
        researchAreas: ['fixture evolution', 'population models', 'synthetic DNA examples'],
        profileResearchAreas: ['Computational biology', 'Anthropology'],
        school: 'Fixture Faculty of Arts and Sciences',
        sourceUrls: [FACULTY_PROFILE_URL],
      },
      entryPathways: [
        {
          _id: 'pathway-1',
          pathwayType: 'EXPLORATORY_CONTACT',
          status: 'PLAUSIBLE',
          evidenceStrength: 'MODERATE',
          studentFacingLabel: 'Explore the PI profile',
          explanation: 'An official Yale faculty profile is available.',
          bestNextStep: 'Review the PI profile and lab site first.',
          sourceUrls: [FACULTY_PROFILE_URL],
        },
      ],
      contactRoutes: [
        {
          _id: 'route-1',
          routeType: 'FACULTY_PI',
          label: 'Example Faculty',
          rationale: 'Official Yale faculty profile for the PI; review it before outreach.',
          url: FACULTY_PROFILE_URL,
          sourceUrl: FACULTY_PROFILE_URL,
        },
      ],
      accessSignals: [
        {
          _id: 'signal-1',
          signalType: 'REACH_OUT_PLAUSIBLE',
          confidence: 'MEDIUM',
          confidenceScore: 0.7,
          sourceUrl: FACULTY_PROFILE_URL,
        },
      ],
    });

    const { container } = await waitFor(() => {
      expect(screen.getByText('Example Sparse Lab')).toBeTruthy();
      return { container: document.body };
    });

    const text = container.textContent || '';
    expect(text).toContain('What this lab studies');
    expect(text).toContain('Best fit for');
    expect(screen.getByText('Fixture Evolution')).toBeTruthy();
    expect(screen.getByText('Population Models')).toBeTruthy();
    expect(screen.getByText('Synthetic DNA Examples')).toBeTruthy();
    expect(text).toContain('Recommended next step');
    expect(text).not.toContain('Why this matched');
    expect(text).not.toContain('Student fit');
    expect(text).not.toContain('Likely preparation');
    expect(text).not.toContain('Good fit if you are interested in');
    expect(text).toContain('Profile status');
    expect(text).not.toContain('Recommended outreach angle');
    expect(text.indexOf('What this lab studies')).toBeLessThan(text.indexOf('Profile status'));
    expect(screen.getByRole('link', { name: 'Open official profile' }).getAttribute('href')).toBe(
      FACULTY_PROFILE_URL,
    );
    expect(screen.queryByRole('link', { name: 'Example Faculty' })).toBeNull();
  });

  it('separates the official PI profile from the lab website for faculty lab pages', async () => {
    const { container } = renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        slug: 'example-separate-profile-lab',
        name: 'Example Separate Profile Lab',
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: RESEARCH_WEBSITE_URL,
        shortDescription: 'Co-Director of Graduate Studies',
        sourceUrls: [
          FACULTY_PROFILE_URL,
          RESEARCH_WEBSITE_URL,
        ],
        departments: ['Statistics & Data Science'],
        researchAreas: ['Mathematical Statistics', 'Machine Learning'],
      },
      entryPathways: [
        {
          _id: 'pathway-1',
          pathwayType: 'EXPLORATORY_CONTACT',
          status: 'PLAUSIBLE',
          evidenceStrength: 'MODERATE',
          studentFacingLabel: 'Explore the PI profile',
          explanation: 'An official Yale faculty profile is available.',
          bestNextStep:
            'Review the PI profile and lab site first, then decide whether targeted exploratory outreach is appropriate.',
          sourceUrls: [
            FACULTY_PROFILE_URL,
            RESEARCH_WEBSITE_URL,
          ],
        },
      ],
      contactRoutes: [
        {
          _id: 'route-1',
          routeType: 'FACULTY_PI',
          label: 'Example Faculty',
          rationale: 'Official Yale faculty profile for the PI; review it before outreach.',
          url: FACULTY_PROFILE_URL,
          sourceUrl: FACULTY_PROFILE_URL,
          visibility: 'PUBLIC',
        },
      ],
      accessSignals: [
        {
          _id: 'signal-1',
          signalType: 'REACH_OUT_PLAUSIBLE',
          confidence: 'MEDIUM',
          sourceUrl: FACULTY_PROFILE_URL,
        },
      ],
    } as LabDetailPayload);

    await screen.findByText('Example Separate Profile Lab');

    expect(screen.getByRole('link', { name: 'Open official profile' }).getAttribute('href')).toBe(
      FACULTY_PROFILE_URL,
    );
    expect(screen.getByRole('link', { name: 'Visit lab website' }).getAttribute('href')).toBe(
      RESEARCH_WEBSITE_URL,
    );
    expect(screen.queryByRole('link', { name: 'Open official route' })).toBeNull();
    expect(screen.queryByText('Co-Director of Graduate Studies')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Contact route' })).toBeNull();
    expect(container.textContent).toContain('What this lab studies');
  });

  it('prefers the lab website action when a contact route opens the lab homepage', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        slug: 'example-homepage-route-lab',
        name: 'Example Homepage Route Lab',
        websiteUrl: RESEARCH_WEBSITE_URL,
        sourceUrls: [
          FACULTY_PROFILE_URL,
          RESEARCH_WEBSITE_URL,
        ],
        departments: ['Psychology'],
        researchAreas: ['Decision neuroscience'],
      },
      contactRoutes: [
        {
          _id: 'route-1',
          routeType: 'FACULTY_PI',
          label: 'Example Faculty',
          url: FACULTY_PROFILE_URL,
          sourceUrl: FACULTY_PROFILE_URL,
          visibility: 'PUBLIC',
        },
        {
          _id: 'route-2',
          routeType: 'PROGRAM_MANAGER',
          label: 'Lab website',
          url: RESEARCH_WEBSITE_URL.replace(/\/$/, ''),
          sourceUrl: RESEARCH_WEBSITE_URL,
          visibility: 'PUBLIC',
        },
      ],
    } as LabDetailPayload);

    await screen.findByText('Example Homepage Route Lab');

    expect(screen.getByRole('link', { name: 'Open official profile' }).getAttribute('href')).toBe(
      FACULTY_PROFILE_URL,
    );
    expect(screen.getByRole('link', { name: 'Visit lab website' }).getAttribute('href')).toBe(
      RESEARCH_WEBSITE_URL,
    );
    expect(screen.queryByRole('link', { name: 'Open official route' })).toBeNull();
  });

  it('keeps a lab homepage separate from a join page official route', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        slug: 'example-join-route-lab',
        name: 'Example Join Route Lab',
        websiteUrl: JOIN_LAB_WEBSITE_URL,
        sourceUrls: [
          FACULTY_PROFILE_URL,
          JOIN_LAB_WEBSITE_URL,
        ],
        departments: ['Psychology'],
        researchAreas: ['Social cognition'],
      },
      entryPathways: [
        {
          _id: 'pathway-1',
          pathwayType: 'EXPLORATORY_CONTACT',
          status: 'PLAUSIBLE',
          evidenceStrength: 'MODERATE',
          studentFacingLabel: 'Exploratory outreach',
          bestNextStep: 'Plan a specific outreach note that references the group’s work.',
          sourceUrls: [JOIN_PAGE_URL],
        },
      ],
      contactRoutes: [
        {
          _id: 'route-1',
          routeType: 'OFFICIAL_APPLICATION',
          label: 'Join us',
          url: JOIN_PAGE_URL,
          sourceUrl: JOIN_PAGE_URL,
          visibility: 'PUBLIC',
        },
      ],
    } as LabDetailPayload);

    await screen.findByText('Example Join Route Lab');

    expect(screen.getByRole('link', { name: 'Visit lab website' }).getAttribute('href')).toBe(
      JOIN_LAB_WEBSITE_URL,
    );
    const officialRouteLinks = screen.getAllByRole('link', { name: 'Open official route' });
    expect(officialRouteLinks).toHaveLength(2);
    expect(officialRouteLinks.map((link) => link.getAttribute('href'))).toEqual(
      expect.arrayContaining([JOIN_PAGE_URL]),
    );
    expect(officialRouteLinks.every((link) => link.getAttribute('href') === JOIN_PAGE_URL)).toBe(true);
    expect(screen.queryByRole('link', { name: 'Open official profile' })).toBeNull();
  });

  it('renders related labs and groups for umbrella research entities', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        slug: 'center-example-quantum-institute',
        name: 'Example Quantum Institute',
        kind: 'institute',
        entityType: 'INSTITUTE',
      },
      entityRelationships: [
        {
          _id: 'rel-1',
          sourceResearchEntityId: 'entity-1',
          targetResearchEntityId: 'entity-2',
          relationshipType: 'MEMBER_RESEARCH_AREA',
          label: 'Faculty research area',
          evidenceStrength: 'MODERATE',
        },
      ],
      relatedResearchEntities: [
        {
          ...basePayload.group,
          _id: 'entity-2',
          id: 'entity-2',
          slug: 'faculty-research-area-example-member',
          name: 'Example Member Research',
          kind: 'individual',
          entityType: 'FACULTY_RESEARCH_AREA',
          departments: ['Applied Physics'],
          researchAreas: ['Quantum error correction'],
          sourceUrls: [],
        },
      ],
    });

    await screen.findByText('Example Quantum Institute');

    expect(screen.getByText('Related labs and groups')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Example Member Research/ }).getAttribute('href')).toBe(
      '/research/faculty-research-area-example-member',
    );
    expect(screen.getByText('Faculty research area')).toBeTruthy();
  });

  it('renders umbrella affiliations for related faculty research areas', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        slug: 'faculty-research-area-example-affiliate',
        name: 'Example Affiliate Research',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
      },
      affiliatedRelationships: [
        {
          _id: 'rel-2',
          sourceResearchEntityId: 'entity-umbrella',
          targetResearchEntityId: 'entity-1',
          relationshipType: 'MEMBER_RESEARCH_AREA',
          label: 'Faculty research area',
          evidenceStrength: 'MODERATE',
        },
      ],
      affiliatedResearchEntities: [
        {
          ...basePayload.group,
          _id: 'entity-umbrella',
          id: 'entity-umbrella',
          slug: 'center-example-umbrella',
          name: 'Example Umbrella Institute',
          kind: 'institute',
          entityType: 'INSTITUTE',
          departments: ['Neuroscience'],
          researchAreas: [],
          sourceUrls: [],
        },
      ],
    });

    await screen.findByText('Example Affiliate Research');

    expect(screen.getByText('Affiliated with')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Example Umbrella Institute/ }).getAttribute('href')).toBe(
      '/research/center-example-umbrella',
    );
  });

  it('does not render inferred student-fit preparation from topic metadata', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        slug: 'example-health-systems-profile',
        name: 'Example Health Systems Profile',
        description: 'Studies emergency medicine, health disparities, data systems, and public health research.',
        departments: ['Fixture School of Medicine'],
        researchAreas: [
          'Emergency Medicine',
          'Health Disparities',
          'Data Systems',
          'Public Health Research',
        ],
        school: 'Fixture School of Medicine',
      },
      accessSignals: [
        {
          _id: 'signal-1',
          signalType: 'REACH_OUT_PLAUSIBLE',
          confidence: 'MEDIUM',
          sourceUrl: OFFICIAL_PROFILE_URL,
        },
      ],
    });

    await screen.findByText('Example Health Systems Profile');

    expect(screen.getByText('Best fit for')).toBeTruthy();
    expect(screen.queryByText('This lab appears to study')).toBeNull();
    expect(screen.queryByText('Good fit if you are interested in')).toBeNull();
    expect(screen.queryByText('Student fit')).toBeNull();
    expect(screen.queryByText('Likely preparation')).toBeNull();
    expect(screen.queryByText('computational or statistical analysis')).toBeNull();
    expect(screen.getAllByText('Emergency Medicine').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Health Disparities').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Data Systems').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Public Health Research').length).toBeGreaterThan(0);
  });

  it('renders detail labels and empty states as visible copy', async () => {
    renderLabDetail();

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.getByText('Profile status')).toBeTruthy();
    expect(screen.getByText('Source-backed details')).toBeTruthy();
    expect(
      screen.getByText('No action-ready or evidence-backed ways in are indexed yet.'),
    ).toBeTruthy();
  });

  it('does not render legacy active listings as a public detail section', async () => {
    const { container } = renderLabDetail();

    await screen.findByText(DEFAULT_ENTITY_NAME);
    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith(
        `/research/${DEFAULT_SLUG}`,
        expect.any(Object),
      );
    });

    const text = container.textContent || '';
    const principalInvestigatorIndex = text.indexOf('Principal Investigator');
    const sparseProfileIndex = text.indexOf('Profile status');
    const sourcesIndex = text.indexOf('Sources');

    expect(text).not.toContain('Active Opportunities');
    expect(text).toContain('No principal investigator is attached yet');
    expect(text).toContain('Check the official profile for current lab leadership.');
    expect(principalInvestigatorIndex).toBeGreaterThan(-1);
    expect(sparseProfileIndex).toBeGreaterThan(-1);
    expect(sourcesIndex).toBeGreaterThan(principalInvestigatorIndex);
    expect(text).not.toContain('Research Activity');
    expect(text).not.toContain('Ways In');
    expect(text).not.toContain('Access evidence has not been attached yet.Evidence');
  });

  it('renders direct scholarly links as related research cards that cite the real destination', async () => {
    renderLabDetail({
      ...basePayload,
      researchActivityLinks: [
        {
          _id: 'link-1',
          relationshipBasis: 'explicit_entity_link',
          evidenceLabel: 'Linked to this research profile',
          title: 'Example research mechanism study',
          url: EXAMPLE_MECHANISM_DOI,
          destinationKind: 'DOI',
          displaySource: 'DOI',
          discoveredVia: 'OPENALEX',
          year: 2024,
          venue: 'Fixture Discovery Journal',
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.getByText('Related Research')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Example research mechanism study' });
    expect(link.getAttribute('href')).toBe(EXAMPLE_MECHANISM_DOI);
    expect(screen.getByText('DOI')).toBeTruthy();
    expect(screen.queryByText('Found via OpenAlex')).toBeNull();
  });

  it('renders member profile publications as recent professor work with a profile handoff', async () => {
    renderLabDetail({
      ...basePayload,
      members: [
        {
          role: 'pi',
          user: {
            _id: 'user-1',
            netid: 'fixture.scholar',
            fname: 'Fixture',
            lname: 'Scholar',
            title: 'Professor of Computer Science',
            primary_department: 'Computer Science',
          },
        },
      ],
      researchActivityLinks: [
        {
          _id: 'profile-pub-1',
          relationshipBasis: 'member_authorship',
          evidenceLabel: 'Authored by a listed professor',
          userId: 'user-1',
          title: 'Example systems publication',
          url: EXAMPLE_SYSTEMS_DOI,
          destinationKind: 'DOI',
          displaySource: 'DOI',
          discoveredVia: 'MANUAL',
          year: 2025,
          venue: 'Fixture Preprint Archive',
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.getByText('Recent work by Fixture Scholar')).toBeTruthy();
    expect(screen.queryByText('Research Activity')).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Example systems publication' }).getAttribute('href'),
    ).toBe(EXAMPLE_SYSTEMS_DOI);
    expect(
      screen.getByRole('link', { name: 'View all research activity on Fixture Scholar’s profile' }).getAttribute('href'),
    ).toBe('/profile/fixture.scholar?tab=research');
  });

  it('does not render YSM publication chrome as research description or area tags', async () => {
    renderLabDetail({
      ...basePayload,
      group: undefined,
      researchEntity: {
        ...basePayload.group,
        slug: 'example-publication-chrome-lab',
        name: 'Example Publication Chrome Lab',
        description: '',
        shortDescription: 'Publications TimelineA big-picture view of P.',
        fullDescription: 'View 5 Related Publications',
        researchAreas: [
          'Inflammation40 YSM ResearchersView 5 Related Publications',
          'View 5 Related Publications',
          'Inflammation',
        ],
      },
    } as unknown as LabDetailPayload);

    const { container } = await waitFor(() => {
      expect(screen.getByText('Example Publication Chrome Lab')).toBeTruthy();
      return { container: document.body };
    });

    expect(container.textContent).toContain('Inflammation');
    expect(container.textContent).not.toContain('Inflammation40 YSM Researchers');
    expect(container.textContent).not.toContain('View 5 Related Publications');
    expect(container.textContent).not.toContain('Publications TimelineA big-picture view of P.');
  });

  it('hides PI-profile fallback topics from sparse research detail pages', async () => {
    renderLabDetail({
      ...basePayload,
      group: undefined,
      researchEntity: {
        ...basePayload.group,
        researchAreas: [],
        profileResearchAreas: [
          'Fixture Delivery Systems',
          'Synthetic Signal Transfer',
        ],
        researchAreaSource: 'PI_PROFILE_FALLBACK',
      },
    } as unknown as LabDetailPayload);

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.queryByText('PI research interests')).toBeNull();
    expect(screen.queryByText('Fixture Delivery Systems')).toBeNull();
    expect(screen.queryByText('Synthetic Signal Transfer')).toBeNull();
  });

  it('does not promote PI-profile fallback topics into lab-level summary copy', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        name: 'Example Fallback Topic Lab',
        description: '',
        shortDescription: '',
        fullDescription: '',
        departments: ['Behavioral Studies'],
        researchAreas: [],
        profileResearchAreas: [
          'Fixture Care Pathway Design',
          'Synthetic Adherence Workflow',
        ],
        researchAreaSource: 'PI_PROFILE_FALLBACK',
      },
      entryPathways: [
        {
          _id: 'pathway-1',
          pathwayType: 'EXPLORATORY_CONTACT',
          status: 'PLAUSIBLE',
          evidenceStrength: 'MODERATE',
          studentFacingLabel: 'Explore the PI profile',
          bestNextStep: 'Review the PI profile and lab site first.',
          sourceUrls: [FACULTY_PROFILE_URL],
        },
      ],
      contactRoutes: [
        {
          _id: 'route-1',
          routeType: 'FACULTY_PI',
          label: 'Example Faculty',
          url: FACULTY_PROFILE_URL,
          sourceUrl: FACULTY_PROFILE_URL,
          visibility: 'PUBLIC',
        },
      ],
    } as LabDetailPayload);

    const { container } = await waitFor(() => {
      expect(screen.getByText('Example Fallback Topic Lab')).toBeTruthy();
      return { container: document.body };
    });

    const text = container.textContent || '';
    expect(text).not.toContain('PI research interests');
    expect(text).not.toContain('Fixture Care Pathway Design');
    expect(text).toContain('A Yale research profile with limited public description.');
    expect(text).not.toContain(
      'Research connected to Fixture Care Pathway Design',
    );
    expect(text).not.toContain('Research connected to Behavioral Studies.');
    expect(screen.queryByText('Plan your next step')).toBeNull();
    expect(screen.queryByText('Ways to approach this lab')).toBeNull();
  });

  it('renders PI-profile synthesis with faculty-research wording instead of lab-description wording', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        name: 'Example Synthesis Lab',
        kind: 'lab',
        entityType: 'LAB',
        description: '',
        shortDescription: '',
        fullDescription: '',
        departments: ['Statistics & Data Science'],
        researchAreas: [],
        profileResearchAreas: [
          'High-Dimensional Statistics',
          'Probability Theory',
        ],
        researchAreaSource: 'PI_PROFILE_FALLBACK',
        profileSynthesisDescription:
          'It appears to center on High-Dimensional Statistics and Probability Theory.',
        descriptionSource: 'PI_PROFILE_SYNTHESIS',
      },
      entryPathways: [
        {
          _id: 'pathway-1',
          pathwayType: 'EXPLORATORY_CONTACT',
          status: 'PLAUSIBLE',
          evidenceStrength: 'MODERATE',
          studentFacingLabel: 'Explore the PI profile',
          bestNextStep: 'Review the PI profile and lab site first.',
          sourceUrls: [FACULTY_PROFILE_URL],
        },
      ],
      contactRoutes: [
        {
          _id: 'route-1',
          routeType: 'FACULTY_PI',
          label: 'Example Faculty',
          url: FACULTY_PROFILE_URL,
          sourceUrl: FACULTY_PROFILE_URL,
          visibility: 'PUBLIC',
        },
      ],
    } as LabDetailPayload);

    const { container } = await waitFor(() => {
      expect(screen.getByText('Example Synthesis Lab')).toBeTruthy();
      return { container: document.body };
    });

    const text = container.textContent || '';
    expect(text).toContain('What this faculty research area covers');
    expect(text).toContain(
      'It appears to center on High-Dimensional Statistics and Probability Theory.',
    );
    expect(text).toContain('Yale Research has not found a separate lab description');
    expect(text).not.toContain('What this lab studies');
    expect(text).not.toContain('Research connected to High-Dimensional Statistics');

    const summary = screen.getByText(
      'It appears to center on High-Dimensional Statistics and Probability Theory.',
    );
    const disclaimer = screen.getByText(
      /Yale Research has not found a separate lab description/,
    );
    expect(summary.tagName).toBe('P');
    expect(disclaimer.tagName).toBe('P');
    expect(summary).not.toBe(disclaimer);
  });

  it('uses lab wording when a PI-profile synthesis belongs to a real lab website', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        name: 'Example Materials Lab',
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: MATERIALS_LAB_WEBSITE_URL,
        description: '',
        shortDescription: '',
        fullDescription: '',
        profileSynthesisDescription:
          'This faculty research profile is synthesized from PI profile topics and recent scholarly work.',
        descriptionSource: 'PI_PROFILE_SYNTHESIS',
      },
    } as LabDetailPayload);

    const { container } = await waitFor(() => {
      expect(screen.getByText('Example Materials Lab')).toBeTruthy();
      return { container: document.body };
    });

    const text = container.textContent || '';
    expect(text).toContain('What this lab studies');
    expect(text).not.toContain('What this faculty research area covers');
  });

  it('uses faculty research wording for individual research entities with source descriptions', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        name: 'Example Faculty Research',
        kind: 'individual',
        entityType: 'INDIVIDUAL_RESEARCH',
        websiteUrl: FACULTY_HOME_URL,
        fullDescription:
          'Example Faculty studies distributed algorithms, population protocols, and consensus mechanisms.',
        descriptionSource: 'ENTITY_SOURCE',
      },
    } as LabDetailPayload);

    const { container } = await waitFor(() => {
      expect(screen.getByText('Example Faculty Research')).toBeTruthy();
      return { container: document.body };
    });

    const text = container.textContent || '';
    expect(text).toContain('What this faculty research area covers');
    expect(text).not.toContain('What this lab studies');
  });

  it('uses the full description as the primary research detail copy', async () => {
    const fullDescription =
      'This lab focuses on fixture social cognition. The group studies how synthetic category knowledge is acquired.';

    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        name: 'Example Full Description Lab',
        shortDescription: 'This lab focuses on fixture social cognition.',
        description:
          'The lab studies how synthetic groups are acquired using controlled fixture methods.',
        fullDescription,
      },
    } as LabDetailPayload);

    const { container } = await waitFor(() => {
      expect(screen.getByText('Example Full Description Lab')).toBeTruthy();
      return { container: document.body };
    });

    expect(container.textContent).toContain(fullDescription);
  });

  it('does not repeat a department as fallback research content on sparse profiles', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        name: 'Example Sparse Department Lab',
        description: '',
        shortDescription: '',
        fullDescription: '',
        departments: ['Public Policy'],
        researchAreas: [],
        profileResearchAreas: [
          'Social Media and Politics',
          'Electoral Systems and Political Participation',
        ],
        researchAreaSource: 'PI_PROFILE_FALLBACK',
      },
    } as LabDetailPayload);

    const { container } = await waitFor(() => {
      expect(screen.getByText('Example Sparse Department Lab')).toBeTruthy();
      return { container: document.body };
    });

    const text = container.textContent || '';
    expect(screen.getAllByText('Public Policy')).toHaveLength(1);
    expect(text).toContain('A Yale research profile with limited public description.');
    expect(text).not.toContain('Research connected to Public Policy.');
  });

  it('renders one official profile action for sparse faculty profile routes', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        name: 'Example Sparse Profile Lab',
        websiteUrl: DEPARTMENT_HOME_URL,
        sourceUrls: [
          DEPARTMENT_PEOPLE_URL,
          FACULTY_PROFILE_URL,
          DEPARTMENT_HOME_URL,
        ],
        departments: ['Public Policy'],
        researchAreas: [],
      },
      entryPathways: [
        {
          _id: 'pathway-1',
          pathwayType: 'EXPLORATORY_CONTACT',
          status: 'PLAUSIBLE',
          evidenceStrength: 'MODERATE',
          studentFacingLabel: 'Explore the PI profile',
          bestNextStep:
            'Review the PI profile and lab site first, then decide whether targeted exploratory outreach is appropriate.',
          sourceUrls: [FACULTY_PROFILE_URL],
        },
      ],
      contactRoutes: [
        {
          _id: 'route-1',
          routeType: 'FACULTY_PI',
          label: 'Example Faculty',
          url: FACULTY_PROFILE_URL,
          sourceUrl: FACULTY_PROFILE_URL,
          visibility: 'PUBLIC',
        },
      ],
    } as LabDetailPayload);

    await screen.findByText('Example Sparse Profile Lab');

    const profileLinks = screen.getAllByRole('link', { name: 'Open official profile' });
    expect(profileLinks).toHaveLength(1);
    expect(profileLinks[0].getAttribute('href')).toBe(FACULTY_PROFILE_URL);
    expect(screen.queryByRole('link', { name: 'Open official route' })).toBeNull();
  });
});
