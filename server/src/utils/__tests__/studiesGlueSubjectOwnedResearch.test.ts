import { describe, expect, it } from 'vitest';
import {
  deriveShortDescriptionFromFullDescription,
  fullDescriptionQuality,
  shortDescriptionQuality,
} from '../researchEntityDescriptionQuality';

const BODY =
  "Robin Fixture's main interests lie in philosophy of language and metaphysics. Among her current areas of research are the semantics of modality and the nature of context.";

describe('a card never glues "Studies" onto a sentence about the person\'s own research (#5685)', () => {
  it('does not derive "Studies <Name>\'s main interests lie in ..." from the body', () => {
    expect(deriveShortDescriptionFromFullDescription(BODY)).not.toMatch(/^Studies /);
  });

  it('still derives "Studies <field list>." when a possessive inside the list is not the subject', () => {
    expect(
      deriveShortDescriptionFromFullDescription(
        "Gender and women's work, labor, and family history in modern Europe. Fixture courses cover the industrial revolution.",
      ),
    ).toBe("Studies Gender and women's work, labor, and family history in modern Europe.");
  });

  it.each([
    "Studies Robin Fixture's main interests lie in philosophy of language and metaphysics.",
    'Studies her research focuses on fixture reef recovery after bleaching.',
    'Studies their work centers on fixture coastal sediment transport.',
  ])('refuses %j as malformed', (card) => {
    expect(shortDescriptionQuality(card, BODY).flags).toContain('malformed-generated-text');
  });

  it.each([
    "Studies Fixtureland's coastal history, river trade networks, and early harbour towns.",
    "Studies Earth's climate processes and evaluates uncertainty in fixture records.",
  ])('keeps a genuine possessive topic %j', (card) => {
    expect(shortDescriptionQuality(card, BODY).flags).not.toContain('malformed-generated-text');
  });
});

describe('a citation tail or review-service record is a fragment (#5685)', () => {
  it('flags a card that is a journal title and year after a closing quotation mark', () => {
    expect(
      shortDescriptionQuality('’ Fixture Studies in the Philosophy of Language, 2019.', BODY).flags,
    ).toContain('paper-fragment');
  });

  it('does not flag a full sentence that opens on a stray closing quotation mark', () => {
    expect(
      shortDescriptionQuality(
        '” The studies identified pathways that let coral larvae settle on damaged substrates.',
        BODY,
      ).flags,
    ).not.toContain('paper-fragment');
  });

  it('flags a body that opens on a peer-review service record', () => {
    expect(
      fullDescriptionQuality(
        'Reviewed the manuscript, “A Fixture Essay on Glaciers.” Studies in Fixture Literature. March 2012.',
      ).flags,
    ).toContain('paper-fragment');
  });
});
