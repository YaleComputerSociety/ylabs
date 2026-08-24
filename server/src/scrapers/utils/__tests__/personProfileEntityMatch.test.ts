import { describe, expect, it } from 'vitest';
import {
  isPersonOrGrantShellSlug,
  personProfileNameTokensFromUrl,
  personProfileSourceMatchesEntity,
  researchEntityIdentityTokens,
  sourceUrlSchoolContradictsEntity,
  sourceUrlToleratedSchoolDivergesFromEntity,
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

  it('rejects an uncorroborated surname-only match at a tolerant host when the entity records no given name at all (#1537)', () => {
    expect(
      personProfileSourceMatchesEntity('https://medicine.yale.edu/profile/thomas-graham/', {
        slug: 'graham-lab-tg296',
        name: 'Graham Lab',
        departments: ['Russian, East European, and Eurasian Studies'],
        school: 'Faculty of Arts and Sciences',
        schools: ['Faculty of Arts and Sciences'],
        fullDescription:
          'The Graham Lab focuses on the intersection of neuroscience and immunology, particularly in understanding how the immune system interacts with the nervous system.',
      }),
    ).toBe(false);
    expect(
      personProfileSourceMatchesEntity('https://medicine.yale.edu/profile/maria-kaliambou/', {
        slug: 'kaliambou-lab-mk655',
        name: 'Kaliambou Lab',
        departments: ['Russian, East European, and Eurasian Studies'],
        school: 'Faculty of Arts and Sciences',
        schools: ['Faculty of Arts and Sciences'],
      }),
    ).toBe(false);
  });

  it('still allows a surname-only match at a non-tolerant host with no given name recorded', () => {
    expect(
      personProfileSourceMatchesEntity('https://physics.yale.edu/people/keith-baker', {
        slug: 'baker-lab-okb2',
        name: 'Baker Lab',
      }),
    ).toBe(true);
  });

  it('allows a surname-only match at a tolerant host when independently corroborated by another page', () => {
    expect(
      personProfileSourceMatchesEntity('https://medicine.yale.edu/profile/thomas-graham/', {
        slug: 'graham-lab-tg296',
        name: 'Graham Lab',
        departments: ['Russian, East European, and Eurasian Studies'],
        sourceUrls: [
          'https://medicine.yale.edu/profile/thomas-graham/',
          'https://reeas.yale.edu/people/thomas-graham',
          'https://reeas.yale.edu/profile/thomas-graham',
        ],
      }),
    ).toBe(true);
  });

  it('is not corroborated by the entity own prose naming itself for a surname-only match (#1671)', () => {
    // Unlike the #1110 topic-named-shell fallback, a surname-only entity's own
    // fullDescription may itself have been populated from this same contested
    // page, so it can never independently corroborate it - only an independent
    // second page counts. This is the same reasoning #1413 already applies to a
    // full-name match at a tolerant host that diverges from the entity's school.
    expect(
      personProfileSourceMatchesEntity('https://medicine.yale.edu/profile/thomas-graham/', {
        slug: 'graham-lab-tg296',
        name: 'Graham Lab',
        departments: ['Russian, East European, and Eurasian Studies'],
        fullDescription: "Thomas Graham's lab studies the immune system.",
      }),
    ).toBe(false);
    expect(
      personProfileSourceMatchesEntity('https://medicine.yale.edu/profile/gregory-crewdson/', {
        slug: 'crewdson-lab-gc58',
        name: 'Crewdson Lab',
        school: 'School of Art',
        departments: ['Art'],
        fullDescription:
          'The Crewdson Lab, led by Professor Gregory Crewdson, focuses on the intersection of art and science, particularly in the realm of medical imaging and its implications for understanding health and disease.',
      }),
    ).toBe(false);
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

  it('rejects an exact full-name homonym at a tolerant host that diverges from the entity own school (#1413)', () => {
    const engineeringEntity = {
      slug: 'faculty-research-area-rex-ying',
      name: 'Rex Ying Research',
      school: 'School of Engineering & Applied Science',
      departments: ['Computer Science'],
    };
    expect(
      personProfileSourceMatchesEntity('https://medicine.yale.edu/profile/rex-ying', engineeringEntity),
    ).toBe(false);

    const medicalEntity = {
      slug: 'nih-pi-pei-yu-chen',
      name: 'Pei-Yu Chen Lab',
      school: 'School of Medicine',
      departments: ['Internal Medicine'],
    };
    expect(
      personProfileSourceMatchesEntity('https://seas.yale.edu/profile/pei-yu-chen', medicalEntity),
    ).toBe(false);
  });

  it('is not corroborated by the entity own prose naming itself (#1413)', () => {
    expect(
      personProfileSourceMatchesEntity('https://medicine.yale.edu/profile/rex-ying', {
        slug: 'faculty-research-area-rex-ying',
        name: 'Rex Ying Research',
        school: 'School of Engineering & Applied Science',
        departments: ['Computer Science'],
        fullDescription: "Rex Ying's research focuses on graph neural networks and scalable machine learning.",
      }),
    ).toBe(false);
  });

  it('keeps a full-name match at a tolerant host corroborated by an independent second profile page', () => {
    expect(
      personProfileSourceMatchesEntity('https://medicine.yale.edu/profile/rex-ying', {
        slug: 'faculty-research-area-rex-ying',
        name: 'Rex Ying Research',
        school: 'School of Engineering & Applied Science',
        departments: ['Computer Science'],
        sourceUrls: [
          'https://medicine.yale.edu/profile/rex-ying',
          'https://engineering.yale.edu/people/rex-ying',
          'https://cs.yale.edu/people/rex-ying',
        ],
      }),
    ).toBe(true);
  });

  it('keeps a full-name match at a tolerant host when it agrees with the entity own school', () => {
    expect(
      personProfileSourceMatchesEntity('https://medicine.yale.edu/profile/pei-yu-chen', {
        slug: 'nih-pi-pei-yu-chen',
        name: 'Pei-Yu Chen Lab',
        school: 'School of Medicine',
        departments: ['Internal Medicine'],
      }),
    ).toBe(true);
  });
});

describe('sourceUrlToleratedSchoolDivergesFromEntity', () => {
  it('fires only for a tolerant host whose implied school diverges from a known entity school', () => {
    expect(
      sourceUrlToleratedSchoolDivergesFromEntity('https://medicine.yale.edu/profile/rex-ying', {
        school: 'School of Engineering & Applied Science',
      }),
    ).toBe(true);
    expect(
      sourceUrlToleratedSchoolDivergesFromEntity('https://medicine.yale.edu/profile/rex-ying', {
        school: 'School of Medicine',
      }),
    ).toBe(false);
    expect(
      sourceUrlToleratedSchoolDivergesFromEntity('https://medicine.yale.edu/profile/rex-ying', {}),
    ).toBe(false);
    expect(
      sourceUrlToleratedSchoolDivergesFromEntity('https://som.yale.edu/profile/rex-ying', {
        school: 'School of Engineering & Applied Science',
      }),
    ).toBe(false);
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

describe('isPersonOrGrantShellSlug (#1595)', () => {
  it('flags NIH/NSF/DOE PI-derived and faculty-research-area slugs', () => {
    expect(isPersonOrGrantShellSlug('nih-pi-quinn-harlow')).toBe(true);
    expect(isPersonOrGrantShellSlug('nsf-pi-casey-lindqvist')).toBe(true);
    expect(isPersonOrGrantShellSlug('doe-pi-jordan-avery')).toBe(true);
    expect(isPersonOrGrantShellSlug('faculty-research-area-morgan-ellery')).toBe(true);
  });

  it('flags a generated <surname>-lab-<code> lab-shell key', () => {
    expect(isPersonOrGrantShellSlug('zephyr-lab-ab12')).toBe(true);
    expect(isPersonOrGrantShellSlug('quill-lab-cd34')).toBe(true);
  });

  it('does not flag a genuine organizational slug', () => {
    expect(isPersonOrGrantShellSlug('harbor-brain-institute')).toBe(false);
    expect(isPersonOrGrantShellSlug('epidemic-modeling-center')).toBe(false);
    expect(isPersonOrGrantShellSlug('yale-coastal-research-hub')).toBe(false);
  });

  it('handles empty/missing input', () => {
    expect(isPersonOrGrantShellSlug(undefined)).toBe(false);
    expect(isPersonOrGrantShellSlug('')).toBe(false);
  });
});
