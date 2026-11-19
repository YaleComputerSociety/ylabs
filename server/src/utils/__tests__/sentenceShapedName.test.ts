import { describe, expect, it } from 'vitest';
import { isSentenceShapedName } from '../sentenceShapedName';

describe('isSentenceShapedName', () => {
  it.each([
    'Thank you for visiting the Orrery Institute',
    'Thanks for your interest in the Orrery Institute',
    'Please contact the Orrery Institute',
    'Click here to apply to the Orrery Program',
    'Learn more about the Orrery Institute',
    'Read more about our fictional microbes',
  ])('refuses a name that opens with a call-to-action phrase: %s', (name) => {
    expect(isSentenceShapedName(name)).toBe(true);
  });

  it.each([
    'Thank you for your interest in the Orrery Institute (OI).',
    'Orrery Lab We study how fictional cells end inflammation.',
    'Is this the Orrery Institute for Fictional Microbes?',
    'Welcome to the Orrery Institute today!',
  ])('refuses a name of four or more words that ends in sentence punctuation: %s', (name) => {
    expect(isSentenceShapedName(name)).toBe(true);
  });

  it.each([
    'Orrery Fictional Instruments Inc.',
    'Orrery Fictional Instrument Co.',
    'Orrery Fictional Analytics Ltd.',
    'Orrery Fictional Holdings Corp.',
    'Orrery Fictional Partners LLC.',
    'Orrery Institute for Studies of the U.S.',
    'Orrery Collaborative of Quill et al.',
  ])('keeps a name whose final period belongs to an abbreviation: %s', (name) => {
    expect(isSentenceShapedName(name)).toBe(false);
  });

  it('keeps a name of three words even when it ends in a period', () => {
    expect(isSentenceShapedName('Orrery Fictional Lab.')).toBe(false);
  });

  it.each([
    'Orrery Institute for Fictional Microbes',
    'Click Chemistry Orrery Laboratory',
    'Learning More Orrery Lab',
    'Orrery Lab for Please and Thanks Studies',
    'The Pleasant Orrery Group',
    'Thanksgiving Orrery Archive',
  ])(
    'keeps an ordinary name, including call-to-action words that are not its opening: %s',
    (name) => {
      expect(isSentenceShapedName(name)).toBe(false);
    },
  );

  it('reads the same value the same way on every call', () => {
    const name = 'Thank you for your interest in the Orrery Institute (OI).';
    expect([isSentenceShapedName(name), isSentenceShapedName(name)]).toEqual([true, true]);
  });

  it('refuses nothing that is not a non-empty string', () => {
    for (const value of [undefined, null, '', '   ', 42, ['Thank you for visiting.']]) {
      expect(isSentenceShapedName(value)).toBe(false);
    }
  });
});
