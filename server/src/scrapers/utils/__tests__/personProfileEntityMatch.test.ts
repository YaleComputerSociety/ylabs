import { describe, expect, it } from 'vitest';
import {
  personProfileNameTokensFromUrl,
  personProfileSourceMatchesEntity,
  researchEntityIdentityTokens,
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
    expect(personProfileNameTokensFromUrl('https://medicine.yale.edu/profile/br574/')).toBeNull();
    expect(personProfileNameTokensFromUrl('https://physics.yale.edu/people/faculty')).toBeNull();
    expect(personProfileNameTokensFromUrl('https://brownlab.yale.edu/')).toBeNull();
    expect(personProfileNameTokensFromUrl('https://example.com/people/keith-baker')).toBeNull();
    expect(personProfileNameTokensFromUrl(undefined)).toBeNull();
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

  it('allows non-person URLs and ambiguous shared-name partial matches', () => {
    expect(
      personProfileSourceMatchesEntity('https://brownlab.yale.edu/research.html', {
        slug: 'dept-physics-charles-brown',
        name: 'Charles Brown Lab',
      }),
    ).toBe(true);
    expect(
      personProfileSourceMatchesEntity('https://medicine.yale.edu/profile/br574/', {
        slug: 'nih-pi-bhaskar-roy',
        name: 'Bhaskar Roy Lab',
      }),
    ).toBe(true);
    expect(
      personProfileSourceMatchesEntity('https://medicine.yale.edu/profile/gunjan-kamdar/', {
        slug: 'nih-pi-gunjan-tiyyagura',
        name: 'Gunjan Tiyyagura Lab',
      }),
    ).toBe(true);
  });
});
