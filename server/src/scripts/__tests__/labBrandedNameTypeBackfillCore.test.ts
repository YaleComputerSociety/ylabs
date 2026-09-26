import { describe, expect, it } from 'vitest';
import {
  classifyLabBrandedNameType,
  planLabBrandedNameTypeBackfill,
  summarizeLabBrandedNameTypeBackfill,
  type LabBrandedNameTypeCandidate,
} from '../labBrandedNameTypeBackfillCore';

const candidate = (
  overrides: Partial<LabBrandedNameTypeCandidate> = {},
): LabBrandedNameTypeCandidate => ({
  slug: 'dept-example-a-researcher',
  storedName: 'Example Neural Computation Lab',
  entityType: 'FACULTY_RESEARCH_AREA',
  kind: 'individual',
  brandedName: 'Example Neural Computation Lab',
  brandedNameSourceUrl: 'https://example-lab.yale.edu/',
  brandedNameObservedAt: '2026-08-28T10:04:30.677Z',
  ...overrides,
});

describe('classifyLabBrandedNameType', () => {
  it('re-types a person-scoped row whose own site named it a laboratory', () => {
    const row = classifyLabBrandedNameType(candidate());
    expect(row.outcome).toBe('plan');
    expect(row.afterEntityType).toBe('LAB');
    expect(row.afterKind).toBe('lab');
    expect(row.sourceUrl).toBe('https://example-lab.yale.edu/');
    expect(row.observedAt).toBe('2026-08-28T10:04:30.677Z');
  });

  it('refuses an umbrella organization name, because the type follows the same boundary as the name', () => {
    const row = classifyLabBrandedNameType(
      candidate({
        storedName: 'Example Center for Data Science',
        brandedName: 'Example Center for Data Science',
      }),
    );
    expect(row.outcome).toBe('brand-not-a-laboratory');
    expect(row.afterEntityType).toBeUndefined();
  });

  it('refuses a working group, which is a committee shape rather than a laboratory', () => {
    const row = classifyLabBrandedNameType(
      candidate({ storedName: 'Example Working Group', brandedName: 'Example Working Group' }),
    );
    expect(row.outcome).toBe('brand-not-a-laboratory');
  });

  it('refuses a link label that carries the head noun but identifies nothing', () => {
    const row = classifyLabBrandedNameType(
      candidate({ storedName: 'Lab Website', brandedName: 'Lab Website' }),
    );
    expect(row.outcome).toBe('brand-not-a-laboratory');
  });

  it('refuses a brand with no laboratory head noun at all', () => {
    const row = classifyLabBrandedNameType(
      candidate({ storedName: 'Example Research', brandedName: 'Example Research' }),
    );
    expect(row.outcome).toBe('brand-not-a-laboratory');
  });

  it('leaves an organization-shaped row alone, because an organization name is its right name', () => {
    const row = classifyLabBrandedNameType(
      candidate({
        entityType: 'CENTER',
        kind: 'center',
        storedName: 'Example Lab',
        brandedName: 'Example Lab',
      }),
    );
    expect(row.outcome).toBe('not-person-scoped');
  });

  it('acts on the brand the row still serves, not one the corpus has replaced', () => {
    const row = classifyLabBrandedNameType(candidate({ storedName: 'A Researcher - Research' }));
    expect(row.outcome).toBe('brand-no-longer-served');
  });

  it('is a no-op on a row already typed LAB', () => {
    expect(classifyLabBrandedNameType(candidate({ entityType: 'LAB' })).outcome).toBe(
      'already-lab',
    );
  });

  it('skips an archived row', () => {
    expect(classifyLabBrandedNameType(candidate({ archived: true })).outcome).toBe('archived');
  });

  it('honours a manual lock on either field it would write', () => {
    expect(
      classifyLabBrandedNameType(candidate({ manuallyLockedFields: ['entityType'] })).outcome,
    ).toBe('locked');
    expect(classifyLabBrandedNameType(candidate({ manuallyLockedFields: ['kind'] })).outcome).toBe(
      'locked',
    );
  });

  it('compares the stored and branded names case-insensitively and ignoring surrounding space', () => {
    const row = classifyLabBrandedNameType(
      candidate({ storedName: '  example neural computation LAB ' }),
    );
    expect(row.outcome).toBe('plan');
  });

  it('derives the type from kind when the row carries no entityType', () => {
    const row = classifyLabBrandedNameType(candidate({ entityType: undefined }));
    expect(row.outcome).toBe('plan');
  });

  it('refuses a brand read off a school faculty-directory profile page, which declares no laboratory', () => {
    const row = classifyLabBrandedNameType(
      candidate({
        storedName: 'A Researcher Lab',
        brandedName: 'A Researcher Lab',
        brandedNameSourceUrl: 'https://example.yale.edu/directory/faculty/a-researcher',
      }),
    );
    expect(row.outcome).toBe('brand-not-self-declared');
    expect(row.afterEntityType).toBeUndefined();
  });

  it('refuses a brand with no citable page at all rather than typing on an absent premise', () => {
    expect(classifyLabBrandedNameType(candidate({ brandedNameSourceUrl: undefined })).outcome).toBe(
      'brand-page-not-a-microsite',
    );
  });

  it('holds a brand read off a sub-page of a lab microsite rather than retracting a served name', () => {
    const row = classifyLabBrandedNameType(
      candidate({
        storedName: 'A Researcher Lab',
        brandedName: 'A Researcher Lab',
        brandedNameSourceUrl: 'https://campuspress.example.edu/aresearcherlab/research/',
      }),
    );
    expect(row.outcome).toBe('brand-page-not-a-microsite');
    expect(row.afterEntityType).toBeUndefined();
  });

  it('holds a brand read off a program page, which declares neither a lab nor a directory entry', () => {
    expect(
      classifyLabBrandedNameType(
        candidate({
          brandedNameSourceUrl:
            'https://medicine.example.edu/psychiatry/research/clinics-and-programs/collab/',
        }),
      ).outcome,
    ).toBe('brand-page-not-a-microsite');
  });

  it('refuses a brand read off a centre team-page entry, which renders one person record', () => {
    expect(
      classifyLabBrandedNameType(
        candidate({ brandedNameSourceUrl: 'https://isps.example.edu/team/a-researcher' }),
      ).outcome,
    ).toBe('brand-not-self-declared');
  });

  it('accepts a /lab/ microsite on a school host, which is a laboratory declaring itself', () => {
    const row = classifyLabBrandedNameType(
      candidate({ brandedNameSourceUrl: 'https://medicine.example.edu/lab/a-researcher/' }),
    );
    expect(row.outcome).toBe('plan');
  });
});

describe('planLabBrandedNameTypeBackfill', () => {
  it('summarizes every outcome it produced', () => {
    const rows = planLabBrandedNameTypeBackfill([
      candidate(),
      candidate({ slug: 'b', entityType: 'LAB' }),
      candidate({ slug: 'c', storedName: 'Example Institute', brandedName: 'Example Institute' }),
    ]);
    const summary = summarizeLabBrandedNameTypeBackfill(rows);
    expect(summary.plan).toBe(1);
    expect(summary['already-lab']).toBe(1);
    expect(summary['brand-not-a-laboratory']).toBe(1);
    expect(Object.values(summary).reduce((total, count) => total + count, 0)).toBe(rows.length);
  });
});
