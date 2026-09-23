import { describe, it, expect } from 'vitest';
import {
  biographySubjectPersonName,
  personSynthesisDescribesAnotherPerson,
} from '../researchHomeNameIdentityAuthority';
import { sanitizeServedResearchEntityCopyFields } from '../researchEntityDescriptionText';

const FOREIGN_FIRST_NAME_BIO =
  'Marlow Ashgate, MD, graduated from a liberal arts college with a B.A. in Psychology, then spent two years as a research trainee studying diagnostic tools for alcohol use disorder. Clinically, his interests lie in child and adolescent psychiatry and addiction psychiatry.';

const OWN_BIO =
  'Marlow Tiverton is a geologist whose work examines the tectonic and geomorphic evolution of convergent plate boundaries, combining low-temperature thermochronology with landscape-evolution modelling.';

const OWN_BODY =
  'The Marlow Lab studies the tectonic and geomorphic evolution of convergent plate boundaries, and investigates low-temperature deformational processes such as faulting and pressure solution.';

const labRow = (synthesis: string, shortDescription = 'Studies convergent plate boundaries.') => ({
  slug: 'marlow-lab-mtv4',
  name: 'Marlow Lab',
  displayName: 'Marlow Lab',
  entityType: 'LAB',
  kind: 'lab',
  fullDescription: OWN_BODY,
  shortDescription,
  profileSynthesisDescription: synthesis,
});

describe('biographySubjectPersonName', () => {
  it('names the subject only from the opening sentence', () => {
    expect(biographySubjectPersonName(FOREIGN_FIRST_NAME_BIO)).toBe('Marlow Ashgate');
    expect(
      biographySubjectPersonName(
        'In 1991, he edited a collection entitled Grand Strategies in War and Peace. Paul Kennedy has since written about naval power.',
      ),
    ).toBe('');
  });
});

describe('personSynthesisDescribesAnotherPerson', () => {
  it('refuses a biography whose surname is foreign but whose first name collides', () => {
    expect(
      personSynthesisDescribesAnotherPerson({
        description: FOREIGN_FIRST_NAME_BIO,
        name: 'Marlow Lab',
        slug: 'marlow-lab-mtv4',
      }),
    ).toBe(true);
  });

  it("keeps the record's own biography, from the lead name or from the record's own", () => {
    expect(
      personSynthesisDescribesAnotherPerson({
        description: OWN_BIO,
        name: 'Marlow Lab',
        slug: 'marlow-lab-mtv4',
        personName: 'Marlow Tiverton',
      }),
    ).toBe(false);
    expect(
      personSynthesisDescribesAnotherPerson({
        description: OWN_BIO,
        name: 'Tiverton Lab',
        slug: 'tiverton-lab-mtv4',
        personName: 'Marlow Tiverton',
      }),
    ).toBe(false);
  });

  it('folds diacritics on both sides so an accented surname is still the same person', () => {
    expect(
      personSynthesisDescribesAnotherPerson({
        description:
          'Martin Hägglund specializes in post-Kantian philosophy, critical theory, and modernist literature.',
        name: 'Martin Hagglund - Research',
        slug: 'hagglund-mh765',
      }),
    ).toBe(false);
  });

  it('stays silent when no name token is shared, rather than refusing every absent surname', () => {
    expect(
      personSynthesisDescribesAnotherPerson({
        description: OWN_BIO,
        name: 'Leitner Family Observatory',
        slug: 'observatory-obs1',
      }),
    ).toBe(false);
  });
});

describe('the served surface', () => {
  it('withholds the foreign biography and keeps the row’s own body and card', () => {
    const served = sanitizeServedResearchEntityCopyFields(labRow(FOREIGN_FIRST_NAME_BIO), []);
    expect(served.profileSynthesisDescription).toBe('');
    expect(served.fullDescription).toContain('convergent plate boundaries');
    expect(served.shortDescription).toContain('convergent plate boundaries');
  });

  it('withholds a card that is itself the refused biography', () => {
    const card = 'Marlow Ashgate, MD, graduated from a liberal arts college with a B.A.';
    const served = sanitizeServedResearchEntityCopyFields(labRow(FOREIGN_FIRST_NAME_BIO, card), []);
    expect(served.profileSynthesisDescription).toBe('');
    expect(served.shortDescription).toBe('');
  });
});
