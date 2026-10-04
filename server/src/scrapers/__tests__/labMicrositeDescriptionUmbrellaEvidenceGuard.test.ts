/**
 * #3148: a page cited by more than one row is not about any single one of them, and
 * no check on the page's TEXT can tell it apart from a lab's own homepage because a
 * school's research landing page reads as good research prose.
 *
 * The person-page exemption is the reason sharing alone cannot decide it: a person's
 * own profile is cited by both their `LAB` and their research-area row and describes
 * both. Narrowing the rule to a page that is a row's SOLE citation was tried instead
 * and measured, and it left two rows still receiving one landing page's blurb.
 *
 * The chip-list and navigation cases here are the other two shapes the same
 * `--explain` read found being planned as bodies: both pass a length check, and the
 * first is a value the visibility gate can never accept.
 */
import { describe, expect, it } from 'vitest';
import {
  descriptionExtractionToObservations,
  isInterestChipListText,
  isProfileTemplateChrome,
  opensOnNavigationChrome,
  type DescriptionExtraction,
} from '../sources/labMicrositeDescriptionLLMExtractor';
import { NO_SURNAME_ROSTER } from '../../utils/researchHomeNameIdentityAuthority';
import { DESCRIPTION_SOURCE_MIN_FOREIGN_CITERS } from '../descriptionSourceOwnership';

const SCHOOL_LANDING_PAGE = 'https://medicine.yale.edu/research/';

const SCHOOL_LANDING_PROSE =
  'Yale School of Medicine research spans the full spectrum of discovery, from fundamental studies of cells and molecules to translational science, clinical investigation, and trials that bring new therapies to patients.';

const landingExtraction = (): DescriptionExtraction => ({
  fullDescription: SCHOOL_LANDING_PROSE,
  shortDescription: 'Research spanning discovery through clinical trials.',
  topics: ['translational science'],
  methods: [],
  name: '',
});

const baseContext = {
  knownPersonSurnames: NO_SURNAME_ROSTER,
  entityId: 'entity-a',
  entityKey: 'dept-african-studies-example-row',
  entityType: 'FACULTY_RESEARCH_AREA',
  kind: 'faculty_research_area',
  sourceUrl: SCHOOL_LANDING_PAGE,
};

describe('shared-evidence guard (#3148)', () => {
  it('emits nothing from a page two other rows cite', () => {
    expect(
      descriptionExtractionToObservations(landingExtraction(), {
        ...baseContext,
        sharedEvidenceUrl: true,
        descriptionSourceForeignCiters: 2,
      }),
    ).toEqual([]);
  });

  it('describes a row from a page one other row cites, on the ingest bar, but asserts no name from it (#3740)', () => {
    const observations = descriptionExtractionToObservations(
      { ...landingExtraction(), name: 'Center for Translational Discovery' },
      { ...baseContext, sharedEvidenceUrl: true, descriptionSourceForeignCiters: 1 },
    );
    expect(observations.find((obs) => obs.field === 'fullDescription')?.value).toBe(
      SCHOOL_LANDING_PROSE,
    );
    expect(observations.some((obs) => obs.field === 'name' || obs.field === 'displayName')).toBe(
      false,
    );
  });

  it('holds the lane to the same citer bar as the ingest ownership guard (#3740)', () => {
    expect(DESCRIPTION_SOURCE_MIN_FOREIGN_CITERS).toBe(2);
    const at = (descriptionSourceForeignCiters: number) =>
      descriptionExtractionToObservations(landingExtraction(), {
        ...baseContext,
        descriptionSourceForeignCiters,
      }).length > 0;
    expect(at(DESCRIPTION_SOURCE_MIN_FOREIGN_CITERS - 1)).toBe(true);
    expect(at(DESCRIPTION_SOURCE_MIN_FOREIGN_CITERS)).toBe(false);
  });

  it('adopts the same prose when no other row cites the page', () => {
    const observations = descriptionExtractionToObservations(landingExtraction(), {
      ...baseContext,
      sharedEvidenceUrl: false,
    });
    expect(observations.find((obs) => obs.field === 'fullDescription')?.value).toBe(
      SCHOOL_LANDING_PROSE,
    );
  });

  it('refuses on the evidence even when the page names itself plausibly', () => {
    expect(
      descriptionExtractionToObservations(
        { ...landingExtraction(), name: 'Center for Translational Discovery' },
        { ...baseContext, sharedEvidenceUrl: true, descriptionSourceForeignCiters: 3 },
      ),
    ).toEqual([]);
  });

  it('exempts a person profile, which a lab row and a research-area row both cite', () => {
    const observations = descriptionExtractionToObservations(
      {
        ...landingExtraction(),
        fullDescription:
          'Research on materials properties in connection to the dynamics and evolution of Earth and other terrestrial planets, combining mineral physics with geodynamic modelling.',
      },
      {
        ...baseContext,
        sourceUrl: 'https://earth.yale.edu/profile/example-person',
        sharedEvidenceUrl: true,
      },
    );
    expect(observations.map((obs) => obs.field)).toContain('fullDescription');
  });
});

