import { describe, expect, it } from 'vitest';

import {
  canonicalPersonName,
  normalizePersonNameCasing,
  personNameCasingChanged,
} from '../personNameCasing';

describe('normalizePersonNameCasing', () => {
  it('title-cases shouty raw-cased person names', () => {
    expect(normalizePersonNameCasing('AZA')).toBe('Aza');
    expect(normalizePersonNameCasing('UGYAN CHOEDUP')).toBe('Ugyan Choedup');
    expect(normalizePersonNameCasing('OLEG BUDNITCKIY')).toBe('Oleg Budnitckiy');
    expect(normalizePersonNameCasing('MOHAMMAD ISLAMUL')).toBe('Mohammad Islamul');
  });

  it('preserves two-letter initials rather than mangling them', () => {
    expect(normalizePersonNameCasing('JJ')).toBe('JJ');
    expect(normalizePersonNameCasing('TJ Johnson')).toBe('TJ Johnson');
    expect(normalizePersonNameCasing('LT Gourzong')).toBe('LT Gourzong');
  });

  it('preserves generational roman-numeral suffixes', () => {
    expect(normalizePersonNameCasing('Myles Alderman III')).toBe('Myles Alderman III');
    expect(normalizePersonNameCasing('Kendall Greer II')).toBe('Kendall Greer II');
    expect(normalizePersonNameCasing('Someone VIII')).toBe('Someone VIII');
  });

  it('preserves academic credential tokens', () => {
    expect(normalizePersonNameCasing('MFA')).toBe('MFA');
    expect(normalizePersonNameCasing('DVM')).toBe('DVM');
    expect(normalizePersonNameCasing('MPH')).toBe('MPH');
  });

  it('leaves already mixed-case and separated names untouched', () => {
    expect(normalizePersonNameCasing('McDonald')).toBe('McDonald');
    expect(normalizePersonNameCasing('Ohno-Machado')).toBe('Ohno-Machado');
    expect(normalizePersonNameCasing("D'Souza")).toBe("D'Souza");
  });

  it('title-cases all-caps runs across hyphens and apostrophes', () => {
    expect(normalizePersonNameCasing('OHNO-MACHADO')).toBe('Ohno-Machado');
    expect(normalizePersonNameCasing("D'SOUZA")).toBe("D'Souza");
    expect(normalizePersonNameCasing('K-BIDI')).toBe('K-Bidi');
  });

  it('preserves whitespace and returns falsy input unchanged', () => {
    expect(normalizePersonNameCasing('  AZA   ALLSOP ')).toBe('  Aza   Allsop ');
    expect(normalizePersonNameCasing('')).toBe('');
  });
});

describe('canonicalPersonName', () => {
  it('title-cases fully uppercase person names', () => {
    expect(canonicalPersonName('RAHEL JAEGGI')).toBe('Rahel Jaeggi');
    expect(canonicalPersonName('OLEG BUDNITCKIY')).toBe('Oleg Budnitckiy');
    expect(canonicalPersonName('MOHAMMAD ISLAMUL HAQUE')).toBe('Mohammad Islamul Haque');
  });

  it('fixes a single uppercase given name beside a correctly cased surname', () => {
    expect(canonicalPersonName('AZA Allsop')).toBe('Aza Allsop');
  });

  it('preserves hyphenated and apostrophized surnames', () => {
    expect(canonicalPersonName('LUDIVINE K-BIDI')).toBe('Ludivine K-Bidi');
    expect(canonicalPersonName("D'SOUZA")).toBe("D'Souza");
    expect(canonicalPersonName('OHNO-MACHADO')).toBe('Ohno-Machado');
  });

  it('leaves already correctly cased names untouched', () => {
    expect(canonicalPersonName('Joanne E. McGovern')).toBe('Joanne E. McGovern');
    expect(canonicalPersonName('Myles Alderman')).toBe('Myles Alderman');
  });

  it('preserves two-letter uppercase initials', () => {
    expect(canonicalPersonName('TJ Johnson')).toBe('TJ Johnson');
    expect(canonicalPersonName('AZ Zayaruznaya')).toBe('AZ Zayaruznaya');
    expect(canonicalPersonName('JJ Penna')).toBe('JJ Penna');
  });

  it('preserves roman-numeral generational suffixes', () => {
    expect(canonicalPersonName('Myles Alderman III')).toBe('Myles Alderman III');
    expect(canonicalPersonName('Nelson Thomas VIII')).toBe('Nelson Thomas VIII');
  });

  it('preserves military ranks and retirement markers', () => {
    expect(canonicalPersonName('LTC (RET) Joanne E. McGovern')).toBe(
      'LTC (RET) Joanne E. McGovern',
    );
  });

  it('preserves post-nominal credential acronyms', () => {
    expect(canonicalPersonName('Kimberly Jannarone DFA')).toBe('Kimberly Jannarone DFA');
  });

  it('normalizes empty and non-string input to an empty string', () => {
    expect(canonicalPersonName('')).toBe('');
    expect(canonicalPersonName('   ')).toBe('');
    expect(canonicalPersonName(undefined)).toBe('');
    expect(canonicalPersonName(null)).toBe('');
  });

  it('is idempotent', () => {
    const once = canonicalPersonName('SUZANNE AKULEY');
    expect(canonicalPersonName(once)).toBe(once);
  });
});

describe('personNameCasingChanged', () => {
  it('flags raw all-caps person names', () => {
    expect(personNameCasingChanged('RAHEL JAEGGI')).toBe(true);
    expect(personNameCasingChanged('AZA Allsop')).toBe(true);
  });

  it('does not flag preserved or already-correct names', () => {
    expect(personNameCasingChanged('TJ Johnson')).toBe(false);
    expect(personNameCasingChanged('Myles Alderman III')).toBe(false);
    expect(personNameCasingChanged('Rahel Jaeggi')).toBe(false);
    expect(personNameCasingChanged('')).toBe(false);
  });
});
