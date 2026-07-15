import { describe, expect, it } from 'vitest';
import { validateLeadIdentityConsistency } from '../leadIdentityConsistency';

describe('validateLeadIdentityConsistency', () => {
  it('matches stable faculty identity', () => {
    expect(
      validateLeadIdentityConsistency({ facultyMemberId: 'f1' }, { facultyMemberId: 'F1' }).status,
    ).toBe('matched');
  });

  it('does not guess from a matching name alone', () => {
    expect(validateLeadIdentityConsistency({ name: 'Tore Eid' }, { name: 'Tore Eid' }).status).toBe(
      'under_review',
    );
  });

  it('guards the known YNN wrong-person pairing', () => {
    expect(
      validateLeadIdentityConsistency(
        { facultyMemberId: 'tore-eid', name: 'Tore Eid' },
        { facultyMemberId: 'hitten-zaveri', name: 'Hitten Zaveri' },
      ),
    ).toMatchObject({ status: 'under_review', selected: null });
  });

  it('reconciles only decisively stronger evidence', () => {
    expect(
      validateLeadIdentityConsistency(
        {
          facultyMemberId: 'f1',
          netid: 'te1',
          profileUrl: 'https://medicine.yale.edu/profile/tore-eid/',
        },
        { name: 'Hitten Zaveri', profileUrl: 'https://medicine.yale.edu/profile/hitten-zaveri/' },
      ),
    ).toMatchObject({ status: 'reconciled', selected: 'member' });
  });

  it('reports missing evidence without inventing an identity', () => {
    expect(validateLeadIdentityConsistency()).toEqual({
      status: 'missing',
      selected: null,
      reason: 'no_lead_evidence',
    });
  });
});
