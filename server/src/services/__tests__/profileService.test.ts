import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  adminUpdateProfile,
  normalizeProfileForClient,
  normalizeProfileUpdateForStorage,
  sanitizeProfileBio,
} from '../profileService';
import { User } from '../../models/user';

const TEST_NETID = 'test-user';
const TEST_PROFILE_URL = 'https://profiles.example.edu/test-user';
const TEST_IMAGE_URL = 'https://profiles.example.edu/test-user.jpg';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('normalizeProfileForClient', () => {
  it('surfaces stored professor image URLs using the client profile field name', () => {
    const profile = normalizeProfileForClient({
      netid: TEST_NETID,
      fname: 'Example',
      lname: 'Person',
      imageUrl: TEST_IMAGE_URL,
    });

    expect(profile.image_url).toBe(TEST_IMAGE_URL);
  });

  it('surfaces scraper-populated faculty profile fields using client profile field names', () => {
    const profile = normalizeProfileForClient({
      netid: TEST_NETID,
      primaryDepartment: 'Applied Mathematics',
      secondaryDepartments: ['Computer Science'],
      researchInterests: ['optimization'],
      website: 'https://research.example.edu/',
      profileUrls: { directory: TEST_PROFILE_URL },
      hIndex: 14,
      openAlexId: 'https://openalex.org/A1',
      physicalLocation: '17 Example Ave',
      buildingDesk: 'Room 101',
    });

    expect(profile.primary_department).toBe('Applied Mathematics');
    expect(profile.secondary_departments).toEqual(['Computer Science']);
    expect(profile.research_interests).toEqual(['optimization']);
    expect(profile.website).toBe('https://research.example.edu/');
    expect(profile.profile_urls).toEqual({ directory: TEST_PROFILE_URL });
    expect(profile.h_index).toBe(14);
    expect(profile.openalex_id).toBe('https://openalex.org/A1');
    expect(profile.physical_location).toBe('17 Example Ave');
    expect(profile.building_desk).toBe('Room 101');
  });

  it('prefers canonical department display labels for public profile output when provided', () => {
    const profile = normalizeProfileForClient(
      {
        netid: 'fx101',
        fname: 'Fixture',
        lname: 'Profile',
        primaryDepartment: 'EASCPS Computer Science',
        secondaryDepartments: ['EAS School of Engineering and Applied Science'],
        departments: ['Computer Science'],
      },
      {
        canonicalProfileDepartments: {
          primaryDepartment: 'CPSC - Computer Science',
          secondaryDepartments: [],
          departments: ['CPSC - Computer Science'],
          unresolved: [],
          ignored: ['EAS School of Engineering and Applied Science'],
        },
      },
    );

    expect(profile.primary_department).toBe('CPSC - Computer Science');
    expect(profile.secondary_departments).toEqual([]);
    expect(profile.departments).toEqual(['CPSC - Computer Science']);
  });

  it('filters source chrome and identifier noise from public research interests', () => {
    const profile = normalizeProfileForClient({
      netid: TEST_NETID,
      researchInterests: [
        'ORCID0000-0000-0000-001X',
        '0000-0000-0000-001X',
        'Lab Whisk Cup Streamline Icon: https://streamlinehq.comExample LabView Lab Website',
        'View Lab Website',
        'Signal Biology10 YSM Researchers View Related Publication',
        '10 YSM Researchers',
        'View Related Publication',
        'spatial analysis',
      ],
      topics: ['spatial analysis', 'model systems'],
    });

    expect(profile.research_interests).toEqual(['Signal Biology', 'spatial analysis']);
    expect(profile.topics).toEqual(['spatial analysis', 'model systems']);
  });

  it('filters YSM profile/publication widgets and metrics from public research terms', () => {
    const profile = normalizeProfileForClient({
      netid: TEST_NETID,
      researchInterests: [
        'Causal Inference and Survey Methods',
        'Example Clinician, MDView Full ProfileView Common Publication',
        'View Full Profile',
        'View Common Publication',
        '9 Publications',
        '21 Citations',
      ],
      topics: [
        'Longitudinal Data Analysis',
        'Example Faculty, MDView Full ProfileView 12 Common Publications',
        'Another Faculty, MDView Full ProfileView Common Publications',
        '9 Publications 21 Citations',
        'Community Intervention Design',
      ],
    });

    expect(profile.research_interests).toEqual([
      'Causal Inference and Survey Methods',
    ]);
    expect(profile.topics).toEqual([
      'Longitudinal Data Analysis',
      'Community Intervention Design',
    ]);
  });

  it('filters publication identifier and citation-metric artifacts from profile research terms', () => {
    const profile = normalizeProfileForClient({
      netid: TEST_NETID,
      researchInterests: [
        'Example publication title that should be dropped with metadata present',
        'PMID: 12345678',
        'PMCID: PMC1234567',
        'DOI: 10.5555/profile-artifact-001',
        'Total citations',
        'Recent citations',
        'Field Citation Ratio',
        '1.82',
        'Relative Citation Ratio',
        'MeSH Keywords and Concepts',
        'Age Distribution',
      ],
      topics: [],
    });

    expect(profile.research_interests).toEqual([]);
  });

  it('strips embedded YSM publication widgets from all profile research terms', () => {
    const profile = normalizeProfileForClient({
      netid: TEST_NETID,
      researchInterests: [
        'Signal Processing11 YSM Researchers View 5 Related Publications',
        'Biointerfaces3 YSM Researchers View 5 Related Publications',
        'Network Models11 YSM Researchers View 4 Related Publications',
        'View 4 Related Publications',
        'Synthetic Delivery3 YSM Researchers View 2 Related Publications',
        'Decision Systems23 YSM Researchers View 2 Related Publications',
        '1',
      ],
      topics: ['View 2 Related Publications', 'Network Models', '2', 'Publications', '4,310', 'Citations'],
    });

    expect(profile.research_interests).toEqual([
      'Signal Processing',
      'Biointerfaces',
      'Network Models',
      'Synthetic Delivery',
      'Decision Systems',
    ]);
    expect(profile.topics).toEqual(['Network Models']);
  });

  it('does not expose a research-area prose blurb as a compact phrase term', () => {
    const profile = normalizeProfileForClient({
      netid: TEST_NETID,
      researchInterests: [
        'Research Areas: Our work is interdisciplinary and combines elements of biogeography community ecology landscape ecology macroecology global change ecology evolution comparative biology biodiversity informatics and conservation. We use mostly terrestrial vertebrates and plants as study systems.',
        'Community ecology',
      ],
      topics: [],
    });

    expect(profile.research_interests).toEqual(['Community ecology']);
  });

  it('derives compact phrase terms from explicit prose research-interest evidence before using a summary', () => {
    const profile = normalizeProfileForClient({
      netid: TEST_NETID,
      bio: 'My research interests include the functional morphology and systematics of mammals. I have studied the evolutionary morphology of several groups of extant and extinct mammals.',
      researchInterests: [
        'Research Areas: My research interests include the functional morphology and phylogenetics of mammals. I have studied the evolutionary morphology of several groups of extant and extinct mammals',
        'such as primates and treeshrews (Scandentia). My previous research has focused on the functional postcranial morphology of treeshrews (Scandentia) and their supraordinal relationships to primates and other euarchontan mammals.',
      ],
      topics: [],
    });

    expect(profile.research_interests).toEqual([
      'functional morphology',
      'phylogenetics of mammals',
    ]);
    expect(profile.research_interest_summary).toBe('');
  });

  it('keeps compact research phrases from physics profiles while dropping teaching/course fragments', () => {
    const profile = normalizeProfileForClient({
      netid: TEST_NETID,
      researchInterests: [
        'AMO prototype sensor array',
        'Electric dipole moment',
        'Casimir effect',
        'Research Areas: AMO',
        'Teaching Interests: My main teaching interests lie in Experimental Physics',
        'particularly The Advanced Physics Laboratory (PHYS 382) and development of new instructional laboratories that address problems of modern interest and new instrumentation',
        'Quantum Mechanics (PHYS 441)',
        'Physics of the Earth and Environment (PHYS 342) which has been offered in alternate years between G\\&G and Physics',
        'I created my own unique curriculum.',
      ],
      topics: [
        'Atomic and Subatomic Physics Research',
        'Quantum Mechanics and Applications',
        'Teaching Interests: My main teaching interests lie in Experimental Physics',
        'Quantum Mechanics (PHYS 441)',
      ],
    });

    expect(profile.research_interests).toEqual([
      'AMO prototype sensor array',
      'Electric dipole moment',
      'Casimir effect',
      'AMO',
    ]);
    expect(profile.topics).toEqual([
      'Atomic and Subatomic Physics Research',
      'Quantum Mechanics and Applications',
    ]);
  });

  it('keeps phrase terms when a research-area bio has already been split into chips', () => {
    const profile = normalizeProfileForClient({
      netid: TEST_NETID,
      researchInterests: [
        'Research Areas: Our work is interdisciplinary and combines elements of biogeography',
        'community ecology',
        'landscape ecology',
        'macroecology',
        'global change ecology',
        'evolution',
        'comparative biology',
        'biodiversity informatics and conservation. We use mostly terrestrial vertebrates and plants as study systems. In its sum',
        'our research attempts to integrate across scales of geography and ecological organization - from global to local assemblages.',
      ],
      topics: [],
    });

    expect(profile.research_interests).toEqual([
      'biogeography',
      'community ecology',
      'landscape ecology',
      'macroecology',
      'global change ecology',
      'evolution',
      'comparative biology',
      'biodiversity informatics and conservation',
    ]);
  });

  it('removes pasted managerial-summary article lists from public profile bios', () => {
    const profile = normalizeProfileForClient({
      netid: TEST_NETID,
      bio: [
        'The profile owner studies how consumers think and decide.',
        '',
        'The profile owner has published more than 70 articles and serves on leading marketing journals.',
        '',
        '"Example Article About Risk Decisions" (with T. Example), February 23. 2022',
        '',
        '"Example Article About Consumer Pricing" (with U. Example), Example Review, March 30, 2011',
      ].join('\n'),
    });

    expect(profile.bio).toContain('studies how consumers think and decide');
    expect(profile.bio).toContain('published more than 70 articles');
    expect(profile.bio).not.toContain('Example Article About Risk Decisions');
    expect(profile.bio).not.toContain('Example Article About Consumer Pricing');
  });

  it('removes official-profile link chrome and pasted address blocks from public bios', () => {
    const profile = normalizeProfileForClient({
      netid: TEST_NETID,
      bio: [
        'Example profile website(Link is external) (Link opens in new window)',
        '',
        'Example TowerRoom 1013219 Example StreetNew Haven, CT 06511',
      ].join('\n'),
    });

    expect(profile.bio).toBe('');
  });

  it('removes publication links and news headlines from public profile bios', () => {
    const profile = normalizeProfileForClient({
      netid: TEST_NETID,
      bio: [
        'My research spans various problems at the intersection of Machine Learning and NLP, including language modeling, representation learning, retrieval, and applications in specialized domains.',
        '',
        'For a full list of publications please see my Google Scholar page.',
        '',
        'Example research news headline unrelated to profile biography',
        '',
        'Example fund supports inventions in technology and healthcare',
      ].join('\n'),
    });

    expect(profile.bio).toBe(
      'My research spans various problems at the intersection of Machine Learning and NLP, including language modeling, representation learning, retrieval, and applications in specialized domains.',
    );
  });

  it('does not expose lab descriptions copied into professor profile bios', () => {
    const copiedLabDescription =
      'My lab focuses on intergroup social cognition. My lab addresses this question by studying how knowledge of social groups is acquired.';

    const profile = normalizeProfileForClient(
      {
        netid: TEST_NETID,
        title: 'Professor of Psychology',
        bio: copiedLabDescription,
      },
      {
        copiedResearchDescriptions: [copiedLabDescription],
      },
    );

    expect(profile.bio).toBe('');
    expect(profile.title).toBe('Professor of Psychology');
  });

  it('hides weak project-fragment bios without substituting lab descriptions', () => {
    const profile = normalizeProfileForClient(
      {
        netid: TEST_NETID,
        bio: 'Prototype instrumentation to measure long-range signals - Example Array Project, Example Real-time Analysis Project',
      },
      {
        copiedResearchDescriptions: [
          'The example lab builds instruments to chart long-range environmental signals using field sensors and computational analysis.',
        ],
      },
    );

    expect(profile.bio).toBe('');
    expect(profile).not.toHaveProperty('researchSummaryFallback');
  });

  it('removes copied headings from public profile bios', () => {
    const profile = normalizeProfileForClient({
      netid: TEST_NETID,
      bio: [
        'Biography',
        'Our lab studies organelle structure and dynamics. We use imaging and genetic tools in C. elegans.',
      ].join('\n'),
    });

    expect(profile.bio).toBe(
      'Our lab studies organelle structure and dynamics. We use imaging and genetic tools in C. elegans.',
    );
  });

  it('removes copied title-only lead paragraphs from public profile bios', () => {
    const profile = normalizeProfileForClient({
      netid: TEST_NETID,
      bio: [
        'Lecturer in the Practice of Management',
        '',
        'Alex Fixture studies organizational learning and practical leadership in complex institutions.',
      ].join('\n'),
    });

    expect(profile.bio).toBe(
      'Alex Fixture studies organizational learning and practical leadership in complex institutions.',
    );
  });

  it('adds missing spaces between copied bio sentences', () => {
    const profile = normalizeProfileForClient({
      netid: TEST_NETID,
      bio: 'I collaborate with investigators on autism research.Here are some papers from the group.',
    });

    expect(profile.bio).toBe(
      'I collaborate with investigators on autism research. Here are some papers from the group.',
    );
  });

  it('normalizes spaced degree abbreviations in public profile bios', () => {
    expect(
      sanitizeProfileBio(
        'Dr. Fixture received a Ph. d. in Chemistry, an M. Phil. , an M. Sc. in Physics, and a B. A. in Biology before joining Yale. My research interests include biological systems and molecular methods.',
      ),
    ).toBe(
      'Dr. Fixture received a Ph.D. in Chemistry, an M.Phil., an M.Sc. in Physics, and a B.A. in Biology before joining Yale. My research interests include biological systems and molecular methods.',
    );
  });

  it('recovers full Yale address text pasted into malformed directory bios', () => {
    const profile = normalizeProfileForClient({
      netid: TEST_NETID,
      physicalLocation: 'Example Tower > 1013',
      bio: [
        'Example profile website(Link is external) (Link opens in new window)',
        '',
        'Example TowerRoom 1013219 Example StreetNew Haven, CT 06511',
      ].join('\n'),
    });

    expect(profile.physical_location).toBe(
      'Example Tower Room 1013, 219 Example Street, New Haven, CT 06511',
    );
  });

  it('normalizes Yale Directory street-first physical locations while preserving the room segment', () => {
    const profile = normalizeProfileForClient({
      netid: TEST_NETID,
      physicalLocation: 'Example St, 100 > 1462',
    });

    expect(profile.physical_location).toBe('100 Example St. Room 1462');
  });
});

