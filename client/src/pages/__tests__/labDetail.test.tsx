import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LabDetail from '../labDetail';
import axios from '../../utils/axios';
import { LabDetailPayload } from '../../types/labDetail';
import {
  flushResearchAnalytics,
  resetResearchAnalyticsDedupeForTests,
} from '../../utils/researchAnalytics';
import { captureClientError } from '../../utils/errorTracking';
import UserContext, { defaultUserContext } from '../../contexts/UserContext';

vi.mock('../../utils/axios', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../../utils/errorTracking', () => ({
  captureClientError: vi.fn(),
}));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

const DEFAULT_SLUG = 'sample-research-profile';
const DEFAULT_ENTITY_NAME = 'Sample Research Profile';
const OFFICIAL_PROFILE_URL = 'https://profile.example.test/profile/sample-faculty';
const RESEARCH_WEBSITE_URL = 'https://research-home.example.test/sample-lab/';
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
const SECTION_INDEX_SOURCE_URL = 'https://example.yale.edu/cores';

const basePayload: LabDetailPayload = {
  group: {
    _id: 'entity-1',
    slug: DEFAULT_SLUG,
    name: DEFAULT_ENTITY_NAME,
    kind: 'individual',
    entityType: 'FACULTY_RESEARCH_AREA',
    fullDescription: 'Studies mechanisms of neurological disease.',
    websiteUrl: OFFICIAL_PROFILE_URL,
    location: '',
    departments: ['Neurology'],
    researchAreas: ['Neuroscience'],
    school: 'School of Medicine',
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
  activeListings: [],
  accessSignals: [],
};

function renderLabDetail(
  payload: LabDetailPayload = basePayload,
  { isAuthenticated = true }: { isAuthenticated?: boolean } = {},
) {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url === '/users/savedResearchEntityIds') {
      return Promise.resolve({ data: { savedResearchEntityIds: [] } });
    }
    if (url === `/research/${DEFAULT_SLUG}`) {
      return Promise.resolve({ data: payload });
    }
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });

  return render(
    <UserContext.Provider value={{ ...defaultUserContext, isLoading: false, isAuthenticated }}>
      <MemoryRouter initialEntries={[`/research/${DEFAULT_SLUG}`]}>
        <Routes>
          <Route path="/research/:slug" element={<LabDetail />} />
          <Route path="/login" element={<div>Yale sign in</div>} />
        </Routes>
      </MemoryRouter>
    </UserContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetResearchAnalyticsDedupeForTests();
  localStorage.clear();
});

