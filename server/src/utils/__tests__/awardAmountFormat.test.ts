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
    ['Up to 5000 per semester', 'Up to $5,000 per semester'],
    ['Typically 500 to 2500, and 3000 each', 'Typically $500 to $2,500, and $3,000 each'],
    ['Total award 1200.', 'Total award $1,200.'],
    ['Up to 2000', 'Up to $2,000'],
    ['Maximum award of 2000', 'Maximum award of $2,000'],
    ['Up to 2000 per year', 'Up to $2,000 per year'],
    ['Awards range from 1000 to 5000', 'Awards range from $1,000 to $5,000'],
    ['Award amount: 5000', 'Award amount: $5,000'],
    ['Stipend 4000', 'Stipend $4,000'],
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
    '£2,500-3,000',
    '€5000 - 7000',
    '2,500-3,000 USD',
    '1,000 to 2,000 dollars',
    '$1500 or 1,200 GBP',
    'Spend by June 30, 2026',
    '2025-2026',
    '2026-27',
    'Up to 150 participants',
    'Top 100 applicants',
    'Grant ID 12345',
    'Room 4500 stipend',
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
