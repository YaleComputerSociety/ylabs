import { describe, expect, it } from 'vitest';
import {
  deriveBioResearchStatement,
  isClinicalOnlyBiographySentence,
} from '../bioResearchStatement';

const refuses = (sentence: string) => expect(isClinicalOnlyBiographySentence(sentence)).toBe(true);
const keeps = (sentence: string) => expect(isClinicalOnlyBiographySentence(sentence)).toBe(false);

describe('the bio’s own person named as a humanities or social-science scholar (#6245)', () => {
  it.each([
    'He is a historian whose special interest is in the treatment of the insane.',
    'She is a medical anthropologist with a particular interest in the treatment of chronic disease.',
    'As a philosopher, her special interest is in the treatment of pain.',
  ])('keeps %s', (sentence) => keeps(sentence));

  it('exempts a scholar before the condition-list path reads the list', () => {
    keeps('She is a historian whose special interests include cholera, syphilis and tuberculosis.');
  });

  it('keeps a historian of medicine as research evidence in a derived statement', () => {
    const statement = deriveBioResearchStatement(
      'She is an intellectual historian of the ancient world, with a particular interest in the entanglements between medicine and theology.',
    );
    expect(statement.evidenceSentences).toHaveLength(1);
  });
});

describe('the bio’s own person named as a performer counts as creative practice (#6245)', () => {
  it.each([
    'As a pianist, her particular interest is in repertoire written for patients in palliative care.',
    'He is a conductor whose particular interest is in performing with hospital patients.',
    'She is a cellist with a particular interest in bringing live performance to patients in hospice care.',
  ])('keeps %s', (sentence) => keeps(sentence));
});

describe('a scholarly frame that governs the clinical word (#6245)', () => {
  it.each([
    'Her particular interest is in the history of psychiatric treatment.',
    'Her special interest is in the politics of patient advocacy movements.',
    'His special interest is in the theology of illness and disease.',
    'Her special interest is in the iconography of disease.',
    'His particular interest is in the political economy of medical care.',
    'Her special interest is in the social determinants of disease.',
  ])('keeps %s', (sentence) => keeps(sentence));

  it.each([
    'Her special interest is in the treatment of trauma in Holocaust testimony.',
    'His special interest is in the healing of disease in Hebrew scripture.',
    'Her special interest is in the treatment of disease in Greek tragedy.',
    'His special interest is in the treatment of injury in Norse myths.',
    'She has a particular interest in medicine in late antiquity.',
    'His special interest is in the care of the dying in Benedictine monasteries.',
    'He has a particular interest in the treatment of tuberculosis in nineteenth-century sanatoria.',
    'Her special interest is in the treatment of melancholy in early modern Europe.',
    'His special interest is in the care of lepers in medieval France.',
    'Her special interest is in the treatment of plague in renaissance Florence.',
    'His special interest is in the treatment of madness in victorian England.',
    'Her special interest is in the treatment of disease in colonial Africa.',
  ])('keeps %s', (sentence) => keeps(sentence));
});

describe('clinical service that only borrows a scholarship word stays refused (#6245)', () => {
  it.each([
    'She cares for patients with a history of melanoma.',
    'His particular interest is in treating patients with a family history of colon cancer.',
    'She cares for patients with a personal history of melanoma.',
    'Her special interest is in the treatment of patients in the law enforcement community.',
    'His particular interest is in the art of minimally invasive surgery.',
    'Her special interest is in the treatment of patients with chronic pain.',
    'His special interest is in the management of trauma patients.',
    'Her special interest is in the treatment of singers and actors with voice disorders.',
    'His special interest is in the care of pianists and violinists with hand injuries.',
    'Her special interest is in the treatment of anthropologists and travelers with tropical infections.',
    'Her special interest is in expanding her surgical repertoire for patients with complex hernias.',
    'His special interest is in the treatment of conditions reported in the medical literature.',
    'She cares for patients with complex disease, addressing the social determinants of health.',
    'His special interest is in providing twenty-first-century care to patients with diabetes.',
    'Her special interest is in the treatment of patients in family law disputes.',
    'He is a psychiatrist and philosopher who treats patients with depression.',
    'She is a medical humanist who cares for patients with cancer.',
    'His special interest is in the care of patients in the archives of the hospital record.',
    'Her special interest is in the representation of patients in the care team.',
    'He offers patients minimally invasive surgery, informed by the history of surgical technique.',
    'He is a historian of medicine whose special interest is in the treatment of tuberculosis among his patients.',
  ])('refuses %s', (sentence) => refuses(sentence));
});
