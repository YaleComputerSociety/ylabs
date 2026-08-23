import { describe, expect, it } from 'vitest';
import { normalizePersonNameCasing } from '../personNameCasing';

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
