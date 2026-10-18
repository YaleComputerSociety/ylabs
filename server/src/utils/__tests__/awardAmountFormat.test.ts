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
    ['$4000 per month', '$4,000 per month'],
    ['Up to $1500.00 per week', 'Up to $1,500 per week'],
    ['Two $5000 awards', 'Two $5,000 awards'],
    ['Up to $5000 grant', 'Up to $5,000 grant'],
    ['2500 per semester', '$2,500 per semester'],
    ['2000', '$2,000'],
    ['1500-2000', '$1,500-$2,000'],
  ])('writes %j as %j', (stored, served) => {
    expect(formatServedAwardAmount(stored)).toBe(served);
  });

  it.each([
    'Up to 3 awards of $1,000',
    '$1,250.50 per month',
    'Stipend for 10 weeks',
    'Funding for the 2026-2027 academic year',
    'Varies',
    '£2,500',
    '€5000',
    '¥150000',
    '10,000 USD',
    '1,000 dollars',
    '5000 EUR',
    'Spend by June 30, 2026',
    'Class of 2027',
  ])(
    'leaves a count, a figure with cents, another currency, a year, or prose as written: %j',
    (stored) => {
      expect(formatServedAwardAmount(stored)).toBe(stored);
    },
  );

  it('passes a missing amount through', () => {
    expect(formatServedAwardAmount(undefined)).toBeUndefined();
    expect(formatServedAwardAmount(null)).toBeNull();
  });
});
