import { describe, expect, it } from 'vitest';
import { syntheticPersonOrcid, withOrcidCheckDigit } from '../../test/syntheticOrcid';
import {
  buildCanonicalNameIndex,
  buildYaleOfficialProfileIndex,
  decideShellMerge,
  planAccountlessClusterFolds,
  sharedOfficialProfileNamesAgree,
  type ShellIdentity,
} from '../dedupeAccountlessResearcherShellsCore';

const REAL_ORCID = syntheticPersonOrcid(601);
const OTHER_ORCID = syntheticPersonOrcid(602);
const YEAR_RUN_ORCID = '2025-2024-2023-2022';
const OUT_OF_RANGE_ORCID = withOrcidCheckDigit('104973150123456');

const officialLink = (path: string, healthStatus = 'UNKNOWN') => ({
  kind: 'YALE_OFFICIAL',
  purpose: 'PRIMARY_IDENTITY',
  url: `https://medicine.example.edu/profile/${path}/`,
  healthStatus,
});

const directoryRecord = (over: Record<string, unknown> = {}) => ({
  id: 'b'.repeat(24),
  displayName: 'Avery Q. Synth',
  email: 'directory.holder@example.test',
  profileLinks: [officialLink('avery-synth')],
  ...over,
});

const shellRecord = (over: Record<string, unknown> = {}): ShellIdentity & { id: string } => ({
  id: 'a'.repeat(24),
  displayName: 'Avery Synth',
  orcid: REAL_ORCID,
  profileLinks: [officialLink('Avery-Synth')],
  ...over,
});

const decide = (shell: ShellIdentity & { id: string }, others: Array<Record<string, unknown>>) => {
  const all = [shell, ...others] as Array<{ id: string } & Record<string, unknown>>;
  return decideShellMerge(
    shell,
    buildCanonicalNameIndex(all),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    buildYaleOfficialProfileIndex(all),
  );
};

describe('the shared official profile fold into a stronger record (#5990, #6002)', () => {
  it('folds two records of one person that hold the same official page', () => {
    expect(decide(shellRecord(), [directoryRecord()])).toEqual({
      merge: true,
      canonicalId: 'b'.repeat(24),
      reason: 'MERGEABLE',
      matchedOn: 'shared-official-profile',
    });
  });

  it('reads the page through the identity URL normalizer, whatever the probe verdict', () => {
    const shell = shellRecord({
      profileLinks: [
        {
          ...officialLink('avery-synth', 'UNAVAILABLE'),
          url: 'http://www.Medicine.example.edu/profile/avery-synth?tab=bio',
        },
      ],
    });
    expect(decide(shell, [directoryRecord()])).toMatchObject({
      merge: true,
      matchedOn: 'shared-official-profile',
    });
  });

  it('does not fold the same full name on two different official pages', () => {
    const decision = decide(shellRecord(), [
      directoryRecord({ profileLinks: [officialLink('avery-synth-2')] }),
    ]);
    expect(decision.merge).toBe(false);
  });

  it('does not count a non-official link as a shared page', () => {
    const decision = decide(
      shellRecord({
        profileLinks: [{ ...officialLink('avery-synth'), kind: 'LAB_ABOUT' }],
      }),
      [directoryRecord()],
    );
    expect(decision.merge).toBe(false);
  });

  it('refuses a conflicting netid', () => {
    const decision = decide(shellRecord({ netid: 'synth1' }), [
      directoryRecord({ netid: 'synth2' }),
    ]);
    expect(decision).toMatchObject({
      merge: false,
      reason: 'NETID_CONFLICT',
      matchedOn: 'shared-official-profile',
    });
  });

  it('refuses a conflicting plausible ORCID', () => {
    const decision = decide(shellRecord(), [directoryRecord({ orcid: OTHER_ORCID })]);
    expect(decision).toMatchObject({ merge: false, reason: 'ORCID_CONFLICT' });
  });

  it('does not fold two different stated middle initials', () => {
    const decision = decide(shellRecord({ displayName: 'Avery R. Synth' }), [directoryRecord()]);
    expect(decision.merge).toBe(false);
  });

  it('does not fold a different given name on the shared page', () => {
    const decision = decide(shellRecord({ displayName: 'Blair Synth' }), [directoryRecord()]);
    expect(decision.merge).toBe(false);
  });

  it.each([YEAR_RUN_ORCID, OUT_OF_RANGE_ORCID])(
    'treats the bogus ORCID %s as absent, so it neither blocks the fold nor makes a conflict',
    (bogus) => {
      expect(
        decide(shellRecord({ orcid: bogus }), [directoryRecord({ orcid: REAL_ORCID })]),
      ).toMatchObject({ merge: true, matchedOn: 'shared-official-profile' });
      expect(decide(shellRecord(), [directoryRecord({ orcid: bogus })])).toMatchObject({
        merge: true,
        matchedOn: 'shared-official-profile',
      });
    },
  );

  it('resolves two stronger holders of the page to nobody', () => {
    const decision = decide(shellRecord(), [
      directoryRecord(),
      directoryRecord({ id: 'c'.repeat(24), email: 'second.holder@example.test' }),
    ]);
    expect(decision).toMatchObject({ merge: false, reason: 'AMBIGUOUS_MULTIPLE_CANONICAL' });
  });
});

