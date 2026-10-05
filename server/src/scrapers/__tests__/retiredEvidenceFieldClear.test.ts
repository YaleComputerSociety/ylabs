import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { REMATERIALIZE_TRACKED_FIELDS } from '../../scripts/rematerializeResearchEntitiesCore';
import {
  RETIRED_EVIDENCE_CLEARABLE_FIELDS,
  planRetiredEvidenceFieldClears,
  type CitedObservation,
  type RetiredEvidenceFieldClearInput,
} from '../retiredEvidenceFieldClear';

const WEBSITE = 'https://synthetic-graft.example.edu/';
const BODY = 'The synthetic group studies how membranes fold under mechanical stress.';
const CARD = 'Studies membrane folding under stress.';

const retired = (id: string, value: unknown): CitedObservation => ({
  _id: id,
  value,
  superseded: true,
  rollback: { rolledBackAt: new Date('2026-10-01T00:00:00Z') },
});

const lookupOf =
  (...observations: CitedObservation[]) =>
  async (ids: string[]) =>
    observations.filter((observation) => ids.includes(String(observation._id)));

const plan = (overrides: Partial<RetiredEvidenceFieldClearInput>) =>
  planRetiredEvidenceFieldClears({
    stored: {
      website: WEBSITE,
      fieldProvenance: { website: { sourceName: 'graft-lane', observationId: 'obs-website' } },
    },
    staged: {},
    unset: {},
    fieldsWithLiveObservation: new Set(),
    lockedFields: [],
    storedForm: (_field, value) => value,
    citedObservations: lookupOf(retired('obs-website', WEBSITE)),
    liveFieldValues: async () => [],
    ...overrides,
  });

