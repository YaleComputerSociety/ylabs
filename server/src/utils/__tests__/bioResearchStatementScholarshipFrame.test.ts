import { describe, expect, it } from 'vitest';
import {
  deriveBioResearchStatement,
  isClinicalOnlyBiographySentence,
} from '../bioResearchStatement';

const refuses = (sentence: string) => expect(isClinicalOnlyBiographySentence(sentence)).toBe(true);
const keeps = (sentence: string) => expect(isClinicalOnlyBiographySentence(sentence)).toBe(false);

const SCHOLAR_INTEREST = 'whose special interest is in madness and medicine.';
const CLINICAL_INTEREST = 'whose special interest is in skin disease';

describe('a sentence that opens by naming its person a humanities or social-science scholar (#6245)', () => {
  it.each([
    `She is a historian ${SCHOLAR_INTEREST}`,
    `He is a philosopher ${SCHOLAR_INTEREST}`,
    `She is an anthropologist ${SCHOLAR_INTEREST}`,
    `He is a sociologist ${SCHOLAR_INTEREST}`,
    `She is a theologian ${SCHOLAR_INTEREST}`,
    `He is a classicist ${SCHOLAR_INTEREST}`,
    `He was a historian ${SCHOLAR_INTEREST}`,
    `She is also a historian ${SCHOLAR_INTEREST}`,
    `She is an early modern historian ${SCHOLAR_INTEREST}`,
    'As a historian, her special interest is in madness and medicine.',
    'As an anthropologist, her special interest is in madness and medicine.',
  ])('keeps %s', (sentence) => keeps(sentence));

  it('keeps a historian of medicine as research evidence in a derived statement', () => {
    const statement = deriveBioResearchStatement(
      'She is an intellectual historian of the ancient world, with a particular interest in the entanglements between medicine and theology.',
    );
    expect(statement.evidenceSentences).toHaveLength(1);
  });

  it('leaves a scholar’s bare condition list to the condition-list path, as before', () => {
    refuses(
      'She is a historian whose special interests include cholera, syphilis and tuberculosis.',
    );
    refuses(
      'He is also a medical sociologist; his special interests include acne scarring and rosacea.',
    );
  });
});

describe('a scholar role that does not name the bio’s own person is not the exemption (#6245)', () => {
  it.each([
    `Her special interest is in skin disease; she is also a historian.`,
    `Her special interest is in skin disease, and she is a historian.`,
    `Her special interest is in skin disease; As a historian, she writes about it.`,
    `She is a historian’s daughter ${CLINICAL_INTEREST}.`,
    `She is a historian's daughter ${CLINICAL_INTEREST}.`,
    `She is a historian-turned-coach ${CLINICAL_INTEREST}.`,
    `She is a very well known historian ${CLINICAL_INTEREST}.`,
    `They are philosophers, and his special interests include acne scarring and rosacea.`,
    `She is historian ${CLINICAL_INTEREST}.`,
  ])('refuses %s', (sentence) => refuses(sentence));

  it.each(['for', 'to', 'of', 'on', 'in', 'with', 'at', 'among', 'by', 'from', 'and', 'or'])(
    'refuses a role reached through "%s" in the filler',
    (word) => refuses(`She is a coach ${word} historian ${CLINICAL_INTEREST}.`),
  );
});

describe('a scholar who also names clinical work or a clinician stays refused (#6245)', () => {
  it.each([
    'physician',
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
    'otolaryngologist',
    'dentist',
    'optometrist',
    'pharmacist',
    'midwife',
    'chiropractor',
  ])('refuses a historian who is also a %s', (clinician) =>
    refuses(`She is a historian ${CLINICAL_INTEREST}; she is also a ${clinician}.`),
  );

  it.each([
    `She is a historian ${CLINICAL_INTEREST}, working with midwives.`,
    `She is a historian ${CLINICAL_INTEREST} at the clinic.`,
    `She is a historian ${CLINICAL_INTEREST} in clinical settings.`,
    `She is a historian ${CLINICAL_INTEREST} in medical practice.`,
    `She is a historian ${CLINICAL_INTEREST}, which she practices on daily.`,
    `She is a historian ${CLINICAL_INTEREST}, which she practised for years.`,
    `She is a historian ${CLINICAL_INTEREST}, practicing on patients.`,
    `She is a historian ${CLINICAL_INTEREST}, practising on patients.`,
    `She is a historian ${CLINICAL_INTEREST}. Physician by training.`,
    'As a historian of medicine, her special interest is in hernia repair in patients.',
    'As a historian of medicine, her special interest is in breast reconstruction in patients.',
    'As a historian of medicine, her special interest is in reconstructive work in patients.',
    'As a historian of medicine, her special interest is in surgical wounds in patients.',
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
    'treating',
    'treated',
    'cares for',
    'care for',
    'caring for',
    'cared for',
    'see',
    'sees',
    'seeing',
    'has seen',
    'saw',
    'manages',
    'managing',
    'managed',
    'performs scans on',
    'performing scans on',
    'operates on',
    'operating on',
    'consults on',
    'consulting on',
    'provides help for',
    'providing help for',
    'delivers help for',
    'delivering help for',
    'offers help for',
    'offering help for',
  ])('refuses a historian who %s skin disease', (verb) =>
    refuses(`She is a historian ${CLINICAL_INTEREST}, which she ${verb} daily.`),
  );

  it('reads a care verb in any case', () => {
    refuses(`She is a historian ${CLINICAL_INTEREST}. Treats it daily.`);
  });
});

describe('creative practice, which the owner counts as research, stays exempt', () => {
  it('keeps a composer whose work is about illness', () => {
    keeps('Her special interest is in composing music for patients in hospice care.');
  });
});
