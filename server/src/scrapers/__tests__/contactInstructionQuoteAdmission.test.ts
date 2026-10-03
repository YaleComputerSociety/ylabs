import { describe, expect, it } from 'vitest';
import { contactQuoteStatesAnInstruction } from '../contactInstructionQuoteAdmission';

describe('contactQuoteStatesAnInstruction (#3928)', () => {
  it.each([
    '[email redacted]',
    '"[email redacted]"',
    'Contact [email redacted]',
    'Email: [email redacted]',
    '[email redacted] (copy)',
    'Copy [email redacted]',
    'Get In Touch Copy [email redacted] Profile 100 Example Street',
    'Contact Us',
    'Contact Info [email redacted] [phone redacted]',
    'Contact Pat Example Senior Associate Director, Media Relations [email redacted]',
    'Appointment Number [phone redacted]',
    'Office Hours By Appointment Only',
    'Contact CV Office Hours',
    'Contact Information Room 101',
    'Contact me: fixture.person {at} example.edu',
    'Please do not email about openings.',
    '',
  ])('refuses a quote that states no instruction: %s', (quote) => {
    expect(contactQuoteStatesAnInstruction(quote)).toBe(false);
  });

  it.each([
    'please email [email redacted] to apply',
    'Interested students should contact the lab manager.',
    'If you are interested in joining the lab, please send your CV to [email redacted].',
    'For additional information, contact: [email redacted].',
    'Contact me at [email redacted].',
    'Email Dr. Example with your CV attached.',
    'Apply using the form on this page.',
    'Prospective students should review current projects before writing. Email [email redacted] with a short note.',
    'Openings can be found on the student employment site.',
    'Reach out to the lab coordinator for current availability.',
  ])('admits a quote that states how, whom or what to send: %s', (quote) => {
    expect(contactQuoteStatesAnInstruction(quote)).toBe(true);
  });

  it('judges the instruction rather than the address, so an unredacted bare address is refused too', () => {
    expect(contactQuoteStatesAnInstruction('fixture.person@example.edu')).toBe(false);
    expect(
      contactQuoteStatesAnInstruction('Email fixture.person@example.edu to arrange a visit.'),
    ).toBe(true);
  });

  it('refuses a non-string value', () => {
    expect(contactQuoteStatesAnInstruction(undefined)).toBe(false);
    expect(contactQuoteStatesAnInstruction({ quote: 'please email us to apply' })).toBe(false);
  });
});
