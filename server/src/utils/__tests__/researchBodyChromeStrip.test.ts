import { describe, expect, it } from 'vitest';
import {
  splitBodySentences,
  stripBodyChrome,
  titleCaseWordRatio,
} from '../researchBodyChromeStrip';

describe('splitBodySentences: the hostile inputs this corpus actually contains', () => {
  it('does not split on a trailing middle initial', () => {
    expect(
      splitBodySentences(
        'Sterling Professor Emeritus of Law Owen M. Fiss stresses the importance.',
      ),
    ).toEqual(['Sterling Professor Emeritus of Law Owen M. Fiss stresses the importance.']);
  });

  it('does not split on a run of initials', () => {
    expect(
      splitBodySentences('Associate Dean and C.N.H. Long Professor of Internal Medicine.'),
    ).toEqual(['Associate Dean and C.N.H. Long Professor of Internal Medicine.']);
  });

  it('does not split on a degree abbreviation', () => {
    expect(splitBodySentences('He holds a Ph.D. in Linguistics from Rutgers University.')).toEqual([
      'He holds a Ph.D. in Linguistics from Rutgers University.',
    ]);
  });

  it('does not split on a courtesy title', () => {
    expect(splitBodySentences('Dr. Maerz earned her undergraduate degree in Arizona.')).toEqual([
      'Dr. Maerz earned her undergraduate degree in Arizona.',
    ]);
  });

  it('does not split a date range where the period falls mid-range', () => {
    expect(splitBodySentences('She served from 1984. -2022. She continues to work there.')).toEqual(
      ['She served from 1984. -2022.', 'She continues to work there.'],
    );
  });

  /**
   * KNOWN LIMIT. When the source lost the space after a period the degree token
   * is no longer at a word boundary, so `\bM\.Div\.` cannot match inside
   * "VirginiaM.Div." and the abbreviation guard does not fire. The result is a
   * boundary in the wrong place, which is one reason the sentence-dropping design
   * was rejected: on `dept-divinity-joyce-mercer` it removed the first fragment
   * and left the rest of the degree list served.
   */
  it('splits a space-stripped run at the wrong place, which is why nothing is dropped on it', () => {
    expect(splitBodySentences('B.A. University of VirginiaM.Div. Yale Divinity School')).toEqual([
      'B.A. University of VirginiaM.Div.',
      'Yale Divinity School',
    ]);
  });

  it('still splits ordinary sentences', () => {
    expect(splitBodySentences('We study ion channels. We use patch clamp. It works.')).toEqual([
      'We study ion channels.',
      'We use patch clamp.',
      'It works.',
    ]);
  });

  it('returns nothing for blank or non-string input', () => {
    expect(splitBodySentences('')).toEqual([]);
    expect(splitBodySentences(null)).toEqual([]);
    expect(splitBodySentences(undefined)).toEqual([]);
  });
});

describe('stripBodyChrome: trailing update stamp', () => {
  it('removes a stamp that is its own sentence', () => {
    const result = stripBodyChrome(
      'She studies chronic liver disease and gastrointestinal conditions. Last Updated on March 15, 2023.',
    );
    expect(result.droppedUpdateStamp).toBe(true);
    expect(result.body).toBe('She studies chronic liver disease and gastrointestinal conditions.');
  });

  it('removes a stamp glued to the previous sentence with no period in front of it', () => {
    const result = stripBodyChrome(
      'This researcher evaluates emotional and behavioral concerns Last Updated on January 02, 2025.',
    );
    expect(result.droppedUpdateStamp).toBe(true);
    expect(result.body).toBe('This researcher evaluates emotional and behavioral concerns');
  });

  it('removes a numeric-dated stamp', () => {
    expect(
      stripBodyChrome('We study ion channels. Last Updated 03/15/2023').droppedUpdateStamp,
    ).toBe(true);
  });

  it('leaves a date that is part of the prose alone', () => {
    const text = 'The lab was founded in March 15, 2023 and studies ion channels.';
    const result = stripBodyChrome(text);
    expect(result.droppedUpdateStamp).toBe(false);
    expect(result.body).toBe(text);
  });
});

describe('stripBodyChrome: inline section label prefix', () => {
  it('unwraps a label rather than discarding the prose behind it', () => {
    const result = stripBodyChrome(
      'Bio: My research focuses on theoretical questions and observational analyses of the large-scale structure of the Universe.',
    );
    expect(result.strippedLabelPrefix).toBe(true);
    expect(result.body).toBe(
      'My research focuses on theoretical questions and observational analyses of the large-scale structure of the Universe.',
    );
  });

  it('unwraps a bare Biography opener', () => {
    const result = stripBodyChrome(
      'Biography This researcher has been a member of the faculty since 1984 and works clinically.',
    );
    expect(result.strippedLabelPrefix).toBe(true);
    expect(result.body).toBe(
      'This researcher has been a member of the faculty since 1984 and works clinically.',
    );
  });

  it('refuses to unwrap a label whose content is a publication title', () => {
    const text =
      'Title A Novel Approach to Measuring the Impact of Surgery in Craniosynostosis using Event-Related Potentials';
    const result = stripBodyChrome(text);
    expect(result.strippedLabelPrefix).toBe(false);
    expect(result.body).toBe(text);
  });

  it('leaves a sentence that merely starts with a similar word alone', () => {
    const text = 'Biographical methods are central to how this group reads archival material.';
    expect(stripBodyChrome(text).strippedLabelPrefix).toBe(false);
  });

  it('does not empty the body when the label is all there is', () => {
    const result = stripBodyChrome('Overview');
    expect(result.body).toBe('Overview');
    expect(result.strippedLabelPrefix).toBe(false);
  });
});

describe('stripBodyChrome: never destructive', () => {
  it('never drops a sentence, even one that reads as pure chrome', () => {
    const text =
      'Assistant Professor of Marketing at the Yale School of Management. This researcher studies rationality.';
    expect(stripBodyChrome(text).body).toBe(text);
  });

  it('preserves a short opening sentence that no prose word-floor would accept', () => {
    const text =
      'Flexibility is an integral part of enzyme function. This conformational motion can include reorganization of catalytic groups.';
    expect(stripBodyChrome(text).body).toBe(text);
  });

  it('returns an empty body only for empty input', () => {
    expect(stripBodyChrome('').body).toBe('');
    expect(stripBodyChrome(null).body).toBe('');
  });

  it('is idempotent', () => {
    const once = stripBodyChrome(
      'Bio: We study ion channels. Last Updated on March 15, 2023.',
    ).body;
    expect(stripBodyChrome(once).body).toBe(once);
  });
});

describe('titleCaseWordRatio', () => {
  it('scores prose low and a title run high', () => {
    expect(
      titleCaseWordRatio('the lab maps how salt-marsh sediments lock away carbon'),
    ).toBeLessThan(0.34);
    expect(
      titleCaseWordRatio('Associate Professor of Surgery and Anesthesiology Critical Care'),
    ).toBeGreaterThan(0.4);
  });

  it('ignores acronyms so a real sentence can cite them freely', () => {
    expect(titleCaseWordRatio('we image the brain with MRI and EEG in awake mice')).toBe(0);
  });
});
