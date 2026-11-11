import { describe, expect, it } from 'vitest';
import {
  investigatorIsProvablyNotALead,
  namesCouldBeOnePerson,
  type GrantPersonIdentity,
} from '../grantLeadIdentity';

const lead: GrantPersonIdentity = { id: 'lead', displayName: 'Robin Synthetic', netid: 'rs1' };
const listed = (person: GrantPersonIdentity) => new Map([[person.id, person]]);

describe('an investigator is provably not the row lead only on positive evidence (#5779)', () => {
  it('is provable for a different netid and an incompatible given name', () => {
    const other = { id: 'other', displayName: 'Quinn Synthetic', netid: 'qs2' };
    expect(investigatorIsProvablyNotALead({ researcherId: 'other' }, [lead], listed(other))).toBe(
      true,
    );
  });

  it('is not provable for a duplicate record that shares the lead name', () => {
    const duplicate = { id: 'dup', displayName: 'Robin Synthetic', netid: 'rs9' };
    expect(investigatorIsProvablyNotALead({ researcherId: 'dup' }, [lead], listed(duplicate))).toBe(
      false,
    );
  });

  it('is not provable when the award lists the lead initial under another given name', () => {
    const split = { id: 'split', displayName: 'Casey Synthetic', netid: 'cs3' };
    expect(
      investigatorIsProvablyNotALead(
        { researcherId: 'split', name: 'R Casey Synthetic' },
        [lead],
        listed(split),
      ),
    ).toBe(false);
  });

  it('is not provable when either record has no netid', () => {
    const noNetid = { id: 'other', displayName: 'Quinn Synthetic' };
    expect(investigatorIsProvablyNotALead({ researcherId: 'other' }, [lead], listed(noNetid))).toBe(
      false,
    );
    const other = { id: 'other', displayName: 'Quinn Synthetic', netid: 'qs2' };
    expect(
      investigatorIsProvablyNotALead(
        { researcherId: 'other' },
        [{ id: 'lead', displayName: 'Robin Synthetic' }],
        listed(other),
      ),
    ).toBe(false);
  });

  it('is not provable for a record recorded as the lead duplicate or distinct pair', () => {
    const folded = {
      id: 'other',
      displayName: 'Quinn Synthetic',
      netid: 'qs2',
      dedupedIntoResearcherId: 'lead',
    };
    expect(investigatorIsProvablyNotALead({ researcherId: 'other' }, [lead], listed(folded))).toBe(
      false,
    );
    const paired = { ...lead, distinctFromResearcherIds: ['other'] };
    const other = { id: 'other', displayName: 'Quinn Synthetic', netid: 'qs2' };
    expect(investigatorIsProvablyNotALead({ researcherId: 'other' }, [paired], listed(other))).toBe(
      false,
    );
  });

  it('is not provable for an investigator the lane resolved to no researcher', () => {
    expect(
      investigatorIsProvablyNotALead({ contact: false, profileId: 7 }, [lead], new Map()),
    ).toBe(false);
  });

  it('reads given names as compatible on an initial or a shared prefix only', () => {
    expect(namesCouldBeOnePerson('Robin Synthetic', 'R Synthetic')).toBe(true);
    expect(namesCouldBeOnePerson('Rob Synthetic', 'Robin Synthetic')).toBe(true);
    expect(namesCouldBeOnePerson('Robin Synthetic', 'Rowan Synthetic')).toBe(false);
    expect(namesCouldBeOnePerson('Robin Synthetic', 'Robin Otherfamily')).toBe(false);
  });
});
