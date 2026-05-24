import { describe, expect, it } from 'vitest';
import {
  buildSavedPathwayPlanUnsetForIds,
  buildSavedPathwayPlansExport,
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
  sourceUrls: ['https://example.invalid/pathway', 'mailto:private-contact@example.invalid'],
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
    applicationUrl: 'https://example.invalid/apply',
    status: 'OPEN',
  },
  evidence: [
    {
      signalType: 'posted_opening',
      confidence: 'HIGH',
      sourceUrl: 'https://example.invalid/evidence',
    },
  ],
  contactRoute: {
    routeType: 'FACULTY_PI',
    label: 'Private contact route',
    url: 'mailto:private-contact@example.invalid',
    visibility: 'PRIVATE',
  },
  ...overrides,
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
            'https://example.invalid/pathway',
            'https://example.invalid/evidence',
            'https://example.invalid/apply',
          ],
          bestNextStepCategory: 'plan-outreach',
        },
      ],
    });
    expect(result.items[0]).not.toHaveProperty('privateNote');
    expect(JSON.stringify(result)).not.toContain('private-contact@example.invalid');
    expect(JSON.stringify(result)).not.toContain('contactRoute');
  });

  it('uses the public source URL boundary for exported source links', () => {
    const blockedUrl =
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/example-person';
    const result = buildSavedPathwayPlansExport(
      [
        pathway({
          sourceUrls: [blockedUrl, 'https://example.invalid/pathway'],
          evidence: [
            {
              signalType: 'posted_opening',
              confidence: 'HIGH',
              sourceUrl: 'https://example.invalid\n.evil.example/source',
            },
          ],
          activePostedOpportunity: {
            _id: '665f0b0c0b0c0b0c0b0c0b0e',
            title: 'Archive assistant',
            applicationUrl: blockedUrl,
            status: 'OPEN',
          },
        }),
      ],
      {},
    );

    expect(result.items[0].sourceLinks).toEqual(['https://example.invalid/pathway']);
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
