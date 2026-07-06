import { describe, expect, it } from 'vitest';

import { longTextParagraphs } from '../longText';

describe('longTextParagraphs', () => {
  it('preserves source paragraph breaks', () => {
    expect(longTextParagraphs('First paragraph.\n\nSecond paragraph.')).toEqual([
      'First paragraph.',
      'Second paragraph.',
    ]);
  });

  it('treats source line breaks as paragraph breaks', () => {
    expect(longTextParagraphs('First paragraph.\nSecond paragraph.')).toEqual([
      'First paragraph.',
      'Second paragraph.',
    ]);
  });

  it('does not split paragraphs inside example abbreviations', () => {
    const text = [
      'The lab studies social groups.',
      'Examples include shared beliefs (e.g. religion), shared origins (e.g. nationality), and shared traits (e.g. introverts).',
      'The group studies how those categories shape attention.',
      'Students use experimental methods.',
      'Projects often compare adults and children.',
    ].join(' ');

    const paragraphs = longTextParagraphs(text, {
      minAutoSplitCharacters: 120,
      sentencesPerParagraph: 3,
    });

    expect(paragraphs).toEqual([
      [
        'The lab studies social groups.',
        'Examples include shared beliefs (e.g. religion), shared origins (e.g. nationality), and shared traits (e.g. introverts).',
        'The group studies how those categories shape attention.',
      ].join(' '),
      ['Students use experimental methods.', 'Projects often compare adults and children.'].join(' '),
    ]);
  });

  it('does not split paragraphs inside titles, initials, or country abbreviations', () => {
    const text = [
      'Dr. D. S. Fahmeed Hyder studies brain energy metabolism.',
      'The lab applies calibrated fMRI and molecular imaging.',
      'Students may see work about the implications of U.S. health policy.',
      'The group also collaborates with Prof. Ken Taylor on microscopy methods.',
      'Projects connect physics, chemistry, engineering, and neuroscience.',
    ].join(' ');

    expect(longTextParagraphs(text, { minAutoSplitCharacters: 120, sentencesPerParagraph: 3 })).toEqual([
      [
        'Dr. D. S. Fahmeed Hyder studies brain energy metabolism.',
        'The lab applies calibrated fMRI and molecular imaging.',
        'Students may see work about the implications of U.S. health policy.',
      ].join(' '),
      [
        'The group also collaborates with Prof. Ken Taylor on microscopy methods.',
        'Projects connect physics, chemistry, engineering, and neuroscience.',
      ].join(' '),
    ]);
  });

  it('does not split paragraphs inside URLs or single-name initials', () => {
    const text = [
      'The lab maintains a bibliography at https://www.ncbi.nlm.nih.gov/myncbi/profile/public/.',
      'The profile-derived summary should be checked against linked sources.',
      'One project is part of a larger program with Dr. D. PIs contributing methods.',
      'Students should verify the official page before outreach.',
      'The profile is retained as planning context.',
    ].join(' ');

    expect(longTextParagraphs(text, { minAutoSplitCharacters: 120, sentencesPerParagraph: 3 })).toEqual([
      [
        'The lab maintains a bibliography at https://www.ncbi.nlm.nih.gov/myncbi/profile/public/.',
        'The profile-derived summary should be checked against linked sources.',
        'One project is part of a larger program with Dr. D. PIs contributing methods.',
      ].join(' '),
      [
        'Students should verify the official page before outreach.',
        'The profile is retained as planning context.',
      ].join(' '),
    ]);
  });

  it('does not split paragraphs inside compact place or role abbreviations', () => {
    const text = [
      'Nicole represented the school in Washington, D.C., at an annual leadership conference.',
      'The project was led by a Principal Investigator and Co-P.I., with collaborators from multiple departments.',
      'Another profile mentions an eight-year B.S./M.D. program before public-health training.',
      'Students reviewed outcomes across several clinical settings.',
      'The profile summarizes professional service and research activity.',
      'Current work connects education, health, and implementation.',
    ].join(' ');

    expect(longTextParagraphs(text, { minAutoSplitCharacters: 120, sentencesPerParagraph: 3 })).toEqual([
      [
        'Nicole represented the school in Washington, D.C., at an annual leadership conference.',
        'The project was led by a Principal Investigator and Co-P.I., with collaborators from multiple departments.',
        'Another profile mentions an eight-year B.S./M.D. program before public-health training.',
      ].join(' '),
      [
        'Students reviewed outcomes across several clinical settings.',
        'The profile summarizes professional service and research activity.',
        'Current work connects education, health, and implementation.',
      ].join(' '),
    ]);
  });

  it('normalizes spaced academic degree abbreviations before splitting', () => {
    const text = [
      'The profile lists Ph. D. training in economics and an M. Phil. , also in economics.',
      'It also lists an M. A. and B. A. before B. Sc. and M. Sc. training.',
      'The bio then describes current research on global markets and firm behavior.',
      'Students can use this profile to evaluate methods and regional interests.',
      'The page includes enough context for a focused outreach note.',
    ].join(' ');

    expect(longTextParagraphs(text, { minAutoSplitCharacters: 120, sentencesPerParagraph: 3 })).toEqual([
      [
        'The profile lists Ph.D. training in economics and an M.Phil., also in economics.',
        'It also lists an M.A. and B.A. before B.Sc. and M.Sc. training.',
        'The bio then describes current research on global markets and firm behavior.',
      ].join(' '),
      [
        'Students can use this profile to evaluate methods and regional interests.',
        'The page includes enough context for a focused outreach note.',
      ].join(' '),
    ]);
  });

  it('does not split paragraphs inside abbreviated species names', () => {
    const text = [
      'The lab studies synapse assembly in C. elegans.',
      'Students use imaging and behavioral assays.',
      'A related project studies the ubiquitin-proteasome system in S. cerevisiae.',
      'The work connects molecular mechanisms to cellular function.',
      'Current methods include genetics, microscopy, and computation.',
    ].join(' ');

    expect(longTextParagraphs(text, { minAutoSplitCharacters: 120, sentencesPerParagraph: 3 })).toEqual([
      [
        'The lab studies synapse assembly in C. elegans.',
        'Students use imaging and behavioral assays.',
        'A related project studies the ubiquitin-proteasome system in S. cerevisiae.',
      ].join(' '),
      [
        'The work connects molecular mechanisms to cellular function.',
        'Current methods include genetics, microscopy, and computation.',
      ].join(' '),
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
