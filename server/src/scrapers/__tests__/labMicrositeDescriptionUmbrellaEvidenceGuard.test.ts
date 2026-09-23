/**
 * #3148: a page that is the sole citation of more than one row is not about any of
 * them, and no check on the page's TEXT can tell it apart from a lab's own homepage
 * because a school's research landing page reads as good research prose.
 *
 * The chip-list and navigation cases here are the other two shapes the same
 * `--explain` read found being planned as bodies: both pass a length check, and the
 * first is a value the visibility gate can never accept.
 */
import { describe, expect, it } from 'vitest';
import {
  descriptionExtractionToObservations,
  isInterestChipListText,
  opensOnNavigationChrome,
  type DescriptionExtraction,
} from '../sources/labMicrositeDescriptionLLMExtractor';
import { NO_SURNAME_ROSTER } from '../../utils/researchHomeNameIdentityAuthority';

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

describe('shared sole-evidence guard (#3148)', () => {
  it('emits nothing from a page that is the only citation of more than one row', () => {
    expect(
      descriptionExtractionToObservations(landingExtraction(), {
        ...baseContext,
        sharedSoleEvidenceUrl: true,
      }),
    ).toEqual([]);
  });

  it('adopts the same prose when the page is that row alone cited page', () => {
    const observations = descriptionExtractionToObservations(landingExtraction(), {
      ...baseContext,
      sharedSoleEvidenceUrl: false,
    });
    expect(observations.find((obs) => obs.field === 'fullDescription')?.value).toBe(
      SCHOOL_LANDING_PROSE,
    );
  });

  it('refuses on the evidence even when the page names itself plausibly', () => {
    expect(
      descriptionExtractionToObservations(
        { ...landingExtraction(), name: 'Center for Translational Discovery' },
        { ...baseContext, sharedSoleEvidenceUrl: true },
      ),
    ).toEqual([]);
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
        { ...baseContext, sharedSoleEvidenceUrl: false },
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
        { ...baseContext, sharedSoleEvidenceUrl: false },
      ),
    ).toEqual([]);
  });
});
