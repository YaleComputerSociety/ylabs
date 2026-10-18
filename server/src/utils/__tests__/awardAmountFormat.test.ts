import { describe, expect, it } from 'vitest';
import { formatServedAwardAmount } from '../awardAmountFormat';

describe('formatServedAwardAmount (#5205)', () => {
  it.each([
    ['Up to 500.00', 'Up to $500'],
    ['Maximum award of 7500', 'Maximum award of $7,500'],
    ['7,500', '$7,500'],
    ['$5000.00', '$5,000'],
    ['3000-4000', '$3,000-$4,000'],
    ['$250-1,500', '$250-$1,500'],
    ['Typically $500 to $2500, up to $3000', 'Typically $500 to $2,500, up to $3,000'],
  ])('writes %j as %j', (stored, served) => {
    expect(formatServedAwardAmount(stored)).toBe(served);
  });

  it.each([
    'Up to 3 awards of $1,000',
    '$1,250.50 per month',
    'Stipend for 10 weeks',
    'Funding for the 2026-2027 academic year',
    'Varies',
  ])('leaves a count, a figure with cents, a year, or prose as written: %j', (stored) => {
    expect(formatServedAwardAmount(stored)).toBe(stored);
  });

  it('passes a missing amount through', () => {
    expect(formatServedAwardAmount(undefined)).toBeUndefined();
    expect(formatServedAwardAmount(null)).toBeNull();
  });
});
