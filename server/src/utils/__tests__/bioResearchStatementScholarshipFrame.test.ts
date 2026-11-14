import { describe, expect, it } from 'vitest';
import {
  deriveBioResearchStatement,
  isClinicalOnlyBiographySentence,
} from '../bioResearchStatement';

const refuses = (sentence: string) => expect(isClinicalOnlyBiographySentence(sentence)).toBe(true);
const keeps = (sentence: string) => expect(isClinicalOnlyBiographySentence(sentence)).toBe(false);

const SCHOLAR_INTEREST = 'whose special interest is in madness and medicine.';

describe('a sentence that opens by naming its person a humanities or social-science scholar (#6245)', () => {
  it.each([
    `She is a historian ${SCHOLAR_INTEREST}`,
    `He is a philosopher ${SCHOLAR_INTEREST}`,
    `She is an anthropologist ${SCHOLAR_INTEREST}`,
    `He is a sociologist ${SCHOLAR_INTEREST}`,
    `She is a theologian ${SCHOLAR_INTEREST}`,
    `He is a classicist ${SCHOLAR_INTEREST}`,
    `They are historians ${SCHOLAR_INTEREST}`,
    `He was a historian ${SCHOLAR_INTEREST}`,
    `She is also an intellectual historian ${SCHOLAR_INTEREST}`,
    'As a historian, her special interest is in madness and medicine.',
  ])('keeps %s', (sentence) => keeps(sentence));

  it('keeps a historian of medicine as research evidence in a derived statement', () => {
    const statement = deriveBioResearchStatement(
      'She is an intellectual historian of the ancient world, with a particular interest in the entanglements between medicine and theology.',
    );
    expect(statement.evidenceSentences).toHaveLength(1);
  });

  it('exempts the scholar before the condition-list path reads the list', () => {
    keeps('She is a historian whose special interests include cholera, syphilis and tuberculosis.');
  });
});

describe('a scholar role anywhere but the opening, or as a possessive, is not the person (#6245)', () => {
  it.each([
    'Her special interest is in skin disease; she is also a historian.',
    'Her special interest is in skin disease, and she is a historian.',
    'Her special interest is in skin disease; As a historian, she writes about it.',
    "She is a historian's daughter whose special interest is in skin disease.",
    'Dysphonia is a historian’s most common complaint, and her special interest is in voice disease.',
  ])('refuses %s', (sentence) => refuses(sentence));
});

describe('a scholar who also names clinical work or a clinician stays refused (#6245)', () => {
  it.each([
    'physician',
    'surgeon',
    'psychiatrist',
    'clinician',
    'nurse',
    'practitioner',
    'doctor',
    'pediatrician',
    'therapist',
    'cardiologist',
    'dermatologist',
    'neurologist',
    'oncologist',
    'urologist',
    'laryngologist',
    'ophthalmologist',
    'rheumatologist',
    'radiologist',
    'anesthesiologist',
  ])('refuses a historian and %s', (clinician) =>
    refuses(`She is a historian and ${clinician} whose special interest is in skin disease.`),
  );

  it.each([
    'She is a historian whose special interest is in skin disease at the clinic.',
    'She is a historian whose special interest is in skin disease in clinical settings.',
    'She is a historian whose special interest is in skin disease in medical practice.',
    'She is a historian whose special interest is in skin disease, which she practices on daily.',
    'As a historian of medicine, her special interest is in hernia repair in patients.',
    'As a historian of medicine, her special interest is in breast reconstruction in patients.',
    'As a historian of medicine, her special interest is in spine surgery in patients.',
    'As a historian of medicine, her special interest is in cardiac procedures in patients.',
    'As a historian of medicine, her special interest is in dental implants in patients.',
    'As a historian of medicine, her special interest is in kidney transplantation in patients.',
    'As a historian of medicine, her special interest is in skin biopsies in patients.',
    'As a historian of medicine, her special interest is in steroid injections in patients.',
    'As a historian of medicine, her special interest is in appendectomy in patients.',
    'As a historian of medicine, her special interest is in rhinoplasty in patients.',
  ])('refuses %s', (sentence) => refuses(sentence));
});

describe('a scholar who describes patient care stays refused (#6245)', () => {
  it.each([
    'treats',
    'cares for',
    'care for',
    'caring for',
    'cared for',
    'sees',
    'seeing',
    'saw',
    'has seen',
    'manages',
    'performs scans on',
    'operates on',
    'consults on',
    'provides help for',
    'delivers help for',
    'offers help for',
  ])('refuses a historian who %s skin disease', (verb) =>
    refuses(
      `She is a historian whose special interest is in skin disease, which she ${verb} daily.`,
    ),
  );

  it('refuses historians who see skin disease', () =>
    refuses(
      'They are historians whose special interest is in skin disease, which they see daily.',
    ));
});

describe('creative practice, which the owner counts as research, stays exempt', () => {
  it('keeps a composer whose work is about illness', () => {
    keeps('Her special interest is in composing music for patients in hospice care.');
  });
});
