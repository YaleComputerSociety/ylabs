import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SHELL_PRECEDENT_KEYS,
  assertWritesAllowed,
  childEnvironment,
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

const developmentProfile = { environment: 'development' };
const adminBypassDotEnv = {
  MONGODBURL: 'mongodb+srv://example.mongodb.net/Development',
  PORT: '4038',
  LOCAL_AUTH_BYPASS: 'true',
  LOCAL_AUTH_BYPASS_NETID: 'devadmin',
  LOCAL_AUTH_BYPASS_USER_TYPE: 'admin',
};

test('a shell value for each local auth bypass key wins over server/.env', () => {
  const env = childEnvironment({
    processEnv: {
      LOCAL_AUTH_BYPASS: 'false',
      LOCAL_AUTH_BYPASS_NETID: 'devstudent',
      LOCAL_AUTH_BYPASS_USER_TYPE: 'undergraduate',
    },
    profile: developmentProfile,
    values: adminBypassDotEnv,
  });

  assert.equal(env.LOCAL_AUTH_BYPASS, 'false');
  assert.equal(env.LOCAL_AUTH_BYPASS_NETID, 'devstudent');
  assert.equal(env.LOCAL_AUTH_BYPASS_USER_TYPE, 'undergraduate');
});

test('an empty shell value still counts as explicitly set and wins', () => {
  const env = childEnvironment({
    processEnv: { LOCAL_AUTH_BYPASS: '' },
    profile: developmentProfile,
    values: adminBypassDotEnv,
  });

  assert.equal(env.LOCAL_AUTH_BYPASS, '');
  assert.equal(env.LOCAL_AUTH_BYPASS_NETID, 'devadmin');
});

test('server/.env still supplies the local auth bypass keys the shell leaves unset', () => {
  const env = childEnvironment({
    processEnv: {},
    profile: developmentProfile,
    values: adminBypassDotEnv,
  });

  assert.equal(env.LOCAL_AUTH_BYPASS, 'true');
  assert.equal(env.LOCAL_AUTH_BYPASS_NETID, 'devadmin');
  assert.equal(env.LOCAL_AUTH_BYPASS_USER_TYPE, 'admin');
});

test('server/.env keeps precedence over the shell for every other key', () => {
  const env = childEnvironment({
    processEnv: {
      MONGODBURL: 'mongodb+srv://example.mongodb.net/Prod',
      PORT: '4000',
      SCRAPER_ENV: 'production',
    },
    profile: developmentProfile,
    values: adminBypassDotEnv,
  });

  assert.equal(env.MONGODBURL, 'mongodb+srv://example.mongodb.net/Development');
  assert.equal(env.PORT, '4038');
  assert.equal(env.SCRAPER_ENV, 'development');
  assert.equal(env.CONFIRM_PROD_SCRAPE, 'false');
  assert.deepEqual(SHELL_PRECEDENT_KEYS, [
    'LOCAL_AUTH_BYPASS',
    'LOCAL_AUTH_BYPASS_NETID',
    'LOCAL_AUTH_BYPASS_USER_TYPE',
  ]);
});

test('run builds the child process environment through childEnvironment', () => {
  const source = fs.readFileSync(new URL('./run-data-profile.mjs', import.meta.url), 'utf8');

  assert.match(
    source,
    /const childEnv = childEnvironment\(\{ processEnv: process\.env, profile, values \}\);/,
  );
  assert.equal(source.match(/\.\.\.values,/g)?.length, 1);
});
