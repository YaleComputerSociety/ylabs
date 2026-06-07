import { afterEach, describe, expect, it, vi } from 'vitest';

const userModelMock = vi.hoisted(() => ({
  findOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
}));

vi.mock('../../models/user', () => ({
  User: userModelMock,
}));

import {
  buildProfileResearchMembershipFilter,
  cleanPublicProfileBio,
  dedupeProfileResearchEntities,
  isLikelySameNameContaminatedProfile,
  isPublicResearchPaperLink,
  normalizePublicProfile,
  orderProfileScholarlyLinks,
  paperToScholarlyLink,
  scholarlyLinkToPublicLink,
  updateOwnProfile,
} from '../profileService';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('profileService profile shaping', () => {
  it('maps canonical user fields to the snake_case profile fields consumed by the client', () => {
    const profile = normalizePublicProfile({
      _id: 'user-1',
      netid: 'abc123',
      fname: 'Ada',
      lname: 'Lovelace',
      imageUrl: 'https://cs.yale.edu/sites/default/files/styles/people_thumbnail/public/pictures/ada.jpg',
      primaryDepartment: 'Computer Science',
      secondaryDepartments: ['Statistics and Data Science'],
      physicalLocation: '17 Hillhouse',
      buildingDesk: '17 Hillhouse, room 101',
      researchInterests: ['computing history'],
      profileUrls: {
        yale: 'https://cs.yale.edu/people/ada-lovelace',
        orcid: 'https://orcid.org/0000-0000-0000-0000',
      },
      hIndex: 42,
      openAlexId: 'https://openalex.org/A123',
    });

    expect(profile.image_url).toBe(
      'https://cs.yale.edu/sites/default/files/styles/people_thumbnail/public/pictures/ada.jpg',
    );
    expect(profile.primary_department).toBe('Computer Science');
    expect(profile.secondary_departments).toEqual(['Statistics and Data Science']);
    expect(profile.physical_location).toBe('17 Hillhouse');
    expect(profile.building_desk).toBe('17 Hillhouse, room 101');
    expect(profile.research_interests).toEqual(['computing history']);
    expect(profile.profile_urls).toEqual({
      yale: 'https://cs.yale.edu/people/ada-lovelace',
      orcid: 'https://orcid.org/0000-0000-0000-0000',
    });
    expect(profile.h_index).toBe(42);
    expect(profile.openalex_id).toBe('https://openalex.org/A123');
  });

  it('does not expose internal user maintenance fields on public profiles', () => {
    const profile = normalizePublicProfile({
      _id: 'user-1',
      netid: 'abc123',
      fname: 'Ada',
      lname: 'Lovelace',
      email: 'ada.lovelace@yale.edu',
      userType: 'professor',
      userConfirmed: true,
      profileVerified: true,
      bio: 'Studies computing history and mathematical approaches to machine reasoning.',
      researchInterests: ['computing history'],
      topics: ['mathematics'],
      orcid: '0000-0000-0000-0000',
      googleScholarId: 'private-scholar-id',
      semanticScholarId: 'private-semantic-id',
      confidenceByField: { email: 0.99 },
      manuallyLockedFields: ['email'],
      savedPathwayPlans: {
        '64a000000000000000000001': { note: 'private advising note' },
      },
      publications: [{ title: 'raw embedded private publication' }],
      lastLoginAt: new Date('2026-01-01T00:00:00.000Z'),
      lastActive: new Date('2026-01-02T00:00:00.000Z'),
      archived: false,
      dedupedIntoUserId: '64a000000000000000000099',
      dedupeReason: 'duplicate',
    });

    expect(profile).toMatchObject({
      _id: 'user-1',
      netid: 'abc123',
      fname: 'Ada',
      lname: 'Lovelace',
      email: 'ada.lovelace@yale.edu',
      userType: 'professor',
      userConfirmed: true,
      profileVerified: true,
      orcid: '0000-0000-0000-0000',
    });
    expect(profile).not.toHaveProperty('googleScholarId');
    expect(profile).not.toHaveProperty('semanticScholarId');
    expect(profile).not.toHaveProperty('confidenceByField');
    expect(profile).not.toHaveProperty('manuallyLockedFields');
    expect(profile).not.toHaveProperty('savedPathwayPlans');
    expect(profile).not.toHaveProperty('publications');
    expect(profile).not.toHaveProperty('lastLoginAt');
    expect(profile).not.toHaveProperty('lastActive');
    expect(profile).not.toHaveProperty('archived');
    expect(profile).not.toHaveProperty('dedupedIntoUserId');
    expect(profile).not.toHaveProperty('dedupeReason');
  });

  it('does not expose metric badge URLs as profile photos', () => {
    const profile = normalizePublicProfile({
      _id: 'user-1',
      netid: 'abc123',
      fname: 'Ada',
      lname: 'Lovelace',
      imageUrl: 'https://badge.dimensions.ai/badge?count=1',
    });

    expect(profile.image_url).toBe('');
    expect(profile.imageUrl).toBe('');
  });

  it('keeps same-person profile URLs when the URL omits a middle name', () => {
    const rawProfile = {
      netid: 'fga7',
      fname: 'Fadi Gabriel',
      lname: 'Akar',
      bio:
        'Dr. Akar studies mechanisms that promote arrhythmias and develops translational cardiovascular imaging approaches.',
      profileUrls: {
        medicine: 'https://medicine.yale.edu/profile/fadi-akar/',
      },
      researchInterests: ['Cardiovascular electrophysiology'],
    };

    expect(isLikelySameNameContaminatedProfile(rawProfile)).toBe(false);

    const profile = normalizePublicProfile(rawProfile);
    expect(profile.bio).toContain('studies mechanisms that promote arrhythmias');
    expect(profile.profile_urls).toEqual({
      medicine: 'https://medicine.yale.edu/profile/fadi-akar/',
    });
  });

  it('omits unsafe profile URL schemes from public profiles', () => {
    const profile = normalizePublicProfile({
      netid: 'ada123',
      fname: 'Ada',
      lname: 'Lovelace',
      bio: 'Ada Lovelace studies computing history.',
      profileUrls: {
        yale: 'https://cs.yale.edu/people/ada-lovelace',
        personal: 'javascript:alert(document.cookie)',
        orcid: 'mailto:ada@yale.edu',
      },
    });

    expect(profile.profile_urls).toEqual({
      yale: 'https://cs.yale.edu/people/ada-lovelace',
    });
  });

  it('does not expose unsafe raw profile website or camel-case profile URL payloads', () => {
    const unsafeProfile = normalizePublicProfile({
      netid: 'ada123',
      fname: 'Ada',
      lname: 'Lovelace',
      bio: 'Ada Lovelace studies computing history.',
      website: 'javascript:alert(document.cookie)',
      profileUrls: {
        yale: 'https://cs.yale.edu/people/ada-lovelace',
        personal: 'javascript:alert(document.cookie)',
      },
    });
    const safeProfile = normalizePublicProfile({
      netid: 'ada123',
      fname: 'Ada',
      lname: 'Lovelace',
      bio: 'Ada Lovelace studies computing history.',
      website: 'https://ada-lovelace.example.test/',
    });

    expect(unsafeProfile.website).toBeUndefined();
    expect(unsafeProfile.profile_urls).toEqual({
      yale: 'https://cs.yale.edu/people/ada-lovelace',
    });
    expect(unsafeProfile).not.toHaveProperty('profileUrls');
    expect(safeProfile.website).toBe('https://ada-lovelace.example.test/');
  });

  it('sanitizes linked research-home payloads before exposing them on public profiles', () => {
    const profile = normalizePublicProfile(
      {
        netid: 'ada123',
        fname: 'Ada',
        lname: 'Lovelace',
        bio: 'Ada Lovelace studies computing history.',
      },
      {
        researchEntities: [
          {
            _id: 'entity-1',
            slug: 'ada-lab',
            name: 'Ada Lab',
            displayName: 'Ada Lab',
            kind: 'lab',
            entityType: 'LAB',
            shortDescription: 'Studies computing history. Questions: hidden@example.edu',
            description: 'Call 203-432-1234 before applying.',
            websiteUrl: 'javascript:alert(document.cookie)',
            website: 'https://ada-lab.example.test',
            sourceUrls: [
              'mailto:hidden@example.edu',
              'data:text/html,<script>alert(1)</script>',
              'https://source.example.test/profile',
            ],
            departments: ['Computer Science'],
            researchAreas: ['Computing History'],
          },
        ],
      },
    );

    expect(profile.researchEntities[0]).toMatchObject({
      website: 'https://ada-lab.example.test/',
      sourceUrls: ['https://source.example.test/profile'],
      shortDescription: 'Studies computing history. Questions: [email redacted]',
      description: 'Call [phone redacted] before applying.',
    });
    expect(profile.researchEntities[0]).not.toHaveProperty('websiteUrl');
    expect(JSON.stringify(profile.researchEntities)).not.toContain('hidden@example.edu');
    expect(JSON.stringify(profile.researchEntities)).not.toContain('javascript:');
    expect(JSON.stringify(profile.researchEntities)).not.toContain('data:text/html');
    expect(JSON.stringify(profile.researchEntities)).not.toContain('mailto:');
  });

  it('keeps same-person profile URLs for compact compound last-name slugs', () => {
    const rawProfile = {
      netid: 'jpd62',
      fname: 'Joao P.',
      lname: 'De Aquino',
      bio:
        'Dr. De Aquino combines behavioral pharmacology and clinical trial methods to develop novel therapeutics for pain and addiction.',
      profileUrls: {
        medicine: 'https://medicine.yale.edu/profile/joao-deaquinolima/',
      },
      researchInterests: ['Addiction medicine'],
    };

    expect(isLikelySameNameContaminatedProfile(rawProfile)).toBe(false);
    expect(normalizePublicProfile(rawProfile).bio).toContain('develop novel therapeutics');
  });

  it('keeps same-person profile URLs for standalone first-initial slugs', () => {
    const rawProfile = {
      netid: 'lc2364',
      fname: 'Lorraine',
      lname: 'Colón-Cartagena',
      bio:
        'Dr. Colón-Cartagena studies the behavior and histologic features of tumors of the breast.',
      profileUrls: {
        medicine: 'https://medicine.yale.edu/profile/l-cartagena/',
      },
      researchInterests: ['Breast pathology'],
    };

    expect(isLikelySameNameContaminatedProfile(rawProfile)).toBe(false);
    expect(normalizePublicProfile(rawProfile).profile_urls).toEqual({
      medicine: 'https://medicine.yale.edu/profile/l-cartagena/',
    });
  });

  it('treats blank-bio initial-plus-last profile URLs as ambiguous contamination', () => {
    const rawProfile = {
      netid: 'maw69',
      fname: 'Marney',
      lname: 'White',
      bio: '',
      profileUrls: {
        medicine: 'https://medicine.yale.edu/profile/m-white/',
      },
    };

    expect(isLikelySameNameContaminatedProfile(rawProfile)).toBe(true);
    expect(normalizePublicProfile(rawProfile).profile_urls).toEqual({});
  });

  it('keeps same-person profile URLs when the slug uses a common first-name prefix', () => {
    const rawProfile = {
      netid: 'jac52',
      fname: 'Jessica',
      lname: 'Cardin',
      bio:
        'The cortex is made up of interconnected networks containing many classes of neurons whose roles in normal brain activity and disease are poorly understood.',
      profileUrls: {
        medicine: 'https://medicine.yale.edu/profile/jess-cardin/',
      },
      researchInterests: ['Neuroscience'],
    };

    expect(isLikelySameNameContaminatedProfile(rawProfile)).toBe(false);
    expect(normalizePublicProfile(rawProfile).bio).toContain('interconnected networks');
  });

  it('keeps same-person profile URLs when an explicit first initial maps to a slug token', () => {
    const rawProfile = {
      netid: 'eje7',
      fname: 'E. Jennifer',
      lname: 'Edelman',
      bio:
        'E. Jennifer Edelman studies addiction medicine, HIV care, and interventions for patients with complex medical and behavioral health needs.',
      profileUrls: {
        medicine: 'https://medicine.yale.edu/profile/eva-edelman/',
      },
      researchInterests: ['Addiction medicine'],
    };

    expect(isLikelySameNameContaminatedProfile(rawProfile)).toBe(false);
    expect(normalizePublicProfile(rawProfile).profile_urls).toEqual({
      medicine: 'https://medicine.yale.edu/profile/eva-edelman/',
    });
  });

  it('keeps same-person profile URLs when the official slug uses a short given-name form', () => {
    const rawProfile = {
      netid: 'jk882',
      fname: 'Jonathan',
      lname: 'Koff',
      bio:
        'Dr. Koff received his undergraduate degree from Hamilton College and his medical degree from Case Western Reserve University.',
      profileUrls: {
        medicine: 'https://medicine.yale.edu/profile/jon-koff/',
      },
      researchInterests: ['Pulmonary medicine'],
    };

    expect(isLikelySameNameContaminatedProfile(rawProfile)).toBe(false);
    expect(normalizePublicProfile(rawProfile).profile_urls).toEqual({
      medicine: 'https://medicine.yale.edu/profile/jon-koff/',
    });
  });

  it('keeps exact-name official bio prose even when the profile URL uses a partial previous surname', () => {
    const rawProfile = {
      netid: 'sjf37',
      fname: 'Samah',
      lname: 'Fodeh-Jarad',
      displayName: 'Samah Fodeh-Jarad',
      bio:
        'Samah Fodeh-Jarad, PhD, studies biomedical informatics, clinical decision support, and equitable emergency medicine data systems.',
      profileUrls: {
        medicine: 'https://medicine.yale.edu/profile/samah-fodeh/',
      },
      researchInterests: ['Biomedical informatics'],
    };

    expect(isLikelySameNameContaminatedProfile(rawProfile)).toBe(false);
    const profile = normalizePublicProfile(rawProfile);
    expect(profile.bio).toContain('Samah Fodeh-Jarad, PhD');
    expect(profile.profile_urls).toEqual({});
  });

  it('keeps exact-name official bio prose when a middle initial appears between first and last name', () => {
    const rawProfile = {
      netid: 'lf457',
      fname: 'Francis',
      lname: 'Lee',
      bio:
        'Francis Y. Lee, MD, PhD, conducts extensive research into fracture healing and bone metastasis.',
      profileUrls: {
        medicine: 'https://medicine.yale.edu/profile/faith-lee/',
        orcid: 'https://orcid.org/0000-0003-2275-2441',
      },
      researchInterests: ['Orthopaedic research'],
    };

    expect(isLikelySameNameContaminatedProfile(rawProfile)).toBe(false);
    const profile = normalizePublicProfile(rawProfile);
    expect(profile.bio).toContain('Francis Y. Lee, MD, PhD');
    expect(profile.profile_urls).toEqual({
      orcid: 'https://orcid.org/0000-0003-2275-2441',
    });
  });

  it('keeps official bio prose when it starts with a verified given-name variant and last name', () => {
    const rawProfile = {
      netid: 'eze3',
      fname: 'Zeynep Erson',
      lname: 'Omay',
      displayName: 'Zeynep Erson Omay',
      bio:
        'Dr. Erson Omay is an Assistant Professor of Neurosurgery and Biomedical Informatics and Data Science. Her research uses computational genomics to understand brain tumors.',
      profileUrls: {
        medicine: 'https://medicine.yale.edu/profile/zeynep-erson/',
      },
      researchInterests: ['Genomics'],
    };

    expect(isLikelySameNameContaminatedProfile(rawProfile)).toBe(false);
    const profile = normalizePublicProfile(rawProfile);
    expect(profile.bio).toContain('Dr. Erson Omay is an Assistant Professor');
    expect(profile.profile_urls).toEqual({});
  });

  it('does not let a shared last name rescue a different multi-token first name', () => {
    const rawProfile = {
      netid: 'fixture',
      fname: 'Mary Jane',
      lname: 'Taylor',
      bio:
        'Dr. Sarah Taylor studies music history and performance practice at another Yale department.',
      profileUrls: {
        music: 'https://music.yale.edu/people/sarah-taylor',
      },
      researchInterests: ['Music'],
    };

    expect(isLikelySameNameContaminatedProfile(rawProfile)).toBe(true);
    expect(normalizePublicProfile(rawProfile).bio).toBe('');
  });

  it('does not treat same-initial different first-name URLs as same-person profiles', () => {
    const rawProfile = {
      netid: 'nb123',
      fname: 'Nancy',
      lname: 'Brown',
      bio: 'Nicholas Brown studies Roman social and economic history.',
      profileUrls: {
        medicine: 'https://medicine.yale.edu/profile/nicholas-brown/',
      },
      researchInterests: ['History'],
    };

    expect(isLikelySameNameContaminatedProfile(rawProfile)).toBe(true);
    expect(normalizePublicProfile(rawProfile).bio).toBe('');
  });

  it('does not treat same-prefix different first-name URLs as same-person profiles', () => {
    const rawProfile = {
      netid: 'ta363',
      fname: 'Thomas',
      lname: 'Adams',
      bio: 'Taylor Adams studies surgical outcomes and clinical decision making.',
      profileUrls: {
        medicine: 'https://medicine.yale.edu/profile/taylor-adams/',
      },
      researchInterests: ['Surgery'],
    };

    expect(isLikelySameNameContaminatedProfile(rawProfile)).toBe(true);
    expect(normalizePublicProfile(rawProfile).bio).toBe('');
  });

  it('does not let exact-name fallback rescue wrong-person bio prose', () => {
    const rawProfile = {
      netid: 'snt26',
      fname: 'Sarah',
      lname: 'Taylor',
      bio:
        'Stephen Taylor, an accomplished solo, chamber, and orchestral musician, is one of the most sought-after oboists in the country.',
      profileUrls: {
        music: 'https://music.yale.edu/people/stephen-taylor',
      },
      researchInterests: ['Music'],
    };

    expect(isLikelySameNameContaminatedProfile(rawProfile)).toBe(true);
    expect(normalizePublicProfile(rawProfile).bio).toBe('');
  });

  it('removes generic bio labels from public profile bios', () => {
    const rawProfile = {
      netid: 'bfg2',
      fname: 'Beverly',
      lname: 'Gage',
      bio:
        'Bio: Beverly Gage is the John Lewis Gaddis Professor of History. Her courses focus on twentieth-century United States history and political culture.',
      profileUrls: {
        departmental: 'https://history.yale.edu/people/beverly-gage/',
      },
      researchInterests: ['United States history'],
    };

    expect(normalizePublicProfile(rawProfile).bio).toBe(
      'Beverly Gage is the John Lewis Gaddis Professor of History. Her courses focus on twentieth-century United States history and political culture.',
    );
  });

  it('suppresses address and profile chrome stored as public bios', () => {
    const badBios = [
      'Kline TowerRoom 1213219 Prospect StreetNew Haven, CT 06511',
      'See my webpage for selected publications.',
      'Medical Research InterestsMammography; Radiology',
      'Department of Astronomy',
      'Bhattacharjee awarded Dylan Hixon 88 Prize for teaching excellence',
      'Associate Research Scientist in Psychiatry',
      'Assistant Professor of Radiology and Biomedical Imaging',
      'Central Campus Office: 17 Hillhouse Ave., Room 323 Medical School Office: 100 College St., Room 1127',
      'For an up-to-date list of publications, please click here',
      'Courses Undergraduate: Reading and Writing Argument, Reading and Writing the Modern Essay.',
      'Yale Engineering advances AI innovation with seed funding for high-impact research and workshops',
      '300 Cedar Street, Wing North Wing, Fl First floor, Rm N140',
      'Program for Obesity Weight and Eating Research (POWER), Psychiatry',
      'Undergraduate: Reading and Writing Argument, Reading and Writing the Modern Essay.',
      'West Campus Integrative Science & Technology Center',
      'A hub for international and industry partnerships, KCITY takes on global challenges',
      'Particles don’t always go with the flow (and why that matters)',
      'Average citations/paper 4/4/16 web of science = 41.5',
      'Ph.D., English, University of VirginiaM.A., English, McGill UniversityB.A., English, University of California at Los Angeles',
      'Ph.D. Environmental Engineering, Johns Hopkins University',
      'M.Sc. Philosophy of Epistemology, Ethics, and Mind, University of Edinburgh',
      'Yingzheng Fan, Yu Yan, Obinna Nwokonkwo, John Kim, Margaret Liu, Leo Chen, Lea R. Winter*. "Tuning membranes for selective separations." Nature Materials 2024.',
      'Julia Simon, Lea R. Winter*. "Plasma-activated co-conversion of N2 and C1 gases towards value-added products." Current Opinion in Green & Sustainable Chemistry 51: 100985 (2025).',
      "View this doctor's clinical profile on the Yale Medicine website for information about the services we offer and making an appointment.",
      'Associate Professor of Public Health (Health Policy); Associate Professor in the History of Medicine, and Associate Professor in the Institution for Social and Policy Studies',
      'Senior Associate Dean of Research and Director of Doctoral Studies; Mary E. Pinchot Professor of Environmental Health',
      'NIH P01 DK57751 (PI: M.H. Nathanson) 04/01/01-04/30/21 Title: Regulation of liver by nuclear calcium signaling Goals: The major goals of this project are to determine the mechanisms by which calcium is regulated in the nucleus of hepatocytes.',
    ];

    for (const bio of badBios) {
      expect(cleanPublicProfileBio({ bio })).toBe('');
      expect(
        normalizePublicProfile({
          netid: 'example',
          fname: 'Example',
          lname: 'Professor',
          bio,
        }).bio,
      ).toBe('');
    }
  });

  it('strips contact chrome from otherwise useful public bios', () => {
    const inlineContactBio =
      'Xiaofeng joined Yale in 03/2024 as an Assistant Professor (forward related email to: liuxiaof@broadinstitute.org). His research interests are centered around medical imaging, machine learning, and cancer detection.';
    expect(cleanPublicProfileBio({ bio: inlineContactBio })).toBe(
      'Xiaofeng joined Yale in 03/2024 as an Assistant Professor. His research interests are centered around medical imaging, machine learning, and cancer detection.',
    );

    const leadingContactBio =
      'Sabrina Diano, Ph.D. Professor Email: sabrina.diano@yale.eduPhone: 737-1216 Dr. Sabrina Diano is a Tenure Professor in the Department of Cellular and Molecular Physiology. Her research focuses on mitochondria-endoplasmic reticulum interactions and metabolic regulation in the central nervous system.';
    expect(cleanPublicProfileBio({ bio: leadingContactBio })).toBe(
      'Dr. Sabrina Diano is a Tenure Professor in the Department of Cellular and Molecular Physiology. Her research focuses on mitochondria-endoplasmic reticulum interactions and metabolic regulation in the central nervous system.',
    );
  });

  it('keeps narrative public bios that mention education credentials', () => {
    const bio =
      'Example Professor received a B.A. from Yale University and a Ph.D. from Stanford University before joining the Yale faculty. She is the author of several books on modern literature, public culture, and the history of higher education.';

    expect(cleanPublicProfileBio({ bio })).toBe(bio);
    expect(
      normalizePublicProfile({
        netid: 'example',
        fname: 'Example',
        lname: 'Professor',
        bio,
      }).bio,
    ).toBe(bio);
  });

  it('keeps narrative public bios with commas and quoted phrases', () => {
    const bio =
      'Example Professor is a historian of science, medicine, and public culture. Her book, "The Public Laboratory," follows debates among scientists, teachers, museum curators, and policy makers across the twentieth century.';

    expect(cleanPublicProfileBio({ bio })).toBe(bio);
    expect(
      normalizePublicProfile({
        netid: 'example',
        fname: 'Example',
        lname: 'Professor',
        bio,
      }).bio,
    ).toBe(bio);
  });

  it('removes trailing official profile update metadata from public bios', () => {
    const profile = normalizePublicProfile({
      netid: 'example',
      fname: 'Example',
      lname: 'Professor',
      bio:
        'Example Professor studies pancreatic cancer risk prediction and develops clinical screening methods for early detection. Last Updated on December 01, 2024.',
    });

    expect(profile.bio).toBe(
      'Example Professor studies pancreatic cancer risk prediction and develops clinical screening methods for early detection.',
    );
  });

  it('strips official profile CTA and glued update chrome from narrative bios', () => {
    expect(
      cleanPublicProfileBio({
        bio:
          'Nicholas Blondin treats benign and malignant brain tumors. Watch a video with Dr. Nicholas Blondin>> Dr. Blondin’s clinical expertise is in treating brain and spine metastasis.',
      }),
    ).toBe(
      'Nicholas Blondin treats benign and malignant brain tumors. Dr. Blondin’s clinical expertise is in treating brain and spine metastasis.',
    );

    expect(
      cleanPublicProfileBio({
        bio:
          'Pamela Kunz is an international leader in clinical research for patients with GI malignancies. Learn more about Dr. Kunz >>',
      }),
    ).toBe(
      'Pamela Kunz is an international leader in clinical research for patients with GI malignancies.',
    );

    expect(
      cleanPublicProfileBio({
        bio:
          'Stuart Seropian studies methods to improve transplantation outcomes through novel anti-cancer agents and methods of treating graft versus host diseaseLast Updated on December 01, 2024.',
      }),
    ).toBe(
      'Stuart Seropian studies methods to improve transplantation outcomes through novel anti-cancer agents and methods of treating graft versus host disease.',
    );
  });

  it('expands stored official research-area blocks into readable public bios', () => {
    const rawProfile = {
      fname: 'Sam',
      lname: 'Raskin',
      bio:
        'Research Areas\n\nAlgebra\nLanglands duality\nGeometric representation theory\nAlgebraic geometry\nHomotopy theory',
      profileUrls: {
        official: 'https://math.yale.edu/profile/sam-raskin/',
      },
    };

    const bio = cleanPublicProfileBio(rawProfile);

    expect(bio.length).toBeGreaterThanOrEqual(120);
    expect(bio).toContain("Sam Raskin's official Yale profile lists research areas");
    expect(bio).toContain('Langlands duality');
    expect(bio).not.toMatch(/^Research Areas\b/);
  });

  it('uses official profile research-interest terms when the stored bio is appointment-only', () => {
    const profile = normalizePublicProfile({
      netid: 'kag67',
      fname: 'Kathleen',
      lname: 'Garrison',
      bio: 'Associate Professor of Psychiatry',
      profileUrls: {
        medicine: 'https://medicine.yale.edu/profile/kathleen-garrison/',
      },
      researchInterests: ['Smoking Cessation', 'Smoking', 'Stroke'],
    });

    expect(profile.bio).toBe(
      "Kathleen Garrison's official Yale profile lists research interests in Smoking Cessation, Smoking, and Stroke, based on Yale's official profile data.",
    );
  });

  it('uses official research-interest terms from same-person Yale people pages', () => {
    const profile = normalizePublicProfile({
      netid: 'asa1',
      fname: 'Alicia',
      lname: 'Schmidt Camacho',
      bio: '',
      profileUrls: {
        departmental: 'https://erm.yale.edu/people/alicia-schmidt-camacho',
      },
      researchInterests: ['Migration', 'Borderlands', 'Latinx literature'],
    });

    expect(profile.bio).toBe(
      "Alicia Schmidt Camacho's official Yale profile lists research interests in Migration, Borderlands, and Latinx literature, based on Yale's official profile data.",
    );
  });

  it('omits short acronym-only profile terms from official interest fallback bios', () => {
    const profile = normalizePublicProfile({
      netid: 'jls289',
      fname: 'Jason L.',
      lname: 'Schwartz',
      bio:
        'Associate Professor of Public Health (Health Policy); Associate Professor in the History of Medicine',
      profileUrls: {
        official: 'https://ysph.yale.edu/profile/jason-l-schwartz/',
      },
      researchInterests: [
        'Advisory Committees',
        'Centers for Disease Control and Prevention',
        'U.S.',
        'Evidence-Based Medicine',
        'Government Regulation',
      ],
    });

    expect(profile.bio).toContain('Advisory Committees');
    expect(profile.bio).toContain('Evidence-Based Medicine');
    expect(profile.bio).not.toContain('U.S.');
  });

  it('does not derive research-interest bios without an official Yale profile URL', () => {
    const profile = normalizePublicProfile({
      netid: 'fixture',
      fname: 'Fixture',
      lname: 'Professor',
      bio: '',
      profileUrls: {
        orcid: 'https://orcid.org/0000-0000-0000-0000',
      },
      researchInterests: ['Smoking Cessation', 'Smoking', 'Stroke'],
    });

    expect(profile.bio).toBe('');
  });

  it('clips long public bios at a sentence boundary', () => {
    const opening =
      'Professor Example studies microbial ecology and develops computational methods for analyzing environmental systems. ';
    const middle =
      'Her group combines field measurements, statistical models, and collaborative experiments with students and partner labs. ';
    const profile = normalizePublicProfile({
      netid: 'example',
      fname: 'Example',
      lname: 'Professor',
      bio: opening + middle.repeat(18),
    });

    expect(profile.bio.length).toBeLessThanOrEqual(1200);
    expect(profile.bio).toMatch(/[.!?]$/);
    expect(profile.bio).toContain('studies microbial ecology');
    expect(profile.bio).not.toMatch(/,\s*$/);
  });

  it('does not clip long public bios at dangling honorific abbreviations', () => {
    const profile = normalizePublicProfile({
      netid: 'example',
      fname: 'Example',
      lname: 'Professor',
      bio:
        'Example Professor studies microbial ecology and develops computational methods for environmental systems '.repeat(
          11,
        ) +
        'Dr. Example also mentors students in field-based data collection and analysis. '.repeat(5),
    });

    expect(profile.bio.length).toBeLessThanOrEqual(1200);
    expect(profile.bio).toMatch(/[.!?]$/);
    expect(profile.bio).not.toMatch(/\bDr\.$/);
  });

  it('suppresses obvious same-name contamination from another faculty member', () => {
    const rawProfile = {
      netid: 'tl324',
      fname: 'Tina',
      lname: 'Lu',
      bio: "Lu Lu's website\n\nKline Tower Room 106",
      profileUrls: {
        statistics_data_science: 'https://statistics.yale.edu/profile/lu-lu',
      },
      topics: [
        'Legume Nitrogen Fixing Symbiosis',
        'Genetic and Environmental Crop Studies',
      ],
      openAlexId: 'https://openalex.org/A5103032289',
      hIndex: 2,
      researchInterests: [],
    };

    expect(isLikelySameNameContaminatedProfile(rawProfile)).toBe(true);

    const profile = normalizePublicProfile(rawProfile, {
      scholarlyLinks: [{ title: 'Wrong paper' }],
      researchEntities: [{ name: 'Wrong lab' }],
    });
    expect(profile.bio).toBe('');
    expect(profile.profile_urls).toEqual({});
    expect(profile.topics).toEqual([]);
    expect(profile.openalex_id).toBeUndefined();
    expect(profile.h_index).toBeUndefined();
    expect(profile.scholarlyLinks).toEqual([]);
    expect(profile.researchEntities).toEqual([]);
  });

  it('keeps trusted membership-backed research homes when scraped profile prose is contaminated', () => {
    const profile = normalizePublicProfile(
      {
        netid: 'ershore',
        fname: 'David',
        lname: 'Stern',
        bio: "Different Stern's website",
        profileUrls: {
          departmental: 'https://example.yale.edu/people/different-stern',
        },
        researchInterests: [],
        topics: ['Unsafe topic'],
        openAlexId: 'https://openalex.org/unsafe',
      },
      {
        trustedResearchEntities: true,
        researchEntities: [
          {
            slug: 'ysm-stern',
            name: 'Stern Lab',
            shortDescription: 'Studies DNA damage responses and melanoma biology.',
            researchAreas: ['DNA Damage'],
          },
        ],
      },
    );

    expect(profile.bio).toBe('');
    expect(profile.profile_urls).toEqual({});
    expect(profile.researchEntities).toEqual([
      {
        slug: 'ysm-stern',
        name: 'Stern Lab',
        shortDescription: 'Studies DNA damage responses and melanoma biology.',
        researchAreas: ['DNA Damage'],
      },
    ]);
    expect(profile.research_interest_summary).toBe(
      'Studies DNA damage responses and melanoma biology.',
    );
    expect(profile.research_interests).toEqual(['DNA Damage']);
  });

  it('hides same-person faculty research-area duplicates when a concrete lab is attached', () => {
    const deduped = dedupeProfileResearchEntities(
      [
        {
          _id: 'lab-1',
          slug: 'ysm-zhang',
          name: 'Zhang Laboratory of Single-Molecule Biophysics & Biochemistry',
          kind: 'lab',
          entityType: 'LAB',
          role: 'pi',
        },
        {
          _id: 'faculty-area-1',
          slug: 'faculty-research-area-yongli-zhang',
          name: 'Yongli Zhang Research',
          kind: 'individual',
          entityType: 'FACULTY_RESEARCH_AREA',
          role: 'pi',
        },
      ],
      {
        fname: 'Yongli',
        lname: 'Zhang',
      },
    );

    expect(deduped).toEqual([
      expect.objectContaining({
        slug: 'ysm-zhang',
      }),
    ]);
  });

  it('keeps a faculty research-area profile when no concrete lab is attached', () => {
    const deduped = dedupeProfileResearchEntities(
      [
        {
          _id: 'faculty-area-1',
          slug: 'faculty-research-area-ada-lovelace',
          name: 'Ada Lovelace Research',
          kind: 'individual',
          entityType: 'FACULTY_RESEARCH_AREA',
          role: 'pi',
        },
      ],
      {
        fname: 'Ada',
        lname: 'Lovelace',
      },
    );

    expect(deduped).toEqual([
      expect.objectContaining({
        slug: 'faculty-research-area-ada-lovelace',
      }),
    ]);
  });

  it('hides stale metric topics when no research identity supports them', () => {
    const profile = normalizePublicProfile({
      netid: 'tl324',
      fname: 'Tina',
      lname: 'Lu',
      bio: 'My research and teaching focus on late imperial Chinese literature.',
      profileUrls: {
        departmental: 'https://eall.yale.edu/people/tina-lu',
      },
      topics: ['Legume Nitrogen Fixing Symbiosis'],
      hIndex: 2,
      researchInterests: [],
    });

    expect(profile.bio).toBe('My research and teaching focus on late imperial Chinese literature.');
    expect(profile.profile_urls).toEqual({
      departmental: 'https://eall.yale.edu/people/tina-lu',
    });
    expect(profile.topics).toEqual([]);
    expect(profile.h_index).toBeUndefined();
  });

  it('suppresses appointment-only biographical sketch text from public bios', () => {
    const profile = normalizePublicProfile({
      netid: 'stone',
      fname: 'A Douglas',
      lname: 'Stone',
      title:
        'Deputy Director, Yale Quantum Institute & Carl A. Morse Professor of Applied Physics and Physics',
      bio:
        'Biographical Sketch: Responsibilities: Deputy Director, Yale Quantum Institute Carl A. Morse Professor of Applied Physics and Professor of Physics',
      profileUrls: {
        departmental: 'https://physics.yale.edu/people/douglas-stone',
      },
      researchInterests: ['Quantum Physics'],
    });

    expect(profile.bio).toBe('');
  });

  it('keeps real research prose after a biographical sketch prefix', () => {
    const profile = normalizePublicProfile({
      netid: 'fixture',
      fname: 'Fixture',
      lname: 'Faculty',
      bio:
        'Biographical Sketch: Studies quantum transport, mesoscopic electron physics, and wave chaos.',
      researchInterests: ['Quantum Physics'],
    });

    expect(profile.bio).toBe(
      'Studies quantum transport, mesoscopic electron physics, and wave chaos.',
    );
  });

  it('uses visible linked research homes to fill an otherwise empty research tab', () => {
    const profile = normalizePublicProfile(
      {
        netid: 'abraham.silberschatz',
        fname: 'Abraham',
        lname: 'Silberschatz',
        bio: '',
        researchInterests: [],
        topics: [],
      },
      {
        researchEntities: [
          {
            name: 'Abraham Silberschatz Faculty Research',
            shortDescription:
              'Studies database systems, operating systems, storage systems, and distributed systems.',
            researchAreas: ['Database Systems', 'Operating Systems'],
          },
        ],
      },
    );

    expect(profile.bio).toBe('');
    expect(profile.research_interest_summary).toBe(
      'Studies database systems, operating systems, storage systems, and distributed systems.',
    );
    expect(profile.research_interests).toEqual(['Database Systems', 'Operating Systems']);
    expect(profile.topics).toEqual([]);
  });

  it('uses trusted source-backed lead research homes as a concise fallback bio', () => {
    const profile = normalizePublicProfile(
      {
        netid: 'saitken',
        fname: 'Sarah',
        lname: 'Aitken',
        bio: '',
        researchInterests: [],
        topics: [],
      },
      {
        trustedResearchEntities: true,
        researchEntities: [
          {
            name: 'Aitken Lab',
            kind: 'lab',
            entityType: 'LAB',
            role: 'pi',
            websiteUrl: 'https://medicine.yale.edu/lab/aitken/',
            shortDescription:
              'The Aitken Lab studies DNA damage mechanisms and their contributions to cancer evolution using genomic pathology, molecular biology, and image analysis.',
            researchAreas: ['DNA Damage', 'Cancer Evolution'],
          },
        ],
      },
    );

    expect(profile.bio).toContain('Sarah Aitken leads the Aitken Lab.');
    expect(profile.bio).toContain(
      'The Aitken Lab studies DNA damage mechanisms and their contributions to cancer evolution',
    );
    expect(profile.bio.length).toBeGreaterThanOrEqual(120);
  });

  it('does not use individual research areas as fallback bios', () => {
    const profile = normalizePublicProfile(
      {
        netid: 'asilber',
        fname: 'Abraham',
        lname: 'Silberschatz',
        bio: '',
        researchInterests: [],
      },
      {
        trustedResearchEntities: true,
        researchEntities: [
          {
            name: 'Abraham Silberschatz Faculty Research',
            kind: 'individual',
            entityType: 'FACULTY_RESEARCH_AREA',
            role: 'pi',
            websiteUrl: 'https://cs.yale.edu/people/abraham-silberschatz',
            shortDescription:
              'Studies database systems, operating systems, storage systems, and distributed systems for modern computing infrastructure.',
            researchAreas: ['Database Systems'],
          },
        ],
      },
    );

    expect(profile.bio).toBe('');
    expect(profile.research_interest_summary).toBe(
      'Studies database systems, operating systems, storage systems, and distributed systems for modern computing infrastructure.',
    );
  });

  it('rejects first-person research-home snippets as fallback bios', () => {
    const profile = normalizePublicProfile(
      {
        netid: 'sk754',
        fname: 'Steven',
        lname: 'Konezny',
        bio: '',
        researchInterests: [],
      },
      {
        trustedResearchEntities: true,
        researchEntities: [
          {
            name: 'Steven Konezny Lab',
            kind: 'lab',
            entityType: 'LAB',
            role: 'pi',
            websiteUrl: 'https://konezny.sites.yale.edu/',
            shortDescription:
              'Studies I have three research projects focused on fabrication, measurement, and theory, depending on student interest and experience.',
            researchAreas: ['Materials Chemistry'],
          },
        ],
      },
    );

    expect(profile.bio).toBe('');
  });

  it('accepts trusted lab summaries that describe combined methods', () => {
    const profile = normalizePublicProfile(
      {
        netid: 'rwg28',
        fname: 'Roshan',
        lname: 'Gunasekara',
        bio: '',
        researchInterests: [],
      },
      {
        trustedResearchEntities: true,
        researchEntities: [
          {
            name: 'Gunasekara Lab',
            kind: 'lab',
            entityType: 'LAB',
            role: 'pi',
            websiteUrl: 'https://medicine.yale.edu/lab/gunasekara/',
            shortDescription:
              'The Gunasekara Lab combines chemistry and neuroscience to develop small molecules for targeted therapy and imaging in neurodegenerative disease models.',
            researchAreas: ['Chemical Neuroscience'],
          },
        ],
      },
    );

    expect(profile.bio).toContain('Roshan Gunasekara leads the Gunasekara Lab.');
    expect(profile.bio).toContain('combines chemistry and neuroscience');
  });

  it('builds profile research-home membership filters across user and faculty identities', () => {
    expect(
      buildProfileResearchMembershipFilter(
        {
          _id: 'user-1',
          facultyMemberId: 'faculty-direct',
        },
        ['faculty-linked', 'faculty-direct'],
      ),
    ).toEqual({
      $or: [
        { userId: 'user-1' },
        { facultyMemberId: { $in: ['faculty-direct', 'faculty-linked'] } },
      ],
      isCurrentMember: { $ne: false },
      researchEntityId: { $exists: true, $ne: null },
    });
  });

  it('extracts compact labels from prose research interests before exposing profile chips', () => {
    const profile = normalizePublicProfile({
      netid: 'zh87',
      fname: 'Fixture',
      lname: 'Faculty',
      profileUrls: {
        yale: 'https://som.yale.edu/faculty-research/faculty-directory/fixture-faculty',
      },
      researchInterests: [
        'Studies how information design, disclosure, and governance mechanisms shape managerial incentives, firm decision-making, and capital market outcomes.',
      ],
      topics: [],
    });

    expect(profile.research_interests).toEqual([
      'information design',
      'disclosure',
      'governance mechanisms',
    ]);
  });

  it('turns identity-backed papers into inspectable profile research activity links', () => {
    const link = paperToScholarlyLink(
      {
        _id: 'paper-1',
        title: 'A real paper',
        doi: '10.1234/example',
        openAccessUrl: 'https://example.test/free',
        year: 2025,
        venue: 'Journal of Examples',
        sources: ['openalex'],
      },
      'user-1',
    );

    expect(link).toMatchObject({
      _id: 'paper-1',
      userId: 'user-1',
      title: 'A real paper',
      url: 'https://doi.org/10.1234/example',
      destinationKind: 'DOI',
      displaySource: 'DOI',
      freeFullTextUrl: 'https://example.test/free',
      freeFullTextLabel: 'Free full text',
      discoveredVia: 'OPENALEX',
      year: 2025,
      venue: 'Journal of Examples',
    });
  });

  it('prioritizes official-profile selected publications before trimming profile activity', () => {
    const links = [
      {
        _id: 'openalex-2026',
        title: 'Recent OpenAlex paper',
        url: 'https://doi.org/10.1234/recent',
        destinationKind: 'DOI',
        displaySource: 'DOI',
        discoveredVia: 'OPENALEX',
        year: 2026,
      },
      {
        _id: 'official-selected',
        title: 'A Double Auction Mechanism for Mobile Data Offloading Markets',
        url: 'https://faculty.example.test/papers/double-auction.pdf',
        sourceUrl:
          'https://engineering.yale.edu/research-and-faculty/faculty-directory/leandros-tassiulas',
        destinationKind: 'OTHER',
        displaySource: 'Official Yale profile',
        discoveredVia: 'OFFICIAL_PROFILE',
        year: 2015,
      },
    ];

    expect(orderProfileScholarlyLinks(links).map((link: any) => link._id)).toEqual([
      'official-selected',
      'openalex-2026',
    ]);
  });

  it('does not expose generated official-profile anchors as paper destinations', () => {
    const link = scholarlyLinkToPublicLink({
      _id: 'official-anchor',
      title: 'Learning and Verifying Quantified Boolean Queries by Example',
      url:
        'https://engineering.yale.edu/research-and-faculty/faculty-directory/abraham-silberschatz#publication-learning-and-verifying-quantified-boolean-queries-by-example',
      sourceUrl:
        'https://engineering.yale.edu/research-and-faculty/faculty-directory/abraham-silberschatz',
      destinationKind: 'OTHER',
      displaySource: 'Official Yale profile',
      discoveredVia: 'OFFICIAL_PROFILE',
      year: 2013,
      externalIds: {
        officialProfileSourceUrl:
          'https://engineering.yale.edu/research-and-faculty/faculty-directory/abraham-silberschatz',
      },
    });

    expect(link.url).toBe('');
    expect(isPublicResearchPaperLink(link)).toBe(false);
  });

  it('does not expose official-profile source pages as paper destinations', () => {
    const link = scholarlyLinkToPublicLink({
      _id: 'official-source-page',
      title: "Scalable Far Memory: Balancing Faults and Evictions, SOSP'25",
      url: 'https://www.cs.yale.edu/homes/abhishek/',
      sourceUrl: 'https://www.cs.yale.edu/homes/abhishek/',
      destinationKind: 'OTHER',
      displaySource: 'Official Yale profile',
      discoveredVia: 'OFFICIAL_PROFILE',
      externalIds: {
        officialProfileSourceUrl: 'https://www.cs.yale.edu/homes/abhishek/',
      },
    });

    expect(link.url).toBe('');
    expect(isPublicResearchPaperLink(link)).toBe(false);
  });

  it('turns research scholarly links into inspectable profile research activity links', () => {
    const link = scholarlyLinkToPublicLink(
      {
        _id: 'link-1',
        userId: 'user-1',
        title: 'Infinite-Horizon Ergodic Control via Kernel Mean Embeddings',
        url: 'https://arxiv.org/pdf/2604.01023',
        destinationKind: 'ARXIV',
        displaySource: 'arXiv',
        discoveredVia: 'OPENALEX',
        year: 2026,
        venue: 'ArXiv.org',
        confidence: 0.8,
        observedAt: new Date('2026-05-15T20:24:32.291Z'),
        externalIds: {
          openAlexId: 'https://openalex.org/W7149210300',
        },
      },
      { userId: 'user-1' },
    );

    expect(link).toMatchObject({
      _id: 'link-1',
      userId: 'user-1',
      title: 'Infinite-Horizon Ergodic Control via Kernel Mean Embeddings',
      url: 'https://arxiv.org/pdf/2604.01023',
      destinationKind: 'ARXIV',
      displaySource: 'arXiv',
      discoveredVia: 'OPENALEX',
      year: 2026,
      venue: 'ArXiv.org',
      confidence: 0.8,
      observedAt: '2026-05-15T20:24:32.291Z',
      externalIds: {
        openAlexId: 'https://openalex.org/W7149210300',
      },
    });
  });

  it('does not expose unsafe scholarly link URLs as public profile research activity', () => {
    const link = scholarlyLinkToPublicLink({
      _id: 'unsafe-link',
      title: 'A Paper With Unsafe Links',
      url: 'javascript:alert(document.cookie)',
      freeFullTextUrl: 'mailto:owner123@yale.edu',
      freeFullTextLabel: 'Email for paper',
      destinationKind: 'OTHER',
      displaySource: 'Official profile',
      discoveredVia: 'OFFICIAL_PROFILE',
      year: 2026,
    });

    expect(link.url).toBe('');
    expect(link.freeFullTextUrl).toBeUndefined();
    expect(link.freeFullTextLabel).toBeUndefined();
    expect(isPublicResearchPaperLink(link)).toBe(false);
  });

  it('excludes dataset repository records from public research paper activity', () => {
    const link = scholarlyLinkToPublicLink({
      _id: 'dataset-1',
      title: 'Raw Data related to Burro1 manuscript',
      url: 'https://doi.org/10.17632/8gk5ssdtvp',
      destinationKind: 'DOI',
      displaySource: 'DOI',
      discoveredVia: 'OPENALEX',
      venue: 'Mendeley Data',
      year: 2026,
      externalIds: {
        doi: '10.17632/8gk5ssdtvp',
      },
    });

    expect(isPublicResearchPaperLink(link)).toBe(false);
  });

  it('excludes supplemental figure records from public research paper activity', () => {
    const link = scholarlyLinkToPublicLink({
      _id: 'figure-1',
      title: 'Figure S1 from ASCL1 Drives Tolerance to Osimertinib in <i>EGFR</i> Mutant Lung Cancer',
      url: 'https://doi.org/10.1158/0008-5472.25785287',
      destinationKind: 'DOI',
      displaySource: 'DOI',
      discoveredVia: 'OPENALEX',
      year: 2025,
    });

    expect(link.title).toBe('Figure S1 from ASCL1 Drives Tolerance to Osimertinib in EGFR Mutant Lung Cancer');
    expect(isPublicResearchPaperLink(link)).toBe(false);
  });

  it('excludes closed OpenAlex-only records from public research paper activity', () => {
    const link = scholarlyLinkToPublicLink({
      _id: 'openalex-closed',
      title: 'Ueno Kozo and Theory and Practice / 上野耕三と「理論と実践」',
      url: 'https://openalex.org/W3110579256',
      destinationKind: 'OPENALEX',
      displaySource: 'OpenAlex record',
      discoveredVia: 'OPENALEX',
      openAccessStatus: 'closed',
      year: 2019,
      externalIds: {
        openAlexId: 'https://openalex.org/W3110579256',
      },
    });

    expect(isPublicResearchPaperLink(link)).toBe(false);
  });

  it('excludes OpenAlex record fallbacks when access status and alternate destinations are missing', () => {
    const link = scholarlyLinkToPublicLink({
      _id: 'openalex-record-only',
      title: 'OpenAlex-only fallback',
      url: 'https://openalex.org/W3110579256',
      destinationKind: 'OPENALEX',
      displaySource: 'OpenAlex record',
      discoveredVia: 'OPENALEX',
      year: 2019,
      externalIds: {
        openAlexId: 'https://openalex.org/W3110579256',
      },
    });

    expect(isPublicResearchPaperLink(link)).toBe(false);
  });

  it('keeps OpenAlex-derived records when they have an inspectable destination', () => {
    const doiLink = scholarlyLinkToPublicLink({
      _id: 'openalex-doi',
      title: 'OpenAlex-derived DOI paper',
      url: 'https://doi.org/10.1000/example',
      destinationKind: 'DOI',
      displaySource: 'DOI',
      discoveredVia: 'OPENALEX',
      year: 2025,
      externalIds: {
        doi: '10.1000/example',
        openAlexId: 'https://openalex.org/W123',
      },
    });
    const freeTextLink = scholarlyLinkToPublicLink({
      _id: 'openalex-oa',
      title: 'OpenAlex open-access paper',
      url: 'https://openalex.org/W456',
      destinationKind: 'OPENALEX',
      displaySource: 'Open access',
      discoveredVia: 'OPENALEX',
      openAccessStatus: 'green',
      freeFullTextUrl: 'https://example.test/free.pdf',
      freeFullTextLabel: 'Free PDF',
      year: 2025,
      externalIds: {
        openAlexId: 'https://openalex.org/W456',
      },
    });

    expect(isPublicResearchPaperLink(doiLink)).toBe(true);
    expect(isPublicResearchPaperLink(freeTextLink)).toBe(true);
  });

  it('keeps OpenAlex-derived open-access papers when the primary URL is viewable', () => {
    const link = paperToScholarlyLink({
      _id: 'paper-open-access',
      title: 'Open access paper without DOI',
      openAccessUrl: 'https://example.test/viewable-paper',
      openAccessStatus: 'gold',
      sources: ['openalex'],
    });

    expect(link.url).toBe('https://example.test/viewable-paper');
    expect(isPublicResearchPaperLink(link)).toBe(true);
  });
});