describe('planRetiredEvidenceFieldClears', () => {
  it('clears a stored field whose cited observation is retired and nothing else states it', async () => {
    expect(await plan({})).toEqual(['website']);
  });

  it('clears a field whose cited observation is superseded without a rollback', async () => {
    const superseded = { _id: 'obs-website', value: WEBSITE, superseded: true };
    expect(await plan({ citedObservations: lookupOf(superseded) })).toEqual(['website']);
  });

  it('keeps the field while a live observation still states it', async () => {
    expect(await plan({ fieldsWithLiveObservation: new Set(['website']) })).toEqual([]);
  });

  it('keeps the field while its cited observation is live', async () => {
    const live = { _id: 'obs-website', value: WEBSITE, superseded: false };
    expect(await plan({ citedObservations: lookupOf(live) })).toEqual([]);
  });

  it('keeps a value a live observation on the row or a merged-in row still states', async () => {
    expect(
      await plan({ liveFieldValues: async () => [{ field: 'website', value: WEBSITE }] }),
    ).toEqual([]);
  });

  it('clears a value the surviving live observations state differently', async () => {
    expect(
      await plan({
        liveFieldValues: async () => [{ field: 'website', value: 'https://other.example.edu/' }],
      }),
    ).toEqual(['website']);
  });

  it('asks the live lookup about the merged-in rows it was given', async () => {
    const seen: unknown[] = [];
    const mergedInRows = [{ _id: new mongoose.Types.ObjectId(), slug: 'synthetic-merged-row' }];
    await plan({
      mergedInRows,
      liveFieldValues: async (input) => {
        seen.push(input.mergedInRows, input.fields);
        return [];
      },
    });
    expect(seen).toEqual([mergedInRows, ['website']]);
  });

  it('keeps a locked field', async () => {
    expect(await plan({ lockedFields: ['website'] })).toEqual([]);
  });

  it('keeps a field carrying a live operator refusal', async () => {
    const stored = {
      website: WEBSITE,
      fieldProvenance: { website: { sourceName: 'graft-lane', observationId: 'obs-website' } },
      fieldValueRefusals: { website: [{ valueKey: 'other', rule: 'wrong_owner' }] },
    };
    expect(await plan({ stored })).toEqual([]);
  });

  it('clears a field whose only refusal has been withdrawn', async () => {
    const stored = {
      website: WEBSITE,
      fieldProvenance: { website: { sourceName: 'graft-lane', observationId: 'obs-website' } },
      fieldValueRefusals: {
        website: [{ valueKey: 'other', rule: 'wrong_owner', withdrawnAt: new Date() }],
      },
    };
    expect(await plan({ stored })).toEqual(['website']);
  });

  it('keeps an operator-authored value even when its observation was retired', async () => {
    const stored = {
      website: WEBSITE,
      fieldProvenance: {
        website: { sourceName: 'manual-admin-edit', observationId: 'obs-website' },
      },
    };
    expect(await plan({ stored })).toEqual([]);
  });

  it('keeps a value whose provenance cites no observation', async () => {
    const stored = { website: WEBSITE, fieldProvenance: { website: { sourceName: 'legacy' } } };
    expect(await plan({ stored })).toEqual([]);
  });

  it('keeps a value with no provenance at all', async () => {
    expect(await plan({ stored: { website: WEBSITE } })).toEqual([]);
  });

  it('keeps a value whose cited observation no longer exists', async () => {
    expect(await plan({ citedObservations: lookupOf() })).toEqual([]);
  });

  it('keeps a value that differs from what the retired observation stated', async () => {
    expect(
      await plan({
        citedObservations: lookupOf(retired('obs-website', 'https://other.example.edu/')),
      }),
    ).toEqual([]);
  });

  it('compares the retired value in the form the materializer stores it', async () => {
    expect(
      await plan({
        citedObservations: lookupOf(retired('obs-website', `  ${WEBSITE.toUpperCase()}  `)),
        storedForm: (_field, value) => String(value).trim().toLowerCase(),
      }),
    ).toEqual(['website']);
  });

  it('keeps a field this pass already stages or clears', async () => {
    expect(await plan({ staged: { website: WEBSITE } })).toEqual([]);
    expect(await plan({ unset: { website: '' } })).toEqual([]);
  });

  it('never clears a derived field even when its cited observation is retired', async () => {
    const stored = {
      kind: 'lab',
      sourceUrls: [WEBSITE],
      fieldProvenance: {
        kind: { sourceName: 'graft-lane', observationId: 'obs-kind' },
        sourceUrls: { sourceName: 'graft-lane', observationId: 'obs-citation' },
      },
    };
    const lookup = lookupOf(retired('obs-kind', 'lab'), retired('obs-citation', [WEBSITE]));
    expect(await plan({ stored, citedObservations: lookup })).toEqual([]);
  });

  it('clears the card with a body whose evidence was retired', async () => {
    const stored = {
      fullDescription: BODY,
      shortDescription: CARD,
      fieldProvenance: {
        fullDescription: { sourceName: 'profile-lane', observationId: 'obs-body' },
        shortDescription: { sourceName: 'profile-lane', observationId: 'obs-body' },
      },
    };
    expect(await plan({ stored, citedObservations: lookupOf(retired('obs-body', BODY)) })).toEqual([
      'fullDescription',
      'shortDescription',
    ]);
  });

  it('keeps a card a live observation or a lock still backs', async () => {
    const stored = {
      fullDescription: BODY,
      shortDescription: CARD,
      fieldProvenance: {
        fullDescription: { sourceName: 'profile-lane', observationId: 'obs-body' },
        shortDescription: { sourceName: 'profile-lane', observationId: 'obs-body' },
      },
    };
    const citedObservations = lookupOf(retired('obs-body', BODY));
    expect(
      await plan({
        stored,
        citedObservations,
        fieldsWithLiveObservation: new Set(['shortDescription']),
      }),
    ).toEqual(['fullDescription']);
    expect(await plan({ stored, citedObservations, lockedFields: ['shortDescription'] })).toEqual([
      'fullDescription',
    ]);
  });

  it('keeps a card a live observation still states while its body clears', async () => {
    const stored = {
      fullDescription: BODY,
      shortDescription: CARD,
      fieldProvenance: {
        fullDescription: { sourceName: 'profile-lane', observationId: 'obs-body' },
        shortDescription: { sourceName: 'profile-lane', observationId: 'obs-body' },
      },
    };
    expect(
      await plan({
        stored,
        citedObservations: lookupOf(retired('obs-body', BODY)),
        liveFieldValues: async () => [{ field: 'shortDescription', value: CARD }],
      }),
    ).toEqual(['fullDescription']);
  });

  it('keeps a card whose own provenance does not cite the retired body observation', async () => {
    const bodyProvenance = { sourceName: 'profile-lane', observationId: 'obs-body' };
    const citedObservations = lookupOf(retired('obs-body', BODY), retired('obs-card', CARD));
    for (const cardProvenance of [
      undefined,
      { sourceName: 'profile-lane' },
      { sourceName: 'card-lane', observationId: 'obs-card' },
      { sourceName: 'card-lane', observationId: 'obs-pruned' },
    ]) {
      const stored = {
        fullDescription: BODY,
        shortDescription: CARD,
        fieldProvenance: { fullDescription: bodyProvenance, shortDescription: cardProvenance },
      };
      expect(await plan({ stored, citedObservations })).toEqual(['fullDescription']);
    }
  });

  it('keeps the card when only the legacy description clears', async () => {
    const stored = {
      description: BODY,
      shortDescription: CARD,
      fieldProvenance: {
        description: { sourceName: 'profile-lane', observationId: 'obs-body' },
        shortDescription: { sourceName: 'profile-lane', observationId: 'obs-body' },
      },
    };
    expect(await plan({ stored, citedObservations: lookupOf(retired('obs-body', BODY)) })).toEqual([
      'description',
    ]);
  });

  it('keeps a card this pass stages or a row that stores none', async () => {
    const provenance = { sourceName: 'profile-lane', observationId: 'obs-body' };
    const citedObservations = lookupOf(retired('obs-body', BODY));
    expect(
      await plan({
        stored: {
          fullDescription: BODY,
          shortDescription: CARD,
          fieldProvenance: { fullDescription: provenance, shortDescription: provenance },
        },
        staged: { shortDescription: CARD },
        citedObservations,
      }),
    ).toEqual(['fullDescription']);
    expect(
      await plan({
        stored: { fullDescription: BODY, fieldProvenance: { fullDescription: provenance } },
        staged: { shortDescription: CARD },
        citedObservations,
      }),
    ).toEqual(['fullDescription']);
  });

  it('reads nothing from the observation log when no field is a candidate', async () => {
    let called = false;
    const result = await plan({
      lockedFields: ['website'],
      citedObservations: async () => {
        called = true;
        return [];
      },
    });
    expect(result).toEqual([]);
    expect(called).toBe(false);
  });

  it('clears only fields the rematerialize report tracks, so no clear reads as no change', () => {
    for (const field of [...RETIRED_EVIDENCE_CLEARABLE_FIELDS, 'shortDescription']) {
      expect(REMATERIALIZE_TRACKED_FIELDS).toContain(field);
    }
  });
});
