import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import {
  MAX_SAVED_PATHWAY_NOTE_LENGTH,
  MAX_SAVED_PROGRAM_NOTE_LENGTH,
  MAX_SAVED_RESEARCH_ENTITY_SHORT_DESCRIPTION_LENGTH,
  boundSavedResearchEntitySummaryText,
  buildCaseInsensitiveNetidFilter,
  normalizeObjectIdStringForUserMutation,
  normalizeObjectIdsForUserMutation,
  normalizeUserLookupObjectId,
  sanitizeSavedPathwayPlanForStorage,
  sanitizeSavedProgramTrackingForResponse,
} from '../userService';
describe('buildCaseInsensitiveNetidFilter', () => {
  it('rejects malformed netids before building regex filters', () => {
    expect(() => buildCaseInsensitiveNetidFilter('.*+$[x]')).toThrow(/Invalid netid/);
    expect(() => buildCaseInsensitiveNetidFilter('a'.repeat(4096))).toThrow(/Invalid netid/);
  });

  it('rejects object-shaped netids without invoking arbitrary toString', () => {
    const objectNetid = {
      toString: () => 'aa123',
    };

    expect(() => buildCaseInsensitiveNetidFilter(objectNetid)).toThrow(/Invalid netid/);
  });

  it('preserves case-insensitive exact netid matching', () => {
    const filter = buildCaseInsensitiveNetidFilter('Aa123');
    const regex = new RegExp(filter.netid.$regex, filter.netid.$options);

    expect(regex.test('aa123')).toBe(true);
    expect(regex.test('xaa123')).toBe(false);
  });
});

describe('normalizeUserLookupObjectId', () => {
  it('accepts string and ObjectId account lookup ids', () => {
    const id = '665f0b0c0b0c0b0c0b0c0b0c';

    expect(normalizeUserLookupObjectId(id)).toBe(id);
    expect(normalizeUserLookupObjectId(new mongoose.Types.ObjectId(id))).toBe(id);
  });

  it('rejects object-shaped account lookup ids without invoking arbitrary toString', () => {
    expect(
      normalizeUserLookupObjectId({
        toString: () => '665f0b0c0b0c0b0c0b0c0b0c',
      }),
    ).toBeNull();
  });
});

describe('sanitizeSavedProgramTrackingForResponse', () => {
  it('returns only bounded records keyed by canonical program ids', () => {
    const id = '665f0b0c0b0c0b0c0b0c0b0c';
    expect(
      sanitizeSavedProgramTrackingForResponse({
        [id]: {
          note: 'x'.repeat(MAX_SAVED_PROGRAM_NOTE_LENGTH + 20),
          stage: 'applied',
          revision: 4,
          updatedAt: '2026-07-11T12:00:00.000Z',
        },
        '__proto__.bad': { note: 'private', stage: 'applied' },
      }),
    ).toEqual({
      [id]: {
        note: 'x'.repeat(MAX_SAVED_PROGRAM_NOTE_LENGTH),
        stage: 'applied',
        revision: 4,
        updatedAt: '2026-07-11T12:00:00.000Z',
      },
    });
  });

  it('normalizes malformed stored metadata without exposing extra fields', () => {
    const id = '665f0b0c0b0c0b0c0b0c0b0c';
    expect(
      sanitizeSavedProgramTrackingForResponse({
        [id]: { note: 12, stage: 'admin', revision: -1, updatedAt: 'bad', secret: 'no' },
      })[id],
    ).toEqual({
      note: '',
      stage: 'not_applied',
      revision: 0,
      updatedAt: new Date(0).toISOString(),
    });
  });
});

