import { describe, expect, it } from 'vitest';
import {
  DESCRIPTION_SLOT_FIELDS,
  descriptionSlotAttestation,
  withDescriptionSlotAttestation,
} from '../sources/labMicrositeDescriptionLLMExtractor';

const wholeRead = {
  primaryPageTextLength: 4_000,
  llmRan: true,
  crawlIncomplete: false,
  unopposedCrawledProseSuppressed: false,
  foreignLabPage: false,
};

describe('descriptionSlotAttestation', () => {
  it('attests empty when the page was read whole and offers no prose to assert', () => {
    expect(descriptionSlotAttestation(wholeRead)).toBe('empty');
  });

  it('makes no claim about a JS shell under the page-text floor', () => {
    expect(descriptionSlotAttestation({ ...wholeRead, primaryPageTextLength: 40 })).toBeUndefined();
  });

  it('makes no claim when the extraction never ran', () => {
    expect(descriptionSlotAttestation({ ...wholeRead, llmRan: false })).toBeUndefined();
  });

  it('makes no claim when a research subpage went unread', () => {
    expect(descriptionSlotAttestation({ ...wholeRead, crawlIncomplete: true })).toBeUndefined();
  });

  it('records a refusal, never an absence, when a guard kept the stored description', () => {
    expect(
      descriptionSlotAttestation({ ...wholeRead, unopposedCrawledProseSuppressed: true }),
    ).toBe('refused');
  });

  it('records a refusal when the page turned out to describe another person’s lab', () => {
    expect(descriptionSlotAttestation({ ...wholeRead, foreignLabPage: true })).toBe('refused');
  });

  it('prefers refused over empty, because a refusal is a claim about prose the page still carries', () => {
    expect(
      descriptionSlotAttestation({
        ...wholeRead,
        crawlIncomplete: true,
        foreignLabPage: true,
      }),
    ).toBe('refused');
  });
});

describe('withDescriptionSlotAttestation', () => {
  const observation = {
    entityType: 'researchEntity' as const,
    entityKey: 'fixture-row',
    field: 'sourceContentHash',
    value: 'abc',
    sourceUrl: 'https://example.edu/profile/example-person/',
  };

  it('carries assertsNoValueFor for both description fields on an empty attestation', () => {
    const [carried] = withDescriptionSlotAttestation([observation], 'empty');

    expect(carried.assertsNoValueFor).toEqual([...DESCRIPTION_SLOT_FIELDS]);
  });

  it('carries nothing on a refusal or on no claim', () => {
    expect(
      withDescriptionSlotAttestation([observation], 'refused')[0].assertsNoValueFor,
    ).toBeUndefined();
    expect(
      withDescriptionSlotAttestation([observation], undefined)[0].assertsNoValueFor,
    ).toBeUndefined();
  });

  it('leaves an empty observation list empty rather than inventing a carrier', () => {
    expect(withDescriptionSlotAttestation([], 'empty')).toEqual([]);
  });
});
