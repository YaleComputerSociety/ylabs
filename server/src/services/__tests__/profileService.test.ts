import { afterEach, describe, expect, it, vi } from 'vitest';

const userModelMock = vi.hoisted(() => ({
  findOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
}));

vi.mock('../../models/user', () => ({
  User: userModelMock,
}));

import {
  adminUpdateProfile,
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
      email: 'ada.lovelace@yale.edu',
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
    expect(profile).not.toHaveProperty('email');
    expect(profile).not.toHaveProperty('physical_location');
    expect(profile).not.toHaveProperty('building_desk');
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
      netid: 'abc123',
      fname: 'Ada',
      lname: 'Lovelace',
      userType: 'professor',
      profileVerified: true,
      orcid: '0000-0000-0000-0000',
    });
    expect(profile).not.toHaveProperty('_id');
    expect(profile).not.toHaveProperty('email');
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
      netid: 'fixture101',
      fname: 'Avery Cardio',
      lname: 'Cardio',
      bio:
        'Dr. Cardio studies mechanisms that promote arrhythmias and develops translational cardiovascular imaging approaches.',
      profileUrls: {
        medicine: 'https://medicine.yale.edu/profile/avery-cardio/',
      },
      researchInterests: ['Cardiovascular electrophysiology'],
    };

    expect(isLikelySameNameContaminatedProfile(rawProfile)).toBe(false);

    const profile = normalizePublicProfile(rawProfile);
    expect(profile.bio).toContain('studies mechanisms that promote arrhythmias');
    expect(profile.profile_urls).toEqual({
      medicine: 'https://medicine.yale.edu/profile/avery-cardio/',
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

  it('prefers an official Yale profile as the public website when the raw website is a lab group', () => {
    const profile = normalizePublicProfile({
      netid: 'fixture102',
      fname: 'Morgan',
      lname: 'Vector',
      email: 'morgan.vector@yale.edu',
      website: 'http://volga.eng.yale.edu/',
      profileUrls: {
        departmental: 'https://physics.yale.edu/people/morgan-vector',
      },
      researchInterests: ['Condensed Matter Physics'],
    });

    expect(profile.website).toBe('https://physics.yale.edu/people/morgan-vector');
    expect(profile.profile_urls).toEqual({
      departmental: 'https://physics.yale.edu/people/morgan-vector',
    });
  });

  it('uses an official Yale profile as the public website when no raw website exists', () => {
    const profile = normalizePublicProfile({
      netid: 'fixture103',
      fname: 'Robin',
      lname: 'Mayer',
      email: 'robin.catalyst@yale.edu',
      profileUrls: {
        chemistry: 'https://chem.yale.edu/profile/robin-mayer',
        orcid: 'https://orcid.org/0000-0002-3943-5250',
      },
      researchInterests: ['Electrocatalysts for Energy Conversion'],
    });

    expect(profile.website).toBe('https://chem.yale.edu/profile/robin-mayer');
  });

  it('does not use a mismatched Yale profile URL as the public website', () => {
    const profile = normalizePublicProfile({
      netid: 'fixture105',
      fname: 'Morgan',
      lname: 'Vector',
      email: 'morgan.vector@yale.edu',
      profileUrls: {
        medicine: 'https://medicine.yale.edu/profile/riley-vector/',
      },
      researchInterests: ['Epidemiology'],
    });

    expect(profile.website).toBeUndefined();
    expect(profile.profile_urls).toEqual({});
  });

  it('accepts an opaque Yale Medicine profile URL only when it matches the user netid', () => {
    const profile = normalizePublicProfile({
      netid: 'mv123',
      fname: 'Morgan',
      lname: 'Vector',
      email: 'morgan.vector@yale.edu',
      profileUrls: {
        medicine: 'https://medicine.yale.edu/profile/MV123/',
      },
      researchInterests: ['Epidemiology'],
    });

    expect(profile.website).toBe('https://medicine.yale.edu/profile/MV123/');
  });

  it('keeps Yale profile URLs for known given-name transliteration variants', () => {
    const profile = normalizePublicProfile({
      netid: 'fixture106',
      fname: 'Yulia',
      lname: 'Vector',
      email: 'yulia.vector@yale.edu',
      profileUrls: {
        medicine: 'https://medicine.yale.edu/profile/julia-vector/',
      },
      researchInterests: ['Translational Methods'],
    });

    expect(profile.website).toBe('https://medicine.yale.edu/profile/julia-vector/');
    expect(profile.profile_urls).toEqual({
      medicine: 'https://medicine.yale.edu/profile/julia-vector/',
    });
  });

  it('keeps Yale profile URLs when an official page uses a common nickname', () => {
    const profile = normalizePublicProfile({
      netid: 'fixture108',
      fname: 'James',
      lname: 'Vector',
      email: 'james.vector@yale.edu',
      profileUrls: {
        divinity: 'https://divinity.yale.edu/profile/jim-vector',
      },
      researchInterests: ['Applied Ethics'],
    });

    expect(profile.website).toBe('https://divinity.yale.edu/profile/jim-vector');
    expect(profile.profile_urls).toEqual({
      divinity: 'https://divinity.yale.edu/profile/jim-vector',
    });
  });

  it('keeps Yale profile URLs when a formal given name maps to a common nickname', () => {
    const profile = normalizePublicProfile({
      netid: 'fixture110',
      fname: 'Kathleen',
      lname: 'Vector',
      email: 'kathy.vector@yale.edu',
      profileUrls: {
        medicine: 'https://medicine.yale.edu/profile/kathy-vector/',
      },
      researchInterests: ['Clinical Methods'],
    });

    expect(profile.website).toBe('https://medicine.yale.edu/profile/kathy-vector/');
    expect(profile.profile_urls).toEqual({
      medicine: 'https://medicine.yale.edu/profile/kathy-vector/',
    });
  });

  it('does not present first-person lab research prose as a faculty personal bio', () => {
    const profile = normalizePublicProfile(
      {
        netid: 'fixture104',
        fname: 'Casey',
        lname: 'Quantum',
        email: 'casey.quantum@yale.edu',
        website: 'https://qiugroup.yale.edu/',
        profileUrls: {
          departmental: 'https://physics.yale.edu/people/casey-quantum',
        },
        bio:
          'One of the grand challenges of materials research is the ability to engineer and tune quantum degrees of freedom. Our group uses and develops first principles quantum physics methods.',
        researchInterests: ['Condensed Matter Physics', 'Quantum Physics'],
      },
      {
        researchEntities: [
          {
            name: 'Quantum Fixture Group',
            role: 'pi',
            websiteUrl: 'https://qiugroup.yale.edu/',
            fullDescription:
              'The Quantum Fixture Group uses and develops first principles quantum physics methods to calculate many-electron interaction effects and make quantitatively accurate predictions about real materials.',
            researchAreas: ['Condensed Matter Physics', 'Quantum Physics'],
          },
        ],
        trustedResearchEntities: true,
      },
    );

    expect(profile.bio).toBe('');
    expect(profile.research_interest_summary).toBe(
      'The Quantum Fixture Group uses and develops first principles quantum physics methods to calculate many-electron interaction effects and make quantitatively accurate predictions about real materials.',
    );
  });

  it('sanitizes linked research-home payloads before exposing them on public profiles', () => {
    const unsafeId = {
      toString() {
        throw new Error('profile research entity id toString should not run');
      },
      toHexString() {
        throw new Error('profile research entity id toHexString should not run');
      },
    };

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
            _id: unsafeId,
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
            researchAreas: [
              'Computing History',
              'Quantum PhysicsTheoristExciton Transport & Diffusion',
              'usually the solid state',
            ],
          },
        ],
      },
    );

    expect(profile.researchEntities[0]).toMatchObject({
      _id: 'ada-lab',
      id: 'ada-lab',
      website: 'https://ada-lab.example.test/',
      sourceUrls: ['https://source.example.test/profile'],
      shortDescription: 'Studies computing history. Questions: [email redacted]',
      description: 'Call [phone redacted] before applying.',
      researchAreas: ['Computing History'],
    });
    expect(profile.researchEntities[0]).not.toHaveProperty('websiteUrl');
    expect(JSON.stringify(profile.researchEntities)).not.toContain('hidden@example.edu');
    expect(JSON.stringify(profile.researchEntities)).not.toContain('javascript:');
    expect(JSON.stringify(profile.researchEntities)).not.toContain('data:text/html');
    expect(JSON.stringify(profile.researchEntities)).not.toContain('mailto:');
  });

  it('suppresses weak research-home summaries from public profile cards', () => {
    const profile = normalizePublicProfile(
      {
        netid: 'mv123',
        fname: 'Morgan',
        lname: 'Vector',
        bio: '',
        researchInterestSummary:
          'Research fields include Research Areas: synthetic policy and Teaching Interests: seminars.',
      },
      {
        researchEntities: [
          {
            slug: 'morgan-vector-research',
            name: 'Morgan Vector Faculty Research',
            shortDescription:
              'Studies synthetic policy and Research Areas: synthetic policy.',
            description:
              'Morgan Vector is affiliated with the Example Center and the Program in Synthetic Studies.',
            researchAreas: ['Synthetic Policy'],
          },
        ],
      },
    );

    expect(profile.research_interest_summary).toBe('');
    expect(profile.researchEntities[0]).not.toHaveProperty('shortDescription');
    expect(profile.researchEntities[0]).not.toHaveProperty('description');
    expect(profile.researchEntities[0]).toMatchObject({
      name: 'Morgan Vector Faculty Research',
      researchAreas: ['Synthetic Policy'],
    });
  });

  it('keeps direct research-home summaries on public profile cards', () => {
    const profile = normalizePublicProfile(
      {
        netid: 'rv123',
        fname: 'Riley',
        lname: 'Vector',
        bio: '',
      },
      {
        researchEntities: [
          {
            slug: 'riley-vector-lab',
            name: 'Riley Vector Lab',
            shortDescription:
              'Studies archival evidence and computational methods for public systems.',
            description:
              'The lab develops mixed-method approaches for evaluating public systems.',
            researchAreas: ['Public Systems'],
          },
        ],
      },
    );

    expect(profile.researchEntities[0]).toMatchObject({
      shortDescription:
        'Studies archival evidence and computational methods for public systems.',
      description:
        'The lab develops mixed-method approaches for evaluating public systems.',
    });
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

  it('does not treat one-token compound last-name profile slugs as wrong-person contamination', () => {
    const rawProfile = {
      netid: 'av123',
      fname: 'Avery Middle',
      lname: 'River Stone',
      bio:
        'Avery Stone studies clinical imaging methods and develops translational models for patient care.',
      profileUrls: {
        medicine: 'https://medicine.yale.edu/profile/avery-stone/',
      },
      researchInterests: ['Clinical imaging'],
    };

    expect(isLikelySameNameContaminatedProfile(rawProfile)).toBe(false);
    expect(normalizePublicProfile(rawProfile).profile_urls).toEqual({});
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

  it('keeps last-name-only directory URLs outside opaque profile paths', () => {
    const rawProfile = {
      netid: 'rd265',
      fname: 'Riley',
      lname: 'Domain',
      bio: 'Riley Domain writes about literary history and twentieth-century poetics.',
      profileUrls: {
        english: 'https://english.yale.edu/people/full-part-time-lecturers/domain',
      },
      researchInterests: ['Literary history'],
    };

    expect(isLikelySameNameContaminatedProfile(rawProfile)).toBe(false);
    expect(normalizePublicProfile(rawProfile).profile_urls).toEqual({
      english: 'https://english.yale.edu/people/full-part-time-lecturers/domain',
    });
  });

  it('keeps surname-only profile paths when the path has no competing given-name token', () => {
    const rawProfile = {
      netid: 'ds123',
      fname: 'Drew',
      lname: 'Signal',
      bio: 'Drew Signal studies environmental science and museum collections.',
      profileUrls: {
        environment: 'https://environment.yale.edu/profile/signal/',
      },
      researchInterests: ['Environmental science'],
    };

    expect(isLikelySameNameContaminatedProfile(rawProfile)).toBe(false);
    expect(normalizePublicProfile(rawProfile).profile_urls).toEqual({
      environment: 'https://environment.yale.edu/profile/signal/',
    });
  });

  it('keeps explicit nickname/alias profile URLs when the last name also matches', () => {
    const profileWithShortName = {
      netid: 'jh123',
      fname: 'Jacob',
      lname: 'North',
      bio: 'Jacob North writes essays and narrative nonfiction.',
      profileUrls: {
        english: 'https://english.yale.edu/people/full-part-time-lecturers/jake-north',
      },
      researchInterests: ['Narrative nonfiction'],
    };
    const profileWithInitialName = {
      netid: 'lj123',
      fname: 'LJ',
      lname: 'Jensen',
      bio: 'LJ Jensen teaches public-sector leadership and nonprofit governance.',
      profileUrls: {
        som: 'https://som.yale.edu/faculty-research/faculty-directory/laura-jensen',
      },
      researchInterests: ['Leadership'],
    };
    const profileWithRomanizedName = {
      netid: 'ip123',
      fname: 'Ian',
      lname: 'Park',
      bio: 'Ian Park teaches clinical practice and biomedical methods.',
      profileUrls: {
        medicine: 'https://medicine.yale.edu/profile/inhyun-park/',
      },
      researchInterests: ['Biomedical methods'],
    };
    const profileWithFormalName = {
      netid: 'jb123',
      fname: 'Jim',
      lname: 'Barlow',
      bio: 'Jim Barlow studies organizations, work, and labor markets.',
      profileUrls: {
        som: 'https://som.yale.edu/faculty-research/faculty-directory/james-barlow',
      },
      researchInterests: ['Organizations'],
    };

    expect(isLikelySameNameContaminatedProfile(profileWithShortName)).toBe(false);
    expect(isLikelySameNameContaminatedProfile(profileWithInitialName)).toBe(false);
    expect(isLikelySameNameContaminatedProfile(profileWithRomanizedName)).toBe(false);
    expect(isLikelySameNameContaminatedProfile(profileWithFormalName)).toBe(false);
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
      'Riley Metabolic, Ph.D. Professor Email: riley.metabolic@yale.eduPhone: 737-1216 Dr. Riley Metabolic is a Tenure Professor in the Department of Cellular and Molecular Physiology. Her research focuses on mitochondria-endoplasmic reticulum interactions and metabolic regulation in the central nervous system.';
    expect(cleanPublicProfileBio({ bio: leadingContactBio })).toBe(
      'Dr. Riley Metabolic is a Tenure Professor in the Department of Cellular and Molecular Physiology. Her research focuses on mitochondria-endoplasmic reticulum interactions and metabolic regulation in the central nervous system.',
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

  it('does not turn stored official research-area blocks into public bios', () => {
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

    expect(bio).toBe('');
  });

  it('does not use official profile research-interest terms as public bios when the stored bio is appointment-only', () => {
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

    expect(profile.bio).toBe('');
  });

  it('suppresses stored generated official research-interest summaries as public bios', () => {
    const profile = normalizePublicProfile({
      netid: 'mv123',
      fname: 'Morgan',
      lname: 'Vector',
      bio:
        "Morgan Vector's official Yale profile lists research interests in Data Systems, Public Health, and Example Methods, based on Yale's official profile data.",
      profileUrls: {
        medicine: 'https://medicine.yale.edu/profile/morgan-vector/',
      },
      researchInterests: ['Data Systems', 'Public Health', 'Example Methods'],
    });

    expect(profile.bio).toBe('');
  });

  it('suppresses title chrome and pasted contact blocks from public profiles', () => {
    expect(
      normalizePublicProfile({
        netid: 'mv123',
        fname: 'Morgan',
        lname: 'Vector',
        title: 'Research / Faculty',
      }).title,
    ).toBeUndefined();

    expect(
      normalizePublicProfile({
        netid: 'rv123',
        fname: 'Riley',
        lname: 'Vector',
        title: 'Home About Research Academics People Media Events Outreach Opportunities',
      }).title,
    ).toBeUndefined();

    expect(
      normalizePublicProfile({
        netid: 'av123',
        fname: 'Alex',
        lname: 'Vector',
        title:
          'Professor of Example Studies Bio Alex Vector studies synthetic policy. Contact 115 Prospect Street alex.vector@yale.edu',
      }).title,
    ).toBeUndefined();
  });

  it('keeps normal public profile titles', () => {
    expect(
      normalizePublicProfile({
        netid: 'sv123',
        fname: 'Sage',
        lname: 'Vector',
        title: 'Associate Professor of Example Methods',
      }).title,
    ).toBe('Associate Professor of Example Methods');
  });

  it('does not use official research-interest terms from same-person Yale people pages as public bios', () => {
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

    expect(profile.bio).toBe('');
  });

  it('does not derive public bios from official interest fallback terms', () => {
    const profile = normalizePublicProfile({
      netid: 'jls289',
      fname: 'Jesse',
      lname: 'Fixture',
      bio:
        'Associate Professor of Public Health (Health Policy); Associate Professor in the History of Medicine',
      profileUrls: {
        official: 'https://ysph.yale.edu/profile/jesse-fixture/',
      },
      researchInterests: [
        'Advisory Committees',
        'Centers for Disease Control and Prevention',
        'U.S.',
        'Evidence-Based Medicine',
        'Government Regulation',
      ],
    });

    expect(profile.bio).toBe('');
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
      fname: 'Taylor',
      lname: 'Literature',
      bio: "Literature Literature's website\n\nKline Tower Room 106",
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
        _id: 'ysm-stern',
        id: 'ysm-stern',
        slug: 'ysm-stern',
        name: 'Stern Lab',
        shortDescription: 'Studies DNA damage responses and melanoma biology.',
        researchAreas: ['DNA Damage'],
      },
    ]);
    // The generated "Studies <areas>." shortDescription only restates the tag
    // chips, so it is not surfaced as the context paragraph.
    expect(profile.research_interest_summary).toBe('');
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
          slug: 'faculty-research-area-fixture-access-lead',
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
      fname: 'Taylor',
      lname: 'Literature',
      bio: 'My research and teaching focus on late imperial Chinese literature.',
      profileUrls: {
        departmental: 'https://eall.yale.edu/people/taylor-literature',
      },
      topics: ['Legume Nitrogen Fixing Symbiosis'],
      hIndex: 2,
      researchInterests: [],
    });

    expect(profile.bio).toBe('My research and teaching focus on late imperial Chinese literature.');
    expect(profile.profile_urls).toEqual({
      departmental: 'https://eall.yale.edu/people/taylor-literature',
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
            fullDescription:
              'The Silberschatz group designs database engines and operating-system storage layers, focusing on transaction processing and crash recovery in distributed settings.',
            researchAreas: ['Database Systems', 'Operating Systems'],
          },
        ],
      },
    );

    expect(profile.bio).toBe('');
    // The real fullDescription prose surfaces as the context paragraph (not the
    // generated "Studies <areas>." restatement of the tag chips).
    expect(profile.research_interest_summary).toBe(
      'The Silberschatz group designs database engines and operating-system storage layers, focusing on transaction processing and crash recovery in distributed settings.',
    );
    expect(profile.research_interests).toEqual(['Database Systems', 'Operating Systems']);
    expect(profile.topics).toEqual([]);
  });

  it('cleans public topics with the same research-term guardrails as interests', () => {
    const profile = normalizePublicProfile(
      {
        netid: 'fixture106',
        fname: 'Alex',
        lname: 'Vaccine',
        bio: '',
        researchInterests: ['Infectious Diseases', 'Health Economics', 'Global Health'],
        topics: [
          'Health Economics',
          'Fish Diseases',
          'Avian Pathogenic Escherichia coli',
          'Cassava mosaic virus',
          'using stochastic simulation models.',
        ],
      },
      {
        trustedResearchEntities: true,
        researchEntities: [
          {
            name: 'Center for Infectious Disease Modeling and Analysis',
            kind: 'center',
            entityType: 'CENTER',
            role: 'pi',
            researchAreas: ['Infectious Disease Modeling'],
          },
        ],
      },
    );

    expect(profile.topics).toEqual(['Health Economics']);
  });

  it('prefers lead lab prose over broad center prose for the research context summary', () => {
    const profile = normalizePublicProfile(
      {
        netid: 'fixture105',
        fname: 'Taylor',
        lname: 'Signal',
        bio: '',
        researchInterests: [],
        topics: [],
      },
      {
        trustedResearchEntities: true,
        researchEntities: [
          {
            name: 'Wu Tsai Institute',
            kind: 'center',
            entityType: 'INSTITUTE',
            role: 'core-faculty',
            fullDescription:
              'The Wu Tsai Institute accelerates interdisciplinary research into cognition, computation, and human behavior across Yale.',
            researchAreas: ['Cognition', 'Computation'],
          },
          {
            name: 'Signal Lab',
            kind: 'lab',
            entityType: 'LAB',
            role: 'pi',
            fullDescription:
              'The Signal Lab studies perception, decision making, and computational psychiatry through neuroimaging, behavioral modeling, and clinical experiments.',
            researchAreas: ['Psychosis', 'Computational Psychiatry'],
          },
        ],
      },
    );

    expect(profile.research_interest_summary).toBe(
      'The Signal Lab studies perception, decision making, and computational psychiatry through neuroimaging, behavioral modeling, and clinical experiments.',
    );
  });

  it('does not use broad affiliation prose as the research context summary when lead prose is thin', () => {
    const profile = normalizePublicProfile(
      {
        netid: 'fixture109',
        fname: 'Taylor',
        lname: 'Signal',
        bio: '',
        researchInterests: [],
        topics: [],
      },
      {
        trustedResearchEntities: true,
        researchEntities: [
          {
            name: 'Signal Research',
            kind: 'individual',
            entityType: 'FACULTY_RESEARCH_AREA',
            role: 'pi',
            fullDescription: 'Research fields include Signal Processing and Cognition.',
            researchAreas: ['Signal Processing', 'Cognition'],
          },
          {
            name: 'Cognition Institute',
            kind: 'center',
            entityType: 'INSTITUTE',
            role: 'core-faculty',
            fullDescription:
              'The Cognition Institute advances interdisciplinary research in computation, behavior, and neural systems through collaborative projects across many departments.',
            researchAreas: ['Cognition', 'Computation'],
          },
        ],
      },
    );

    expect(profile.research_interest_summary).toBe('');
  });

  it('uses trusted source-backed lead research homes as a concise fallback bio', () => {
    const profile = normalizePublicProfile(
      {
        netid: 'fixture107',
        fname: 'Sage',
        lname: 'Repair',
        bio: '',
        researchInterests: [],
        topics: [],
      },
      {
        trustedResearchEntities: true,
        researchEntities: [
          {
            name: 'Repair Lab',
            kind: 'lab',
            entityType: 'LAB',
            role: 'pi',
            websiteUrl: 'https://medicine.yale.edu/lab/repair/',
            shortDescription:
              'The Repair Lab studies DNA damage mechanisms and their contributions to cancer evolution using genomic pathology, molecular biology, and image analysis.',
            researchAreas: ['DNA Damage', 'Cancer Evolution'],
          },
        ],
      },
    );

    expect(profile.bio).toContain('Sage Repair leads the Repair Lab.');
    expect(profile.bio).toContain(
      'The Repair Lab studies DNA damage mechanisms and their contributions to cancer evolution',
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
    // Only a generated "Studies <areas>." shortDescription is present, so there
    // is no real prose to show beside the tag chips.
    expect(profile.research_interest_summary).toBe('');
  });

  it('suppresses a context summary that merely restates the research-area tags', () => {
    const profile = normalizePublicProfile(
      {
        netid: 'jlp58',
        fname: 'Jordan',
        lname: 'Peccia',
        bio: '',
        researchInterests: [],
        topics: [],
      },
      {
        trustedResearchEntities: true,
        researchEntities: [
          {
            name: 'Peccia Lab',
            kind: 'lab',
            entityType: 'LAB',
            role: 'pi',
            fullDescription:
              'Research fields include Indoor Air Quality and Microbial Exposure, SARS-CoV-2 detection and testing, and Air Quality and Health Impacts.',
            researchAreas: [
              'Indoor Air Quality and Microbial Exposure',
              'SARS-CoV-2 detection and testing',
              'Air Quality and Health Impacts',
            ],
          },
        ],
      },
    );

    expect(profile.research_interest_summary).toBe('');
    expect(profile.research_interests).toEqual([
      'Indoor Air Quality and Microbial Exposure',
      'SARS-CoV-2 detection and testing',
      'Air Quality and Health Impacts',
    ]);
  });

  it('leads the context summary with research, dropping appointment/title preamble', () => {
    const profile = normalizePublicProfile(
      {
        netid: 'bpl2',
        fname: 'Brian',
        lname: 'Leaderer',
        bio: '',
        researchInterests: [],
        topics: [],
      },
      {
        trustedResearchEntities: true,
        researchEntities: [
          {
            name: 'Leaderer Lab',
            kind: 'lab',
            entityType: 'LAB',
            role: 'pi',
            fullDescription:
              'Dr. Brian Leaderer is the Susan Dwight Bliss Professor Emeritus of Epidemiology at the Yale School of Public Health. He served as Deputy Dean for over 14 years. Dr. Leaderer studies how exposures to indoor and outdoor air contaminants affect respiratory health in epidemiological field studies.',
            researchAreas: ['Air Quality and Health Impacts'],
          },
        ],
      },
    );

    expect(profile.research_interest_summary).toBe(
      'Dr. Leaderer studies how exposures to indoor and outdoor air contaminants affect respiratory health in epidemiological field studies.',
    );
    expect(profile.research_interest_summary).not.toContain('Professor Emeritus');
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
          'https://engineering.yale.edu/research-and-faculty/faculty-directory/lane-network',
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
      title: 'Figure S1 from ASCL1 Drives Tolerance to Osimertinib in <i>EGFR</i> Mutant Literatureng Cancer',
      url: 'https://doi.org/10.1158/0008-5472.25785287',
      destinationKind: 'DOI',
      displaySource: 'DOI',
      discoveredVia: 'OPENALEX',
      year: 2025,
    });

    expect(link.title).toBe('Figure S1 from ASCL1 Drives Tolerance to Osimertinib in EGFR Mutant Literatureng Cancer');
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

describe('profileService admin profile update persistence', () => {
  it('bounds and allowlists admin profile update payloads before persistence', async () => {
    userModelMock.findOne.mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        primaryDepartment: 'Existing Department',
        secondaryDepartments: ['Existing Secondary'],
      }),
    });
    userModelMock.findOneAndUpdate.mockReturnValue({
      select: vi.fn(() => ({
        lean: vi.fn().mockResolvedValue({ netid: 'ada123' }),
      })),
    });

    await adminUpdateProfile('ada123', {
      bio: `Reach me at hidden@example.edu or 203-432-1234. ${'x'.repeat(20_000)}`,
      primaryDepartment: 'Computer Science',
      secondaryDepartments: Array.from({ length: 200 }, (_, index) => `Dept ${index} dept${index}@example.edu`),
      researchInterests: ['Machine learning admin@example.edu', { nested: true }],
      topics: ['Systems 203-432-1234'],
      website: 'javascript:alert(document.cookie)',
      profileUrls: {
        official: 'https://profiles.example.edu/ada',
        unsafe: 'data:text/html,<script>alert(1)</script>',
      },
      fname: `Ada hidden@example.edu ${'x'.repeat(500)}`,
      lname: { nested: true },
      email: 'ada@example.edu\nBcc: hidden@example.edu',
      title: `Professor 203-432-1234 ${'x'.repeat(500)}`,
      hIndex: 2_000_000,
      profileVerified: 'true',
      userConfirmed: true,
      userType: 'superadmin',
      publications: 'not an array',
      arbitraryNested: { $set: { admin: true } },
    });

    const update = userModelMock.findOneAndUpdate.mock.calls[0][1];

    expect(update.bio.length).toBeLessThanOrEqual(5_000);
    expect(update.bio).not.toContain('hidden@example.edu');
    expect(update.bio).not.toContain('203-432-1234');
    expect(update.primaryDepartment).toBe('Computer Science');
    expect(update.secondaryDepartments.length).toBeLessThanOrEqual(100);
    expect(JSON.stringify(update.secondaryDepartments)).not.toContain('@example.edu');
    expect(update.researchInterests).toEqual(['Machine learning [email redacted]']);
    expect(update.topics).toEqual(['Systems [phone redacted]']);
    expect(update.website).toBeUndefined();
    expect(update.profileUrls.official).toMatch(/^https:\/\/profiles\.example\.edu\/ada\/?$/);
    expect(update.profileUrls).not.toHaveProperty('unsafe');
    expect(update.fname.length).toBeLessThanOrEqual(120);
    expect(update.fname).not.toContain('hidden@example.edu');
    expect(update).not.toHaveProperty('lname');
    expect(update).not.toHaveProperty('email');
    expect(update.title.length).toBeLessThanOrEqual(320);
    expect(update.title).not.toContain('203-432-1234');
    expect(update).not.toHaveProperty('hIndex');
    expect(update).not.toHaveProperty('profileVerified');
    expect(update.userConfirmed).toBe(true);
    expect(update).not.toHaveProperty('userType');
    expect(update.publications).toEqual([]);
    expect(update).not.toHaveProperty('arbitraryNested');
  });

  it('accepts every userType the AdminProfileEditModal dropdown actually offers', async () => {
    for (const userType of ['admin', 'professor', 'faculty', 'undergraduate', 'graduate', 'unknown']) {
      userModelMock.findOneAndUpdate.mockReturnValue({
        select: vi.fn(() => ({ lean: vi.fn().mockResolvedValue({ netid: 'u123' }) })),
      });

      await adminUpdateProfile('u123', { userType });

      const update = userModelMock.findOneAndUpdate.mock.calls.at(-1)![1] as Record<string, unknown>;
      expect(update.userType).toBe(userType);
    }
  });

  it('drops the legacy generic student userType, which no real account uses and the dropdown never offers', async () => {
    userModelMock.findOneAndUpdate.mockReturnValue({
      select: vi.fn(() => ({ lean: vi.fn().mockResolvedValue({ netid: 'u123' }) })),
    });

    await adminUpdateProfile('u123', { userType: 'student' });

    const update = userModelMock.findOneAndUpdate.mock.calls.at(-1)![1] as Record<string, unknown>;
    expect(update).not.toHaveProperty('userType');
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

  it('sanitizes admin profile URL fields before persisting a faculty profile', async () => {
    userModelMock.findOneAndUpdate.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          netid: 'prof123',
          website: 'https://faculty.example.test/',
          profileUrls: { yale: 'https://faculty.example.test/profile' },
        }),
      }),
    });

    await adminUpdateProfile('prof123', {
      title: 'Professor of Security',
      website: 'javascript:alert(document.cookie)',
      imageUrl: 'https://user:pass@example.yale.edu/profile.jpg',
      profileUrls: {
        yale: 'https://faculty.example.test/profile',
        mail: 'mailto:prof123@yale.edu',
        script: 'javascript:alert(document.cookie)',
      },
    });

    expect(userModelMock.findOneAndUpdate).toHaveBeenCalledWith(
      { netid: 'prof123' },
      {
        title: 'Professor of Security',
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

  it('bounds and allowlists admin profile publications before persistence', async () => {
    userModelMock.findOneAndUpdate.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          netid: 'prof123',
          publications: [],
        }),
      }),
    });

    await adminUpdateProfile('prof123', {
      publications: [
        {
          title: `Contact ada@example.edu about ${'A'.repeat(800)}`,
          doi: '10.1234/example ada@example.edu',
          year: '2026',
          venue: 'Journal phone 203-555-1212',
          cited_by_count: '42',
          open_access_url: 'https://example.yale.edu/paper.pdf',
          source: 'official-profile ada@example.edu',
          ownerEmail: 'ada@example.edu',
          raw: { private: true },
        },
        {
          title: '',
          raw: { private: true },
        },
        {
          title: 'Unsafe URL paper',
          openAccessUrl: 'javascript:alert(document.cookie)',
        },
      ],
    });

    const update = userModelMock.findOneAndUpdate.mock.lastCall[1];
    expect(update.publications).toHaveLength(2);
    expect(update.publications[0]).toMatchObject({
      year: 2026,
      citedByCount: 42,
      openAccessUrl: 'https://example.yale.edu/paper.pdf',
    });
    expect(update.publications[0].title.length).toBeLessThanOrEqual(500);
    expect(JSON.stringify(update.publications)).not.toContain('ada@example.edu');
    expect(JSON.stringify(update.publications)).not.toContain('203-555-1212');
    expect(JSON.stringify(update.publications)).not.toContain('ownerEmail');
    expect(JSON.stringify(update.publications)).not.toContain('raw');
    expect(update.publications[1]).toEqual({ title: 'Unsafe URL paper' });
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

    const profileUrls: Record<string, unknown> = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [
        `url${index}`,
        `https://faculty.example.test/profile/${index}`,
      ]),
    );
    Object.defineProperty(profileUrls, 'late', {
      get: () => {
        throw new Error('profile URL sanitizer read past the self-edit URL cap');
      },
      enumerable: true,
    });

    const secondaryDepartments = Array.from(
      { length: 50 },
      (_, index) => ` Department ${index} `,
    );
    Object.defineProperty(secondaryDepartments, '50', {
      get: () => {
        throw new Error('profile array sanitizer read past the self-edit array cap');
      },
      enumerable: true,
    });

    const researchInterests = Array.from({ length: 50 }, (_, index) =>
      index === 0 ? 'x'.repeat(500) : ` Interest ${index} `,
    );
    Object.defineProperty(researchInterests, '50', {
      get: () => {
        throw new Error('profile interest sanitizer read past the self-edit array cap');
      },
      enumerable: true,
    });

    await updateOwnProfile('prof123', {
      bio: 'a'.repeat(6000),
      primaryDepartment: '  Computer Science  ',
      secondaryDepartments,
      researchInterests,
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
