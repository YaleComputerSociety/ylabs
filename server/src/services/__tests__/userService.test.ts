import { describe, expect, it } from 'vitest';
import {
  buildCaseInsensitiveNetidFilter,
  buildSavedPathwayPlanUnsetForIds,
  buildSavedPathwayPlansExport,
  normalizeObjectIdsForUserMutation,
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
  it('escapes netid regex metacharacters before exact case-insensitive lookup', () => {
    const filter = buildCaseInsensitiveNetidFilter('.*+$[x]');
    const pattern = filter.netid.$regex;
    const regex = new RegExp(pattern, filter.netid.$options);

    expect(pattern).toBe('^\\.\\*\\+\\$\\[x\\]$');
    expect(regex.test('.*+$[x]')).toBe(true);
    expect(regex.test('abc123')).toBe(false);
  });

  it('preserves case-insensitive exact netid matching', () => {
    const filter = buildCaseInsensitiveNetidFilter('Aa123');
    const regex = new RegExp(filter.netid.$regex, filter.netid.$options);

    expect(regex.test('aa123')).toBe(true);
    expect(regex.test('xaa123')).toBe(false);
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
  it('normalizes create/update payloads before persisting a saved pathway plan', () => {
    const result = sanitizeSavedPathwayPlanForStorage({
      intent: 'mass-email',
      stage: 'ready',
      note: `${'a'.repeat(5001)}`,
      checklist: {
        'review-evidence': true,
        'bad-value': 'yes',
        '': true,
      },
    });

    expect(result.intent).toBe('later');
    expect(result.stage).toBe('ready');
    expect(result.note).toHaveLength(5000);
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

  it('drops oversized saved pathway checklist keys before storage', () => {
    const result = sanitizeSavedPathwayPlanForStorage({
      checklist: {
        ['a'.repeat(121)]: true,
        'review-evidence': true,
      },
    });

    expect(result.checklist).toEqual({ 'review-evidence': true });
  });
});

describe('buildSavedPathwayPlanUnsetForIds', () => {
  it('builds update paths used when saved pathways or plans are deleted', () => {
    expect(
      buildSavedPathwayPlanUnsetForIds([
        '665f0b0c0b0c0b0c0b0c0b0c',
        '665f0b0c0b0c0b0c0b0c0b0d',
      ]),
    ).toEqual({
      'savedPathwayPlans.665f0b0c0b0c0b0c0b0c0b0c': '',
      'savedPathwayPlans.665f0b0c0b0c0b0c0b0c0b0d': '',
    });
  });
});

describe('normalizeObjectIdsForUserMutation', () => {
  it('normalizes valid ObjectId strings for account mutations', () => {
    const result = normalizeObjectIdsForUserMutation(
      ['665f0b0c0b0c0b0c0b0c0b0c'],
      'savedResearchPlans',
    );

    expect(result.map((id) => id.toString())).toEqual(['665f0b0c0b0c0b0c0b0c0b0c']);
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
    const ids = Array.from({ length: 101 }, (_, index) =>
      index.toString(16).padStart(24, '0'),
    );

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