describe('LabDetail page', () => {
  it('records one profile open after the canonical profile loads', async () => {
    mockedAxios.post.mockResolvedValue({ status: 202 });
    renderLabDetail();

    await screen.findByText(DEFAULT_ENTITY_NAME);
    await waitFor(async () => {
      await flushResearchAnalytics();
      expect(mockedAxios.post).toHaveBeenCalledWith(
        '/analytics/research/batch',
        {
          events: expect.arrayContaining([
            expect.objectContaining({
              eventType: 'research_profile_open',
              entityType: 'research_entity',
              entityId: 'entity-1',
              payload: { source: 'direct' },
            }),
          ]),
        },
        { withCredentials: true },
      );
    });
    const profileOpenEvents = mockedAxios.post.mock.calls
      .filter((call) => call[0] === '/analytics/research/batch')
      .flatMap((call) => call[1]?.events ?? [])
      .filter((event: { eventType?: string }) => event?.eventType === 'research_profile_open');
    expect(profileOpenEvents).toHaveLength(1);
  });

  it('redirects an archived slug to the canonical entity slug', async () => {
    const OLD_SLUG = 'nsf-pi-archived-shell';
    const CANONICAL_SLUG = 'named-canonical-lab';
    const canonicalPayload: LabDetailPayload = {
      ...basePayload,
      group: {
        ...basePayload.group,
        _id: 'canonical-1',
        slug: CANONICAL_SLUG,
        name: 'Canonical Lab Name',
      },
    };
    mockedAxios.post.mockResolvedValue({ status: 202 });
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/users/savedResearchEntityIds') {
        return Promise.resolve({ data: { savedResearchEntityIds: [] } });
      }
      if (url === `/research/${OLD_SLUG}`) {
        return Promise.resolve({
          data: canonicalPayload,
          request: { responseURL: `http://localhost/api/research/${CANONICAL_SLUG}` },
        });
      }
      if (url === `/research/${CANONICAL_SLUG}`) {
        return Promise.resolve({
          data: canonicalPayload,
          request: { responseURL: `http://localhost/api/research/${CANONICAL_SLUG}` },
        });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });

    render(
      <UserContext.Provider
        value={{ ...defaultUserContext, isLoading: false, isAuthenticated: true }}
      >
        <MemoryRouter initialEntries={[`/research/${OLD_SLUG}`]}>
          <Routes>
            <Route path="/research/:slug" element={<LabDetail />} />
            <Route path="/login" element={<div>Yale sign in</div>} />
          </Routes>
        </MemoryRouter>
      </UserContext.Provider>,
    );

    await screen.findByText('Canonical Lab Name');
    await waitFor(() =>
      expect(mockedAxios.get).toHaveBeenCalledWith(
        `/research/${CANONICAL_SLUG}`,
        expect.anything(),
      ),
    );
    expect(screen.queryByText('Research profile not found.')).toBeNull();
  });

  it('keeps generic source review separate from a qualified action', async () => {
    mockedAxios.post.mockResolvedValue({ status: 202 });
    renderLabDetail();
    await screen.findByText(DEFAULT_ENTITY_NAME);

    fireEvent.click(screen.getByRole('link', { name: 'Open source' }));
    await flushResearchAnalytics();

    await waitFor(() =>
      expect(mockedAxios.post).toHaveBeenCalledWith(
        '/analytics/research/batch',
        {
          events: expect.arrayContaining([
            expect.objectContaining({
              eventType: 'research_source_review',
              payload: { sourceCategory: 'faculty_profile' },
            }),
          ]),
        },
        { withCredentials: true },
      ),
    );
    const qualifiedActionEvents = mockedAxios.post.mock.calls
      .filter((call) => call[0] === '/analytics/research/batch')
      .flatMap((call) => call[1]?.events ?? [])
      .filter((event: { eventType?: string }) => event?.eventType === 'research_qualified_action');
    expect(qualifiedActionEvents).toHaveLength(0);
  });

  it('flags an unavailable source link and sorts it last from the serialized researchEntity payload', async () => {
    const UNHEALTHY_PRIMARY_SITE = 'https://solomonlab.example.test/lab';
    const HEALTHY_PUBLICATIONS_PAGE = 'https://solomonlab.example.test/lab/publications';
    const payload = {
      ...basePayload,
      group: undefined as unknown as LabDetailPayload['group'],
      researchEntity: {
        _id: 'entity-source-health',
        slug: DEFAULT_SLUG,
        name: DEFAULT_ENTITY_NAME,
        kind: 'lab',
        entityType: 'RESEARCH_GROUP',
        websiteUrl: UNHEALTHY_PRIMARY_SITE,
        departments: ['School of Medicine'],
        researchAreas: ['Immunobiology'],
        typicalUndergradRoles: [],
        prerequisiteCourses: [],
        creditOptions: [],
        fundingPrograms: [],
        sourceUrls: [UNHEALTHY_PRIMARY_SITE, HEALTHY_PUBLICATIONS_PAGE],
        sourceLinkHealth: [
          { url: UNHEALTHY_PRIMARY_SITE, healthStatus: 'UNAVAILABLE', httpStatusCode: 404 },
          { url: HEALTHY_PUBLICATIONS_PAGE, healthStatus: 'OK', httpStatusCode: 200 },
        ],
      },
    } as unknown as LabDetailPayload;

    renderLabDetail(payload);
    await screen.findByText(DEFAULT_ENTITY_NAME);

    const markers = screen.getAllByText('may be unavailable');
    expect(markers).toHaveLength(1);

    const unavailableArticle = markers[0].closest('article');
    expect(unavailableArticle).not.toBeNull();
    const unavailableOpenLink = within(unavailableArticle as HTMLElement).getByRole('link', {
      name: 'Open source',
    });
    expect(unavailableOpenLink.getAttribute('href')).toBe(UNHEALTHY_PRIMARY_SITE);

    const openLinks = screen
      .getAllByRole('link', { name: 'Open source' })
      .map((link) => link.getAttribute('href'));
    expect(openLinks.indexOf(HEALTHY_PUBLICATIONS_PAGE)).toBeLessThan(
      openLinks.indexOf(UNHEALTHY_PRIMARY_SITE),
    );

    const healthyArticle = screen
      .getAllByRole('link', { name: 'Open source' })
      .find((link) => link.getAttribute('href') === HEALTHY_PUBLICATIONS_PAGE)
      ?.closest('article');
    expect(within(healthyArticle as HTMLElement).queryByText('may be unavailable')).toBeNull();
  });

  it('gates the primary Visit official website CTA on a dead source link and falls back to the Yale Directory (#934)', async () => {
    const DEAD_PRIMARY_SITE = 'https://deadlab.example.test/lab';
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        websiteUrl: DEAD_PRIMARY_SITE,
        sourceUrls: [DEAD_PRIMARY_SITE],
        sourceLinkHealth: [
          { url: DEAD_PRIMARY_SITE, healthStatus: 'UNAVAILABLE', httpStatusCode: 404 },
        ],
      },
      members: [],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.queryByRole('link', { name: 'Visit official website' })).toBeNull();
    expect(screen.getByText(/does not have a direct link for this research home/)).toBeTruthy();
    const directoryLink = screen.getByRole('link', { name: 'Search the Yale Directory' });
    expect(directoryLink.getAttribute('href')).toBe('https://directory.yale.edu/');
  });

  it('emits the server-owned category for a matching qualified route without its URL', async () => {
    mockedAxios.post.mockResolvedValue({ status: 202 });
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        sourceUrls: [JOIN_PAGE_URL],
        planningContext: {
          category: 'official_application',
          label: 'Official application',
          url: JOIN_PAGE_URL,
        },
      },
    });
    await screen.findByText(DEFAULT_ENTITY_NAME);
    const actionLink = screen
      .getAllByRole('link', { name: 'Open source' })
      .find((link) => link.getAttribute('href') === JOIN_PAGE_URL);
    expect(actionLink).toBeTruthy();

    fireEvent.click(actionLink!);
    await flushResearchAnalytics();

    await waitFor(() =>
      expect(mockedAxios.post).toHaveBeenCalledWith(
        '/analytics/research/batch',
        {
          events: expect.arrayContaining([
            expect.objectContaining({
              eventType: 'research_qualified_action',
              entityId: 'entity-1',
              payload: { actionCategory: 'official_application' },
            }),
          ]),
        },
        { withCredentials: true },
      ),
    );
    const actionEvent = mockedAxios.post.mock.calls
      .filter((call) => call[0] === '/analytics/research/batch')
      .flatMap((call) => call[1]?.events ?? [])
      .find((event: { eventType?: string }) => event?.eventType === 'research_qualified_action');
    expect(JSON.stringify(actionEvent)).not.toContain(JOIN_PAGE_URL);
  });

  it('guides students to the official profile without promising an unavailable email', async () => {
    renderLabDetail();

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.getByText('How to get involved')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /^Email/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open official profile' }).getAttribute('href')).toBe(
      OFFICIAL_PROFILE_URL,
    );
    expect(screen.queryByText('Profile status')).toBeNull();
    expect(screen.queryByText('Contact options')).toBeNull();
    expect(screen.queryByText(/No verified contact route is available yet/)).toBeNull();
    expect(screen.queryByText('Ways In')).toBeNull();
    expect(screen.queryByText('Evidence')).toBeNull();
  });

  it('surfaces the lead PI official profile as the open-profile CTA when the entity site is a lab page', async () => {
    const LAB_WEBSITE_URL = 'https://medicine.yale.edu/lab/fixture-steele/';
    const LEAD_OFFICIAL_PROFILE_URL = 'https://medicine.yale.edu/profile/fixture-steele/';
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        websiteUrl: LAB_WEBSITE_URL,
        sourceUrls: [LAB_WEBSITE_URL],
      },
      members: [
        {
          role: 'pi',
          user: {
            netid: 'fixture.steele',
            fname: 'Fixture',
            lname: 'Steele',
            displayName: 'Fixture Steele',
            primary_department: 'Psychiatry',
            profileUrls: { official: LEAD_OFFICIAL_PROFILE_URL },
          },
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(
      screen
        .getByRole('link', { name: "Open Fixture Steele's official profile" })
        .getAttribute('href'),
    ).toBe(LEAD_OFFICIAL_PROFILE_URL);
    expect(screen.queryByRole('link', { name: 'Open official profile' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Visit official website' }).getAttribute('href')).toBe(
      LAB_WEBSITE_URL,
    );
  });

  it('renders a Yale Directory fallback instead of a dead end when no website, profile, or email exists', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        websiteUrl: '',
        sourceUrls: [],
        accessSummary: {
          status: 'reach-out-plausible',
          confidence: 0.7,
          signalTypes: ['REACH_OUT_PLAUSIBLE'],
          bestNextStep: 'Reach out to the PI.',
          evidence: [{ signalType: 'REACH_OUT_PLAUSIBLE', confidence: 'MEDIUM' }],
        },
      },
      members: [
        {
          role: 'pi',
          user: {
            netid: 'fixture.faculty',
            fname: 'Jordan',
            lname: 'Researcher',
            displayName: 'Jordan Researcher',
            primary_department: 'Neurology',
          },
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.getByText('How to get involved')).toBeTruthy();
    expect(screen.getByText(/does not have a direct link for Jordan Researcher/)).toBeTruthy();
    expect(screen.getByText(/Look them up in the Yale Directory/)).toBeTruthy();
    const directoryLink = screen.getByRole('link', { name: 'Search the Yale Directory' });
    expect(directoryLink.getAttribute('href')).toBe('https://directory.yale.edu/');

    expect(screen.queryByRole('link', { name: 'Open official profile' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Visit official website' })).toBeNull();
    expect(screen.queryByRole('link', { name: /^Email/ })).toBeNull();
    expect(screen.queryByText('Reach-out plausible')).toBeNull();
  });

  it('keeps a raw HR org-code out of the no-direct-link outreach prose', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        websiteUrl: '',
        sourceUrls: [],
        departments: ['Chemistry'],
        school: 'Faculty of Arts and Sciences',
        accessSummary: {
          status: 'reach-out-plausible',
          confidence: 0.7,
          signalTypes: ['REACH_OUT_PLAUSIBLE'],
          bestNextStep: 'Reach out to the PI.',
          evidence: [{ signalType: 'REACH_OUT_PLAUSIBLE', confidence: 'MEDIUM' }],
        },
      },
      members: [
        {
          role: 'pi',
          user: {
            netid: 'fixture.faculty',
            fname: 'Caitlin',
            lname: 'Davis',
            displayName: 'Caitlin Davis',
            primary_department: 'FASCHM Administration',
          },
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.queryByText(/FASCHM Administration/)).toBeNull();
    expect(
      screen.getByText(
        /does not have a direct link for Caitlin Davis \(Faculty of Arts and Sciences\) yet/,
      ),
    ).toBeTruthy();
  });

  it('prefers an available official source over the generic Yale Directory when no website, profile, or email exists', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        websiteUrl: '',
        sourceUrls: [JOIN_PAGE_URL],
        accessSummary: {
          status: 'reach-out-plausible',
          confidence: 0.7,
          signalTypes: ['REACH_OUT_PLAUSIBLE'],
          bestNextStep: 'Reach out to the PI.',
          evidence: [{ signalType: 'REACH_OUT_PLAUSIBLE', confidence: 'MEDIUM' }],
        },
      },
      members: [
        {
          role: 'pi',
          user: {
            netid: 'fixture.faculty',
            fname: 'Jordan',
            lname: 'Researcher',
            displayName: 'Jordan Researcher',
            primary_department: 'Neurology',
          },
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.getByRole('link', { name: 'Open the official page' }).getAttribute('href')).toBe(
      JOIN_PAGE_URL,
    );
    expect(screen.queryByRole('link', { name: 'Search the Yale Directory' })).toBeNull();
    expect(screen.queryByText(/does not have a direct link/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open official profile' })).toBeNull();
    expect(screen.getByText('Reach-out plausible')).toBeTruthy();
  });

  it('still falls through to the Yale Directory when the only source is a listing or section-index page', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        websiteUrl: '',
        sourceUrls: [SECTION_INDEX_SOURCE_URL],
      },
      members: [
        {
          role: 'pi',
          user: {
            netid: 'fixture.faculty',
            fname: 'Jordan',
            lname: 'Researcher',
            displayName: 'Jordan Researcher',
            primary_department: 'Neurology',
          },
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    const directoryLink = screen.getByRole('link', { name: 'Search the Yale Directory' });
    expect(directoryLink.getAttribute('href')).toBe('https://directory.yale.edu/');
    expect(screen.queryByRole('link', { name: 'Open the official page' })).toBeNull();
  });

  it('does not surface a contested lead profile page as the official CTA when the lead identity is under review', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        leadIdentityStatus: 'under_review',
        websiteUrl: '',
        sourceUrls: [OFFICIAL_PROFILE_URL],
      },
      members: [
        {
          role: 'pi',
          user: {
            netid: 'fixture.faculty',
            fname: 'Jordan',
            lname: 'Researcher',
            displayName: 'Jordan Researcher',
            primary_department: 'Neurology',
          },
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    const directoryLink = screen.getByRole('link', { name: 'Search the Yale Directory' });
    expect(directoryLink.getAttribute('href')).toBe('https://directory.yale.edu/');
    expect(screen.queryByRole('link', { name: 'Open the official page' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open official profile' })).toBeNull();
  });

  it('still surfaces a non-profile official page as the CTA when the lead identity is under review', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        leadIdentityStatus: 'under_review',
        websiteUrl: '',
        sourceUrls: [JOIN_PAGE_URL],
      },
      members: [
        {
          role: 'pi',
          user: {
            netid: 'fixture.faculty',
            fname: 'Jordan',
            lname: 'Researcher',
            displayName: 'Jordan Researcher',
            primary_department: 'Neurology',
          },
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.getByRole('link', { name: 'Open the official page' }).getAttribute('href')).toBe(
      JOIN_PAGE_URL,
    );
    expect(screen.queryByRole('link', { name: 'Search the Yale Directory' })).toBeNull();
  });

  it('points to the official website instead of a dead end when there is no profile or email', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: RESEARCH_WEBSITE_URL,
        sourceUrls: [RESEARCH_WEBSITE_URL],
      },
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.getByRole('link', { name: 'Visit lab website' }).getAttribute('href')).toBe(
      RESEARCH_WEBSITE_URL,
    );
    expect(screen.queryByRole('link', { name: 'Open official profile' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Search the Yale Directory' })).toBeNull();
    expect(screen.queryByRole('link', { name: /^Email/ })).toBeNull();
  });

  it('points an under-review entity to its official website instead of a Yale Directory dead end', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        kind: 'lab',
        entityType: 'LAB',
        leadIdentityStatus: 'under_review',
        websiteUrl: RESEARCH_WEBSITE_URL,
        sourceUrls: [RESEARCH_WEBSITE_URL],
      },
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.getByRole('link', { name: 'Visit lab website' }).getAttribute('href')).toBe(
      RESEARCH_WEBSITE_URL,
    );
    expect(screen.queryByRole('link', { name: 'Search the Yale Directory' })).toBeNull();
    expect(screen.queryByText(/does not have a direct link/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open official profile' })).toBeNull();
    expect(screen.queryByRole('link', { name: /^Email/ })).toBeNull();
  });

  it('lets students save an indexed pathway as a research plan from the profile summary', async () => {
    mockedAxios.put.mockResolvedValue({ data: {} });

    renderLabDetail({
      ...basePayload,
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    const saveButton = screen.getByRole('button', { name: 'Save research plan' });
    fireEvent.click(saveButton);

    expect(mockedAxios.put).toHaveBeenCalledWith('/users/savedResearchEntities', {
      withCredentials: true,
      data: { savedResearchEntities: ['entity-1'] },
    });
    expect(screen.getByRole('button', { name: 'Saved to Dashboard' })).toBeTruthy();
    expect((await screen.findByRole('status')).textContent).toContain('Research plan saved');
  });

  it('saves the research plan when students click the visible save row label', async () => {
    mockedAxios.put.mockResolvedValue({ data: {} });

    renderLabDetail({
      ...basePayload,
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    fireEvent.click(screen.getByText('Save research plan'));

    expect(mockedAxios.put).toHaveBeenCalledWith('/users/savedResearchEntities', {
      withCredentials: true,
      data: { savedResearchEntities: ['entity-1'] },
    });
    expect(screen.getByRole('button', { name: 'Saved to Dashboard' })).toBeTruthy();
  });

  it('shows the research-plan save action with the research summary', async () => {
    renderLabDetail({
      ...basePayload,
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.getByRole('button', { name: 'Save research plan' })).toBeTruthy();
    expect(screen.getByText('Research summary')).toBeTruthy();
  });

  it('saves a research entity even when it has no indexed pathway', async () => {
    mockedAxios.put.mockResolvedValue({ data: {} });
    renderLabDetail();

    await screen.findByText(DEFAULT_ENTITY_NAME);
    fireEvent.click(screen.getByRole('button', { name: 'Save research plan' }));

    expect(mockedAxios.put).toHaveBeenCalledWith('/users/savedResearchEntities', {
      withCredentials: true,
      data: { savedResearchEntities: ['entity-1'] },
    });
  });

  it('sends signed-out visitors to Yale sign in before saving a research plan', async () => {
    renderLabDetail(basePayload, { isAuthenticated: false });

    await screen.findByText(DEFAULT_ENTITY_NAME);
    fireEvent.click(screen.getByRole('button', { name: 'Save research plan' }));

    expect(await screen.findByText('Yale sign in')).toBeTruthy();
    expect(mockedAxios.put).not.toHaveBeenCalled();
    expect(localStorage.getItem('yale-research.firstResearchPlanSave.v1')).toBeNull();
  });

  it('does not claim a research plan was saved when persistence fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedAxios.put.mockRejectedValueOnce(new Error('save unavailable'));
    renderLabDetail();

    await screen.findByText(DEFAULT_ENTITY_NAME);
    fireEvent.click(screen.getByRole('button', { name: 'Save research plan' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save research plan' })).toBeTruthy(),
    );
    expect(screen.queryByText('Research plan saved')).toBeNull();
    expect(localStorage.getItem('yale-research.firstResearchPlanSave.v1')).toBeNull();
  });

  it('renders program page wording instead of lab wording', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        slug: 'department-undergrad-research-molecular-biophysics-and-biochemistry',
        name: 'Molecular Biophysics and Biochemistry Undergraduate Research',
        kind: 'program',
        entityType: 'PROGRAM',
        websiteUrl: 'https://mbb.yale.edu/introduction-undergraduate-program',
        shortDescription:
          'Supports undergraduate research in molecular biophysics and biochemistry through department guidance.',
      },
    });

    await screen.findByText('Molecular Biophysics and Biochemistry Undergraduate Research');

    expect(screen.getByRole('link', { name: 'Visit program website' }).getAttribute('href')).toBe(
      'https://mbb.yale.edu/introduction-undergraduate-program',
    );
    expect(screen.getByText('What this program focuses on')).toBeTruthy();
  });

  it('renders one full PI card without a duplicate section', async () => {
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
            image_url: 'https://example.test/jordan-researcher.jpg',
            profileUrls: {
              official: 'https://medicine.yale.edu/profile/jordan-researcher-fixture/',
            },
          },
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    const principalInvestigatorSection = screen
      .getByRole('heading', { name: 'Principal Investigator' })
      .closest('section');

    expect(screen.queryByText('Lead professor')).toBeNull();
    const profileCardLink = within(principalInvestigatorSection as HTMLElement).getByRole('link', {
      name: "Open Jordan Researcher's official profile",
    });
    expect(profileCardLink.getAttribute('href')).toBe(OFFICIAL_PROFILE_URL);
    expect(profileCardLink.getAttribute('target')).toBe('_blank');
    expect(screen.getAllByText('Jordan Researcher')).toHaveLength(1);
    expect(
      within(principalInvestigatorSection as HTMLElement).getByRole('img', {
        name: 'Jordan Researcher',
      }),
    ).toBeTruthy();
    expect(
      within(principalInvestigatorSection as HTMLElement).getAllByText('Principal Investigator')
        .length,
    ).toBeGreaterThan(1);
    expect(screen.getByText('Professor of Example Studies')).toBeTruthy();
    expect(screen.getByText('Example Studies')).toBeTruthy();
  });

  it('never renders verdict-tier or planning-status rows, only a constant contact prompt', async () => {
    renderLabDetail();

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.queryByText('Evidence level')).toBeNull();
    expect(screen.queryByText('Planning status')).toBeNull();
    expect(screen.queryByText('Student decision')).toBeNull();
    expect(screen.getByText('How to get involved')).toBeTruthy();
  });

  it('always offers an email-the-PI action when the PI has an email, regardless of signals', async () => {
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
            email: 'jordan.researcher@example.test',
          },
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    const emailLink = screen.getByRole('link', { name: 'Email Jordan Researcher' });
    expect(emailLink.getAttribute('href')).toBe(
      'mailto:jordan.researcher@example.test?subject=Interest%20in%20undergraduate%20research',
    );
  });

  it('keeps multiple PI cards together in a dedicated pluralized section', async () => {
    const secondInvestigatorProfileUrl = 'https://medicine.yale.edu/profile/second-investigator/';
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        websiteUrl: secondInvestigatorProfileUrl,
        leadProfessorPublicKey: 'fixture-second-pi',
      },
      members: [
        {
          role: 'pi',
          user: {
            publicKey: 'fixture-first-pi',
            fname: 'First',
            lname: 'Investigator',
            displayName: 'First Investigator',
            profileUrls: {
              official: 'https://medicine.yale.edu/profile/first-investigator/',
            },
          },
        },
        {
          role: 'co-pi',
          user: {
            publicKey: 'fixture-second-pi',
            fname: 'Second',
            lname: 'Investigator',
            displayName: 'Second Investigator',
            title: 'Professor of Example Studies',
            primary_department: 'Example Studies',
            profileUrls: {
              official: secondInvestigatorProfileUrl,
            },
          },
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    const section = screen
      .getByRole('heading', { name: 'Principal Investigators' })
      .closest('section');
    expect(section).toBeTruthy();
    expect(within(section as HTMLElement).getByText('First Investigator')).toBeTruthy();
    expect(within(section as HTMLElement).getByText('Second Investigator')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Principal Investigator' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Lead professor' })).toBeNull();
    expect(screen.getAllByText('First Investigator')).toHaveLength(1);
    expect(screen.getAllByText('Second Investigator')).toHaveLength(1);
    expect(screen.getAllByText('Professor of Example Studies')).toHaveLength(1);
    expect(screen.getAllByText('Example Studies')).toHaveLength(1);
  });

  it('renders a director-led org home under a Directors heading, not Principal Investigators (#693)', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        kind: 'institute',
        entityType: 'INSTITUTE',
      },
      members: [
        {
          role: 'director',
          user: {
            publicKey: 'fixture-director',
            fname: 'Fixture',
            lname: 'Director',
            displayName: 'Fixture Director',
            title: 'Sterling Professor of Applied Physics',
          },
        },
        {
          role: 'co-director',
          user: {
            publicKey: 'fixture-co-director',
            fname: 'Fixture',
            lname: 'Codirector',
            displayName: 'Fixture Codirector',
            title: 'Deputy Director and Professor of Physics',
          },
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.getByRole('heading', { name: 'Directors' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Principal Investigators' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Principal Investigator' })).toBeNull();
  });

  it('labels a single director lead as Director in the decision summary, not Principal Investigator (#693)', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        kind: 'center',
        entityType: 'CENTER',
      },
      members: [
        {
          role: 'director',
          user: {
            publicKey: 'fixture-solo-director',
            fname: 'Solo',
            lname: 'Director',
            displayName: 'Solo Director',
            title: 'Professor and Director',
          },
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.getByRole('heading', { name: 'Director' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Principal Investigator' })).toBeNull();
  });

  it('prefers the org get-involved page over a director profile for an umbrella home (#657)', async () => {
    const GET_INVOLVED_URL = 'https://institute.example.yale.edu/get-involved';
    const DIRECTOR_PROFILE_URL = 'https://institute.example.yale.edu/profile/fixture-director';
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        kind: 'institute',
        entityType: 'INSTITUTE',
        websiteUrl: '',
        sourceUrls: [GET_INVOLVED_URL],
      },
      members: [
        {
          role: 'director',
          user: {
            publicKey: 'fixture-director',
            fname: 'Fixture',
            lname: 'Director',
            displayName: 'Fixture Director',
            title: 'Professor and Director',
            profileUrls: { official: DIRECTOR_PROFILE_URL },
          },
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.getByText('How to get involved')).toBeTruthy();
    expect(screen.getByText(/coordinates involvement at the organization level/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See how to get involved' }).getAttribute('href')).toBe(
      GET_INVOLVED_URL,
    );
    expect(
      screen.getByRole('link', { name: 'Contact Fixture Director' }).getAttribute('href'),
    ).toBe(DIRECTOR_PROFILE_URL);
    expect(screen.queryByRole('link', { name: 'Open official profile' })).toBeNull();
    expect(screen.queryByRole('link', { name: /^Email/ })).toBeNull();
  });

  it('does not choose an arbitrary lead professor when no PI matches the official profile', async () => {
    renderLabDetail({
      ...basePayload,
      members: [
        {
          role: 'pi',
          user: {
            publicKey: 'fixture-first-unmatched-pi',
            fname: 'First',
            lname: 'Unmatched',
            profileUrls: {
              official: 'https://medicine.yale.edu/profile/first-unmatched/',
            },
          },
        },
        {
          role: 'co-pi',
          user: {
            publicKey: 'fixture-second-unmatched-pi',
            fname: 'Second',
            lname: 'Unmatched',
            profileUrls: {
              official: 'https://medicine.yale.edu/profile/second-unmatched/',
            },
          },
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.getByRole('heading', { name: 'Principal Investigators' })).toBeTruthy();
    expect(screen.queryByText('Lead professor')).toBeNull();
  });

  it('keeps the dedicated identity review state instead of showing a PI card', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        leadIdentityStatus: 'under_review',
      },
      members: [
        {
          role: 'pi',
          user: {
            publicKey: 'fixture-unverified-pi',
            fname: 'Unverified',
            lname: 'Investigator',
            displayName: 'Unverified Investigator',
          },
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.getByRole('heading', { name: 'Principal Investigator' })).toBeTruthy();
    expect(screen.getByText('Lead identity under review')).toBeTruthy();
    expect(screen.queryByText('Unverified Investigator')).toBeNull();
  });

  it('links the principal investigator card to the official faculty profile from the detail page', async () => {
    renderLabDetail({
      ...basePayload,
      members: [
        {
          role: 'pi',
          user: {
            netid: 'fs123',
            publicKey: 'fixture-scholar-pi',
            fname: 'Fixture',
            lname: 'Scholar',
            displayName: 'Fixture Scholar',
            title: 'Professor of Example Medicine',
            primary_department: 'Example Medicine',
            profileUrls: {
              official: 'https://medicine.yale.edu/profile/fixture-scholar/',
            },
          },
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    const profileCardLink = screen.getByRole('link', {
      name: "Open Fixture Scholar's official profile",
    });
    expect(profileCardLink.getAttribute('href')).toBe(OFFICIAL_PROFILE_URL);
    expect(profileCardLink.getAttribute('rel')).toContain('noopener');
    expect(screen.queryByRole('link', { name: 'Open official profile' })).toBeNull();
    expect(screen.getAllByText('Fixture Scholar').length).toBeGreaterThan(0);
  });

  it('does not link the PI name even when only an internal profile fallback exists', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        websiteUrl: RESEARCH_WEBSITE_URL,
        sourceUrls: [RESEARCH_WEBSITE_URL],
      },
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
            internalProfilePath: '/profile/fixture.faculty',
            website: 'https://jordan-researcher.example.test/',
          },
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.queryByRole('link', { name: 'Open official profile' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'View PI profile' })).toBeNull();
    expect(screen.queryAllByRole('link', { name: /Jordan Researcher/ })).toHaveLength(0);
    expect(document.querySelector('a[href="/profile/fixture.faculty"]')).toBeNull();
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

    expect(screen.queryByRole('heading', { name: 'Outreach' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Contact route' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Plan your next step' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Draft outreach email' })).toBeNull();
  });

  it('does not offer in-product outreach drafting when a PI contact route has an email', async () => {
    renderLabDetail({
      ...basePayload,
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.queryByRole('heading', { name: 'Outreach' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Draft outreach email' })).toBeNull();
    expect(screen.queryByText('jordan.researcher@yale.edu')).toBeNull();
    expect(
      screen.queryByText(
        `Inquiry from a Yale undergraduate about research in ${DEFAULT_ENTITY_NAME}`,
      ),
    ).toBeNull();
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

  it('uses the research website as the first public next step for exploratory profile routes', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        slug: 'example-field-lab',
        name: 'Example Field Lab',
        websiteUrl: RESEARCH_WEBSITE_URL,
        sourceUrls: [FACULTY_ROSTER_URL, FACULTY_AFFILIATED_PROFILE_URL, RESEARCH_WEBSITE_URL],
      },
      accessSignals: [
        {
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
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: RESEARCH_WEBSITE_URL,
        sourceUrls: [FACULTY_ROSTER_URL, FACULTY_PROFILE_URL, RESEARCH_WEBSITE_URL],
      },
    });

    const { container } = await waitFor(() => {
      expect(screen.getByText('Example Roster Filtered Lab')).toBeTruthy();
      return { container: document.body };
    });

    expect(
      screen
        .getAllByRole('link', { name: 'Open official profile' })
        .every((link) => link.getAttribute('href') === FACULTY_PROFILE_URL),
    ).toBe(true);
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
        fullDescription:
          'Studies fixture evolution, population models, and synthetic DNA examples.',
        websiteUrl: RESEARCH_WEBSITE_URL,
        departments: ['Ecology and Evolutionary Biology'],
        researchAreas: ['fixture evolution', 'population models', 'synthetic DNA examples'],
        profileResearchAreas: ['Computational biology', 'Anthropology'],
        school: 'Fixture Faculty of Arts and Sciences',
        sourceUrls: [FACULTY_PROFILE_URL],
      },
      accessSignals: [
        {
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
    expect(text).toContain('How to get involved');
    expect(text).not.toContain('Why this matched');
    expect(text).not.toContain('Student fit');
    expect(text).not.toContain('Likely preparation');
    expect(text).not.toContain('Good fit if you are interested in');
    expect(text).not.toContain('Profile status');
    expect(text).not.toContain('Recommended outreach angle');
    expect(
      screen
        .getAllByRole('link', { name: 'Open official profile' })
        .every((link) => link.getAttribute('href') === FACULTY_PROFILE_URL),
    ).toBe(true);
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
        sourceUrls: [FACULTY_PROFILE_URL, RESEARCH_WEBSITE_URL],
        departments: ['Statistics & Data Science'],
        researchAreas: ['Mathematical Statistics', 'Machine Learning'],
      },
      accessSignals: [
        {
          signalType: 'REACH_OUT_PLAUSIBLE',
          confidence: 'MEDIUM',
          sourceUrl: FACULTY_PROFILE_URL,
        },
      ],
    } as LabDetailPayload);

    await screen.findByText('Example Separate Profile Lab');

    expect(
      screen
        .getAllByRole('link', { name: 'Open official profile' })
        .every((link) => link.getAttribute('href') === FACULTY_PROFILE_URL),
    ).toBe(true);
    expect(screen.getByRole('link', { name: 'Visit lab website' }).getAttribute('href')).toBe(
      RESEARCH_WEBSITE_URL,
    );
    expect(screen.queryByRole('link', { name: 'Open official route' })).toBeNull();
    expect(screen.queryByText('Co-Director of Graduate Studies')).toBeNull();
    expect(container.textContent).toContain('What this lab studies');
  });

  it('prefers the lab website action when a contact route opens the lab homepage', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        slug: 'example-homepage-route-lab',
        name: 'Example Homepage Route Lab',
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: RESEARCH_WEBSITE_URL,
        sourceUrls: [FACULTY_PROFILE_URL, RESEARCH_WEBSITE_URL],
        departments: ['Psychology'],
        researchAreas: ['Decision neuroscience'],
      },
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

  it('does not treat a lab homepage URL as an official person profile', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        slug: 'example-lab-homepage-pi-route',
        name: 'Example Lab Homepage PI Route',
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: RESEARCH_WEBSITE_URL,
        sourceUrls: [RESEARCH_WEBSITE_URL],
        departments: ['Biomedical Engineering'],
        researchAreas: ['Optical Microscopy'],
      },
    } as LabDetailPayload);

    await screen.findByText('Example Lab Homepage PI Route');

    expect(screen.queryByRole('link', { name: 'Open official profile' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Visit lab website' }).getAttribute('href')).toBe(
      RESEARCH_WEBSITE_URL,
    );
    expect(screen.queryByRole('link', { name: 'Open official route' })).toBeNull();
    expect(screen.getByText('Research website')).toBeTruthy();
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
          relationshipType: 'MEMBER_RESEARCH_AREA',
          label: 'Faculty research area',
          evidenceStrength: 'MODERATE',
        },
      ],
      relatedResearchEntities: [
        {
          id: 'entity-2',
          slug: 'faculty-research-area-example-member',
          name: 'Example Member Research',
          kind: 'individual',
          entityType: 'FACULTY_RESEARCH_AREA',
          departments: ['Applied Physics'],
        },
      ],
    });

    await screen.findByText('Example Quantum Institute');

    expect(screen.getByText('Related labs and groups')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Example Member Research/ }).getAttribute('href')).toBe(
      '/research/faculty-research-area-example-member',
    );
    expect(screen.getByText('Individual')).toBeTruthy();
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
          relationshipType: 'MEMBER_RESEARCH_AREA',
          label: 'Faculty research area',
          evidenceStrength: 'MODERATE',
        },
      ],
      affiliatedResearchEntities: [
        {
          id: 'entity-umbrella',
          slug: 'center-yale-cancer-center',
          name: 'Yale Cancer Center',
          kind: 'center',
          entityType: 'CENTER',
          departments: ['Neuroscience'],
        },
      ],
    });

    await screen.findByText('Example Affiliate');

    expect(screen.getByText('Affiliated with')).toBeTruthy();
    expect(screen.getByText('Center')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Yale Cancer Center/ }).getAttribute('href')).toBe(
      '/research/center-yale-cancer-center',
    );
  });

  it('does not link an affiliation summary without a navigable slug', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        slug: 'faculty-research-area-example-affiliate',
        name: 'Example Affiliate Research',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
      },
      affiliatedResearchEntities: [
        {
          id: 'entity-umbrella',
          slug: '',
          name: 'Yale Quantum Institute',
          kind: 'institute',
          entityType: 'INSTITUTE',
          departments: ['Physics'],
        },
      ],
    });

    await screen.findByText('Example Affiliate');

    expect(screen.getByText('Yale Quantum Institute')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Yale Quantum Institute/ })).toBeNull();
  });

  it('renders a duplicated affiliation only once', async () => {
    const duplicateAffiliation = {
      id: 'entity-umbrella',
      slug: 'center-example-institute',
      name: 'Example Institute',
      kind: 'institute',
      entityType: 'INSTITUTE',
      departments: ['Neuroscience', 'Psychology'],
    };
    renderLabDetail({
      ...basePayload,
      affiliatedResearchEntities: [duplicateAffiliation, { ...duplicateAffiliation }],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.getAllByText('Affiliated with')).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: /Example Institute/ })).toHaveLength(1);
  });

  it('renders a duplicated related research entity only once', async () => {
    const duplicateRelated = {
      id: 'dept-physics-example-member',
      slug: 'dept-physics-example-member',
      name: 'Example Physics Member',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      departments: ['Physics'],
    };
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        kind: 'institute',
        entityType: 'INSTITUTE',
      },
      relatedResearchEntities: [duplicateRelated, { ...duplicateRelated }],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.getAllByText('Related labs and groups')).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: /Example Physics Member/ })).toHaveLength(1);
  });

  it('does not render inferred student-fit preparation from topic metadata', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        slug: 'example-health-systems-profile',
        name: 'Example Health Systems Profile',
        fullDescription:
          'Studies emergency medicine, health disparities, data systems, and public health research.',
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

  it('does not render internal profile completeness copy', async () => {
    renderLabDetail();

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.queryByText('Profile status')).toBeNull();
    expect(screen.queryByText('Source-backed details')).toBeNull();
    expect(screen.queryByText('No indexed planning routes are attached yet.')).toBeNull();
  });

  it('does not render legacy active listings as a public detail section', async () => {
    const { container } = renderLabDetail();

    await screen.findByText(DEFAULT_ENTITY_NAME);
    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith(`/research/${DEFAULT_SLUG}`, expect.any(Object));
    });

    const text = container.textContent || '';
    const principalInvestigatorIndex = text.indexOf('Principal Investigator');
    const sourcesIndex = text.indexOf('Sources');

    expect(text).not.toContain('Active Opportunities');
    expect(text).toContain('No principal investigator is attached yet');
    expect(text).toContain('Check the official profile for current leadership.');
    expect(principalInvestigatorIndex).toBeGreaterThan(-1);
    expect(sourcesIndex).toBeGreaterThan(principalInvestigatorIndex);
    expect(text).not.toContain('Research Activity');
    expect(text).not.toContain('Ways In');
    expect(text).not.toContain('Access evidence has not been attached yet.Evidence');
  });

  it('does not render paper-derived research evidence', async () => {
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

    expect(screen.queryByText('Related Research')).toBeNull();
    expect(screen.queryByText('Research evidence')).toBeNull();
    expect(screen.queryByText('Example research mechanism study')).toBeNull();
  });

  it('does not render publications attributed to research-home members', async () => {
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
          relationshipBasis: 'identity_authorship',
          evidenceLabel: 'Authored by a listed professor',
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

    expect(screen.queryByText('Recent work by Fixture Scholar')).toBeNull();
    expect(screen.queryByText('Research evidence')).toBeNull();
    expect(screen.queryByText('Example systems publication')).toBeNull();
  });

  it('deduplicates repeated active member rows before rendering profile cards', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const duplicateMember = {
      role: 'pi' as const,
      user: {
        _id: 'user-duplicate',
        netid: 'fixture.duplicate',
        fname: 'Fixture',
        lname: 'Duplicate',
        title: 'Professor of Astronomy',
        primary_department: 'Astronomy',
      },
    };

    renderLabDetail({
      ...basePayload,
      members: [duplicateMember, duplicateMember],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(consoleError.mock.calls.some((call) => String(call[0]).includes('same key'))).toBe(
      false,
    );
    consoleError.mockRestore();
  });

  it('deduplicates the same lead person across PI and director rows', async () => {
    renderLabDetail({
      ...basePayload,
      members: [
        {
          role: 'pi',
          user: {
            publicKey: 'fixture-lead-pi',
            fname: 'Fixture',
            lname: 'Lead',
            displayName: 'Fixture Lead',
            title: 'Professor of Example Studies',
            primary_department: 'Example Studies',
          },
        },
        {
          role: 'director',
          user: {
            publicKey: 'fixture-lead-director',
            fname: 'Fixture',
            lname: 'Lead',
            displayName: 'Fixture Lead',
            title: 'Professor of Example Studies',
            primary_department: 'Example Studies',
          },
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    const principalInvestigatorSection = screen
      .getByRole('heading', { name: 'Principal Investigator' })
      .closest('section');

    expect(principalInvestigatorSection).toBeTruthy();
    const section = within(principalInvestigatorSection as HTMLElement);
    expect(section.getAllByText('Fixture Lead')).toHaveLength(1);
    expect(section.getAllByText('Principal Investigator').length).toBeGreaterThan(0);
    expect(section.queryByText('Director')).toBeNull();
  });

  it('does not render YSM publication chrome as research description or area tags', async () => {
    renderLabDetail({
      ...basePayload,
      group: undefined,
      researchEntity: {
        ...basePayload.group,
        slug: 'example-publication-chrome-lab',
        name: 'Example Publication Chrome Lab',
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
        profileResearchAreas: ['Fixture Delivery Systems', 'Synthetic Signal Transfer'],
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
        shortDescription: '',
        fullDescription: '',
        departments: ['Behavioral Studies'],
        researchAreas: [],
        profileResearchAreas: ['Fixture Care Pathway Design', 'Synthetic Adherence Workflow'],
        researchAreaSource: 'PI_PROFILE_FALLBACK',
      },
    } as LabDetailPayload);

    const { container } = await waitFor(() => {
      expect(screen.getByText('Example Fallback Topic Lab')).toBeTruthy();
      return { container: document.body };
    });

    const text = container.textContent || '';
    expect(text).not.toContain('PI research interests');
    expect(text).not.toContain('Fixture Care Pathway Design');
    expect(text).not.toContain('A Yale research profile with limited public description.');
    expect(screen.queryByText('Research summary')).toBeNull();
    await waitFor(() => expect(captureClientError).toHaveBeenCalledWith(expect.any(Error)));
    expect(text).not.toContain('Research connected to Fixture Care Pathway Design');
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
        shortDescription: '',
        fullDescription: '',
        departments: ['Statistics & Data Science'],
        researchAreas: [],
        profileResearchAreas: ['High-Dimensional Statistics', 'Probability Theory'],
        researchAreaSource: 'PI_PROFILE_FALLBACK',
        profileSynthesisDescription:
          'It appears to center on High-Dimensional Statistics and Probability Theory.',
        descriptionSource: 'PI_PROFILE_SYNTHESIS',
      },
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
    expect(text).toContain(
      'Yale Research has not found a separate research website or posted undergraduate opening',
    );
    expect(text).not.toContain('What this lab studies');
    expect(text).not.toContain('Research connected to High-Dimensional Statistics');

    const summary = screen.getByText(
      'It appears to center on High-Dimensional Statistics and Probability Theory.',
    );
    const disclaimer = screen.getByText(
      /Yale Research has not found a separate research website or posted undergraduate opening/,
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
      expect(screen.getByRole('heading', { level: 1, name: 'Example' })).toBeTruthy();
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
        fullDescription,
      },
    } as LabDetailPayload);

    const { container } = await waitFor(() => {
      expect(screen.getByText('Example Full Description Lab')).toBeTruthy();
      return { container: document.body };
    });

    expect(container.textContent).toContain(
      'This research profile focuses on fixture social cognition. The group studies how synthetic category knowledge is acquired.',
    );
  });

  it('does not repeat a department as fallback research content on sparse profiles', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        name: 'Example Sparse Department Lab',
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
    expect(text).not.toContain('A Yale research profile with limited public description.');
    expect(screen.queryByText('Research summary')).toBeNull();
    await waitFor(() => expect(captureClientError).toHaveBeenCalledWith(expect.any(Error)));
    expect(text).not.toContain('Research connected to Public Policy.');
  });

  it('renders one official profile action for sparse faculty profile routes', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        name: 'Example Sparse Profile Lab',
        websiteUrl: DEPARTMENT_HOME_URL,
        sourceUrls: [DEPARTMENT_PEOPLE_URL, FACULTY_PROFILE_URL, DEPARTMENT_HOME_URL],
        departments: ['Public Policy'],
        researchAreas: [],
      },
    } as LabDetailPayload);

    await screen.findByText('Example Sparse Profile Lab');

    const profileLinks = screen.getAllByRole('link', { name: 'Open official profile' });
    expect(profileLinks).toHaveLength(1);
    expect(profileLinks[0].getAttribute('href')).toBe(FACULTY_PROFILE_URL);
    expect(screen.queryByRole('link', { name: 'Open official route' })).toBeNull();
  });
});

