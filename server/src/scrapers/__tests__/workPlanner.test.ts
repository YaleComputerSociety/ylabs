import { describe, it, expect } from 'vitest';
import { buildEntityWorkPlan } from '../workPlanner';

const NOW = new Date('2026-05-03T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('buildEntityWorkPlan', () => {
  it('plans missing fields for fetch', () => {
    const plan = buildEntityWorkPlan({
      entityType: 'researchGroup',
      entityKey: 'smith-lab',
      sourceName: 'lab-microsite-undergrad-llm',
      targetFields: ['acceptingUndergrads', 'undergradEvidenceQuote'],
      observations: [],
      freshnessWindowMs: 7 * DAY,
      now: NOW,
    });

    expect(plan.shouldFetch).toBe(true);
    expect(plan.fields).toEqual([
      { field: 'acceptingUndergrads', shouldFetch: true, reason: 'missing' },
      { field: 'undergradEvidenceQuote', shouldFetch: true, reason: 'missing' },
    ]);
  });

  it('skips fresh same-source observations', () => {
    const plan = buildEntityWorkPlan({
      entityType: 'user',
      entityKey: 'abc123',
      sourceName: 'yale-directory',
      targetFields: ['title'],
      observations: [
        {
          sourceName: 'yale-directory',
          field: 'title',
          observedAt: new Date('2026-05-02T12:00:00Z'),
        },
      ],
      freshnessWindowMs: 7 * DAY,
      now: NOW,
    });

    expect(plan.shouldFetch).toBe(false);
    expect(plan.fields[0]).toEqual({
      field: 'title',
      shouldFetch: false,
      reason: 'fresh',
      lastObservedAt: '2026-05-02T12:00:00.000Z',
    });
  });

  it('fetches stale fields and ignores superseded observations', () => {
    const plan = buildEntityWorkPlan({
      entityType: 'paper',
      entityKey: 'W1',
      sourceName: 'openalex',
      targetFields: ['citedByCount'],
      observations: [
        {
          sourceName: 'openalex',
          field: 'citedByCount',
          observedAt: new Date('2026-05-02T12:00:00Z'),
          superseded: true,
        },
        {
          sourceName: 'openalex',
          field: 'citedByCount',
          observedAt: new Date('2026-04-01T12:00:00Z'),
        },
      ],
      freshnessWindowMs: 7 * DAY,
      now: NOW,
    });

    expect(plan.shouldFetch).toBe(true);
    expect(plan.fields[0]).toEqual({
      field: 'citedByCount',
      shouldFetch: true,
      reason: 'stale',
      lastObservedAt: '2026-04-01T12:00:00.000Z',
    });
  });

  it('does not plan manually locked fields', () => {
    const plan = buildEntityWorkPlan({
      entityType: 'researchGroup',
      entityKey: 'smith-lab',
      sourceName: 'lab-microsite-undergrad-llm',
      targetFields: ['acceptingUndergrads'],
      manuallyLockedFields: ['acceptingUndergrads'],
      observations: [],
      freshnessWindowMs: 7 * DAY,
      now: NOW,
    });

    expect(plan.shouldFetch).toBe(false);
    expect(plan.fields[0]).toEqual({
      field: 'acceptingUndergrads',
      shouldFetch: false,
      reason: 'manual-lock',
    });
  });
});
