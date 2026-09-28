import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';

import {
  isResearchEntityContactField,
  observationIsKeyedToRow,
  withoutForeignContactObservations,
} from '../rowKeyedContactEvidence';

const rowId = new mongoose.Types.ObjectId();
const loserId = new mongoose.Types.ObjectId();
const row = { _id: rowId, slug: 'example-survivor-lab' };

describe('contact evidence must be keyed to the row it names a contact for (#3609)', () => {
  it('accepts an observation anchored to the row id', () => {
    expect(observationIsKeyedToRow({ entityId: rowId, entityKey: 'some-other-key' }, row)).toBe(
      true,
    );
  });

  it('accepts an unanchored observation keyed to the row slug', () => {
    expect(observationIsKeyedToRow({ entityKey: 'example-survivor-lab' }, row)).toBe(true);
  });

  it('refuses an observation anchored to another row even when its key is the slug', () => {
    expect(
      observationIsKeyedToRow({ entityId: loserId, entityKey: 'example-survivor-lab' }, row),
    ).toBe(false);
  });

  it('refuses an observation keyed to a merged-in loser or to any other key', () => {
    expect(observationIsKeyedToRow({ entityKey: 'example-merged-loser' }, row)).toBe(false);
    expect(observationIsKeyedToRow({ entityKey: '' }, row)).toBe(false);
    expect(observationIsKeyedToRow({}, { _id: rowId })).toBe(false);
  });

  it('names exactly the three fields that identify a person to contact', () => {
    expect(['contactEmail', 'contactName', 'contactRole'].every(isResearchEntityContactField)).toBe(
      true,
    );
    expect(isResearchEntityContactField('contactInstructionsQuote')).toBe(false);
    expect(isResearchEntityContactField('websiteUrl')).toBe(false);
  });

  it('drops only foreign contact observations and keeps every other foreign field', () => {
    const observations = [
      { field: 'contactEmail', entityKey: 'example-merged-loser' },
      { field: 'contactName', entityKey: 'example-merged-loser' },
      { field: 'departments', entityKey: 'example-merged-loser' },
      { field: 'contactRole', entityKey: 'example-survivor-lab' },
      { field: 'contactEmail', entityId: rowId },
    ];

    expect(withoutForeignContactObservations(observations, row)).toEqual([
      { field: 'departments', entityKey: 'example-merged-loser' },
      { field: 'contactRole', entityKey: 'example-survivor-lab' },
      { field: 'contactEmail', entityId: rowId },
    ]);
  });
});
