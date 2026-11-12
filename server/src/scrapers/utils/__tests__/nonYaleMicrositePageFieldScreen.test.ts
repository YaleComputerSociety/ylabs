import { describe, expect, it } from 'vitest';
import { NO_SURNAME_ROSTER } from '../../../utils/researchHomeNameIdentityAuthority';
import { descriptionExtractionToObservations } from '../../sources/labMicrositeDescriptionLLMExtractor';
import { extractionToObservations } from '../../sources/labMicrositeUndergradLLMExtractor';
import {
  MICROSITE_PAGE_DERIVED_FIELDS_BY_SOURCE,
  withoutRefusedNonYaleMicrositeDescriptions,
  withoutRefusedNonYaleMicrositePageFields,
} from '../nonYaleMicrositeDescriptionScreen';

const LEAD_NAMES = ['Quillon Varnadore'];
const REFUSED_PAGE = 'https://coastal-foundation.example.org/about';
const SURNAME_PAGE = 'https://varnadorelab.example.org/research';
const YALE_PAGE = 'https://medicine.yale.edu/lab/estuary/';

const everyPageDerivedField = (sourceUrl: string) =>
  [...MICROSITE_PAGE_DERIVED_FIELDS_BY_SOURCE].flatMap(([sourceName, fields]) =>
    [...fields].map((field) => ({
      sourceName,
      field,
      value: field === 'currentUndergradCount' ? 3 : ['sediment coring'],
      sourceUrl,
    })),
  );

const fieldsOf = (observations: { sourceName: string; field: string }[]) =>
  observations.map((observation) => `${observation.sourceName}/${observation.field}`);

