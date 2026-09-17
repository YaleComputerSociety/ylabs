import { BSON } from 'bson';
import { describe, expect, it } from 'vitest';
import {
  RETIRED_POPULATED_COLLECTIONS,
  assertRetiredCollectionsAreUnmodelled,
  countBsonDocuments,
  evaluateRetiredCollectionBackup,
} from '../retiredCollectionDropCore';

const dumpOf = (documents: Array<Record<string, unknown>>): Buffer =>
  Buffer.concat(documents.map((document) => Buffer.from(BSON.serialize(document))));

describe('countBsonDocuments', () => {
  it('counts a mongodump stream without deserializing it', () => {
    expect(countBsonDocuments(dumpOf([{ a: 1 }, { b: 'two' }, { c: [3, 4] }]))).toBe(3);
  });

  it('counts an empty dump as zero documents', () => {
    expect(countBsonDocuments(Buffer.alloc(0))).toBe(0);
  });

  it('refuses a stream truncated inside a document', () => {
    const truncated = dumpOf([{ a: 1 }, { b: 2 }]).subarray(0, 18);
    expect(() => countBsonDocuments(truncated)).toThrow(/impossible length|length prefix/);
  });

  it('refuses a document whose declared length is nonsense', () => {
    const corrupt = Buffer.from(dumpOf([{ a: 1 }]));
    corrupt.writeInt32LE(2, 0);
    expect(() => countBsonDocuments(corrupt)).toThrow(/impossible length/);
  });
});

describe('evaluateRetiredCollectionBackup', () => {
  it('passes when every populated collection is backed up at the same count', () => {
    const result = evaluateRetiredCollectionBackup({
      collections: ['users', 'contact_routes'],
      liveCounts: { users: 19009, contact_routes: 2296 },
      backupCounts: { users: 19009, contact_routes: 2296 },
    });
    expect(result.ok).toBe(true);
  });

  it('needs no dump for a collection that holds no rows', () => {
    const result = evaluateRetiredCollectionBackup({
      collections: ['users'],
      liveCounts: { users: 0 },
      backupCounts: {},
    });
    expect(result.ok).toBe(true);
    expect(result.checks[0].reason).toBe('no rows to preserve');
  });

  it('refuses a populated collection with no dump at all', () => {
    const result = evaluateRetiredCollectionBackup({
      collections: ['users'],
      liveCounts: { users: 19009 },
      backupCounts: {},
    });
    expect(result.ok).toBe(false);
    expect(result.checks[0].reason).toMatch(/no dump for it/);
  });

  it('refuses a dump that is short of the live count', () => {
    const result = evaluateRetiredCollectionBackup({
      collections: ['users'],
      liveCounts: { users: 19009 },
      backupCounts: { users: 19008 },
    });
    expect(result.ok).toBe(false);
    expect(result.checks[0].reason).toMatch(/19008 rows against 19009 live/);
  });

  it('refuses a dump taken before rows were added, so a stale backup cannot pass', () => {
    const result = evaluateRetiredCollectionBackup({
      collections: ['contact_routes'],
      liveCounts: { contact_routes: 2400 },
      backupCounts: { contact_routes: 2296 },
    });
    expect(result.ok).toBe(false);
  });
});

describe('assertRetiredCollectionsAreUnmodelled', () => {
  it('accepts a retired list no model declares', () => {
    expect(() =>
      assertRetiredCollectionsAreUnmodelled({
        collections: RETIRED_POPULATED_COLLECTIONS,
        modelledCollections: ['research_entities', 'accounts', 'researchers'],
      }),
    ).not.toThrow();
  });

  it('refuses a collection a live model still declares', () => {
    expect(() =>
      assertRetiredCollectionsAreUnmodelled({
        collections: ['users', 'accounts'],
        modelledCollections: ['accounts'],
      }),
    ).toThrow(/still declares: accounts/);
  });
});
