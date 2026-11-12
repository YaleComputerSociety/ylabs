import { describe, expect, it } from 'vitest';
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
  it('lists methods and every other field the microsite lanes derive from page text', () => {
    expect(fieldsOf(everyPageDerivedField(REFUSED_PAGE))).toEqual([
      'lab-microsite-description-llm/shortDescription',
      'lab-microsite-description-llm/researchAreas',
      'lab-microsite-description-llm/methods',
      'lab-microsite-undergrad-llm/undergradAccessEvidence',
      'lab-microsite-undergrad-llm/currentUndergradCount',
      'lab-microsite-undergrad-llm/pastUndergradAdvisees',
      'lab-microsite-undergrad-llm/undergradEvidenceQuote',
      'lab-microsite-undergrad-llm/joinPageUrl',
      'lab-microsite-undergrad-llm/undergradRoleEvidenceQuote',
      'lab-microsite-undergrad-llm/contactInstructionsQuote',
      'lab-microsite-undergrad-llm/undergradConstraintQuote',
    ]);
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
