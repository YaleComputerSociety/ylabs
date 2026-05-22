import { describe, expect, it } from 'vitest';

import { longTextParagraphs } from '../longText';

describe('longTextParagraphs', () => {
  it('preserves source paragraph breaks', () => {
    expect(longTextParagraphs('First paragraph.\n\nSecond paragraph.')).toEqual([
      'First paragraph.',
      'Second paragraph.',
    ]);
  });

  it('splits long single-blob prose into readable paragraphs', () => {
    const text = [
      'The lab studies sensory systems in changing environments.',
      'Students use imaging, computation, and behavioral experiments.',
      'Current projects examine how neural circuits adapt over time.',
      'The group also collaborates with clinicians and engineers.',
      'These collaborations connect basic science to translational questions.',
      'Students can use the profile to decide whether the methods fit their interests.',
    ].join(' ');

    expect(longTextParagraphs(text, { minAutoSplitCharacters: 120, sentencesPerParagraph: 3 })).toEqual([
      [
        'The lab studies sensory systems in changing environments.',
        'Students use imaging, computation, and behavioral experiments.',
        'Current projects examine how neural circuits adapt over time.',
      ].join(' '),
      [
        'The group also collaborates with clinicians and engineers.',
        'These collaborations connect basic science to translational questions.',
        'Students can use the profile to decide whether the methods fit their interests.',
      ].join(' '),
    ]);
  });

  it('leaves short text as one paragraph', () => {
    expect(longTextParagraphs('Short research summary.')).toEqual(['Short research summary.']);
  });
});