describe('sharedOfficialProfileNamesAgree', () => {
  it('accepts a middle initial stated on one side only', () => {
    expect(sharedOfficialProfileNamesAgree('Avery Synth', 'Avery Q. Synth')).toBe(true);
  });

  it('refuses two different stated middle initials', () => {
    expect(sharedOfficialProfileNamesAgree('Avery Q. Synth', 'Avery R. Synth')).toBe(false);
  });

  it('refuses a missing name', () => {
    expect(sharedOfficialProfileNamesAgree(undefined, 'Avery Synth')).toBe(false);
  });
});

describe('the shared official profile join among records of equal identity (#5990, #6002)', () => {
  const member = (id: string, over: Record<string, unknown> = {}) => ({
    id: id.padStart(24, '0'),
    displayName: 'Avery Synth',
    profileLinks: [officialLink('avery-synth')],
    liveRoleEdges: 0,
    ...over,
  });

  it('folds two name-only records holding one unprobed official page into the survivor', () => {
    const plan = planAccountlessClusterFolds(
      [member('1', { displayName: 'Avery Q. Synth' }), member('2', { liveRoleEdges: 2 })],
      [],
    );
    expect(plan.foldTargetById).toEqual(new Map([['1'.padStart(24, '0'), '2'.padStart(24, '0')]]));
    expect(plan.sharedOfficialProfileFoldIds).toEqual(new Set(['1'.padStart(24, '0')]));
  });

  it('is a no-op on the second run, once the folded record is gone', () => {
    const members = [
      member('1', { displayName: 'Avery Q. Synth' }),
      member('2', { liveRoleEdges: 2 }),
    ];
    const first = planAccountlessClusterFolds(members, []);
    const second = planAccountlessClusterFolds(
      members.filter((entry) => !first.foldTargetById.has(entry.id)),
      [],
    );
    expect(first.foldTargetById.size).toBe(1);
    expect(second.foldTargetById.size).toBe(0);
  });

  it('does not join the same full name on two different official pages', () => {
    const plan = planAccountlessClusterFolds(
      [
        member('1', { displayName: 'Avery Q. Synth' }),
        member('2', { profileLinks: [officialLink('avery-synth-2')] }),
      ],
      [],
    );
    expect(plan.foldTargetById.size).toBe(0);
  });

  it('does not join a conflicting netid', () => {
    const plan = planAccountlessClusterFolds(
      [
        member('1', { displayName: 'Avery Q. Synth', netid: 'synth1' }),
        member('2', { netid: 'synth2' }),
      ],
      [],
    );
    expect(plan.foldTargetById.size).toBe(0);
  });

  it('does not join two different stated middle initials', () => {
    const plan = planAccountlessClusterFolds(
      [
        member('1', { displayName: 'Avery Q. Synth' }),
        member('2', { displayName: 'Avery R. Synth' }),
      ],
      [],
    );
    expect(plan.foldTargetById.size).toBe(0);
  });

  it('refuses a group that two agreeing joins would close over different middle initials', () => {
    const plan = planAccountlessClusterFolds(
      [
        member('1', { displayName: 'Avery Q. Synth' }),
        member('2'),
        member('3', { displayName: 'Avery R. Synth' }),
      ],
      [],
    );
    expect(plan.foldTargetById.size).toBe(0);
    expect(plan.refusedGroups.MIDDLE_INITIAL_CONFLICT).toBe(1);
  });

  it.each([YEAR_RUN_ORCID, OUT_OF_RANGE_ORCID])(
    'treats the bogus ORCID %s as absent in the join',
    (bogus) => {
      const blocked = planAccountlessClusterFolds(
        [
          member('1', { displayName: 'Avery Q. Synth', orcid: bogus }),
          member('2', { orcid: REAL_ORCID }),
        ],
        [],
      );
      expect(blocked.foldTargetById.size).toBe(1);
      const enabled = planAccountlessClusterFolds(
        [
          member('1', { displayName: 'Avery Q. Synth', orcid: bogus }),
          member('2', { orcid: bogus, profileLinks: [officialLink('avery-synth-2')] }),
        ],
        [],
      );
      expect(enabled.foldTargetById.size).toBe(0);
    },
  );

  it.each([{ displayName: 'Avery Synth' }, { displayName: 'Blair Other' }, {}])(
    'joins nobody when a record outside the group holds the page (%o)',
    (outsider) => {
      const plan = planAccountlessClusterFolds(
        [member('1', { displayName: 'Avery Q. Synth' }), member('2')],
        [{ ...outsider, profileLinks: [officialLink('avery-synth')] }],
      );
      expect(plan.foldTargetById.size).toBe(0);
    },
  );
});
