import { describe, expect, it } from 'vitest';
import { isClinicalOnlyBiographySentence } from '../bioResearchStatement';

describe('clinical-service biography shapes the roster-bio rule refuses (#6151)', () => {
  it.each([
    'Her clinical interests are sports concussion and return-to-play decisions for school athletes.',
    'Her special interests include acne scarring, rosacea and cosmetic dermatology.',
    'She enjoys managing patients with complex heart rhythm problems.',
    'He has treated patients with sports injuries for over a decade.',
    'He is committed to supporting his patients through every stage of recovery.',
    'She is known for giving her patients clear, practical guidance after surgery.',
    'She is dedicated to working with patients to restore mobility after joint replacement.',
    'Her aim is to benefit her patients with chronic pain through careful medication review.',
  ])('refuses a clinical-only sentence: %s', (sentence) => {
    expect(isClinicalOnlyBiographySentence(sentence)).toBe(true);
  });

  it.each([
    'Their work focuses on working with patients to build a decision aid for prostate cancer treatment.',
    'He worked with patients to co-design a symptom tracking app and tests whether it reduces readmissions.',
    'His clinical interests include glaucoma, and he builds retinal imaging tools that flag early nerve loss.',
    'Her special interests include how sleep loss changes memory consolidation in shift workers.',
    'She studies how managing patients with diabetes in group visits changes long-term outcomes.',
    'She develops new strategies for managing patients with sepsis.',
    'She is working with patients to better understand their experience of living with chronic pain.',
    'He works with patients to learn which symptoms of their condition matter most to them.',
    'Her particular interests include the history of medicine and public health in colonial ports.',
    'His special interests include historical accounts of hospital care in early modern cities.',
    'Her special interests include the medical humanities and narratives of chronic illness.',
  ])('keeps a research sentence that also names patients or care: %s', (sentence) => {
    expect(isClinicalOnlyBiographySentence(sentence)).toBe(false);
  });

  it.each([
    'Her app lets primary care physicians remotely manage their patients with heart failure.',
    'The platform will enable clinicians to better support their patients after discharge.',
    'His tool helps nurses quickly treat their patients with chest pain.',
    'Her app helps clinicians managing patients with heart failure stay on schedule.',
    'His scheduling tool supports surgeons who treated patients in rural clinics.',
    'His scheduling tool supports surgeons who have treated patients in rural clinics.',
    'Her app supports nurses who are managing patients with sepsis.',
    'Her dashboard alerts clinicians who are managing their patients after surgery.',
  ])('keeps a sentence about another care-giver and their patients: %s', (sentence) => {
    expect(isClinicalOnlyBiographySentence(sentence)).toBe(false);
  });

  it.each([
    'She writes plays about caring for a parent through a long illness.',
    'His play about the management of a family farm after a stroke premiered last spring.',
  ])('keeps creative practice about care: %s', (sentence) => {
    expect(isClinicalOnlyBiographySentence(sentence)).toBe(false);
  });
});
