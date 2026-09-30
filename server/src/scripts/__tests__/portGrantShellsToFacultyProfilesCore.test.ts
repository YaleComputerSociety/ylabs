import { describe, expect, it } from 'vitest';
import {
  personNameForFacultySlug,
  planGrantOnlyArchival,
  planGrantShellPort,
  portableGrantShellFields,
  summarizeGrantShellPort,
  unionRecentGrants,
  type GrantShellPortInput,
  type GrantShellPortRow,
} from '../portGrantShellsToFacultyProfilesCore';

const shell = (overrides: Partial<GrantShellPortRow> = {}): GrantShellPortRow => ({
  id: 'shell-1',
  slug: 'nih-pi-jordan-avery',
  entityType: 'FACULTY_RESEARCH_AREA',
  studentVisibilityTier: 'student_ready',
  ...overrides,
});

const input = (overrides: Partial<GrantShellPortInput> = {}): GrantShellPortInput => ({
  shells: [shell()],
  leadPersonIdsByEntityId: new Map([['shell-1', ['person-1']]]),
  personNameById: new Map([['person-1', 'Jordan Avery']]),
  liveFacultyRowsByPersonId: new Map(),
  rowsHoldingSlug: new Map(),
  tombstoneTerminusIdByArchivedRowId: new Map(),
  ...overrides,
});

describe('grant shell port onto a faculty research profile', () => {
  it('creates a person-scoped faculty row named from the lead, not the grant key', () => {
    const outcome = planGrantShellPort(
      input({
        shells: [shell({ slug: 'nsf-pi-0123456789abcdef01234567' })],
      }),
    );
    expect(outcome.refused).toEqual([]);
    expect(outcome.plans).toEqual([
      {
        kind: 'created-faculty-row',
        survivorSlug: 'faculty-research-area-jordan-avery',
        templateShellId: 'shell-1',
        shellIds: ['shell-1'],
      },
    ]);
  });

  it('merges into the one live faculty row the same lead already has', () => {
    const outcome = planGrantShellPort(
      input({
        liveFacultyRowsByPersonId: new Map([
          [
            'person-1',
            [{ id: 'fra-1', slug: 'bbs-jordan-avery', entityType: 'FACULTY_RESEARCH_AREA' }],
          ],
        ]),
      }),
    );
    expect(outcome.plans).toEqual([
      {
        kind: 'existing-faculty-row',
        survivorId: 'fra-1',
        survivorSlug: 'bbs-jordan-avery',
        shellIds: ['shell-1'],
      },
    ]);
  });

  it('refuses to choose between several faculty rows for one person', () => {
    const rows = [
      { id: 'fra-1', slug: 'bbs-jordan-avery', entityType: 'FACULTY_RESEARCH_AREA' },
      { id: 'fra-2', slug: 'ysm-faculty-jordan-avery', entityType: 'FACULTY_RESEARCH_AREA' },
    ];
    const outcome = planGrantShellPort(
      input({ liveFacultyRowsByPersonId: new Map([['person-1', rows]]) }),
    );
    expect(outcome.plans).toEqual([]);
    expect(outcome.refused).toEqual([
      { shellId: 'shell-1', reason: 'severalFacultyRowsForPerson' },
    ]);
  });

  it('revives the faculty row that was folded into this grant row earlier', () => {
    const holder = {
      id: 'old-fra',
      slug: 'faculty-research-area-jordan-avery',
      entityType: 'FACULTY_RESEARCH_AREA',
      archived: true,
    };
    const outcome = planGrantShellPort(
      input({
        rowsHoldingSlug: new Map([[holder.slug, holder]]),
        tombstoneTerminusIdByArchivedRowId: new Map([['old-fra', 'shell-1']]),
      }),
    );
    expect(outcome.plans).toEqual([
      {
        kind: 'revived-faculty-row',
        survivorId: 'old-fra',
        survivorSlug: 'faculty-research-area-jordan-avery',
        shellIds: ['shell-1'],
      },
    ]);
  });

  it('refuses a target slug an unrelated row holds, live or archived', () => {
    const slug = 'faculty-research-area-jordan-avery';
    const live = planGrantShellPort(
      input({
        rowsHoldingSlug: new Map([
          [slug, { id: 'other', slug, entityType: 'FACULTY_RESEARCH_AREA' }],
        ]),
      }),
    );
    expect(live.refused).toEqual([{ shellId: 'shell-1', reason: 'targetSlugHeldByAnotherRow' }]);

    const archived = planGrantShellPort(
      input({
        rowsHoldingSlug: new Map([
          [slug, { id: 'other', slug, entityType: 'FACULTY_RESEARCH_AREA', archived: true }],
        ]),
        tombstoneTerminusIdByArchivedRowId: new Map([['other', 'somebody-else']]),
      }),
    );
    expect(archived.refused).toEqual([
      { shellId: 'shell-1', reason: 'targetSlugHeldByUnrelatedArchivedRow' },
    ]);
  });

  it('leaves a lab-typed grant row in place, because the faculty prefix reads as a profile shell', () => {
    const outcome = planGrantShellPort(input({ shells: [shell({ entityType: 'LAB' })] }));
    expect(outcome.plans).toEqual([]);
    expect(outcome.refused).toEqual([{ shellId: 'shell-1', reason: 'labTyped' }]);
  });

  it('refuses a row with several leads, and an unled row whose key names no person', () => {
    const severalLeads = planGrantShellPort(
      input({ leadPersonIdsByEntityId: new Map([['shell-1', ['person-1', 'person-2']]]) }),
    );
    expect(severalLeads.refused).toEqual([{ shellId: 'shell-1', reason: 'severalLeads' }]);

    const unnamed = planGrantShellPort(
      input({
        shells: [shell({ slug: 'nsf-pi-0123456789abcdef01234567' })],
        leadPersonIdsByEntityId: new Map(),
      }),
    );
    expect(unnamed.refused).toEqual([{ shellId: 'shell-1', reason: 'noPersonName' }]);
  });

  it('names an unled row from its key when the key carries a person name', () => {
    const outcome = planGrantShellPort(input({ leadPersonIdsByEntityId: new Map() }));
    expect(outcome.plans[0]).toMatchObject({
      kind: 'created-faculty-row',
      survivorSlug: 'faculty-research-area-jordan-avery',
    });
  });

  it('folds two grant rows for one person into one survivor, templated on the served one', () => {
    const outcome = planGrantShellPort(
      input({
        shells: [
          shell({ id: 'nih', slug: 'nih-pi-jordan-avery', studentVisibilityTier: 'suppressed' }),
          shell({ id: 'nsf', slug: 'nsf-pi-jordan-avery', studentVisibilityTier: 'student_ready' }),
        ],
        leadPersonIdsByEntityId: new Map([
          ['nih', ['person-1']],
          ['nsf', ['person-1']],
        ]),
      }),
    );
    expect(outcome.plans).toEqual([
      {
        kind: 'created-faculty-row',
        survivorSlug: 'faculty-research-area-jordan-avery',
        templateShellId: 'nsf',
        shellIds: ['nih', 'nsf'],
      },
    ]);
    expect(summarizeGrantShellPort(outcome).shellsBySurvivorKind['created-faculty-row']).toBe(2);
  });

  it('drops credentials and parentheticals from a display name before slugging it', () => {
    expect(personNameForFacultySlug('Jordan (JJ) Avery, MD, PhD')).toBe('Jordan Avery');
  });

  it('copies everything but identity and lifecycle fields onto the survivor', () => {
    const copied = portableGrantShellFields({
      _id: 'x',
      slug: 'nih-pi-jordan-avery',
      archived: false,
      canonicalGroupId: null,
      createdAt: new Date(0),
      name: 'Jordan Avery Faculty Research',
      manuallyLockedFields: ['fullDescription'],
      fieldValueRefusals: [{ field: 'websiteUrl' }],
      fieldProvenance: { name: { sourceName: 'nih-reporter' } },
    });
    expect(Object.keys(copied).sort()).toEqual([
      'fieldProvenance',
      'fieldValueRefusals',
      'manuallyLockedFields',
      'name',
    ]);
  });

  it('unions grants by award id so a merge never counts one award twice', () => {
    expect(
      unionRecentGrants([
        { recentGrants: [{ id: 'R01-1', title: 'a' }] },
        {
          recentGrants: [
            { id: 'R01-1', title: 'a' },
            { id: 'R21-2', title: 'b' },
          ],
        },
      ]),
    ).toEqual([
      { id: 'R01-1', title: 'a' },
      { id: 'R21-2', title: 'b' },
    ]);
  });
});

