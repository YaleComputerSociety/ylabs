import { describe, expect, it } from 'vitest';
import { materializeEntity } from '../../scrapers/entityMaterializer';
import {
  decideRefusedRedraftRetire,
  fallbackServesAfterRetire,
  refusedRedraftRetireReason,
} from '../refusedRedraftBodyRetire';

const BODY = 'Studies volcanic seismology using borehole strainmeters on Pacific island arcs.';

describe('refused redraft retire decision (#5961)', () => {
  it('keeps a supported body whatever the fallback', () => {
    expect(
      decideRefusedRedraftRetire({ adoptedBodyStillSupported: true, fallbackServes: true }),
    ).toBe('kept-supported');
  });

  it('retires an unsupported body only with a fallback that serves', () => {
    expect(
      decideRefusedRedraftRetire({ adoptedBodyStillSupported: false, fallbackServes: true }),
    ).toBe('retire-with-fallback');
    expect(
      decideRefusedRedraftRetire({ adoptedBodyStillSupported: false, fallbackServes: false }),
    ).toBe('residual-no-fallback');
  });

  it('names the contract, the refusal and the failed support check in the reason', () => {
    expect(refusedRedraftRetireReason('written-description-5961-v2', 'empty-description')).toBe(
      'written-description-refused-redraft:written-description-5961-v2:draft-refused=empty-description:adopted-body-failed-support-check',
    );
  });

  it('finds no fallback when the projection unsets the field or keeps the retired body', () => {
    const base = { entityDoc: { fullDescription: BODY }, retiredBody: BODY, leadPersonName: '' };
    expect(
      fallbackServesAfterRetire({ ...base, plannedSet: {}, plannedUnset: { fullDescription: '' } }),
    ).toBe(false);
    expect(fallbackServesAfterRetire({ ...base, plannedSet: {}, plannedUnset: {} })).toBe(false);
    expect(
      fallbackServesAfterRetire({ ...base, plannedSet: { fullDescription: '' }, plannedUnset: {} }),
    ).toBe(false);
  });

  it('refuses a planned retire outside a dry run', async () => {
    await expect(
      materializeEntity(
        'researchEntity',
        { entityKey: 'fixture' },
        { treatObservationIdsAsRetired: new Set(['x']) },
      ),
    ).rejects.toThrow('treatObservationIdsAsRetired requires dryRun');
  });
});
