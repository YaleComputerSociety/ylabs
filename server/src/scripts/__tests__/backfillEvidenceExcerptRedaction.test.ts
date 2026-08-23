import { describe, expect, it } from 'vitest';
import {
  assertBackfillEvidenceExcerptRedactionApplyAllowed,
  buildEvidenceExcerptRedactionPlans,
  parseBackfillEvidenceExcerptRedactionArgs,
} from '../backfillEvidenceExcerptRedaction';

describe('buildEvidenceExcerptRedactionPlans (#1112)', () => {
  it('plans a cleaned excerpt when a marker-bearing sentence is stored', () => {
    const { plans, blocked } = buildEvidenceExcerptRedactionPlans([
      {
        _id: '64f111111111111111111111',
        type: 'CONTACT_INSTRUCTIONS_EXIST',
        source: { excerpt: 'We host undergraduates. Email us at [email redacted]' },
      },
    ]);

    expect(blocked).toHaveLength(0);
    expect(plans).toHaveLength(1);
    expect(plans[0].after).toBe('We host undergraduates.');
    expect(plans[0].after).not.toMatch(/\[(?:email|phone) redacted\]/i);
  });

  it('plans an empty excerpt when the whole stored value is a marker directive', () => {
    const { plans } = buildEvidenceExcerptRedactionPlans([
      {
        _id: '64f222222222222222222222',
        type: 'APPLICATION_FORM_EXISTS',
        source: { excerpt: 'Email us at [email redacted]' },
      },
    ]);

    expect(plans).toHaveLength(1);
    expect(plans[0].after).toBe('');
  });

  it('skips records with no redaction marker', () => {
    const { plans, blocked } = buildEvidenceExcerptRedactionPlans([
      {
        _id: '64f333333333333333333333',
        type: 'CONTACT_INSTRUCTIONS_EXIST',
        source: { excerpt: 'A join, opportunities, or application page was found.' },
      },
    ]);

    expect(plans).toHaveLength(0);
    expect(blocked).toHaveLength(0);
  });

  it('blocks records whose source.excerpt is review-locked', () => {
    const { plans, blocked } = buildEvidenceExcerptRedactionPlans([
      {
        _id: '64f444444444444444444444',
        type: 'CONTACT_INSTRUCTIONS_EXIST',
        source: { excerpt: 'Email us at [email redacted]' },
        review: { status: 'reviewed', lockedFields: ['source.excerpt'] },
      },
    ]);

    expect(plans).toHaveLength(0);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].reason).toBe('review-locked-excerpt');
  });
});

describe('parseBackfillEvidenceExcerptRedactionArgs (#1112)', () => {
  it('defaults to a dry run', () => {
    const options = parseBackfillEvidenceExcerptRedactionArgs([]);
    expect(options.apply).toBe(false);
    expect(options.limitProvided).toBe(false);
  });

  it('parses apply, limit, and confirmation flags', () => {
    const options = parseBackfillEvidenceExcerptRedactionArgs([
      '--apply',
      '--limit=25',
      '--confirm-evidence-excerpt-redaction',
    ]);
    expect(options.apply).toBe(true);
    expect(options.limit).toBe(25);
    expect(options.limitProvided).toBe(true);
    expect(options.confirmEvidenceExcerptRedaction).toBe(true);
  });
});

describe('assertBackfillEvidenceExcerptRedactionApplyAllowed (#1112)', () => {
  it('is a no-op in dry-run mode', () => {
    expect(() =>
      assertBackfillEvidenceExcerptRedactionApplyAllowed({
        apply: false,
        plannedWrites: 999,
        maxApply: 1,
      }),
    ).not.toThrow();
  });

  it('requires --limit and confirmation before applying', () => {
    expect(() =>
      assertBackfillEvidenceExcerptRedactionApplyAllowed({
        apply: true,
        limitProvided: false,
        confirmEvidenceExcerptRedaction: true,
        plannedWrites: 1,
        maxApply: 10,
      }),
    ).toThrow(/--limit is required/);

    expect(() =>
      assertBackfillEvidenceExcerptRedactionApplyAllowed({
        apply: true,
        limitProvided: true,
        confirmEvidenceExcerptRedaction: false,
        plannedWrites: 1,
        maxApply: 10,
      }),
    ).toThrow(/--confirm-evidence-excerpt-redaction is required/);
  });

  it('refuses to exceed --max-apply', () => {
    expect(() =>
      assertBackfillEvidenceExcerptRedactionApplyAllowed({
        apply: true,
        limitProvided: true,
        confirmEvidenceExcerptRedaction: true,
        plannedWrites: 11,
        maxApply: 10,
      }),
    ).toThrow(/above --max-apply/);
  });
});
