import { describe, expect, it } from 'vitest';
import { redactDirectContactInfo, sanitizeEvidenceExcerpt } from '../contactRedaction';

const clean = (raw: string): string | undefined =>
  sanitizeEvidenceExcerpt(redactDirectContactInfo(raw));

describe('sanitizeEvidenceExcerpt', () => {
  it('leaves marker-free excerpts untouched', () => {
    expect(clean('Undergraduates are listed on the lab page.')).toBe(
      'Undergraduates are listed on the lab page.',
    );
  });

  it('returns undefined for empty or whitespace input', () => {
    expect(sanitizeEvidenceExcerpt(undefined)).toBeUndefined();
    expect(sanitizeEvidenceExcerpt('   ')).toBeUndefined();
  });

  it('keeps substantive context and drops the labeled contact tail', () => {
    expect(
      clean(
        'Contact Info: Laura Newburgh Assistant Professor of Physics email: laura@example.edu phone: (203-432-1234',
      ),
    ).toBe('Laura Newburgh Assistant Professor of Physics');
  });

  it('drops the bracketed contact trailer while keeping the roster names', () => {
    expect(clean('Undergrad Students Ian Fernandes Contact: <ian@example.edu>')).toBe(
      'Undergrad Students Ian Fernandes',
    );
  });

  it('collapses marker-only excerpts to undefined', () => {
    expect(clean('Email us at labcontact@example.edu')).toBeUndefined();
    expect(clean('Phone: 203-432-1234 Email: hidden@example.edu')).toBeUndefined();
    expect(clean('Questions: hidden@example.edu or 203-432-1234.')).toBeUndefined();
  });

  it('never returns a residual redaction marker token', () => {
    const samples = [
      'Contact: <hidden@example.edu>',
      'Reach out to hidden@example.edu',
      'Robert Schoelkopf Undergrad Students Ian Fernandes Contact: <ian@example.edu>',
    ];
    for (const sample of samples) {
      const result = clean(sample) ?? '';
      expect(result).not.toMatch(/redacted/i);
    }
  });
});
