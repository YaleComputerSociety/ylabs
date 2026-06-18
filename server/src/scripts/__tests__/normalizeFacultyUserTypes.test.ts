import { describe, expect, it } from 'vitest';
import { parseNormalizeFacultyUserTypesArgs } from '../normalizeFacultyUserTypes';

describe('normalizeFacultyUserTypes args', () => {
  it('defaults to dry-run mode', () => {
    expect(parseNormalizeFacultyUserTypesArgs([])).toEqual({ apply: false });
  });

  it('requires explicit apply mode for writes', () => {
    expect(parseNormalizeFacultyUserTypesArgs(['--apply'])).toEqual({ apply: true });
  });
});
