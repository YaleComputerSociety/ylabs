import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertCommandAllowed,
  parseInvocation,
  parseMongoTarget,
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

test('blocks local Beta materialization and auto-materialization', () => {
  assert.throws(
    () =>
      assertCommandAllowed('beta-operator', [
        'yarn',
        '--cwd',
        'server',
        'scrape',
        'run',
        '--auto-materialize',
      ]),
    /Beta Render shell/,
  );
  assert.throws(
    () =>
      assertCommandAllowed('beta-operator', ['yarn', '--cwd', 'server', 'scrape', 'materialize']),
    /Beta Render shell/,
  );
});
