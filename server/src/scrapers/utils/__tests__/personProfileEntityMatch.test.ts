import { describe, expect, it } from 'vitest';
import {
  personProfileNameTokensFromUrl,
  personProfileSourceMatchesEntity,
  researchEntityIdentityTokens,
  sourceUrlSchoolContradictsEntity,
} from '../personProfileEntityMatch';

describe('personProfileNameTokensFromUrl', () => {
  it('returns name tokens for a name-shaped Yale person page', () => {
    expect(personProfileNameTokensFromUrl('https://physics.yale.edu/people/keith-baker')).toEqual([
      'keith',
      'baker',
    ]);
    expect(
      personProfileNameTokensFromUrl('https://medicine.yale.edu/profile/stephen-dellaporta-phd'),
    ).toEqual(['stephen', 'dellaporta']);
  });

  it('returns null for netid, single-token, listing, and non-Yale URLs', () => {
    expect(personProfileNameTokensFromUrl('https://medicine.yale.edu/profile/zz000/')).toBeNull();
    expect(personProfileNameTokensFromUrl('https://physics.yale.edu/people/faculty')).toBeNull();
    expect(personProfileNameTokensFromUrl('https://brownlab.yale.edu/')).toBeNull();
    expect(personProfileNameTokensFromUrl('https://example.com/people/keith-baker')).toBeNull();
    expect(personProfileNameTokensFromUrl(undefined)).toBeNull();
  });

  it('returns null for dash-separated department-roster listing pages (#1301)', () => {
    expect(
      personProfileNameTokensFromUrl('https://linguistics.yale.edu/people/linguistics-faculty'),
    ).toBeNull();
    expect(personProfileNameTokensFromUrl('https://cbb.yale.edu/people/our-people')).toBeNull();
    expect(personProfileNameTokensFromUrl('https://medicine.yale.edu/people/ladder-faculty')).toBeNull();
  });
});

describe('researchEntityIdentityTokens', () => {
  it('draws person tokens from name and slug and drops role, prefix, and suffix noise', () => {
    expect(
      researchEntityIdentityTokens({ slug: 'dept-physics-charles-brown', name: 'Charles Brown Lab' }),
    ).toEqual(expect.arrayContaining(['charles', 'brown', 'physics']));
    expect(researchEntityIdentityTokens({ slug: 'nih-pi-hualiang-pi', name: 'Hualiang Pi Lab' })).toEqual(
      expect.arrayContaining(['hualiang', 'pi']),
    );
    expect(
      researchEntityIdentityTokens({ slug: 'faculty-research-area-david-fiellin', name: 'Program in Addiction Medicine' }),
    ).toEqual(expect.arrayContaining(['david', 'fiellin']));
  });
});

