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

const basePayload: LabDetailPayload = {
  group: {
    _id: 'entity-1',
    slug: 'nih-pi-stephen-strittmatter',
    name: 'Stephen Strittmatter Research Profile',
    kind: 'individual',
    entityType: 'FACULTY_RESEARCH_AREA',
    description: 'Studies mechanisms of neurological disease.',
    websiteUrl: 'https://medicine.yale.edu/profile/stephen-strittmatter',
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
    if (url === '/research/nih-pi-stephen-strittmatter') {
      return Promise.resolve({ data: payload });
    }
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });

  return render(
    <MemoryRouter initialEntries={['/research/nih-pi-stephen-strittmatter']}>
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

    await screen.findByText('Stephen Strittmatter Research Profile');

    expect(
      screen.getByText('Review the official profile first, then decide whether targeted outreach is appropriate.'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open official profile' }).getAttribute('href')).toBe(
      'https://medicine.yale.edu/profile/stephen-strittmatter',
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
          sourceUrls: ['https://medicine.yale.edu/profile/stephen-strittmatter'],
        },
      ],
    });

    await screen.findByText('Stephen Strittmatter Research Profile');

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
          sourceUrls: ['https://medicine.yale.edu/profile/stephen-strittmatter'],
        },
      ],
    });

    await screen.findByText('Stephen Strittmatter Research Profile');

    fireEvent.click(screen.getByText('Save research plan'));

    expect(mockedAxios.put).toHaveBeenCalledWith('/users/savedResearchPlans', {
      withCredentials: true,
      data: { savedResearchPlans: ['pathway-1'] },
    });
    expect(screen.getByRole('button', { name: 'Saved to Dashboard' })).toBeTruthy();
  });

  it('places the research-plan save action in the page header before the student decision panel', async () => {
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
          sourceUrls: ['https://medicine.yale.edu/profile/stephen-strittmatter'],
        },
      ],
    });

    await screen.findByText('Stephen Strittmatter Research Profile');

    const saveButton = screen.getByRole('button', { name: 'Save research plan' });
    const studentDecisionHeading = screen.getByText('Student decision');

    expect(
      Boolean(saveButton.compareDocumentPosition(studentDecisionHeading) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
  });

  it('surfaces the lead professor profile in the student decision panel', async () => {
    renderLabDetail({
      ...basePayload,
      members: [
        {
          role: 'pi',
          user: {
            netid: 'ss123',
            fname: 'Stephen',
            lname: 'Strittmatter',
            displayName: 'Stephen Strittmatter',
            title: 'Professor of Neurology',
            primary_department: 'Neurology',
          },
        },
      ],
    });

    await screen.findByText('Stephen Strittmatter Research Profile');

    const leadProfessorLabel = screen.getByText('Lead professor');
    const recommendedNextStep = screen.getByText('Recommended next step');
    const profileLinks = screen.getAllByRole('link', { name: /Stephen Strittmatter/ });

    expect(profileLinks[0].getAttribute('href')).toBe('/profile/ss123');
    expect(screen.getByText('Professor of Neurology · Neurology')).toBeTruthy();
    expect(
      Boolean(
        leadProfessorLabel.compareDocumentPosition(recommendedNextStep) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
  });

  it('labels the sidebar as a contact route instead of repeating next-step language', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        contactEmail: 'holley.lab@yale.edu',
      },
    });

    await screen.findByText('Stephen Strittmatter Research Profile');

    expect(screen.getByRole('heading', { name: 'Contact route' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Plan your next step' })).toBeNull();
  });

  it('falls back to a source URL when no official website is available', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        websiteUrl: '',
        sourceUrls: ['https://research.yale.edu/source-profile'],
      },
    });

    await screen.findByText('Stephen Strittmatter Research Profile');

    expect(screen.getByRole('link', { name: 'Open official profile' }).getAttribute('href')).toBe(
      'https://research.yale.edu/source-profile',
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
          sourceUrls: ['https://medicine.yale.edu/profile/stephen-strittmatter'],
        },
      ],
      contactRoutes: [
        {
          _id: 'route-1',
          routeType: 'PROGRAM_MANAGER',
          label: 'Program manager',
          rationale: 'This route is listed by the program.',
          url: 'https://medicine.yale.edu/contact',
          sourceUrl: 'https://medicine.yale.edu/profile/stephen-strittmatter',
        },
      ],
    });

    await screen.findByText('Stephen Strittmatter Research Profile');

    expect(screen.getAllByText('Contact the program manager through the listed route.')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Open official route' }).getAttribute('href')).toBe(
      'https://medicine.yale.edu/contact',
    );
    expect(screen.getByRole('link', { name: 'Open official profile' }).getAttribute('href')).toBe(
      'https://medicine.yale.edu/profile/stephen-strittmatter',
    );
  });

  it('uses the research website as the first public next step for exploratory profile routes', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        slug: 'dept-eeb-serena-tucci',
        name: 'Serena Tucci Lab',
        websiteUrl: 'https://campuspress.yale.edu/stucci/',
        sourceUrls: [
          'https://eeb.yale.edu/people/faculty',
          'https://eeb.yale.edu/people/faculty-affiliated/serena-tucci',
          'https://campuspress.yale.edu/stucci/',
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
            'https://eeb.yale.edu/people/faculty-affiliated/serena-tucci',
            'https://campuspress.yale.edu/stucci/',
          ],
        },
      ],
      contactRoutes: [
        {
          _id: 'route-1',
          routeType: 'FACULTY_PI',
          label: 'Serena Tucci',
          rationale: 'Official Yale faculty profile for the PI; review it before outreach.',
          url: 'https://eeb.yale.edu/people/faculty-affiliated/serena-tucci',
          sourceUrl: 'https://eeb.yale.edu/people/faculty-affiliated/serena-tucci',
        },
      ],
      accessSignals: [
        {
          _id: 'signal-1',
          signalType: 'REACH_OUT_PLAUSIBLE',
          confidence: 'MEDIUM',
          sourceUrl: 'https://eeb.yale.edu/people/faculty-affiliated/serena-tucci',
        },
      ],
    });

    await screen.findByText('Serena Tucci Lab');

    expect(screen.getByRole('link', { name: 'Open official profile' }).getAttribute('href')).toBe(
      'https://eeb.yale.edu/people/faculty-affiliated/serena-tucci',
    );
    expect(screen.queryByText('Faculty page')).toBeNull();
    expect(screen.queryByText('Serena Tucci page')).toBeNull();
    expect(screen.getByText('Research website')).toBeTruthy();
  });

  it('links official profile to the PI profile and never surfaces the faculty roster list', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        slug: 'dept-mcdb-thierry-emonet',
        name: 'Thierry Emonet Lab',
        websiteUrl: 'https://emonet.biology.yale.edu/',
        sourceUrls: [
          'https://mcdb.yale.edu/people/faculty',
          'https://mcdb.yale.edu/profile/thierry-emonet-phd',
          'https://emonet.biology.yale.edu/',
        ],
      },
      contactRoutes: [
        {
          _id: 'route-1',
          routeType: 'FACULTY_PI',
          label: 'Thierry Emonet',
          rationale: 'Official Yale faculty profile for the PI; review it before outreach.',
          url: 'https://mcdb.yale.edu/profile/thierry-emonet-phd',
          sourceUrl: 'https://mcdb.yale.edu/profile/thierry-emonet-phd',
        },
      ],
    });

    const { container } = await waitFor(() => {
      expect(screen.getByText('Thierry Emonet Lab')).toBeTruthy();
      return { container: document.body };
    });

    expect(screen.getByRole('link', { name: 'Open official profile' }).getAttribute('href')).toBe(
      'https://mcdb.yale.edu/profile/thierry-emonet-phd',
    );
    expect(screen.getByRole('link', { name: 'Visit lab website' }).getAttribute('href')).toBe(
      'https://emonet.biology.yale.edu/',
    );
    expect(container.textContent).toContain('Thierry Emonet Phd page');
    expect(container.textContent).not.toContain('Faculty page');
    expect(
      Array.from(container.querySelectorAll('a')).some(
        (link) => link.getAttribute('href') === 'https://mcdb.yale.edu/people/faculty',
      ),
    ).toBe(false);
  });

  it('leads sparse profiles with a student decision summary before evidence details', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        slug: 'dept-eeb-serena-tucci',
        name: 'Serena Tucci Lab',
        kind: 'lab',
        entityType: 'LAB',
        description: 'Studies human evolution, population genetics, and ancient DNA.',
        websiteUrl: 'https://campuspress.yale.edu/stucci/',
        departments: ['Ecology and Evolutionary Biology'],
        researchAreas: ['human evolution', 'population genetics', 'ancient DNA'],
        profileResearchAreas: ['Computational biology', 'Anthropology'],
        school: 'Yale Faculty of Arts and Sciences',
        sourceUrls: ['https://eeb.yale.edu/people/faculty-affiliated/serena-tucci'],
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
          sourceUrls: ['https://eeb.yale.edu/people/faculty-affiliated/serena-tucci'],
        },
      ],
      contactRoutes: [
        {
          _id: 'route-1',
          routeType: 'FACULTY_PI',
          label: 'Serena Tucci',
          rationale: 'Official Yale faculty profile for the PI; review it before outreach.',
          url: 'https://eeb.yale.edu/people/faculty-affiliated/serena-tucci',
          sourceUrl: 'https://eeb.yale.edu/people/faculty-affiliated/serena-tucci',
        },
      ],
      accessSignals: [
        {
          _id: 'signal-1',
          signalType: 'REACH_OUT_PLAUSIBLE',
          confidence: 'MEDIUM',
          confidenceScore: 0.7,
          sourceUrl: 'https://eeb.yale.edu/people/faculty-affiliated/serena-tucci',
        },
      ],
    });

    const { container } = await waitFor(() => {
      expect(screen.getByText('Serena Tucci Lab')).toBeTruthy();
      return { container: document.body };
    });

    const text = container.textContent || '';
    expect(text).toContain('What this lab studies');
    expect(text).toContain('Best fit for');
    expect(screen.getByText('Human Evolution')).toBeTruthy();
    expect(screen.getByText('Population Genetics')).toBeTruthy();
    expect(screen.getByText('Ancient DNA')).toBeTruthy();
    expect(text).toContain('Recommended next step');
    expect(text).not.toContain('Why this matched');
    expect(text).not.toContain('Student fit');
    expect(text).not.toContain('Likely preparation');
    expect(text).not.toContain('Good fit if you are interested in');
    expect(text).toContain('Profile status');
    expect(text).not.toContain('Recommended outreach angle');
    expect(text.indexOf('What this lab studies')).toBeLessThan(text.indexOf('Profile status'));
    expect(screen.getByRole('link', { name: 'Open official profile' }).getAttribute('href')).toBe(
      'https://eeb.yale.edu/people/faculty-affiliated/serena-tucci',
    );
    expect(screen.queryByRole('link', { name: 'Serena Tucci' })).toBeNull();
  });

  it('separates the official PI profile from the lab website for faculty lab pages', async () => {
    const { container } = renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        slug: 'dept-statistics-zhou-fan',
        name: 'Zhou Fan Lab',
        websiteUrl: 'https://www.stat.yale.edu/~zf59/',
        shortDescription: 'Co-Director of Graduate Studies',
        sourceUrls: [
          'https://statistics.yale.edu/profile/zhou-fan',
          'https://www.stat.yale.edu/~zf59/',
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
            'https://statistics.yale.edu/profile/zhou-fan',
            'http://www.stat.yale.edu/~zf59/',
          ],
        },
      ],
      contactRoutes: [
        {
          _id: 'route-1',
          routeType: 'FACULTY_PI',
          label: 'Zhou Fan',
          rationale: 'Official Yale faculty profile for the PI; review it before outreach.',
          url: 'https://statistics.yale.edu/profile/zhou-fan',
          sourceUrl: 'https://statistics.yale.edu/profile/zhou-fan',
          visibility: 'PUBLIC',
        },
      ],
      accessSignals: [
        {
          _id: 'signal-1',
          signalType: 'REACH_OUT_PLAUSIBLE',
          confidence: 'MEDIUM',
          sourceUrl: 'https://statistics.yale.edu/profile/zhou-fan',
        },
      ],
    } as LabDetailPayload);

    await screen.findByText('Zhou Fan Lab');

    expect(screen.getByRole('link', { name: 'Open official profile' }).getAttribute('href')).toBe(
      'https://statistics.yale.edu/profile/zhou-fan',
    );
    expect(screen.getByRole('link', { name: 'Visit lab website' }).getAttribute('href')).toBe(
      'https://www.stat.yale.edu/~zf59/',
    );
    expect(screen.queryByRole('link', { name: 'Open official route' })).toBeNull();
    expect(screen.queryByText('Co-Director of Graduate Studies')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Contact route' })).toBeNull();
    expect(
      Array.from(container.querySelectorAll('.grid')).some((element) =>
        element.className.includes('lg:grid-cols-[minmax(0,1fr)_22rem]'),
      ),
    ).toBe(false);
    expect(container.querySelector('.lg\\:mx-auto')).toBeTruthy();
  });

  it('prefers the lab website action when a contact route opens the lab homepage', async () => {
    const { container } = renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        slug: 'dept-psych-robb-rutledge',
        name: 'Robb Rutledge Lab',
        websiteUrl: 'https://rutledgelab.org/',
        sourceUrls: [
          'https://psychology.yale.edu/people/robb-rutledge',
          'https://rutledgelab.org/',
        ],
        departments: ['Psychology'],
        researchAreas: ['Decision neuroscience'],
      },
      contactRoutes: [
        {
          _id: 'route-1',
          routeType: 'FACULTY_PI',
          label: 'Robb Rutledge',
          url: 'https://psychology.yale.edu/people/robb-rutledge',
          sourceUrl: 'https://psychology.yale.edu/people/robb-rutledge',
          visibility: 'PUBLIC',
        },
        {
          _id: 'route-2',
          routeType: 'PROGRAM_MANAGER',
          label: 'Lab website',
          url: 'https://rutledgelab.org',
          sourceUrl: 'https://rutledgelab.org/',
          visibility: 'PUBLIC',
        },
      ],
    } as LabDetailPayload);

    await screen.findByText('Robb Rutledge Lab');

    expect(screen.getByRole('link', { name: 'Open official profile' }).getAttribute('href')).toBe(
      'https://psychology.yale.edu/people/robb-rutledge',
    );
    expect(screen.getByRole('link', { name: 'Visit lab website' }).getAttribute('href')).toBe(
      'https://rutledgelab.org/',
    );
    expect(screen.queryByRole('link', { name: 'Open official route' })).toBeNull();
    expect(container.querySelector('.max-w-screen-2xl')).toBeTruthy();
    expect(
      Array.from(container.querySelectorAll('.grid')).some((element) =>
        element.className.includes('xl:grid-cols-[minmax(0,1fr)_24rem]') &&
        element.className.includes('2xl:grid-cols-[minmax(0,1fr)_26rem]'),
      ),
    ).toBe(true);
    expect(container.querySelector('.lg\\:col-span-2')).toBeNull();
  });

  it('keeps a lab homepage separate from a join page official route', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        slug: 'nsf-pi-67d891f450621bcef4348451',
        name: 'Yarrow Dunham Lab',
        websiteUrl: 'http://www.socialcogdev.com/',
        sourceUrls: [
          'https://psychology.yale.edu/people/yarrow-dunham',
          'http://www.socialcogdev.com/',
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
          sourceUrls: ['http://www.socialcogdev.com/join-us-1'],
        },
      ],
      contactRoutes: [
        {
          _id: 'route-1',
          routeType: 'OFFICIAL_APPLICATION',
          label: 'Join us',
          url: 'http://www.socialcogdev.com/join-us-1',
          sourceUrl: 'http://www.socialcogdev.com/join-us-1',
          visibility: 'PUBLIC',
        },
      ],
    } as LabDetailPayload);

    await screen.findByText('Yarrow Dunham Lab');

    expect(screen.getByRole('link', { name: 'Visit lab website' }).getAttribute('href')).toBe(
      'http://www.socialcogdev.com/',
    );
    const officialRouteLinks = screen.getAllByRole('link', { name: 'Open official route' });
    expect(officialRouteLinks.map((link) => link.getAttribute('href'))).toEqual([
      'http://www.socialcogdev.com/join-us-1',
      'http://www.socialcogdev.com/join-us-1',
    ]);
    expect(screen.queryByRole('link', { name: 'Open official profile' })).toBeNull();
  });

  it('renders related labs and groups for umbrella research entities', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        slug: 'center-yale-quantum-institute',
        name: 'Yale Quantum Institute',
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
          _id: 'entity-2',
          id: 'entity-2',
          slug: 'faculty-research-area-aleksander-kubica',
          name: 'Aleksander Kubica Research',
          kind: 'individual',
          entityType: 'FACULTY_RESEARCH_AREA',
          departments: ['Applied Physics'],
          researchAreas: ['Quantum error correction'],
          sourceUrls: [],
        },
      ],
    });

    await screen.findByText('Yale Quantum Institute');

    expect(screen.getByText('Related labs and groups')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Aleksander Kubica Research/ }).getAttribute('href')).toBe(
      '/research/faculty-research-area-aleksander-kubica',
    );
    expect(screen.getByText('Faculty research area')).toBeTruthy();
  });

  it('renders umbrella affiliations for related faculty research areas', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        slug: 'faculty-research-area-zhong-shao',
        name: 'Zhong Shao Research',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
      },
      affiliatedRelationships: [
        {
          _id: 'rel-2',
          sourceResearchEntityId: 'entity-wti',
          targetResearchEntityId: 'entity-1',
          relationshipType: 'MEMBER_RESEARCH_AREA',
          label: 'Faculty research area',
          evidenceStrength: 'MODERATE',
        },
      ],
      affiliatedResearchEntities: [
        {
          _id: 'entity-wti',
          id: 'entity-wti',
          slug: 'center-wu-tsai',
          name: 'Wu Tsai Institute',
          kind: 'institute',
          entityType: 'INSTITUTE',
          departments: ['Neuroscience'],
          researchAreas: [],
          sourceUrls: [],
        },
      ],
    });

    await screen.findByText('Zhong Shao Research');

    expect(screen.getByText('Affiliated with')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Wu Tsai Institute/ }).getAttribute('href')).toBe(
      '/research/center-wu-tsai',
    );
  });

  it('does not render inferred student-fit preparation from topic metadata', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        slug: 'ysm-venkatesh',
        name: 'Venkatesh Research Profile',
        description: 'Studies emergency medicine, health disparities, data systems, and public health research.',
        departments: ['Yale School of Medicine'],
        researchAreas: [
          'Emergency Medicine',
          'Health Disparities',
          'Data Systems',
          'Public Health Research',
        ],
        school: 'Yale School of Medicine',
      },
      accessSignals: [
        {
          _id: 'signal-1',
          signalType: 'REACH_OUT_PLAUSIBLE',
          confidence: 'MEDIUM',
          sourceUrl: 'https://medicine.yale.edu/profile/example',
        },
      ],
    });

    await screen.findByText('Venkatesh Research Profile');

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

  it('does not use low-contrast classes for detail labels and empty states', async () => {
    const { container } = renderLabDetail();

    await screen.findByText('Stephen Strittmatter Research Profile');

    expect(container.querySelector('section h2.text-gray-400')).toBeNull();
    expect(container.querySelector('section p.text-gray-500')).toBeNull();
  });

  it('does not render legacy active listings as a public detail section', async () => {
    const { container } = renderLabDetail();

    await screen.findByText('Stephen Strittmatter Research Profile');
    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith(
        '/research/nih-pi-stephen-strittmatter',
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
          title: 'Pancreatic tumor suppression mechanisms',
          url: 'https://doi.org/10.1000/pancreas',
          destinationKind: 'DOI',
          displaySource: 'DOI',
          discoveredVia: 'OPENALEX',
          year: 2024,
          venue: 'Cancer Discovery',
        },
      ],
    });

    await screen.findByText('Stephen Strittmatter Research Profile');

    expect(screen.getByText('Related Research')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Pancreatic tumor suppression mechanisms' });
    expect(link.getAttribute('href')).toBe('https://doi.org/10.1000/pancreas');
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
            netid: 'ja54',
            fname: 'James',
            lname: 'Aspnes',
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
          title: 'Stochastic well-structured transition systems',
          url: 'https://doi.org/10.48550/arXiv.2512.20939',
          destinationKind: 'DOI',
          displaySource: 'DOI',
          discoveredVia: 'MANUAL',
          year: 2025,
          venue: 'arXiv.org',
        },
      ],
    });

    await screen.findByText('Stephen Strittmatter Research Profile');

    expect(screen.getByText('Recent work by James Aspnes')).toBeTruthy();
    expect(screen.queryByText('Research Activity')).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Stochastic well-structured transition systems' }).getAttribute('href'),
    ).toBe('https://doi.org/10.48550/arXiv.2512.20939');
    expect(
      screen.getByRole('link', { name: 'View all research activity on James Aspnes’s profile' }).getAttribute('href'),
    ).toBe('/profile/ja54?tab=research');
  });

  it('does not render YSM publication chrome as research description or area tags', async () => {
    renderLabDetail({
      ...basePayload,
      group: undefined,
      researchEntity: {
        ...basePayload.group,
        slug: 'ysm-langston',
        name: 'Langston Lab',
        description: '',
        shortDescription: 'Publications TimelineA big-picture view of P.',
        fullDescription: 'View 5 Related Publications',
        researchAreas: [
          'Inflammation40 YSM ResearchersView 5 Related Publications',
          'View 5 Related Publications',
          'Inflammation',
        ],
      },
    } as LabDetailPayload);

    const { container } = await waitFor(() => {
      expect(screen.getByText('Langston Lab')).toBeTruthy();
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
          'Nanoparticle-Based Drug Delivery',
          'RNA Interference and Gene Delivery',
        ],
        researchAreaSource: 'PI_PROFILE_FALLBACK',
      },
    } as LabDetailPayload);

    await screen.findByText('Stephen Strittmatter Research Profile');

    expect(screen.queryByText('PI research interests')).toBeNull();
    expect(screen.queryByText('Nanoparticle-Based Drug Delivery')).toBeNull();
    expect(screen.queryByText('RNA Interference and Gene Delivery')).toBeNull();
  });

  it('does not promote PI-profile fallback topics into lab-level summary copy', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        name: 'Ravi Dhar Lab',
        description: '',
        shortDescription: '',
        fullDescription: '',
        departments: ['Economics'],
        researchAreas: [],
        profileResearchAreas: [
          'Heart Failure Treatment and Management',
          'Medication Adherence and Compliance',
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
          sourceUrls: ['https://economics.yale.edu/people/ravi-dhar'],
        },
      ],
      contactRoutes: [
        {
          _id: 'route-1',
          routeType: 'FACULTY_PI',
          label: 'Ravi Dhar',
          url: 'https://economics.yale.edu/people/ravi-dhar',
          sourceUrl: 'https://economics.yale.edu/people/ravi-dhar',
          visibility: 'PUBLIC',
        },
      ],
    } as LabDetailPayload);

    const { container } = await waitFor(() => {
      expect(screen.getByText('Ravi Dhar Lab')).toBeTruthy();
      return { container: document.body };
    });

    const text = container.textContent || '';
    expect(text).not.toContain('PI research interests');
    expect(text).not.toContain('Heart Failure Treatment and Management');
    expect(text).toContain('A Yale research profile with limited public description.');
    expect(text).not.toContain(
      'Research connected to Heart Failure Treatment and Management',
    );
    expect(text).not.toContain('Research connected to Economics.');
    expect(screen.queryByText('Plan your next step')).toBeNull();
    expect(screen.queryByText('Ways to approach this lab')).toBeNull();
  });

  it('renders PI-profile synthesis with faculty-research wording instead of lab-description wording', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        name: 'Zhou Fan Lab',
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
          sourceUrls: ['https://statistics.yale.edu/profile/zhou-fan'],
        },
      ],
      contactRoutes: [
        {
          _id: 'route-1',
          routeType: 'FACULTY_PI',
          label: 'Zhou Fan',
          url: 'https://statistics.yale.edu/profile/zhou-fan',
          sourceUrl: 'https://statistics.yale.edu/profile/zhou-fan',
          visibility: 'PUBLIC',
        },
      ],
    } as LabDetailPayload);

    const { container } = await waitFor(() => {
      expect(screen.getByText('Zhou Fan Lab')).toBeTruthy();
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
        name: 'The Faboratory',
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: 'https://www.eng.yale.edu/faboratory/',
        description: '',
        shortDescription: '',
        fullDescription: '',
        profileSynthesisDescription:
          'This faculty research profile is synthesized from PI profile topics and recent scholarly work.',
        descriptionSource: 'PI_PROFILE_SYNTHESIS',
      },
    } as LabDetailPayload);

    const { container } = await waitFor(() => {
      expect(screen.getByText('The Faboratory')).toBeTruthy();
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
        name: 'James Aspnes — Research',
        kind: 'individual',
        entityType: 'INDIVIDUAL_RESEARCH',
        websiteUrl: 'https://www.cs.yale.edu/homes/aspnes/',
        fullDescription:
          'James Aspnes studies distributed algorithms, population protocols, and consensus mechanisms.',
        descriptionSource: 'ENTITY_SOURCE',
      },
    } as LabDetailPayload);

    const { container } = await waitFor(() => {
      expect(screen.getByText('James Aspnes — Research')).toBeTruthy();
      return { container: document.body };
    });

    const text = container.textContent || '';
    expect(text).toContain('What this faculty research area covers');
    expect(text).not.toContain('What this lab studies');
  });

  it('uses the full description as the primary research detail copy', async () => {
    const fullDescription =
      'My lab focuses on intergroup social cognition. Humans are perhaps the most social species on the planet. My lab addresses this question by studying how knowledge of social groups is acquired.';

    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        name: 'Yarrow Dunham Lab',
        shortDescription: 'My lab focuses on intergroup social cognition.',
        description:
          'The lab studies how social groups are acquired in adults and children, using experimental and cross-cultural methods.',
        fullDescription,
      },
    } as LabDetailPayload);

    const { container } = await waitFor(() => {
      expect(screen.getByText('Yarrow Dunham Lab')).toBeTruthy();
      return { container: document.body };
    });

    expect(container.textContent).toContain(fullDescription);
  });

  it('does not repeat a department as fallback research content on sparse profiles', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        name: 'Joshua Kalla Lab',
        description: '',
        shortDescription: '',
        fullDescription: '',
        departments: ['Economics'],
        researchAreas: [],
        profileResearchAreas: [
          'Social Media and Politics',
          'Electoral Systems and Political Participation',
        ],
        researchAreaSource: 'PI_PROFILE_FALLBACK',
      },
    } as LabDetailPayload);

    const { container } = await waitFor(() => {
      expect(screen.getByText('Joshua Kalla Lab')).toBeTruthy();
      return { container: document.body };
    });

    const text = container.textContent || '';
    expect(screen.getAllByText('Economics')).toHaveLength(1);
    expect(text).toContain('A Yale research profile with limited public description.');
    expect(text).not.toContain('Research connected to Economics.');
  });

  it('renders one official profile action for sparse faculty profile routes', async () => {
    renderLabDetail({
      ...basePayload,
      group: {
        ...basePayload.group,
        name: 'Joshua Kalla Lab',
        websiteUrl: 'https://economics.yale.edu/',
        sourceUrls: [
          'https://economics.yale.edu/people?page=18',
          'https://economics.yale.edu/people/joshua-kalla',
          'https://economics.yale.edu/',
        ],
        departments: ['Economics'],
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
          sourceUrls: ['https://economics.yale.edu/people/joshua-kalla'],
        },
      ],
      contactRoutes: [
        {
          _id: 'route-1',
          routeType: 'FACULTY_PI',
          label: 'Joshua Kalla',
          url: 'https://economics.yale.edu/people/joshua-kalla',
          sourceUrl: 'https://economics.yale.edu/people/joshua-kalla',
          visibility: 'PUBLIC',
        },
      ],
    } as LabDetailPayload);

    await screen.findByText('Joshua Kalla Lab');

    const profileLinks = screen.getAllByRole('link', { name: 'Open official profile' });
    expect(profileLinks).toHaveLength(1);
    expect(profileLinks[0].getAttribute('href')).toBe(
      'https://economics.yale.edu/people/joshua-kalla',
    );
    expect(screen.queryByRole('link', { name: 'Open official route' })).toBeNull();
  });
});
