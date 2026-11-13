import { describe, expect, it } from 'vitest';
import {
  deriveBioResearchStatement,
  isClinicalOnlyBiographySentence,
} from '../bioResearchStatement';

const refuses = (sentence: string) => expect(isClinicalOnlyBiographySentence(sentence)).toBe(true);
const keeps = (sentence: string) => expect(isClinicalOnlyBiographySentence(sentence)).toBe(false);

describe('special-interests list of conditions or procedures (#6192)', () => {
  it.each([
    'Her special interests include eczema, psoriasis and chronic hand dermatitis.',
    'His special interests include tendinitis and bursitis.',
    'His special interests include trigger finger and tennis elbow.',
    'His particular interests include breast reconstruction and hernia repair.',
    'Her special interests include acne treatment and knee arthroscopy.',
    'His special interests include shoulder care and hip arthroplasty.',
    'Her special interests include the management of glaucoma and the treatment of cataracts.',
    'His special interests include children with scoliosis and adults with spinal stenosis.',
    'Her special interests include a history of recurrent kidney stones and gout.',
    'Her particular interests include metastatic breast cancer.',
    'Her special interests include but are not limited to eczema and psoriasis.',
  ])('refuses a list whose every item is a condition or procedure: %s', refuses);

  it.each([
    'His special interests include the history of medicine and the rise of hospitals.',
    'Her special interests include a history of public asylums and the law.',
    'Her particular interests include the cultural meanings of cancer in the twentieth century.',
    'Her particular interests include the Reconstruction era and the Gilded Age.',
    'His particular interests include Radical Reconstruction.',
    'Her special interests include water treatment and wastewater management.',
    'Her special interests include the management of coastal fisheries and the treatment of prisoners.',
    'His special interests include children with refugee status and adults with limited literacy.',
    'Her special interests include eczema and medieval law.',
    'His particular interests include trauma and loss.',
    'Her particular interests include the collective trauma of forced migration.',
    'His particular interests include empathy and nostalgia.',
    'Her particular interests include apoptosis and symbiosis.',
    'Her particular interests include the Roma.',
    'Her particular interests include GNOSIS.',
  ])('keeps a list with an item that is not a condition or procedure: %s', keeps);

  it('refuses an interests-include-treating list of conditions', () => {
    refuses('Her interests include treating rosacea, melasma and adult acne.');
  });

  it('keeps an interests-include-managing list that names no condition', () => {
    keeps('His interests include managing urban forests and river basins.');
  });
});

describe('special interest in the management of conditions (#6192)', () => {
  it('refuses when every managed item is a condition', () => {
    refuses('His special interest is in the management of glaucoma and cataracts.');
  });

  it.each([
    'His special interest is in the management of coastal wetlands and estuaries.',
    'His special interest is in the management of glaucoma and coastal wetlands.',
  ])('keeps when a managed item is not a condition: %s', keeps);
});

describe('caring for and partnering with, said of the biography own person (#6192)', () => {
  it.each([
    'She partners with families to manage asthma and food allergies at home.',
    'He cares for adults with epilepsy and migraine.',
  ])('refuses when the biography own person gives the care: %s', refuses);

  it.each([
    'Community health workers partner with families to manage asthma in public housing.',
    'Her work follows rural nurses caring for adults with epilepsy and migraine.',
  ])('keeps when another care-giver is the subject: %s', keeps);

  it('keeps care for people whose listed needs are not conditions', () => {
    keeps('She cares for children with complex needs and their families.');
  });
});

describe('the new shapes yield to inquiry and creative practice (#6192)', () => {
  it('keeps a condition list that sits inside a stated lab', () => {
    keeps('In her lab, her special interests include eczema and psoriasis.');
  });

  it.each([
    'In her dance work, her special interests include scoliosis and hip dysplasia.',
    'A practising musician, she partners with families to manage asthma at home.',
  ])('keeps creative practice: %s', keeps);
});

describe('deriving a research statement from a biography with a condition list (#6192)', () => {
  it('drops the condition list and keeps the research sentence', () => {
    const research = 'Her research examines how skin barrier genes shape inflammation in children.';
    const list = 'Her special interests include eczema, psoriasis and chronic hand dermatitis.';
    const derived = deriveBioResearchStatement(`${research} ${list}`);
    expect(derived.evidenceSentences).toContain(research);
    expect(derived.evidenceSentences).not.toContain(list);
  });
});