describe('interest chip list refusal (#3148)', () => {
  it('recognises a labelled chip run with no predicate', () => {
    expect(
      isInterestChipListText(
        'Research Interests: Geophysical and geological fluid dynamics Continuum mechanics Multiphase and multicomponent physics Shear localization and damage theory',
      ),
    ).toBe(true);
  });

  it('leaves a real body that introduces itself with the same label', () => {
    expect(
      isInterestChipListText(
        'Research interests: my group studies how shear localization and damage theory explain the initiation of plate tectonics on rocky planets.',
      ),
    ).toBe(false);
  });

  it('leaves an unlabelled body alone', () => {
    expect(isInterestChipListText('We study the regulation of ion channels in the cortex.')).toBe(
      false,
    );
  });

  it('emits nothing for a chip run reaching the observation builder', () => {
    expect(
      descriptionExtractionToObservations(
        {
          ...landingExtraction(),
          fullDescription:
            'Research Interests: Geophysical and geological fluid dynamics Continuum mechanics Multiphase and multicomponent physics Shear localization and damage theory',
        },
        { ...baseContext, sharedEvidenceUrl: false },
      ),
    ).toEqual([]);
  });
});

describe('navigation chrome refusal (#3148)', () => {
  it('recognises a body that opens on the page menu', () => {
    expect(
      opensOnNavigationChrome(
        'Main Menu Sub Menu home publications Research people alum/theses Outreach contact links Welcome Current Research Projects We are studying the electrical and electrothermal dynamics of graphene.',
      ),
    ).toBe(true);
  });

  it('leaves prose that discusses a skip link further in alone', () => {
    expect(
      opensOnNavigationChrome(
        'Our group studies how assistive technology changes the way blind users navigate the web. We have measured that the phrase Skip to main content is announced inconsistently across browsers.',
      ),
    ).toBe(false);
  });

  it('emits nothing for a menu-led body reaching the observation builder', () => {
    expect(
      descriptionExtractionToObservations(
        {
          ...landingExtraction(),
          fullDescription:
            'Main Menu Sub Menu home publications Research people alum/theses Outreach contact links Welcome Current Research Projects We are studying the electrical and electrothermal dynamics of graphene in order to explore device applications.',
        },
        { ...baseContext, sharedEvidenceUrl: false },
      ),
    ).toEqual([]);
  });
});

describe('profile template chrome refusal (#4048)', () => {
  it('recognises the MeSH chip run and the co-author panel of a title-only profile', () => {
    expect(
      isProfileTemplateChrome(
        'Medical Research Interests Asthma; Pediatrics; Respiration Disorders ORCID 0000-0000-0000-0000',
      ),
    ).toBe(true);
    expect(
      isProfileTemplateChrome(
        'Research Overview Medical Research Interests Lung Research at a Glance Yale Co-Authors Frequent collaborators of a fixture person.',
      ),
    ).toBe(true);
    expect(
      isProfileTemplateChrome(
        'Research at a Glance Yale Co-Authors Frequent collaborators of a fixture person published research.',
      ),
    ).toBe(true);
  });

  it('leaves a research body that names medical research in passing alone', () => {
    expect(
      isProfileTemplateChrome(
        'The lab studies how platelets contribute to alcohol-associated liver disease, and its medical research interests span thrombosis and inflammation.',
      ),
    ).toBe(false);
  });

  it('emits nothing for profile chrome reaching the observation builder', () => {
    expect(
      descriptionExtractionToObservations(
        {
          ...landingExtraction(),
          fullDescription:
            'Medical Research Interests Blood Platelets; Liver Diseases; Liver Diseases, Alcoholic ORCID 0000-0000-0000-0000',
        },
        { ...baseContext, sourceUrl: 'https://medicine.yale.edu/profile/fixture-person/' },
      ),
    ).toEqual([]);
  });
});
