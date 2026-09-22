import { describe, expect, it } from 'vitest';
import { stripInvisibleFormatCharacters } from '../invisibleFormatCharacters';
import { replaceAsciiControls } from '../asciiControl';

const SOFT_HYPHENATED_TITLE = 'Assis\u00adtant Pro\u00adfes\u00adsor of Eco\u00adnom\u00adics';

const FAMILY: Array<{ name: string; dirty: string }> = [
  { name: 'U+00AD soft hyphen', dirty: 'Pro\u00adfessor of Economics' },
  { name: 'U+200B zero-width space', dirty: 'Pro\u200bfessor of Economics' },
  { name: 'U+200C zero-width non-joiner', dirty: 'Pro\u200cfessor of Economics' },
  { name: 'U+200D zero-width joiner', dirty: 'Pro\u200dfessor of Economics' },
  { name: 'U+2060 word joiner', dirty: 'Pro\u2060fessor of Economics' },
  { name: 'U+FEFF byte-order mark', dirty: 'Pro\ufefffessor of Economics' },
];

describe('stripInvisibleFormatCharacters', () => {
  it('restores the title-keyed classification a soft hyphen defeated', () => {
    expect(/professor/i.test(SOFT_HYPHENATED_TITLE)).toBe(false);
    expect(stripInvisibleFormatCharacters(SOFT_HYPHENATED_TITLE)).toBe(
      'Assistant Professor of Economics',
    );
    expect(/professor/i.test(stripInvisibleFormatCharacters(SOFT_HYPHENATED_TITLE))).toBe(true);
  });

  it('handles the whole family the same page can emit, not only the soft hyphen', () => {
    for (const { name, dirty } of FAMILY) {
      expect(
        /professor/i.test(dirty),
        `${name} should defeat the classifier before the strip`,
      ).toBe(false);
      expect(stripInvisibleFormatCharacters(dirty), name).toBe('Professor of Economics');
    }
  });

  it('folds a no-break space to a plain space, one character for one', () => {
    const dirty = 'Professor\u00a0of Economics';
    expect(/^Professor of Economics$/.test(dirty)).toBe(false);
    expect(stripInvisibleFormatCharacters(dirty)).toBe('Professor of Economics');
    expect(stripInvisibleFormatCharacters(dirty)).toHaveLength(dirty.length);
  });

  it('leaves an ordinary ASCII hyphen and already-clean text alone', () => {
    expect(stripInvisibleFormatCharacters('Non-Tenure Track Lecturer')).toBe(
      'Non-Tenure Track Lecturer',
    );
    expect(stripInvisibleFormatCharacters('Assistant Professor of Economics')).toBe(
      'Assistant Professor of Economics',
    );
  });

  it('is idempotent', () => {
    const once = stripInvisibleFormatCharacters(SOFT_HYPHENATED_TITLE);
    expect(stripInvisibleFormatCharacters(once)).toBe(once);
  });

  it('answers the same on a repeated call, so the shared regexes carry no lastIndex', () => {
    expect(stripInvisibleFormatCharacters(SOFT_HYPHENATED_TITLE)).toBe(
      stripInvisibleFormatCharacters(SOFT_HYPHENATED_TITLE),
    );
  });

  it('covers what replaceAsciiControls cannot, since a format character is not a control', () => {
    expect(replaceAsciiControls(SOFT_HYPHENATED_TITLE, ' ')).toBe(SOFT_HYPHENATED_TITLE);
  });
});