describe('the non-Yale microsite page-field screen (#5920)', () => {
  const REFUSED_HOME = 'https://coastal-foundation.example.org/';
  const REFUSED_JOIN = 'https://coastal-foundation.example.org/join';
  const REFUSED_PEOPLE = 'https://coastal-foundation.example.org/people';

  const laneOutputOnRefusedSite = () => [
    ...descriptionExtractionToObservations(
      {
        fullDescription:
          'The group studies how estuarine sediment moves during storm surges, combining tidal marsh cores with channel erosion models to forecast shoreline change.',
        shortDescription:
          'Investigates how estuarine sediment moves during storm surges and forecasts shoreline change.',
        topics: ['coastal sediment transport', 'salt marsh carbon storage'],
        methods: ['sediment coring', 'isotope ratio mass spectrometry'],
        name: 'Coastal Foundation',
      },
      {
        sourceUrl: REFUSED_HOME,
        entityKey: 'estuary-page-field-oracle',
        entityType: 'FACULTY_RESEARCH_AREA',
        knownPersonSurnames: NO_SURNAME_ROSTER,
      },
    ).map((observation) => ({ ...observation, sourceName: 'lab-microsite-description-llm' })),
    ...extractionToObservations(
      'estuary-page-field-oracle',
      REFUSED_HOME,
      {
        openToUndergrads: 'yes',
        currentUndergradCount: 1,
        currentUndergradEvidenceQuotes: ['Riley Example, Yale College'],
        evidenceQuote: 'We welcome students.',
        evidenceSource: 'explicit_text',
        joinPageUrl: REFUSED_JOIN,
        undergradRoleQuote: 'Undergraduates help collect data.',
        contactInstructionsQuote: 'Apply using the form on this page.',
        explicitConstraintQuote: 'Prior Python experience preferred.',
      },
      new Date('2026-04-27T12:00:00Z'),
      {
        sourcePages: [
          {
            url: REFUSED_HOME,
            text: 'We welcome students. Undergraduates help collect data. Apply using the form on this page. Prior Python experience preferred.',
          },
          { url: REFUSED_JOIN, text: 'Join the lab. Undergraduates are welcome.' },
          { url: REFUSED_PEOPLE, text: 'People Riley Example, Yale College' },
        ],
      },
    ).map((observation) => ({ ...observation, sourceName: 'lab-microsite-undergrad-llm' })),
  ];

  it('drops every field both lanes emit for a refused site except those the docs exclude', () => {
    const documentedExclusions = new Set([
      'lab-microsite-description-llm/fullDescription',
      'lab-microsite-description-llm/description',
      'lab-microsite-description-llm/entityType',
      'lab-microsite-description-llm/kind',
      'lab-microsite-description-llm/name',
      'lab-microsite-description-llm/displayName',
      'lab-microsite-undergrad-llm/fullDescription',
      'lab-microsite-undergrad-llm/shortDescription',
      'lab-microsite-undergrad-llm/sourceContentHash',
      'lab-microsite-undergrad-llm/lanePageHealth',
      'lab-microsite-undergrad-llm/lastObservedAt',
    ]);
    const emitted = laneOutputOnRefusedSite();
    const kept = fieldsOf(withoutRefusedNonYaleMicrositePageFields(emitted, LEAD_NAMES));
    expect(kept.filter((field) => !documentedExclusions.has(field))).toEqual([]);
    expect(fieldsOf(emitted).filter((field) => !kept.includes(field))).toEqual(
      expect.arrayContaining([
        'lab-microsite-description-llm/shortDescription',
        'lab-microsite-description-llm/researchAreas',
        'lab-microsite-description-llm/methods',
        'lab-microsite-undergrad-llm/undergradAccessEvidence',
        'lab-microsite-undergrad-llm/currentUndergradCount',
        'lab-microsite-undergrad-llm/joinPageUrl',
        'lab-microsite-undergrad-llm/undergradRoleEvidenceQuote',
        'lab-microsite-undergrad-llm/contactInstructionsQuote',
        'lab-microsite-undergrad-llm/undergradConstraintQuote',
      ]),
    );
  });

  it('a surname in a URL inside a lane value does not confirm the page', () => {
    const observations = [
      {
        sourceName: 'lab-microsite-undergrad-llm',
        field: 'undergradAccessEvidence',
        value: {
          openToUndergrads: 'yes',
          evidenceQuote: 'We welcome students.',
          sourceUrls: [REFUSED_HOME, 'https://coastal-foundation.example.org/people/varnadore'],
          quoteSourceUrl: 'https://coastal-foundation.example.org/people/varnadore',
          joinPageUrl: 'https://coastal-foundation.example.org/varnadore-join',
        },
        sourceUrl: REFUSED_HOME,
      },
      {
        sourceName: 'lab-microsite-undergrad-llm',
        field: 'joinPageUrl',
        value: 'https://coastal-foundation.example.org/varnadore-join',
        sourceUrl: REFUSED_HOME,
      },
    ];
    expect(withoutRefusedNonYaleMicrositePageFields(observations, LEAD_NAMES)).toEqual([]);
  });

  it("a sub-page's fields are kept when another page on the same site names the lead", () => {
    const subPageFields = [
      {
        sourceName: 'lab-microsite-undergrad-llm',
        field: 'undergradEvidenceQuote',
        value: 'Undergraduates are welcome to join the group each semester.',
        sourceUrl: REFUSED_JOIN,
      },
      {
        sourceName: 'lab-microsite-undergrad-llm',
        field: 'joinPageUrl',
        value: REFUSED_JOIN,
        sourceUrl: REFUSED_JOIN,
      },
      {
        sourceName: 'lab-microsite-undergrad-llm',
        field: 'currentUndergradCount',
        value: 2,
        sourceUrl: REFUSED_PEOPLE,
      },
    ];
    const homePageText = {
      sourceName: 'research-page-text',
      field: 'researchPageText',
      value: [{ url: REFUSED_HOME, text: 'Directed by Quillon Varnadore.' }],
      sourceUrl: REFUSED_HOME,
    };
    const otherSiteText = {
      ...homePageText,
      value: [{ url: SURNAME_PAGE, text: 'Directed by Quillon Varnadore.' }],
      sourceUrl: SURNAME_PAGE,
    };
    expect(
      withoutRefusedNonYaleMicrositePageFields(subPageFields, LEAD_NAMES, [
        ...subPageFields,
        homePageText,
      ]),
    ).toEqual(subPageFields);
    expect(
      withoutRefusedNonYaleMicrositePageFields(subPageFields, LEAD_NAMES, [
        ...subPageFields,
        otherSiteText,
      ]),
    ).toEqual([]);
  });

  it('a refused page supplies none of those fields', () => {
    expect(
      withoutRefusedNonYaleMicrositePageFields(everyPageDerivedField(REFUSED_PAGE), LEAD_NAMES),
    ).toEqual([]);
  });

  it('a surname-carrying page and a Yale-hosted page supply all of them', () => {
    for (const page of [SURNAME_PAGE, YALE_PAGE]) {
      const observations = everyPageDerivedField(page);
      expect(withoutRefusedNonYaleMicrositePageFields(observations, LEAD_NAMES)).toEqual(
        observations,
      );
    }
  });

  it('a page whose stored text or sibling quote names the lead supplies them', () => {
    const observations = everyPageDerivedField(REFUSED_PAGE);
    const namingQuote = {
      sourceName: 'lab-microsite-undergrad-llm',
      field: 'contactInstructionsQuote',
      value: 'Email Quillon Varnadore to ask about openings.',
      sourceUrl: REFUSED_PAGE,
    };
    const storedPageText = {
      sourceName: 'research-page-text',
      field: 'researchPageText',
      value: [{ url: REFUSED_PAGE, text: 'Directed by Quillon Varnadore.' }],
      sourceUrl: REFUSED_PAGE,
    };
    expect(
      withoutRefusedNonYaleMicrositePageFields([...observations, namingQuote], LEAD_NAMES),
    ).toHaveLength(observations.length + 1);
    expect(
      withoutRefusedNonYaleMicrositePageFields(observations, LEAD_NAMES, [
        ...observations,
        storedPageText,
      ]),
    ).toEqual(observations);
  });

  it('leaves the description fields to the description screen and other lanes alone', () => {
    const untouched = [
      {
        sourceName: 'lab-microsite-description-llm',
        field: 'fullDescription',
        value: 'x',
        sourceUrl: REFUSED_PAGE,
      },
      {
        sourceName: 'lab-microsite-description-llm',
        field: 'description',
        value: 'x',
        sourceUrl: REFUSED_PAGE,
      },
      {
        sourceName: 'lab-microsite-description-llm',
        field: 'entityType',
        value: 'LAB',
        sourceUrl: REFUSED_PAGE,
      },
      {
        sourceName: 'lab-microsite-description-llm',
        field: 'name',
        value: 'Coastal Foundation',
        sourceUrl: REFUSED_PAGE,
      },
      {
        sourceName: 'lab-microsite-undergrad-llm',
        field: 'fullDescription',
        value: 'x',
        sourceUrl: REFUSED_PAGE,
      },
      {
        sourceName: 'lab-microsite-undergrad-llm',
        field: 'lastObservedAt',
        value: 'x',
        sourceUrl: REFUSED_PAGE,
      },
      {
        sourceName: 'dept-faculty-roster',
        field: 'methods',
        value: ['x'],
        sourceUrl: REFUSED_PAGE,
      },
    ];
    expect(withoutRefusedNonYaleMicrositePageFields(untouched, LEAD_NAMES)).toEqual(untouched);
  });

  it('keeps every field when the row has no lead name to check', () => {
    const observations = everyPageDerivedField(REFUSED_PAGE);
    expect(withoutRefusedNonYaleMicrositePageFields(observations, [])).toEqual(observations);
  });

  it('screening an already screened set is a no-op', () => {
    const observations = [
      ...everyPageDerivedField(REFUSED_PAGE),
      ...everyPageDerivedField(YALE_PAGE),
    ];
    const once = withoutRefusedNonYaleMicrositePageFields(observations, LEAD_NAMES);
    expect(withoutRefusedNonYaleMicrositePageFields(once, LEAD_NAMES)).toEqual(once);
    expect(withoutRefusedNonYaleMicrositeDescriptions(once, LEAD_NAMES)).toEqual(once);
  });
});
