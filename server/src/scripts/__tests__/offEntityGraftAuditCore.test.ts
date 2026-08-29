import { describe, expect, it } from 'vitest';
import {
  MAX_DESCRIPTION_PROMPT_CHARS,
  OFF_ENTITY_GRAFT_REASONING_EFFORT,
  buildOffEntityGraftUserMessage,
  judgeOffEntityGraftRuns,
  parseOffEntityGraftRun,
  projectedPopulationCount,
  seededSample,
  wilsonInterval,
} from '../offEntityGraftAuditCore';

describe('offEntityGraftAuditCore', () => {
  it('carries the record name and type into the prompt, which attribution needs', () => {
    const message = buildOffEntityGraftUserMessage({
      name: 'Marisol Abarca Faculty Research',
      entityType: 'FACULTY_RESEARCH_AREA',
      recordKind: 'person',
      description: 'The Section of Endocrine Surgery is interested in clinical outcomes.',
    });
    expect(message).toContain('Marisol Abarca Faculty Research');
    expect(message).toContain('FACULTY_RESEARCH_AREA');
    expect(message).toContain('INDIVIDUAL PERSON');
    expect(message).toContain('Section of Endocrine Surgery');
  });

  it('bounds the judged description so one long record cannot dominate the run cost', () => {
    const message = buildOffEntityGraftUserMessage({
      name: 'Example Lab',
      entityType: 'LAB',
      recordKind: 'organization',
      description: 'x'.repeat(MAX_DESCRIPTION_PROMPT_CHARS + 5_000),
    });
    expect(message).not.toContain('x'.repeat(MAX_DESCRIPTION_PROMPT_CHARS + 1));
  });

  it('reads a malformed or unrecognized scope as unclear rather than this_entity', () => {
    expect(parseOffEntityGraftRun('not json').scope).toBe('unclear');
    expect(parseOffEntityGraftRun('{"researchSubject":"cilia"}').scope).toBe('unclear');
    expect(
      parseOffEntityGraftRun('{"researchSubject":"cilia","subjectScope":"parent org"}').scope,
    ).toBe('parent_org');
  });

  it('records a verdict only when every run agrees', () => {
    const unanimous = judgeOffEntityGraftRuns([
      { subject: 'the department', scope: 'parent_org' },
      { subject: 'the department', scope: 'parent_org' },
      { subject: 'the department', scope: 'parent_org' },
    ]);
    expect(unanimous.verdict).toBe('parent_org');
    expect(unanimous.unanimous).toBe(true);
    expect(unanimous.servableWhenUnanimous).toBe(false);

    const divided = judgeOffEntityGraftRuns([
      { subject: 'cilia', scope: 'this_entity' },
      { subject: 'cilia', scope: 'parent_org' },
      { subject: 'cilia', scope: 'this_entity' },
    ]);
    expect(divided.verdict).toBe('split');
    expect(divided.servableWhenUnanimous).toBeNull();
  });

  it('pins medium reasoning effort, the setting the minimal default invalidated', () => {
    expect(OFF_ENTITY_GRAFT_REASONING_EFFORT).toBe('medium');
  });

  it('reports a Wilson interval that stays inside [0, 1] at low rates', () => {
    const interval = wilsonInterval(9, 300);
    expect(interval.rate).toBeCloseTo(0.03, 5);
    expect(interval.lower).toBeGreaterThan(0);
    expect(interval.lower).toBeLessThan(interval.rate);
    expect(interval.upper).toBeGreaterThan(interval.rate);
    expect(interval.upper).toBeLessThan(1);
    expect(wilsonInterval(0, 0)).toMatchObject({ rate: 0, lower: 0, upper: 0 });
  });

  it('projects an interval onto the population it was sampled from', () => {
    const projected = projectedPopulationCount(wilsonInterval(30, 300), 2553);
    expect(projected.point).toBe(255);
    expect(projected.lower).toBeLessThan(projected.point);
    expect(projected.upper).toBeGreaterThan(projected.point);
  });

  it('samples reproducibly and without replacement', () => {
    const items = Array.from({ length: 100 }, (_, index) => index);
    const first = seededSample(items, 10, 7);
    expect(first).toEqual(seededSample(items, 10, 7));
    expect(new Set(first).size).toBe(10);
    expect(seededSample(items, 10, 8)).not.toEqual(first);
    expect(seededSample(items, 500, 7)).toHaveLength(100);
  });
});