describe('normalizeProfileUpdateForStorage', () => {
  it('maps profile UI field names to scraper/materializer-backed User fields', () => {
    const update = normalizeProfileUpdateForStorage({
      primary_department: 'Applied Mathematics',
      secondary_departments: ['Computer Science'],
      research_interests: ['optimization'],
      profile_urls: { directory: TEST_PROFILE_URL },
      image_url: TEST_IMAGE_URL,
      h_index: 14,
      openalex_id: 'https://openalex.org/A1',
    });

    expect(update.primaryDepartment).toBe('Applied Mathematics');
    expect(update.secondaryDepartments).toEqual(['Computer Science']);
    expect(update.researchInterests).toEqual(['optimization']);
    expect(update.profileUrls).toEqual({ directory: TEST_PROFILE_URL });
    expect(update.imageUrl).toBe(TEST_IMAGE_URL);
    expect(update.hIndex).toBe(14);
    expect(update.openAlexId).toBe('https://openalex.org/A1');
  });
});

describe('adminUpdateProfile', () => {
  it('does not allow profile edits to grant admin authority', async () => {
    const lean = vi.fn().mockResolvedValue({
      netid: 'fixture-profile',
      fname: 'Fixture',
      lname: 'Profile',
      email: 'fixture-profile@example.invalid',
      userType: 'faculty',
    });
    const select = vi.fn().mockReturnValue({ lean });
    const findOneAndUpdate = vi.spyOn(User, 'findOneAndUpdate').mockReturnValue({ select } as any);

    await adminUpdateProfile('fixture-profile', {
      userType: 'admin',
      userConfirmed: true,
    });

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { netid: 'fixture-profile' },
      { userConfirmed: true },
      { new: true, runValidators: true },
    );
  });
});
