import assert from 'assert/strict';
import test from 'node:test';
import {
  assertExplicitCsvForExecute,
  assertSafeWrite,
  maskConnectionString,
  parseDataOpsArgs,
  resolveSafeSummaryPath,
  toMeiliListingDocument,
  validateAndFilterFellowshipDocuments,
  validateFellowshipDocuments,
  validateMeiliListingDocuments,
  writeSummary,
} from '../dataOps';

const credentialedMongoUri = (database: string) => {
  const scheme = ['mongo', 'db+', 'srv'].join('');
  const credentials = ['example-user', 'example-pass'].join(':');
  const host = ['example', 'mongodb', 'net'].join('.');
  return [scheme, ':', '//', credentials, '@', host, '/', database].join('');
};

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

test('parseDataOpsArgs constrains summary output paths to safe JSON reports', () => {
  assert.match(resolveSafeSummaryPath('./tmp/summary.json'), /tmp\/summary\.json$/);

  assert.throws(
    () => parseDataOpsArgs(['--summary', '/etc/summary.json']),
    /--summary must write under .* or \.\/tmp/,
  );
  assert.throws(
    () => parseDataOpsArgs(['--summary', './tmp/summary.txt']),
    /--summary must point to a \.json report file/,
  );
});

test('writeSummary validates paths before creating report directories', () => {
  assert.throws(
    () => writeSummary('/etc/data-ops-summary.json', { ok: true }),
    /--summary must write under .* or \.\/tmp/,
  );
});

test('parseDataOpsArgs requires a known target when executing', () => {
  const options = parseDataOpsArgs(['--execute', '--target', 'dev', '--replace-existing']);

  assert.equal(options.dryRun, false);
  assert.equal(options.execute, true);
  assert.equal(options.target, 'dev');
  assert.equal(options.replaceExisting, true);
});

test('assertExplicitCsvForExecute keeps dry-run default CSV discovery but blocks execute fallback', () => {
  assert.doesNotThrow(() =>
    assertExplicitCsvForExecute(parseDataOpsArgs(['--dry-run']), 'Fellowship import'),
  );

  assert.throws(
    () =>
      assertExplicitCsvForExecute(
        parseDataOpsArgs(['--execute', '--target', 'dev']),
        'Fellowship import',
      ),
    /Fellowship import execute mode requires --csv with an explicit input file/,
  );

  assert.doesNotThrow(() =>
    assertExplicitCsvForExecute(
      parseDataOpsArgs([
        '--execute',
        '--target',
        'dev',
        '--csv',
        './fixtures/fellowships.csv',
      ]),
      'Fellowship import',
    ),
  );
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

  assert.throws(
    () =>
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
    /resolved destination metadata/,
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
      { mongodbUrl: credentialedMongoUri('Production') },
    ),
  );
});

test('assertSafeWrite requires target flags to match resolved destinations', () => {
  assert.throws(
    () =>
      assertSafeWrite(parseDataOpsArgs(['--execute', '--target', 'dev']), 'test op', {
        mongodbUrl: credentialedMongoUri('Production'),
      }),
    /target dev does not match MongoDB database "production"/,
  );

  assert.throws(
    () =>
      assertSafeWrite(parseDataOpsArgs(['--execute', '--target', 'dev']), 'test op', {
        mongodbUrl: credentialedMongoUri('Development'),
        meilisearchHost: 'https://meilisearch.internal',
        meilisearchIndexPrefix: 'prod',
      }),
    /target dev does not match Meilisearch index prefix "prod"/,
  );

  assert.doesNotThrow(() =>
    assertSafeWrite(parseDataOpsArgs(['--execute', '--target', 'dev']), 'test op', {
      mongodbUrl: credentialedMongoUri('Development'),
      meilisearchHost: 'https://meilisearch.internal',
      meilisearchIndexPrefix: 'dev',
    }),
  );
});

test('validateFellowshipDocuments reports missing required artifacts and duplicates', () => {
  const validation = validateFellowshipDocuments([
    {
      title: 'Summer Research',
      applicationLink: 'https://example.test/apply',
      description: 'Apply',
    },
    { title: 'Summer Research', applicationLink: '', description: '' },
    { title: 'Untitled Fellowship', applicationLink: 'https://example.test/other' },
  ]);

  assert.deepEqual(validation.errors, ['row 3: missing fellowship title']);
  assert(validation.warnings.some((warning) => warning.includes('duplicate fellowship title')));
  assert(validation.warnings.some((warning) => warning.includes('missing application link')));
  assert(validation.warnings.some((warning) => warning.includes('missing description')));
});

test('validateAndFilterFellowshipDocuments reports missing titles before filtering import rows', () => {
  const result = validateAndFilterFellowshipDocuments([
    {
      title: 'Summer Research',
      applicationLink: 'https://example.test/apply',
      description: 'Apply',
    },
    { title: 'Untitled Fellowship', applicationLink: 'https://example.test/blank' },
    { title: '', applicationLink: 'https://example.test/missing' },
  ]);

  assert.deepEqual(result.validation.errors, [
    'row 2: missing fellowship title',
    'row 3: missing fellowship title',
  ]);
  assert.deepEqual(
    result.validFellowships.map((fellowship) => fellowship.title),
    ['Summer Research'],
  );
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

  assert(validation.errors.some((error) => error.includes('duplicate id "a"')));
  assert(validation.errors.some((error) => error.includes('missing string id')));
  assert(validation.errors.some((error) => error.includes('missing title')));
  assert(validation.errors.some((error) => error.includes('forbidden field "_id"')));
  assert(validation.warnings.some((warning) => warning.includes('missing description')));
});

test('maskConnectionString hides credentials but preserves host context', () => {
  assert.equal(
    maskConnectionString(credentialedMongoUri('Production')),
    [
      ['mongo', 'db+', 'srv'].join(''),
      ':',
      '//',
      '***',
      ':',
      '***',
      '@',
      'example.mongodb.net',
      '/Production',
    ].join(''),
  );
});