describe('sanitizeSavedPathwayPlanForStorage', () => {
  it('keeps valid date-only reminders and rejects invalid dates and intervals', () => {
    expect(
      sanitizeSavedPathwayPlanForStorage({
        targetDeadline: '2026-09-30',
        actedOnDate: '2026-02-29',
        followUpIntervalDays: 14,
      }),
    ).toMatchObject({
      targetDeadline: '2026-09-30',
      actedOnDate: null,
      followUpIntervalDays: 14,
    });
    expect(
      sanitizeSavedPathwayPlanForStorage({
        targetDeadline: '09/30/2026',
        actedOnDate: '2026-07-12T00:00:00Z',
        followUpIntervalDays: 15,
      }),
    ).toMatchObject({ targetDeadline: null, actedOnDate: null, followUpIntervalDays: null });
  });

  it('normalizes create/update payloads before persisting a saved pathway plan', () => {
    const result = sanitizeSavedPathwayPlanForStorage({
      intent: 'mass-email',
      stage: 'ready',
      note: `${'a'.repeat(MAX_SAVED_PATHWAY_NOTE_LENGTH + 1)}`,
      checklist: {
        'review-evidence': true,
        'bad-value': 'yes',
        '': true,
      },
    });

    expect(result.intent).toBe('later');
    expect(result.stage).toBe('ready');
    expect(result.note).toHaveLength(MAX_SAVED_PATHWAY_NOTE_LENGTH);
    expect(result.checklist).toEqual({
      'review-evidence': true,
      'bad-value': false,
    });
  });

  it('bounds saved pathway checklist entries before storage', () => {
    const result = sanitizeSavedPathwayPlanForStorage({
      checklist: Object.fromEntries(
        Array.from({ length: 60 }, (_, index) => [`task-${index}`, index % 2 === 0]),
      ),
    });

    expect(Object.keys(result.checklist)).toHaveLength(50);
    expect(result.checklist).toHaveProperty('task-0', true);
    expect(result.checklist).toHaveProperty('task-49', false);
    expect(result.checklist).not.toHaveProperty('task-50');
  });

  it('ignores non-object saved pathway checklists before storage', () => {
    const result = sanitizeSavedPathwayPlanForStorage({
      checklist: ['email-pi', 'draft-note'] as any,
    });

    expect(result.checklist).toEqual({});
  });

  it('stops reading saved pathway checklist keys after the storage cap', () => {
    const result = sanitizeSavedPathwayPlanForStorage({
      checklist: Object.fromEntries(
        Array.from({ length: 10_000 }, (_, index) => [`task-${index}`, true]),
      ),
    });

    expect(Object.keys(result.checklist)).toHaveLength(50);
    expect(result.checklist).toHaveProperty('task-0', true);
    expect(result.checklist).toHaveProperty('task-49', true);
    expect(result.checklist).not.toHaveProperty('task-9999');
  });

  it('drops oversized saved pathway checklist keys before storage', () => {
    const result = sanitizeSavedPathwayPlanForStorage({
      checklist: {
        ['a'.repeat(121)]: true,
        'review-evidence': true,
      },
    });

    expect(result.checklist).toEqual({ 'review-evidence': true });
  });

  it('normalizes saved pathway checklist keys before storage', () => {
    const result = sanitizeSavedPathwayPlanForStorage({
      checklist: {
        ' review.evidence ': true,
        $set: true,
        constructor: true,
        prototype: true,
      },
    });

    expect(result.checklist).toEqual({
      review_evidence: true,
      _set: true,
    });
    expect(Object.prototype.hasOwnProperty.call(result.checklist, 'constructor')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result.checklist, 'prototype')).toBe(false);
  });

  it('sanitizes and bounds completed checklist history for durable storage', () => {
    const result = sanitizeSavedPathwayPlanForStorage({
      intent: 'credit',
      checklistHistory: [
        {
          intent: 'outreach',
          label: '  Contact the program office  ',
          completedAt: '2026-07-11T12:00:00Z',
        },
        { intent: 'invalid', label: 'Dropped', completedAt: '2026-07-11T12:00:00Z' },
        { intent: 'thesis', label: 'Bad date', completedAt: 'not-a-date' },
      ],
    });

    expect(result.checklistHistory).toEqual([
      {
        intent: 'outreach',
        label: 'Contact the program office',
        completedAt: '2026-07-11T12:00:00.000Z',
      },
    ]);
  });
});

describe('normalizeObjectIdsForUserMutation', () => {
  it('normalizes ObjectId instances without falling back to arbitrary object coercion', () => {
    const objectId = new mongoose.Types.ObjectId('665f0b0c0b0c0b0c0b0c0b0c');

    expect(normalizeObjectIdStringForUserMutation(objectId, 'favPathways')).toBe(
      '665f0b0c0b0c0b0c0b0c0b0c',
    );
  });

  it('normalizes valid ObjectId strings for account mutations', () => {
    const result = normalizeObjectIdsForUserMutation(
      ['665f0b0c0b0c0b0c0b0c0b0c'],
      'savedResearchPlans',
    );

    expect(result.map((id) => id.toString())).toEqual(['665f0b0c0b0c0b0c0b0c0b0c']);
  });

  it('rejects arbitrary object-shaped ids instead of invoking toString', () => {
    const objectIdLike = {
      toString: () => '665f0b0c0b0c0b0c0b0c0b0c',
    };

    expect(() => normalizeObjectIdsForUserMutation([objectIdLike], 'favListings')).toThrow(
      /Invalid favListings id/,
    );
  });

  it('rejects non-array account mutation batches before per-id work', () => {
    expect(() =>
      normalizeObjectIdsForUserMutation({ 0: '665f0b0c0b0c0b0c0b0c0b0c' } as any, 'favListings'),
    ).toThrow(/Invalid favListings ids/);
  });

  it('rejects malformed ids before they reach Mongo update paths', () => {
    expect(() => normalizeObjectIdsForUserMutation(['not-an-object-id'], 'favPathways')).toThrow(
      /Invalid favPathways id/,
    );
    try {
      normalizeObjectIdsForUserMutation(['not-an-object-id'], 'favPathways');
    } catch (error: any) {
      expect(error.status).toBe(400);
    }
  });

  it('rejects oversized account mutation batches before per-id work', () => {
    const ids = Array.from({ length: 101 }, (_, index) => index.toString(16).padStart(24, '0'));

    expect(() => normalizeObjectIdsForUserMutation(ids, 'favPathways')).toThrow(
      /Too many favPathways ids/,
    );
    try {
      normalizeObjectIdsForUserMutation(ids, 'favPathways');
    } catch (error: any) {
      expect(error.status).toBe(400);
    }
  });
});

describe('boundSavedResearchEntitySummaryText', () => {
  it('bounds both saved-entity summary description variants', () => {
    expect(
      boundSavedResearchEntitySummaryText(
        's'.repeat(MAX_SAVED_RESEARCH_ENTITY_SHORT_DESCRIPTION_LENGTH + 1),
        MAX_SAVED_RESEARCH_ENTITY_SHORT_DESCRIPTION_LENGTH,
      ),
    ).toHaveLength(MAX_SAVED_RESEARCH_ENTITY_SHORT_DESCRIPTION_LENGTH);
  });
});