describe('personProfileSourceMatchesEntity', () => {
  it('rejects a different professor keyed onto an entity', () => {
    expect(
      personProfileSourceMatchesEntity('https://physics.yale.edu/people/keith-baker', {
        slug: 'dept-physics-charles-brown',
        name: 'Charles Brown Lab',
      }),
    ).toBe(false);
    expect(
      personProfileSourceMatchesEntity('https://medicine.yale.edu/profile/james-bond/', {
        slug: 'bundy-lab-jab49',
        name: 'Bundy Lab',
      }),
    ).toBe(false);
    expect(
      personProfileSourceMatchesEntity('https://medicine.yale.edu/profile/david-song/', {
        slug: 'simon-lab-djs69',
        name: 'Simon Lab',
      }),
    ).toBe(false);
  });

  it('keeps a corroborated person page, including compound and concatenated surnames', () => {
    expect(
      personProfileSourceMatchesEntity('https://physics.yale.edu/people/keith-baker', {
        slug: 'baker-lab-okb2',
        name: 'Baker Lab',
      }),
    ).toBe(true);
    expect(
      personProfileSourceMatchesEntity('https://medicine.yale.edu/profile/choukri-benmamoun/', {
        slug: 'ben-mamoun-lab-cb542',
        name: 'Ben Mamoun Lab',
      }),
    ).toBe(true);
    expect(
      personProfileSourceMatchesEntity('https://tdps.yale.edu/profile/julie-vandyke', {
        slug: 'van-dyke-lab-jv94',
        name: 'Van Dyke Lab',
      }),
    ).toBe(true);
    expect(
      personProfileSourceMatchesEntity('https://politicalscience.yale.edu/people/alex-debs', {
        slug: 'dept-econ-alexandre-debs',
        name: 'Alexandre Debs Faculty Research',
      }),
    ).toBe(true);
  });

  it('allows non-person URLs and non-name-shaped person slugs', () => {
    expect(
      personProfileSourceMatchesEntity('https://brownlab.yale.edu/research.html', {
        slug: 'dept-physics-charles-brown',
        name: 'Charles Brown Lab',
      }),
    ).toBe(true);
    expect(
      personProfileSourceMatchesEntity('https://medicine.yale.edu/profile/zz000/', {
        slug: 'nih-pi-fixture-person',
        name: 'Fixture Person Lab',
      }),
    ).toBe(true);
  });

  it('allows a surname collision (shared family name, differing given name) for identity resolution', () => {
    expect(
      personProfileSourceMatchesEntity('https://medicine.yale.edu/profile/frances-lowell/', {
        slug: 'nih-pi-perry-lowell',
        name: 'Perry Lowell Faculty Research',
      }),
    ).toBe(true);
  });

  it('rejects a shared-first-name graft of a different person (#981)', () => {
    expect(
      personProfileSourceMatchesEntity('https://medicine.yale.edu/profile/benjamin-mercer/', {
        slug: 'dept-econ-benjamin-lowell',
        name: 'Benjamin Lowell Faculty Research',
      }),
    ).toBe(false);
    expect(
      personProfileSourceMatchesEntity('https://economics.yale.edu/people/benjamin-carter', {
        slug: 'nih-pi-benjamin-tiyyagura',
        name: 'Benjamin Tiyyagura Lab',
      }),
    ).toBe(false);
  });

  it('keeps a topic-named grant shell PI page corroborated by the entity own evidence (#1110)', () => {
    const reproEcologyShell = {
      slug: 'nsf-pi-67d891d950621bcef4347e63',
      name: 'Yale Reproductive Ecology Laboratory',
      sourceUrls: [
        'https://eeb.yale.edu/people/faculty-affiliated/richard-bribiescas',
        'https://anthropology.yale.edu/people/richard-gutierrez-bribiescas',
        'https://medicine.yale.edu/profile/richard-bribiescas/',
      ],
      fullDescription:
        'The Yale Reproductive Ecology Laboratory studies human life history. PI Dr. Richard Bribiescas.',
    };
    expect(
      personProfileSourceMatchesEntity(
        'https://anthropology.yale.edu/profile/richard-bribiescas',
        reproEcologyShell,
      ),
    ).toBe(true);
    expect(
      personProfileSourceMatchesEntity(
        'https://anthropology.yale.edu/profile/richard-bribiescas',
        {
          slug: 'nsf-pi-67d891d950621bcef4347e63',
          name: 'Yale Reproductive Ecology Laboratory',
          fullDescription:
            'The Yale Reproductive Ecology Laboratory studies human life history. PI Dr. Richard Bribiescas.',
        },
      ),
    ).toBe(true);
  });

  it('still rejects a lone mis-picked professor page even with entity evidence present', () => {
    expect(
      personProfileSourceMatchesEntity('https://physics.yale.edu/people/keith-baker', {
        slug: 'dept-physics-charles-brown',
        name: 'Charles Brown Lab',
        sourceUrls: [
          'https://physics.yale.edu/people/keith-baker',
          'https://physics.yale.edu/people/charles-brown',
        ],
        fullDescription: 'The Charles Brown Lab studies condensed matter physics. PI Charles Brown.',
      }),
    ).toBe(false);
  });

  it('rejects an exact full-name homonym at a contradicting Yale school', () => {
    const medicineGrantShell = {
      slug: 'nih-pi-jordan-avery',
      name: 'Jordan Avery Lab',
      school: 'School of Medicine',
      departments: ['Internal Medicine'],
    };
    expect(
      personProfileSourceMatchesEntity(
        'https://faculty.som.yale.edu/jordanavery/',
        medicineGrantShell,
      ),
    ).toBe(false);
    expect(
      personProfileSourceMatchesEntity('https://som.yale.edu/profile/jordan-avery/', medicineGrantShell),
    ).toBe(false);
  });

  it('keeps the same homonym when the source school agrees with the entity', () => {
    const medicineGrantShell = {
      slug: 'nih-pi-jordan-avery',
      name: 'Jordan Avery Lab',
      school: 'School of Medicine',
      departments: ['Internal Medicine'],
    };
    expect(
      personProfileSourceMatchesEntity(
        'https://medicine.yale.edu/profile/jordan-avery/',
        medicineGrantShell,
      ),
    ).toBe(true);
    expect(
      personProfileSourceMatchesEntity('https://faculty.som.yale.edu/jordanavery/', {
        slug: 'som-pi-jordan-avery',
        name: 'Jordan Avery Faculty Research',
        school: 'School of Management',
      }),
    ).toBe(true);
  });

  it('does not gate a school contradiction when the entity records no school', () => {
    expect(
      personProfileSourceMatchesEntity('https://faculty.som.yale.edu/jordanavery/', {
        slug: 'nih-pi-jordan-avery',
        name: 'Jordan Avery Lab',
      }),
    ).toBe(true);
  });
});

describe('sourceUrlSchoolContradictsEntity', () => {
  it('fires only when both host and entity resolve to different known schools', () => {
    expect(
      sourceUrlSchoolContradictsEntity('https://faculty.som.yale.edu/jordanavery/', {
        school: 'School of Medicine',
        departments: ['Internal Medicine'],
      }),
    ).toBe(true);
    expect(
      sourceUrlSchoolContradictsEntity('https://medicine.yale.edu/profile/jordan-avery/', {
        school: 'School of Medicine',
      }),
    ).toBe(false);
  });

  it('does not fire for unmapped hosts, non-Yale hosts, or schoolless entities', () => {
    expect(
      sourceUrlSchoolContradictsEntity('https://economics.yale.edu/people/jordan-avery', {
        school: 'School of Medicine',
      }),
    ).toBe(false);
    expect(
      sourceUrlSchoolContradictsEntity('https://example.com/jordanavery', {
        school: 'School of Medicine',
      }),
    ).toBe(false);
    expect(
      sourceUrlSchoolContradictsEntity('https://faculty.som.yale.edu/jordanavery/', {}),
    ).toBe(false);
  });

  it('allows a source school that matches any of a multi-school entity', () => {
    expect(
      sourceUrlSchoolContradictsEntity('https://seas.yale.edu/profile/jordan-avery/', {
        school: 'School of Medicine',
        departments: ['Biomedical Engineering'],
      }),
    ).toBe(false);
  });
});
