import { describe, expect, it } from 'vitest';
import {
  entityKeysWhoseLabClaimOnlyAGrantLaneWrote,
  entityKeysWithNonGrantLabEvidence,
  planGrantMintedLabShellRetype,
  summarizeGrantShellRetypeRefusals,
  type GrantShellRow,
} from '../retypeGrantMintedLabShellsCore';

const shell = (overrides: Partial<GrantShellRow> = {}): GrantShellRow => ({
  id: 'id-1',
  slug: 'nih-pi-jordan-avery',
  name: 'Jordan Avery Lab',
  kind: 'lab',
  entityType: 'LAB',
  ...overrides,
});

describe('grant-minted lab shell retype plan (#3145)', () => {
  it('renames a grant-only lab claim to a person-scoped research record', () => {
    const outcome = planGrantMintedLabShellRetype([shell()], new Set(), new Set());
    expect(outcome.refused).toEqual([]);
    expect(outcome.plans).toHaveLength(1);
    expect(outcome.plans[0].correctedName).toBe('Jordan Avery Faculty Research');
    expect(outcome.plans[0].currentName).toBe('Jordan Avery Lab');
  });

  it('handles the Laboratory spelling as well as Lab', () => {
    const outcome = planGrantMintedLabShellRetype(
      [shell({ name: 'Jordan Avery Laboratory' })],
      new Set(),
      new Set(),
    );
    expect(outcome.plans[0].correctedName).toBe('Jordan Avery Faculty Research');
  });

  it('refuses a lab a page-reading source also asserts', () => {
    const outcome = planGrantMintedLabShellRetype(
      [shell()],
      new Set(['nih-pi-jordan-avery']),
      new Set(),
    );
    expect(outcome.plans).toEqual([]);
    expect(outcome.refused[0].reason).toBe('lab-corroborated-by-another-source');
  });

  it('refuses a shell carrying a website of its own', () => {
    const withUrl = planGrantMintedLabShellRetype(
      [shell({ websiteUrl: 'https://example.yale.edu/lab/avery/' })],
      new Set(),
      new Set(),
    );
    expect(withUrl.refused[0].reason).toBe('carries-a-website-of-its-own');
    const withLegacyUrl = planGrantMintedLabShellRetype(
      [shell({ website: 'https://example.yale.edu/lab/avery/' })],
      new Set(),
      new Set(),
    );
    expect(withLegacyUrl.refused[0].reason).toBe('carries-a-website-of-its-own');
  });

  it('withdraws a name-only lab claim even when the row carries a website', () => {
    // 16 served rows sat here. All of them are typed person-scoped already, all
    // carry a website, and their "<person> Lab" name was minted by a grant lane in
    // one 13-minute window two months before #3145 fixed that lane. Today's lane
    // emits the person-scoped suffix for every one of them, and no re-run retracts a
    // stored value, so the website was protecting a string no source asserts (#3252).
    const outcome = planGrantMintedLabShellRetype(
      [
        shell({
          kind: 'individual',
          entityType: 'FACULTY_RESEARCH_AREA',
          websiteUrl: 'https://example.yale.edu/avery/',
        }),
      ],
      new Set(),
      new Set(),
    );
    expect(outcome.refused).toEqual([]);
    expect(outcome.plans).toHaveLength(1);
    expect(outcome.plans[0].correctedName).toBe('Jordan Avery Faculty Research');
    // The name is withdrawn, never the type: the site may well be a lab's, so this
    // lane must not read a website as grounds to demote what the row claims to be.
    expect(outcome.plans[0].typeAssertsALab).toBe(false);
    expect(outcome.plans[0].nameAssertsALab).toBe(true);
  });

  it('still refuses a website-carrying row whose TYPE asserts the lab', () => {
    // Correcting the name alone on a row typed LAB would be undone next pass, because
    // the materializer re-derives the suffix from `entityType` (#3269), so the repair
    // and the engine would alternate forever.
    const outcome = planGrantMintedLabShellRetype(
      [shell({ websiteUrl: 'https://example.yale.edu/lab/avery/' })],
      new Set(),
      new Set(),
    );
    expect(outcome.plans).toEqual([]);
    expect(outcome.refused[0].reason).toBe('carries-a-website-of-its-own');
  });

  it('withdraws a whole lab claim whose only writer is a funding lane, website or not', () => {
    // The consistently-wrong row. Name and type both assert the lab, both were written
    // by the same pre-#3145 funding lane, and nothing outside those lanes asserts a lab
    // about it. It agrees with itself, so no consistency check can see it; keeping it
    // because a site exists would retain a promotion on the signal #2686 disqualified.
    const outcome = planGrantMintedLabShellRetype(
      [shell({ websiteUrl: 'https://example.yale.edu/lab/avery/' })],
      new Set(),
      new Set(['nih-pi-jordan-avery']),
    );
    expect(outcome.refused).toEqual([]);
    expect(outcome.plans).toHaveLength(1);
    expect(outcome.plans[0].correctedName).toBe('Jordan Avery Faculty Research');
    // Both arms travel together, and the apply order is name, then `entityType`, then a
    // single rematerialize, so #3269's suffix re-derivation reads the corrected type.
    expect(outcome.plans[0].nameAssertsALab).toBe(true);
    expect(outcome.plans[0].typeAssertsALab).toBe(true);
  });

  it('puts a key in the writer set only when a funding lane wrote the claim alone', () => {
    const grantOnly = entityKeysWhoseLabClaimOnlyAGrantLaneWrote([
      {
        entityKey: 'nih-pi-jordan-avery',
        field: 'name',
        value: 'Avery Lab',
        sourceName: 'nih-reporter',
      },
    ]);
    expect(grantOnly.has('nih-pi-jordan-avery')).toBe(true);

    // Anything outside the funding lanes takes the key out, an operator edit included:
    // the question this set answers is who wrote the claim.
    const alsoAnOperator = entityKeysWhoseLabClaimOnlyAGrantLaneWrote([
      {
        entityKey: 'nih-pi-jordan-avery',
        field: 'name',
        value: 'Avery Lab',
        sourceName: 'nih-reporter',
      },
      {
        entityKey: 'nih-pi-jordan-avery',
        field: 'name',
        value: 'Avery Lab',
        sourceName: 'manual-admin-edit',
      },
    ]);
    expect(alsoAnOperator.has('nih-pi-jordan-avery')).toBe(false);

    // Membership is positive on both halves. A row no lane asserts a lab about has no
    // writer, so it is stored residue and a different defect: reading it as writer-only
    // put 62 extra rows in the planner and 129 in the audit where the cohort is 14.
    expect(entityKeysWhoseLabClaimOnlyAGrantLaneWrote([]).size).toBe(0);

    // The corroboration set answers the other question and deliberately discounts the
    // row's own naming lane, so the two must not be substituted for each other.
    const corroboration = entityKeysWithNonGrantLabEvidence(
      [
        {
          entityKey: 'nih-pi-jordan-avery',
          field: 'name',
          value: 'Avery Lab',
          sourceName: 'manual-admin-edit',
        },
      ],
      new Map([['nih-pi-jordan-avery', 'manual-admin-edit']]),
    );
    expect(corroboration.has('nih-pi-jordan-avery')).toBe(false);
  });

  it('never reverses an operator decision', () => {
    for (const field of ['name', 'kind', 'entityType']) {
      const outcome = planGrantMintedLabShellRetype(
        [shell({ manuallyLockedFields: [field] })],
        new Set(),
        new Set(),
      );
      expect(outcome.refused[0].reason).toBe('manually-locked');
    }
  });

  it('refuses rather than guesses when the name does not reduce to a person name', () => {
    const outcome = planGrantMintedLabShellRetype(
      [shell({ name: 'Molecular Biophysics Lab' })],
      new Set(),
      new Set(),
    );
    expect(outcome.plans).toEqual([]);
    expect(outcome.refused[0].reason).toBe('name-does-not-match-the-shell-key');
  });

  it('refuses a name that reduces to a person the shell key does not name', () => {
    const outcome = planGrantMintedLabShellRetype(
      [shell({ name: 'Perry Lowell Lab' })],
      new Set(),
      new Set(),
    );
    expect(outcome.plans).toEqual([]);
    expect(outcome.refused[0].reason).toBe('name-does-not-match-the-shell-key');
  });

  it('accepts an extra middle name on either side of the shell key', () => {
    const extraInName = planGrantMintedLabShellRetype(
      [shell({ name: 'Jordan Blake Avery Lab' })],
      new Set(),
      new Set(),
    );
    expect(extraInName.plans[0].correctedName).toBe('Jordan Blake Avery Faculty Research');
    const objectIdKey = planGrantMintedLabShellRetype(
      [shell({ slug: 'nsf-pi-6512f0a1c2d3e4f5a6b7c8d9' })],
      new Set(),
      new Set(),
    );
    expect(objectIdKey.plans[0].correctedName).toBe('Jordan Avery Faculty Research');
  });

  it('plans the type arm on its own evidence, so a landed rename does not blind it', () => {
    const renamedButStillTypedLab = planGrantMintedLabShellRetype(
      [shell({ name: 'Jordan Avery Faculty Research' })],
      new Set(),
      new Set(),
    );
    expect(renamedButStillTypedLab.refused).toEqual([]);
    expect(renamedButStillTypedLab.plans[0].nameAssertsALab).toBe(false);
    expect(renamedButStillTypedLab.plans[0].typeAssertsALab).toBe(true);
    expect(renamedButStillTypedLab.plans[0].correctedName).toBe('Jordan Avery Faculty Research');

    const retypedButStillNamedLab = planGrantMintedLabShellRetype(
      [shell({ kind: 'individual', entityType: 'FACULTY_RESEARCH_AREA' })],
      new Set(),
      new Set(),
    );
    expect(retypedButStillNamedLab.plans[0].nameAssertsALab).toBe(true);
    expect(retypedButStillNamedLab.plans[0].typeAssertsALab).toBe(false);
  });

  it('leaves a row alone when neither its name nor its type asserts a lab, and treats a non-grant slug as a candidate', () => {
    const noLab = planGrantMintedLabShellRetype(
      [
        shell({
          name: 'Jordan Avery Faculty Research',
          kind: 'individual',
          entityType: 'FACULTY_RESEARCH_AREA',
        }),
      ],
      new Set(),
      new Set(),
    );
    expect(noLab.refused[0].reason).toBe('not-a-lab-claim');
    // A non-grant slug is now a candidate, because the candidate test is the row's own
    // claim rather than the lane that minted it (#3266).
    const nonGrantSlug = planGrantMintedLabShellRetype(
      [shell({ slug: 'ysm-faculty-jordan-avery' })],
      new Set(),
      new Set(),
    );
    expect(nonGrantSlug.refused).toEqual([]);
    expect(nonGrantSlug.plans[0].correctedName).toBe('Jordan Avery Faculty Research');
  });

  it('counts a non-grant lab assertion from any field, and ignores a grant lane one', () => {
    const keys = entityKeysWithNonGrantLabEvidence([
      { entityKey: 'nih-pi-a', field: 'name', value: 'Person A Lab', sourceName: 'nih-reporter' },
      {
        entityKey: 'nih-pi-b',
        field: 'displayName',
        value: 'Person B Lab',
        sourceName: 'lab-microsite-description-llm',
      },
      { entityKey: 'nih-pi-c', field: 'kind', value: 'lab', sourceName: 'manual-admin-edit' },
      {
        entityKey: 'nih-pi-d',
        field: 'entityType',
        value: 'LAB',
        sourceName: 'official-profile-pi-backfill',
      },
      {
        entityKey: 'nih-pi-e',
        field: 'entityType',
        value: 'FACULTY_RESEARCH_AREA',
        sourceName: 'official-profile-pi-backfill',
      },
    ]);
    expect([...keys].sort()).toEqual(['nih-pi-b', 'nih-pi-c', 'nih-pi-d']);
  });

  it('summarizes every refusal reason so a zero is a measured zero', () => {
    const counts = summarizeGrantShellRetypeRefusals([
      { reason: 'manually-locked' },
      { reason: 'manually-locked' },
    ]);
    expect(counts['manually-locked']).toBe(2);
    expect(counts['carries-a-website-of-its-own']).toBe(0);
    expect(Object.keys(counts)).toHaveLength(6);
  });

  it('does not let a row be corroborated by the lane that named it (#3266)', () => {
    const assertions = [
      {
        entityKey: 'ysm-fixture',
        field: 'name',
        value: 'Fixture Lab',
        sourceName: 'ysm-faculty-directory',
      },
    ];
    // With no naming lane supplied the assertion counts, which is the pre-#3266 behaviour.
    expect([...entityKeysWithNonGrantLabEvidence(assertions)]).toEqual(['ysm-fixture']);
    // Once the row's own naming lane is known, its own assertion cannot corroborate it.
    expect([
      ...entityKeysWithNonGrantLabEvidence(
        assertions,
        new Map([['ysm-fixture', 'ysm-faculty-directory']]),
      ),
    ]).toEqual([]);
    // Another lane still corroborates.
    expect([
      ...entityKeysWithNonGrantLabEvidence(
        assertions,
        new Map([['ysm-fixture', 'dept-faculty-roster']]),
      ),
    ]).toEqual(['ysm-fixture']);
  });
});
