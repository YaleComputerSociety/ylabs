import { describe, expect, it } from 'vitest';
import {
  asYaleNetid,
  isNormalizedYaleNetid,
  looksLikeYaleNetid,
  normalizedYaleNetid,
} from '../yaleNetid';

describe('looksLikeYaleNetid', () => {
  it('accepts the letters-then-digits shape a netid actually has', () => {
    expect(looksLikeYaleNetid('abc12')).toBe(true);
    expect(looksLikeYaleNetid('ABC12')).toBe(true);
  });

  it('rejects an email local-part, which is what the scraper mint path produces', () => {
    expect(looksLikeYaleNetid('sample.person')).toBe(false);
    expect(looksLikeYaleNetid('sample-person')).toBe(false);
    expect(looksLikeYaleNetid('sample_person')).toBe(false);
  });

  it('rejects lengths outside two to twelve characters', () => {
    expect(looksLikeYaleNetid('a')).toBe(false);
    expect(looksLikeYaleNetid('a'.repeat(13))).toBe(false);
  });

  it('rejects a namespaced key rather than reading through the prefix', () => {
    expect(looksLikeYaleNetid('netid:abc12')).toBe(false);
  });

  it('rejects a non-string and an empty value', () => {
    expect(looksLikeYaleNetid(undefined)).toBe(false);
    expect(looksLikeYaleNetid(null)).toBe(false);
    expect(looksLikeYaleNetid(12345)).toBe(false);
    expect(looksLikeYaleNetid('')).toBe(false);
    expect(looksLikeYaleNetid('   ')).toBe(false);
  });
});

describe('isNormalizedYaleNetid', () => {
  it('requires lower case, so an audit filter cannot be split across two spellings', () => {
    expect(isNormalizedYaleNetid('abc12')).toBe(true);
    expect(isNormalizedYaleNetid('ABC12')).toBe(false);
  });
});

describe('asYaleNetid', () => {
  it('returns the trimmed value when it is a netid and empty when it is not', () => {
    expect(asYaleNetid('  abc12  ')).toBe('abc12');
    expect(asYaleNetid('sample.person')).toBe('');
  });
});

describe('normalizedYaleNetid', () => {
  it('lower cases an accepted netid and still refuses a local-part', () => {
    expect(normalizedYaleNetid('ABC12')).toBe('abc12');
    expect(normalizedYaleNetid('Sample.Person')).toBe('');
  });
});