describe('grant-only rows are archived, not ported (#3992)', () => {
  it('refuses to port a grant row whose every citation is a grant record', () => {
    const outcome = planGrantShellPort(input({ shells: [shell({ grantOnly: true })] }));
    expect(outcome.plans).toEqual([]);
    expect(outcome.refused).toEqual([{ shellId: 'shell-1', reason: 'grantOnlyEvidence' }]);
  });

  it('archives a grant-only faculty row and leaves one an operator locked or overrode', () => {
    const plan = planGrantOnlyArchival([
      { id: 'plain', entityType: 'FACULTY_RESEARCH_AREA', grantOnly: true },
      {
        id: 'locked',
        entityType: 'FACULTY_RESEARCH_AREA',
        grantOnly: true,
        manuallyLockedFields: ['fullDescription'],
      },
      {
        id: 'overridden',
        entityType: 'FACULTY_RESEARCH_AREA',
        grantOnly: true,
        studentVisibilityOverrideTier: 'student_ready',
      },
      { id: 'corroborated', entityType: 'FACULTY_RESEARCH_AREA', grantOnly: false },
      { id: 'lab', entityType: 'LAB', grantOnly: true },
    ]);
    expect(plan).toEqual({
      archiveIds: ['plain'],
      keptForOperatorIntentIds: ['locked', 'overridden'],
    });
  });
});
