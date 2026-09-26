import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import '../../models';
import { reportUnbuildableDeclaredIndexSpecs, unbuildableIndexSpecReason } from '../connections';

describe('unbuildableIndexSpecReason', () => {
  it('names the rejection when a spec mixes sparse with a partial filter', () => {
    expect(
      unbuildableIndexSpecReason({
        unique: true,
        sparse: true,
        partialFilterExpression: { slug: { $type: 'string' } },
      }),
    ).toMatch(/cannot mix "partialFilterExpression" and "sparse"/);
  });

  it('accepts either option on its own, and a spec with neither', () => {
    expect(unbuildableIndexSpecReason({ unique: true, sparse: true })).toBeNull();
    expect(
      unbuildableIndexSpecReason({
        unique: true,
        partialFilterExpression: { slug: { $type: 'string' } },
      }),
    ).toBeNull();
    expect(unbuildableIndexSpecReason({ unique: true })).toBeNull();
    expect(unbuildableIndexSpecReason(undefined)).toBeNull();
  });

  it('treats sparse: false as present, because MongoDB rejects the pairing either way', () => {
    expect(
      unbuildableIndexSpecReason({
        sparse: false,
        partialFilterExpression: { slug: { $type: 'string' } },
      }),
    ).not.toBeNull();
  });
});

describe('no registered model declares an index MongoDB can never build (#3081)', () => {
  it('reports nothing across every registered model', () => {
    expect(reportUnbuildableDeclaredIndexSpecs(mongoose.connection)).toEqual([]);
  });

  it('reports a model that does, naming the collection and the index', () => {
    const probe = new mongoose.Schema({ slug: String }, { collection: 'unbuildable_probe_rows' });
    probe.index(
      { slug: 1 },
      { unique: true, sparse: true, partialFilterExpression: { slug: { $type: 'string' } } },
    );
    const connection = mongoose.createConnection();
    connection.model('UnbuildableProbe', probe);

    expect(reportUnbuildableDeclaredIndexSpecs(connection)).toEqual([
      {
        model: 'UnbuildableProbe',
        collection: 'unbuildable_probe_rows',
        indexName: 'slug_1',
        reason: 'cannot mix "partialFilterExpression" and "sparse" options',
      },
    ]);
  });
});
