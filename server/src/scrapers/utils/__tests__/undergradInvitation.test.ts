import { describe, expect, it } from 'vitest';
import {
  classifyInvitationSentence,
  extractUndergradInvitation,
  statedTermIsPast,
} from '../undergradInvitation';

const NOW = new Date('2026-10-18T12:00:00Z');
const level = (text: string) => extractUndergradInvitation(text, NOW)?.level ?? null;

describe('extractUndergradInvitation', () => {
  it.each([
    'We are actively recruiting undergraduate researchers to join our lab.',
    'The Example Lab is currently hiring postdocs, graduate students, and undergrads.',
    'We are recruiting one or two motivated undergraduate students to work on zebrafish genetics.',
    'We are looking for highly motivated undergraduate students, graduate students and postdocs.',
    'We have openings for undergraduate, graduate, and postdoctoral researchers!',
    'Undergraduates: Undergraduate research positions are also available.',
    'We are seeking six (6) undergrad students to join us in a yearlong program.',
    'Opening: We are looking for PhD and undergraduate students to work on machine learning for science.',
  ])('reads an active opening as actively hiring: %s', (text) => {
    expect(level(text)).toBe('actively_hiring');
  });

  it('treats a future term as an active opening even beside a past apply-by date', () => {
    const text =
      'Yale undergrads: Positions will be available in Spring 2027. For consideration, please email the PI no later than November 2025 with a CV.';
    expect(level(text)).toBe('actively_hiring');
  });

  it.each([
    'We welcome undergraduate students to join our lab.',
    'We are always looking for motivated postdocs, graduate and undergraduate students to join our lab!',
    'Interested undergraduate students are encouraged to contact the PI and inquire about opportunities.',
    'If you are an undergraduate interested in working with us as a research assistant, please fill out this form.',
    'Undergraduates: Email the PI with a short description of your background and interests.',
    'Undergraduate research opportunities are available during both the academic year and the summer.',
    'If you are a current Yale undergraduate interested in research, feel free to email me to check if there are any research opportunities available.',
    'We also offer opportunities to undergraduate students who wish to pursue applied research.',
    'We are currently hiring graduate students and postdocs; undergraduates are welcome to contact us.',
    'We are actively recruiting postdocs, but undergraduates are welcome to reach out about projects.',
    'We are currently hiring postdocs, and undergraduates are welcome to contact us.',
  ])('reads a standing invitation as welcomes undergrads: %s', (text) => {
    expect(level(text)).toBe('welcomes_undergrads');
  });

  it.each([
    'Our undergraduate student positions for 2026-27 have also been filled!',
    'We are not currently accepting undergraduate students.',
    'The lab has hosted undergraduate researchers from Yale College for many years.',
    'She first joined the lab during her undergraduate studies.',
    'He teaches an undergraduate course on comparative literature.',
    'She has served as the Director of Undergraduate Studies for the department.',
    'BA-BS/MPH for Yale College Students.',
    'Learn about our Undergraduate Program.',
    'During the summer, some of the institute research groups are hiring Yale undergraduate students.',
    'The center accepts applications from Yale undergraduate and graduate students for awards ranging from $500 to $2000.',
    'Each senior member of the lab is encouraged to gain mentoring experience by training one or two undergraduates.',
    'We are recruiting undergraduate students for Summer 2024.',
    'Positions in the lab include post-baccalaureate associates and undergraduate research assistants.',
    'We are looking for talented postdocs to join our group at Yale.',
  ])('gives no badge to: %s', (text) => {
    expect(level(text)).toBeNull();
  });

  it('keeps the stronger invitation when a page carries both', () => {
    const text =
      'We welcome undergraduates of every background. We are currently recruiting undergraduate research assistants for the spring.';
    expect(extractUndergradInvitation(text, NOW)).toEqual({
      level: 'actively_hiring',
      quote: 'We are currently recruiting undergraduate research assistants for the spring.',
    });
  });

  it('reads an opening under a short undergraduate heading and quotes the heading with it', () => {
    expect(extractUndergradInvitation('Undergraduates. Positions are available now.', NOW)).toEqual(
      {
        level: 'actively_hiring',
        quote: 'Undergraduates. Positions are available now.',
      },
    );
  });

  it('restores the space a flattened heading lost after its colon', () => {
    expect(
      extractUndergradInvitation('Yale undergrads:Positions will be available in Spring 2027.', NOW)
        ?.quote,
    ).toBe('Yale undergrads: Positions will be available in Spring 2027.');
  });

  it('returns null for empty input', () => {
    expect(extractUndergradInvitation('', NOW)).toBeNull();
    expect(extractUndergradInvitation(undefined, NOW)).toBeNull();
  });
});

describe('statedTermIsPast', () => {
  it('reads seasons and academic years against now', () => {
    expect(statedTermIsPast('Positions for Spring 2027.', NOW)).toBe(false);
    expect(statedTermIsPast('Positions for Fall 2026.', NOW)).toBe(false);
    expect(statedTermIsPast('Positions for Summer 2026.', NOW)).toBe(true);
    expect(statedTermIsPast('Positions for the 2025-26 academic year.', NOW)).toBe(true);
    expect(statedTermIsPast('Positions for the 2026-27 academic year.', NOW)).toBe(false);
    expect(statedTermIsPast('No term stated.', NOW)).toBe(false);
  });
});

describe('classifyInvitationSentence', () => {
  it('does not read a standing qualifier as an active opening', () => {
    expect(
      classifyInvitationSentence('We are always looking for curious undergraduates.', NOW),
    ).toBe('welcomes_undergrads');
  });
});
