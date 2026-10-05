import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertWritesAllowed,
  parseInvocation,
  parseMongoTarget,
  shadowedValues,
  validateProfileValues,
} from './run-data-profile.mjs';

test('parses a Mongo URL into a sanitized target summary', () => {
  assert.deepEqual(parseMongoTarget('mongodb+srv://example.mongodb.net/Beta?retryWrites=true'), {
    host: 'example.mongodb.net',
    database: 'Beta',
    local: false,
  });
});

test('requires remote Atlas Development MongoDB for the development profile', () => {
  assert.throws(
    () =>
      validateProfileValues('development', {
        MONGODBURL: 'mongodb://127.0.0.1:27017/Development',
        SCRAPER_ENV: 'development',
      }),
    /requires a remote MongoDB database/,
  );
  assert.doesNotThrow(() =>
    validateProfileValues('development', {
      MONGODBURL: 'mongodb+srv://example.mongodb.net/Development',
      SCRAPER_ENV: 'development',
    }),
  );
});

test('requires the exact Beta database for the beta operator', () => {
  assert.throws(
    () =>
      validateProfileValues('beta-operator', {
        MONGODBURL: 'mongodb+srv://example.mongodb.net/Production',
        SCRAPER_ENV: 'beta',
      }),
    /requires Mongo database Beta/,
  );
});

test('parses write mode without placing it in the child command', () => {
  assert.deepEqual(
    parseInvocation(['development', '--write', '--', 'yarn', '--cwd', 'server', 'scrape', 'list']),
    {
      profileName: 'development',
      writesEnabled: true,
      command: ['yarn', '--cwd', 'server', 'scrape', 'list'],
    },
  );
});

test('keeps the beta operator read-only because Beta is filled by promotion', () => {
  assert.throws(
    () => assertWritesAllowed('beta-operator', true),
    /read-only[\s\S]*beta:refresh-from-development:plan/,
  );
  assert.doesNotThrow(() => assertWritesAllowed('beta-operator', false));
  assert.doesNotThrow(() => assertWritesAllowed('development', true));
});

test('requires a local host and the ylabs_local database for the local profile', () => {
  assert.throws(
    () =>
      validateProfileValues('local', {
        MONGODBURL: 'mongodb+srv://example.mongodb.net/ylabs_local',
      }),
    /requires a local MongoDB host/,
  );
  assert.throws(
    () => validateProfileValues('local', { MONGODBURL: 'mongodb://127.0.0.1:27017/Development' }),
    /requires Mongo database ylabs_local/,
  );
  assert.doesNotThrow(() =>
    validateProfileValues('local', { MONGODBURL: 'mongodb://127.0.0.1:27017/ylabs_local' }),
  );
  assert.doesNotThrow(() =>
    validateProfileValues('local', { MONGODBURL: 'mongodb://[::1]:27017/ylabs_local' }),
  );
});

test('keeps the local profile read-only for scraper writes', () => {
  assert.throws(() => assertWritesAllowed('local', true), /read-only/);
});

test('blanks every credentialed env key the local profile does not declare', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-shadow-'));
  const shadowedFile = path.join(dir, '.env');
  fs.writeFileSync(
    shadowedFile,
    'MONGODBURL=mongodb+srv://example.mongodb.net/Development\nDEVELOPMENT_MONGODBURL=x\nPORT=4000\n',
  );
  assert.deepEqual(
    shadowedValues(
      { shadowedFile },
      { MONGODBURL: 'mongodb://127.0.0.1:27017/ylabs_local', PORT: '4000' },
    ),
    { DEVELOPMENT_MONGODBURL: '' },
  );
  assert.deepEqual(shadowedValues({ shadowedFile: path.join(dir, 'absent') }, {}), {});
});
