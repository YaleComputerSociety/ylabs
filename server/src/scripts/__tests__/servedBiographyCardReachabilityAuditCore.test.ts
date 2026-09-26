import { describe, expect, it } from 'vitest';
import {
  assertBiographyCardReachabilityConsistent,
  buildBiographyCardPopulation,
  buildBiographyCardReachability,
  classifyDerivedCardSubstitute,
  unwidenedSubstituteReaches,
  type ServedBiographyCardRow,
} from '../servedBiographyCardReachabilityAuditCore';

const servedRow = (overrides: Partial<ServedBiographyCardRow>): ServedBiographyCardRow => ({
  slug: 'synthetic-row',
  shortDescription: '',
  fullDescription: '',
  researchAreas: ['Immunology'],
  entityType: 'FACULTY_RESEARCH_AREA',
  kind: 'lab',
  ...overrides,
});

const CREDENTIAL_CARD = 'Dr. Avery Lin was appointed to the faculty in 2011.';

const CREDENTIAL_LED_RESEARCH_BODY =
  'Dr. Avery Lin was appointed to the faculty in 2011. Investigates how tissue-resident memory ' +
  'T cells patrol the airway epithelium after viral infection, and develops single-cell tools to ' +
  'map the signals that keep them there.';

const RESEARCH_CARD = 'Studies airway immunology in chronic lung disease.';

describe('served biography-card population', () => {
  it('counts the career-biography card as the population and the person-bio card as the control', () => {
    const population = buildBiographyCardPopulation([
      servedRow({ slug: 'credential-card', shortDescription: CREDENTIAL_CARD }),
      servedRow({ slug: 'research-card', shortDescription: RESEARCH_CARD }),
      servedRow({
        slug: 'named-research-card',
        shortDescription: "Dr. Avery Lin's research investigates mechanisms of airway injury.",
      }),
    ]);

    expect(population.servedRows).toBe(3);
    expect(population.careerBiographyCards).toBe(1);
    expect(population.slugs).toEqual(['credential-card']);
    // The widened control has to be larger, because a zero or an equal count would
    // mean the two detectors are not measuring different things and the population
    // number carries no calibration at all.
    expect(population.personBioCards).toBeGreaterThan(population.careerBiographyCards);
  });

  it('splits the population by entityType', () => {
    const population = buildBiographyCardPopulation([
      servedRow({ slug: 'fra-row', shortDescription: CREDENTIAL_CARD }),
      servedRow({ slug: 'lab-row', shortDescription: CREDENTIAL_CARD, entityType: 'LAB' }),
      servedRow({ slug: 'untyped-row', shortDescription: CREDENTIAL_CARD, entityType: '' }),
    ]);

    expect(population.byEntityType).toEqual({ FACULTY_RESEARCH_AREA: 1, LAB: 1, UNTYPED: 1 });
  });
});

describe('derived-substitute reachability', () => {
  it('reaches a biography card whose body still carries research prose', () => {
    const row = servedRow({
      shortDescription: CREDENTIAL_CARD,
      fullDescription: CREDENTIAL_LED_RESEARCH_BODY,
    });

    const { outcome, derived } = classifyDerivedCardSubstitute(row);

    expect(outcome).toBe('substitutable');
    expect(derived).toMatch(/^Investigates how tissue-resident memory T cells/);
  });

  it('refuses a derivation that is itself a biography', () => {
    const row = servedRow({
      shortDescription: 'Dr. Avery Lin holds a joint appointment in immunobiology.',
      fullDescription:
        'Research focuses on airway immunology. Dr. Avery Lin holds a joint appointment in ' +
        'immunobiology and was awarded the departmental teaching prize.',
    });

    expect(classifyDerivedCardSubstitute(row).outcome).toBe('derived_still_biography');
  });

  it('reports a body that yields no card at all rather than counting it as reachable', () => {
    const row = servedRow({
      shortDescription: CREDENTIAL_CARD,
      fullDescription:
        'Dr. Avery Lin was awarded the national mentoring prize and holds a joint appointment in ' +
        'immunobiology, and is one of the nation’s leading voices on vaccine policy.',
    });

    expect(classifyDerivedCardSubstitute(row).outcome).toBe('body_yields_nothing');
  });

  it('reports a card the body already derives rather than substituting it for itself', () => {
    const derivable = servedRow({
      shortDescription: CREDENTIAL_CARD,
      fullDescription: CREDENTIAL_LED_RESEARCH_BODY,
    });
    const { derived } = classifyDerivedCardSubstitute(derivable);

    expect(classifyDerivedCardSubstitute({ ...derivable, shortDescription: derived }).outcome).toBe(
      'derived_equals_card',
    );
  });

  it('does not count the mechanism as it stands today, because the gate accepts the biography', () => {
    const row = servedRow({
      shortDescription: CREDENTIAL_CARD,
      fullDescription: CREDENTIAL_LED_RESEARCH_BODY,
    });

    expect(unwidenedSubstituteReaches(row)).toBe(false);
    expect(classifyDerivedCardSubstitute(row).outcome).toBe('substitutable');
  });
});

describe('audit consistency', () => {
  it('sums the outcome buckets to the population', () => {
    const audit = buildBiographyCardReachability([
      servedRow({
        slug: 'reachable',
        shortDescription: CREDENTIAL_CARD,
        fullDescription: CREDENTIAL_LED_RESEARCH_BODY,
      }),
      servedRow({ slug: 'residue', shortDescription: CREDENTIAL_CARD, fullDescription: '' }),
      servedRow({ slug: 'not-in-population', shortDescription: RESEARCH_CARD }),
    ]);

    expect(audit.population).toBe(2);
    expect(audit.widenedSubstitute).toBe(1);
    expect(audit.unwidenedSubstitute).toBe(0);
    expect(audit.substitutableSlugs).toEqual(['reachable']);
    expect(() => assertBiographyCardReachabilityConsistent(audit)).not.toThrow();
  });

  it('refuses a split whose buckets do not account for every row', () => {
    const audit = buildBiographyCardReachability([
      servedRow({ slug: 'residue', shortDescription: CREDENTIAL_CARD, fullDescription: '' }),
    ]);

    expect(() =>
      assertBiographyCardReachabilityConsistent({ ...audit, population: audit.population + 1 }),
    ).toThrow(/population/);
  });
});
