import { describe, expect, it } from 'vitest';
import { planPageReadVerdict, type PageReadRow } from '../applyPageReadVerdictCore';
import { parsePageReadVerdictArgs } from '../applyPageReadVerdict';

const row = (overrides: Partial<PageReadRow> = {}): PageReadRow => ({
  slug: 'example-lab-0001',
  name: 'Example Lab',
  entityType: 'FACULTY_RESEARCH_AREA',
  kind: 'individual',
  observations: [],
  rowsSharingTheWebsiteUrl: 0,
  ...overrides,
});

describe('promote-declared-lab', () => {
  it('sets the type and refuses any observation asserting the person-scoped one', () => {
    // The promotion is allowed because the page NAMES the laboratory, not because a
    // website exists. A surviving person-scoped observation would re-derive over the
    // stored value, so it is refused in the same pass.
    const { plan } = planPageReadVerdict(
      row({
        observations: [
          { field: 'entityType', value: 'FACULTY_RESEARCH_AREA' },
          { field: 'kind', value: 'individual' },
        ],
      }),
      'promote-declared-lab',
    );
    expect(plan?.set).toEqual({ entityType: 'LAB', kind: 'lab' });
    expect(plan?.refusals).toEqual([
      { field: 'entityType', value: 'FACULTY_RESEARCH_AREA' },
      { field: 'kind', value: 'individual' },
    ]);
  });

  it('needs no refusal when nothing observes the type', () => {
    const { plan } = planPageReadVerdict(row(), 'promote-declared-lab');
    expect(plan?.refusals).toEqual([]);
    expect(plan?.set.entityType).toBe('LAB');
  });

  it('does nothing to a row already carrying the declared type', () => {
    expect(planPageReadVerdict(row({ entityType: 'LAB' }), 'promote-declared-lab').refused).toBe(
      'already-the-declared-type',
    );
  });
});

describe('refuse-borrowed-site', () => {
  it('refuses the url when no other row carries it', () => {
    const { plan } = planPageReadVerdict(
      row({ websiteUrl: 'https://example.invalid/department/' }),
      'refuse-borrowed-site',
    );
    expect(plan?.refusals).toEqual([
      { field: 'websiteUrl', value: 'https://example.invalid/department/' },
    ]);
    // Refused AND cleared: a refusal blocks re-admission but does not remove what the
    // row already serves.
    expect(plan?.set).toEqual({ websiteUrl: '' });
  });

  it('refuses to act when another row shares the site', () => {
    // Clearing a borrowed url promotes the borrower, measured at 3 grafted rows
    // published when 10 were cleared, so a shared url needs the other row read first.
    expect(
      planPageReadVerdict(
        row({ websiteUrl: 'https://example.invalid/department/', rowsSharingTheWebsiteUrl: 1 }),
        'refuse-borrowed-site',
      ).refused,
    ).toBe('another-row-shares-the-site');
  });
});

describe('refuse-grafted-organization', () => {
  const grafted = row({
    name: 'Example Person Faculty Research',
    displayName: 'Example Affiliated Study Group',
    observations: [
      { field: 'displayName', value: 'Example Affiliated Study Group' },
      { field: 'name', value: 'Example Affiliated Study Group' },
      { field: 'entityType', value: 'LAB' },
      { field: 'kind', value: 'lab' },
    ],
  });

  it('refuses every field the graft reaches, not only the heading', () => {
    const { plan } = planPageReadVerdict(grafted, 'refuse-grafted-organization');
    expect(plan?.refusals).toEqual([
      { field: 'displayName', value: 'Example Affiliated Study Group' },
      { field: 'name', value: 'Example Affiliated Study Group' },
      { field: 'entityType', value: 'LAB' },
      { field: 'kind', value: 'lab' },
    ]);
    expect(plan?.set).toEqual({ displayName: '' });
  });

  it('refuses to act when the row has no other heading to fall back on', () => {
    // The fallback rule: an empty corrected heading preserves the fabrication rather
    // than removing it.
    expect(
      planPageReadVerdict(
        row({ name: '', displayName: 'Example Affiliated Study Group' }),
        'refuse-grafted-organization',
      ).refused,
    ).toBe('refusing-the-name-would-leave-no-heading');
    expect(
      planPageReadVerdict(
        row({
          name: 'Example Affiliated Study Group',
          displayName: 'Example Affiliated Study Group',
        }),
        'refuse-grafted-organization',
      ).refused,
    ).toBe('refusing-the-name-would-leave-no-heading');
  });
});

describe('every arm', () => {
  it('never reverses an operator decision', () => {
    for (const arm of [
      'promote-declared-lab',
      'refuse-borrowed-site',
      'refuse-grafted-organization',
    ] as const) {
      expect(planPageReadVerdict(row({ manuallyLockedFields: ['name'] }), arm).refused).toBe(
        'manually-locked',
      );
    }
  });

  it('requires a slug, a known arm and the page as evidence, with no bulk mode', () => {
    expect(() => parsePageReadVerdictArgs(['--arm=promote-declared-lab'])).toThrow(
      /--slug is required/,
    );
    expect(() => parsePageReadVerdictArgs(['--slug=x', '--arm=guess'])).toThrow(
      /--arm must be one of/,
    );
    expect(() => parsePageReadVerdictArgs(['--slug=x', '--arm=promote-declared-lab'])).toThrow(
      /--evidence-url is required/,
    );
    expect(() => parsePageReadVerdictArgs(['--all'])).toThrow(/Unknown argument/);
  });
});
