import { describe, expect, it } from 'vitest';

import { parseArgs } from '../acceptFormalizationReviewExceptions';

describe('acceptFormalizationReviewExceptions CLI helpers', () => {
  it('constrains formalization exception artifacts to safe JSON roots', () => {
    expect(parseArgs(['--output=/tmp/ylabs-formalization-exceptions.json'])).toMatchObject({
      apply: false,
      confirm: false,
      output: '/tmp/ylabs-formalization-exceptions.json',
    });
    expect(() => parseArgs(['--output=/etc/formalization-exceptions.json'])).toThrow(
      /--output must write under/,
    );
    expect(() => parseArgs(['--output=/tmp/formalization-exceptions.txt'])).toThrow(
      /--output must point to a \.json report file/,
    );
  });
});