describe('LabDetail display name unification', () => {
  const RICHER_DISPLAY_NAME = 'Grace Hopper Center for Advanced Computing';

  it('renders displayName in both the H1 and the document title when it differs from name', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        name: 'hopper computing lab',
        displayName: RICHER_DISPLAY_NAME,
      },
    } as LabDetailPayload);

    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading.textContent).toBe(RICHER_DISPLAY_NAME);
    await waitFor(() => expect(document.title).toContain(RICHER_DISPLAY_NAME));
  });

  it('falls back to name in both the H1 and the document title when displayName is empty', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        name: 'Fallback Research Home',
        displayName: '',
      },
    } as LabDetailPayload);

    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('Fallback Research Home');
    await waitFor(() => expect(document.title).toContain('Fallback Research Home'));
  });

  it('offers a Visit official website action for a website-only research home', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        websiteUrl: MATERIALS_LAB_WEBSITE_URL,
        sourceUrls: [MATERIALS_LAB_WEBSITE_URL],
      },
      members: [
        {
          role: 'pi',
          user: {
            netid: 'fixture.faculty',
            fname: 'Jordan',
            lname: 'Researcher',
            displayName: 'Jordan Researcher',
            primary_department: 'Neurology',
          },
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    const websiteLink = screen.getByRole('link', { name: 'Visit official website' });
    expect(websiteLink.getAttribute('href')).toBe(MATERIALS_LAB_WEBSITE_URL);
    expect(screen.queryByRole('link', { name: 'Search the Yale Directory' })).toBeNull();
  });

  it('normalizes a schemeless website-only home url to an absolute external link', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        websiteUrl: 'lab-home.example.test/materials',
        sourceUrls: ['lab-home.example.test/materials'],
      },
      members: [
        {
          role: 'pi',
          user: {
            netid: 'fixture.faculty',
            fname: 'Jordan',
            lname: 'Researcher',
            displayName: 'Jordan Researcher',
            primary_department: 'Neurology',
          },
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    const websiteLink = screen.getByRole('link', { name: 'Visit official website' });
    expect(websiteLink.getAttribute('href')).toBe('https://lab-home.example.test/materials');
  });

  it('surfaces an official person-profile way-in from sourceUrls with no attached lead (#646)', async () => {
    const PERSON_PROFILE_SOURCE_URL = 'https://medicine.yale.edu/profile/example-lead/';
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        entityType: 'LAB',
        websiteUrl: '',
        sourceUrls: [PERSON_PROFILE_SOURCE_URL],
      },
      members: [],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    const wayInLink = screen
      .getAllByRole('link')
      .find(
        (link) => link.getAttribute('href') === 'https://medicine.yale.edu/profile/example-lead',
      );
    expect(wayInLink).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Search the Yale Directory' })).toBeNull();
  });

  it('falls through to the Yale Directory for an identifier-only source with no lead or website (#651)', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        entityType: 'LAB',
        websiteUrl: '',
        sourceUrls: ['https://orcid.org/0000-0000-0000-0000'],
      },
      members: [],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.getByRole('link', { name: 'Search the Yale Directory' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open the official page' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open official profile' })).toBeNull();
  });

  it('never promotes a bare ORCID as the official-page CTA for a web-less home whose lead lacks an official profile (#651)', async () => {
    const ORCID_URL = 'https://orcid.org/0000-0000-0000-0000';
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        entityType: 'FACULTY_RESEARCH_AREA',
        websiteUrl: '',
        sourceUrls: [ORCID_URL],
      },
      members: [
        {
          role: 'pi',
          user: {
            netid: 'fixture.faculty',
            fname: 'Ada',
            lname: 'Researcher',
            displayName: 'Ada Researcher',
            primary_department: 'Neurology',
            profileUrls: { orcid: ORCID_URL },
          },
        },
      ],
    });

    await screen.findByText(DEFAULT_ENTITY_NAME);

    expect(screen.getByRole('link', { name: 'Search the Yale Directory' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open the official page' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open official profile' })).toBeNull();
  });

  it('renders the polished NotFound page when the research profile 404s', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/users/savedResearchEntityIds') {
        return Promise.resolve({ data: { savedResearchEntityIds: [] } });
      }
      if (url === `/research/${DEFAULT_SLUG}`) {
        return Promise.reject({ response: { status: 404 } });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });

    render(
      <UserContext.Provider
        value={{ ...defaultUserContext, isLoading: false, isAuthenticated: true }}
      >
        <MemoryRouter initialEntries={[`/research/${DEFAULT_SLUG}`]}>
          <Routes>
            <Route path="/research/:slug" element={<LabDetail />} />
          </Routes>
        </MemoryRouter>
      </UserContext.Provider>,
    );

    expect(
      await screen.findByRole('heading', { name: /we couldn't find that yale research page/i }),
    ).toBeTruthy();
    const exploreLink = screen.getByRole('link', { name: /explore yale research/i });
    expect(exploreLink.getAttribute('href')).toBe('/research');
    await waitFor(() => expect(document.title).toContain('Page not found'));
  });

  it('offers an Explore Research recovery CTA when the profile fails to load for a non-404 reason', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/users/savedResearchEntityIds') {
        return Promise.resolve({ data: { savedResearchEntityIds: [] } });
      }
      if (url === `/research/${DEFAULT_SLUG}`) {
        return Promise.reject({ response: { status: 500 } });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });

    render(
      <UserContext.Provider
        value={{ ...defaultUserContext, isLoading: false, isAuthenticated: true }}
      >
        <MemoryRouter initialEntries={[`/research/${DEFAULT_SLUG}`]}>
          <Routes>
            <Route path="/research/:slug" element={<LabDetail />} />
          </Routes>
        </MemoryRouter>
      </UserContext.Provider>,
    );

    expect(
      await screen.findByText(/Something went wrong loading this research profile/),
    ).toBeTruthy();
    const exploreLink = screen.getByRole('link', { name: /explore yale research/i });
    expect(exploreLink.getAttribute('href')).toBe('/research');
  });
});
