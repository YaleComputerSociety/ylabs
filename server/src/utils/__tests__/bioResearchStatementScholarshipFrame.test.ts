import { describe, expect, it } from 'vitest';
import {
  deriveBioResearchStatement,
  isClinicalOnlyBiographySentence,
} from '../bioResearchStatement';

const refuses = (sentence: string) => expect(isClinicalOnlyBiographySentence(sentence)).toBe(true);
const keeps = (sentence: string) => expect(isClinicalOnlyBiographySentence(sentence)).toBe(false);

describe('a clinical word inside humanities or social-science scholarship is research (#6245)', () => {
  it.each([
    'Her special interest is in the treatment of trauma in Holocaust testimony.',
    'She is an intellectual historian with a particular interest in medicine and theology in late antiquity.',
    'He is an anthropologist with a particular interest in how patients and healers negotiate care in rural India.',
    'Her particular interest is in the history of psychiatric treatment in colonial Africa.',
    'His special interest is in the representation of disease in Victorian fiction.',
    'Her special interest is in the politics of patient advocacy movements.',
    'He has a particular interest in the treatment of tuberculosis in nineteenth-century sanatoria.',
    'She has a particular interest in the treatment of asylum seekers under international refugee law.',
    'His special interests include caring for patients with heart failure as a lens on the political economy of home health aides.',
  ])('keeps %s', (sentence) => keeps(sentence));

  it('keeps a historian of medicine as research evidence in a derived statement', () => {
    const statement = deriveBioResearchStatement(
      'She is an intellectual historian of the ancient world, with a particular interest in the entanglements between medicine and theology.',
    );
    expect(statement.evidenceSentences).toHaveLength(1);
  });
});

describe('a performer counts as creative practice (owner decision, #6245)', () => {
  it.each([
    'As a pianist, her particular interest is in repertoire written for patients in palliative care.',
    'He is a conductor whose particular interest is in performing with hospital patients.',
    'She is a cellist with a particular interest in bringing live performance to patients in hospice care.',
  ])('keeps %s', (sentence) => keeps(sentence));
});

describe('clinical service that only borrows a scholarship word stays refused (#6245)', () => {
  it.each([
    'She cares for patients with a history of melanoma.',
    'His particular interest is in treating patients with a family history of colon cancer.',
    'She provides care to patients with a past history of stroke.',
    'Her special interest is in the treatment of patients in the law enforcement community.',
    'His particular interest is in the art of minimally invasive surgery.',
    'Her special interest is in the treatment of patients with chronic pain.',
    'She provides compassionate care to patients with cancer.',
    'His special interest is in the management of trauma patients.',
  ])('refuses %s', (sentence) => refuses(sentence));
});