describe('updateOwnProfile', () => {
  it('sanitizes self-edit URL fields before persisting a faculty profile', async () => {
    userModelMock.findOneAndUpdate.mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        netid: 'prof123',
        website: 'https://faculty.example.test/',
        profileUrls: { yale: 'https://faculty.example.test/profile' },
      }),
    });

    await updateOwnProfile('prof123', {
      bio: 'I study secure systems.',
      website: 'javascript:alert(document.cookie)',
      imageUrl: 'data:text/html,<script>alert(1)</script>',
      profileUrls: {
        yale: 'https://faculty.example.test/profile',
        mail: 'mailto:prof123@yale.edu',
        script: 'javascript:alert(document.cookie)',
      },
    });

    expect(userModelMock.findOneAndUpdate).toHaveBeenCalledWith(
      { netid: 'prof123' },
      {
        bio: 'I study secure systems.',
        profileUrls: {
          yale: 'https://faculty.example.test/profile',
        },
      },
      {
        new: true,
        runValidators: true,
      },
    );
  });

  it('bounds self-editable profile payload size before persisting a faculty profile', async () => {
    userModelMock.findOne.mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        netid: 'prof123',
        primaryDepartment: 'Computer Science',
        secondaryDepartments: [],
      }),
    });
    userModelMock.findOneAndUpdate.mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        netid: 'prof123',
      }),
    });

    const profileUrls = Object.fromEntries(
      Array.from({ length: 80 }, (_, index) => [
        index % 2 === 0 ? `url${index}` : `oversized-${'x'.repeat(200)}-${index}`,
        `https://faculty.example.test/profile/${index}`,
      ]),
    );

    await updateOwnProfile('prof123', {
      bio: 'a'.repeat(6000),
      primaryDepartment: '  Computer Science  ',
      secondaryDepartments: Array.from({ length: 80 }, (_, index) => ` Department ${index} `),
      researchInterests: Array.from({ length: 80 }, (_, index) =>
        index === 0 ? 'x'.repeat(500) : ` Interest ${index} `,
      ),
      topics: Array.from({ length: 80 }, (_, index) => ` Topic ${index} `),
      profileUrls,
    });

    const persisted = userModelMock.findOneAndUpdate.mock.calls.at(-1)?.[1];
    expect(persisted.bio).toHaveLength(2000);
    expect(persisted.primaryDepartment).toBe('Computer Science');
    expect(persisted.secondaryDepartments).toHaveLength(50);
    expect(persisted.secondaryDepartments[0]).toBe('Department 0');
    expect(persisted.researchInterests).toHaveLength(50);
    expect(persisted.researchInterests[0]).toHaveLength(120);
    expect(persisted.topics).toHaveLength(50);
    expect(Object.keys(persisted.profileUrls)).toHaveLength(20);
    expect(Object.keys(persisted.profileUrls).every((key) => key.length <= 80)).toBe(true);
    expect(persisted.departments).toHaveLength(51);
  });
});
