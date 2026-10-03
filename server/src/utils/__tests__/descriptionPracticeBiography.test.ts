import { describe, expect, it } from 'vitest';
import { isPracticeBiographyWithoutResearch } from '../descriptionNonResearchBodyShape';
import {
  fullDescriptionQuality,
  shortDescriptionQuality,
} from '../researchEntityDescriptionQuality';

const clinicalPracticeBiography =
  'The clinician serves as a clinical lead at an outpatient psychiatry center. She also maintains a private practice focused on the treatment of mood and anxiety disorders in children, adolescents, and young adults.';

const hospitalPracticeBiography =
  "The physician's clinical interests are primarily in the diagnosis and management of children with congenital heart disease. He has a clinical practice at a children's hospital and has been a member of the medical staff since 1994.";

const lawPracticeBiography =
  'Before joining the faculty, the lecturer had a private practice focused on cross-border technology transactions for clients in the life sciences, and counseled clients on licensing and joint ventures.';

describe('isPracticeBiographyWithoutResearch (#4551)', () => {
  it('reads a clinician or lawyer practice biography with no research as practice only', () => {
    expect(isPracticeBiographyWithoutResearch(clinicalPracticeBiography)).toBe(true);
    expect(isPracticeBiographyWithoutResearch(hospitalPracticeBiography)).toBe(true);
    expect(isPracticeBiographyWithoutResearch(lawPracticeBiography)).toBe(true);
  });

  it('reads a practice setting that opens a sentence', () => {
    expect(
      isPracticeBiographyWithoutResearch(
        'Private practice in an example city focuses on the treatment of anxiety in adolescents. Board-certified in child and adolescent psychiatry.',
      ),
    ).toBe(true);
  });

  it('keeps a practice biography that also states research, publication or teaching', () => {
    for (const text of [
      `${clinicalPracticeBiography} Her research evaluates brief interventions for adolescent anxiety.`,
      `${hospitalPracticeBiography} He has published widely on fetal echocardiography.`,
      `${clinicalPracticeBiography} She teaches the residency seminar on psychotherapy.`,
      'Practice locations: the main campus. Research Fellowship: an academic medical center. Clinical interests: kidney stone surgery.',
    ]) {
      expect(isPracticeBiographyWithoutResearch(text)).toBe(false);
    }
  });

  it('does not read research on treatment as a practice biography', () => {
    expect(
      isPracticeBiographyWithoutResearch(
        'The proof of concept we are testing is that nanosphere delivery provides opportunities for the treatment of bladder disease, and we plan to create clinically viable complexes for treatment of the urinary tract.',
      ),
    ).toBe(false);
  });

  it('needs a statement of where the person practises', () => {
    expect(
      isPracticeBiographyWithoutResearch(
        'Clinical interests include the diagnosis and management of heart failure.',
      ),
    ).toBe(false);
  });

  it('refuses a practice-only body but never a card', () => {
    const body = fullDescriptionQuality(clinicalPracticeBiography);
    expect(body.isUseful).toBe(false);
    expect(body.flags).toContain('practice-biography');
    expect(shortDescriptionQuality(clinicalPracticeBiography, '').flags).not.toContain(
      'practice-biography',
    );
  });
});
