import assert from 'assert/strict';
import test from 'node:test';
import {
  assertSafeWrite,
  maskConnectionString,
  parseDataOpsArgs,
  toMeiliListingDocument,
  validateFellowshipDocuments,
  validateMeiliListingDocuments,
} from '../dataOps';

test('parseDataOpsArgs defaults to dry-run and accepts explicit output paths', () => {
  const options = parseDataOpsArgs([
    '--csv',
    './fixtures/fellowships.csv',
    '--summary',
    './tmp/summary.json',
  ]);

  assert.equal(options.dryRun, true);
  assert.equal(options.execute, false);
  assert.match(options.csvPath || '', /fixtures\/fellowships\.csv$/);
  assert.match(options.summaryPath || '', /tmp\/summary\.json$/);
});

test('parseDataOpsArgs requires a known target when executing', () => {
  const options = parseDataOpsArgs(['--execute', '--target', 'dev', '--replace-existing']);

  assert.equal(options.dryRun, false);
  assert.equal(options.execute, true);
  assert.equal(options.target, 'dev');
  assert.equal(options.replaceExisting, true);
});

test('assertSafeWrite blocks ambiguous and production writes', () => {
  assert.throws(
    () => assertSafeWrite(parseDataOpsArgs(['--execute']), 'test op'),
    /writes require --target/,
  );

  assert.throws(
    () => assertSafeWrite(parseDataOpsArgs(['--execute', '--target', 'prod']), 'test op'),
    /refuses prod writes/,
  );

  assert.doesNotThrow(() =>
    assertSafeWrite(
      parseDataOpsArgs([
        '--execute',
        '--target',
        'prod',
        '--allow-production',
        '--confirm-production',
      ]),
      'test op',
    ),
  );
});

test('validateFellowshipDocuments reports missing required artifacts and duplicates', () => {
  const validation = validateFellowshipDocuments([
    { title: 'Summer Research', applicationLink: 'https://example.test/apply', description: 'Apply' },
    { title: 'Summer Research', applicationLink: '', description: '' },
    { title: 'Untitled Fellowship', applicationLink: 'https://example.test/other' },
  ]);

  assert.deepEqual(validation.errors, ['row 3: missing fellowship title']);
  assert(validation.warnings.some(warning => warning.includes('duplicate fellowship title')));
  assert(validation.warnings.some(warning => warning.includes('missing application link')));
  assert(validation.warnings.some(warning => warning.includes('missing description')));
});

test('toMeiliListingDocument strips Mongo-only fields before indexing', () => {
  const doc = toMeiliListingDocument({
    _id: { toString: () => 'listing-1' },
    __v: 2,
    embedding: [0.1, 0.2],
    title: 'Quantum Lab',
    description: 'Research listing',
  });

  assert.equal(doc.id, 'listing-1');
  assert.equal('_id' in doc, false);
  assert.equal('__v' in doc, false);
  assert.equal('embedding' in doc, false);
});

test('validateMeiliListingDocuments rejects unsafe indexing payloads', () => {
  const validation = validateMeiliListingDocuments([
    { id: 'a', title: 'A', description: 'ok' },
    { id: 'a', title: 'Duplicate', _id: 'mongo-id' },
    { id: 12, description: 'missing title' },
  ]);

  assert(validation.errors.some(error => error.includes('duplicate id "a"')));
  assert(validation.errors.some(error => error.includes('missing string id')));
  assert(validation.errors.some(error => error.includes('missing title')));
  assert(validation.errors.some(error => error.includes('forbidden field "_id"')));
  assert(validation.warnings.some(warning => warning.includes('missing description')));
});

test('maskConnectionString hides credentials but preserves host context', () => {
  assert.equal(
    maskConnectionString('mongodb+srv://user:password@example.mongodb.net/Production'),
    'mongodb+srv://***:***@example.mongodb.net/Production',
  );
});
