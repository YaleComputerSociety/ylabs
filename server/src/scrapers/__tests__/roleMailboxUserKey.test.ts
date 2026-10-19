import { describe, expect, it } from 'vitest';
import {
  inferredPiKeyNamesRoleOrUnitMailbox,
  userKeyNamesRoleOrUnitMailbox,
} from '../roleMailboxUserKey';

const unitProfile = 'https://physics.yale.edu/profile/ann-alpha';
const personObservations = (sourceUrl: string, fname = 'Ann', lname = 'Alpha') => [
  { field: 'fname', value: fname, sourceUrl },
  { field: 'lname', value: lname, sourceUrl },
  { field: 'title', value: 'Professor of Physics', sourceUrl },
];

describe('userKeyNamesRoleOrUnitMailbox', () => {
  it('flags a key minted from the mailbox of the unit whose pages it was read from', () => {
    expect(userKeyNamesRoleOrUnitMailbox('netid:physics', personObservations(unitProfile))).toBe(
      true,
    );
  });

  it('flags a role-word key whatever its pages', () => {
    expect(
      userKeyNamesRoleOrUnitMailbox(
        'netid:unitx.dus',
        personObservations('https://example.org/x'),
      ),
    ).toBe(true);
  });

  it('keeps a unit-name key when the address names the person the key observes', () => {
    expect(
      userKeyNamesRoleOrUnitMailbox(
        'netid:physics',
        personObservations(unitProfile, 'Ann', 'Physics'),
      ),
    ).toBe(false);
  });

  it('keeps person keys and keys of another shape', () => {
    expect(userKeyNamesRoleOrUnitMailbox('netid:aa123', personObservations(unitProfile))).toBe(
      false,
    );
    expect(
      userKeyNamesRoleOrUnitMailbox('netid:ann.alpha', personObservations(unitProfile)),
    ).toBe(false);
    expect(
      userKeyNamesRoleOrUnitMailbox('dept:physics:ann-alpha', personObservations(unitProfile)),
    ).toBe(false);
  });

  it('needs unit evidence for a bare unit-name key', () => {
    expect(
      userKeyNamesRoleOrUnitMailbox('netid:physics', personObservations('https://example.org/x')),
    ).toBe(false);
  });
});

describe('inferredPiKeyNamesRoleOrUnitMailbox', () => {
  it('reads the unit from the roster page the research row observation cites', () => {
    const observation = {
      field: 'inferredPiUserKey',
      value: 'netid:physics',
      sourceUrl: 'https://physics.yale.edu/people/faculty',
    };
    expect(inferredPiKeyNamesRoleOrUnitMailbox('netid:physics', observation)).toBe(true);
    expect(inferredPiKeyNamesRoleOrUnitMailbox('netid:ann.alpha', observation)).toBe(false);
    expect(inferredPiKeyNamesRoleOrUnitMailbox('dept:physics:ann-alpha', observation)).toBe(
      false,
    );
  });
});
