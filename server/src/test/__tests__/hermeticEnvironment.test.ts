import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { afterEach, describe, expect, it } from 'vitest';

import { getMeiliClient, getMeiliIndex } from '../../utils/meiliClient';
import {
  UNREACHABLE_SEARCH_INDEX_MESSAGE,
  applyEnvironmentFence,
  fencedEnvironmentKeys,
  hermeticChildEnvironment,
} from '../hermeticEnvironment';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SYNTHETIC_KEY = 'YLABS_HERMETIC_FENCE_PROBE';

describe('the server suite never resolves a live backend from the environment (#2966)', () => {
  afterEach(() => {
    delete process.env[SYNTHETIC_KEY];
  });

  it('leaves every fenced name unset while the suite runs', () => {
    dotenv.config();
    for (const key of fencedEnvironmentKeys()) {
      expect(process.env[key], `${key} must not be readable from a test`).toBeUndefined();
    }
  });

  it('strips an inherited live backend without touching what the runner owns', () => {
    const template = Object.keys(
      dotenv.parse(fs.readFileSync(path.join(SERVER_ROOT, '.env.example'))),
    );
    expect(template).toContain('MEILISEARCH_API_KEY');

    const inherited: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      CI: 'true',
      PATH: '/usr/bin',
      MONGODBURL: 'mongodb+srv://live-cluster.example.invalid/research',
      SCRAPER_ENV: 'beta',
      ALLOW_NON_PROD_SCRAPER_WRITES: 'true',
    };
    for (const key of template) inherited[key] = 'inherited-from-a-local-file';

    applyEnvironmentFence(inherited);

    for (const key of [...template, 'MONGODBURL', 'SCRAPER_ENV', 'ALLOW_NON_PROD_SCRAPER_WRITES']) {
      expect(inherited[key], `${key} must not survive the fence`).toBeUndefined();
    }
    expect(inherited.NODE_ENV).toBe('test');
    expect(inherited.CI).toBe('true');
    expect(inherited.PATH).toBe('/usr/bin');
    expect(inherited.YLABS_SKIP_LOCAL_DOTENV).toBe('true');
  });

  it('hands a spawned child a backend no local env file can put back', () => {
    const probeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-hermetic-child-'));
    const probePath = path.join(probeDirectory, '.env');
    fs.writeFileSync(
      probePath,
      [
        'MEILISEARCH_HOST=http://localhost:7700',
        'MEILISEARCH_API_KEY=local_development_master_key',
        'MONGODBURL=mongodb+srv://live-cluster.example.invalid/research',
        'ALLOW_NON_PROD_SCRAPER_WRITES=true',
      ].join('\n'),
    );

    const child = spawnSync(
      process.execPath,
      [
        '-e',
        "require('dotenv').config({ path: process.argv[1] });" +
          'process.stdout.write(JSON.stringify(process.env));',
        probePath,
      ],
      { cwd: SERVER_ROOT, env: hermeticChildEnvironment(), encoding: 'utf8' },
    );

    expect(child.status).toBe(0);
    const childEnv = JSON.parse(child.stdout) as NodeJS.ProcessEnv;
    expect(childEnv.MEILISEARCH_HOST).toBe('http://127.0.0.1:1');
    expect(childEnv.MEILISEARCH_API_KEY).not.toBe('local_development_master_key');
    expect(childEnv.MONGODBURL).not.toContain('live-cluster');
    expect(childEnv.ALLOW_NON_PROD_SCRAPER_WRITES).not.toBe('true');
    expect(childEnv.YLABS_SKIP_LOCAL_DOTENV).toBe('true');
  });

  it('lets a spawned child keep the memory database the suite gives it', () => {
    const child = hermeticChildEnvironment({
      MONGODBURL: 'mongodb://127.0.0.1:27017/ylabs-memory-fixture',
      NODE_ENV: 'test',
    });
    expect(child.MONGODBURL).toBe('mongodb://127.0.0.1:27017/ylabs-memory-fixture');
    expect(child.NODE_ENV).toBe('test');
    expect(child.MEILISEARCH_HOST).toBe('http://127.0.0.1:1');
  });

  it('leaves dotenv.config unable to put a file into the environment', () => {
    const probePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-hermetic-fence-')),
      '.env',
    );
    fs.writeFileSync(probePath, `${SYNTHETIC_KEY}=loaded-from-file\n`);

    expect(dotenv.config({ path: probePath })).toEqual({ parsed: {} });
    expect(process.env[SYNTHETIC_KEY]).toBeUndefined();
  });

  it('refuses to hand a suite the real search index', async () => {
    const index = await getMeiliIndex('researchentities');
    await expect(index.search('', { limit: 1 })).rejects.toThrow(UNREACHABLE_SEARCH_INDEX_MESSAGE);
    await expect(index.addDocuments([{ id: 'probe' }])).rejects.toThrow(
      UNREACHABLE_SEARCH_INDEX_MESSAGE,
    );
    await expect(index.deleteDocument('probe')).rejects.toThrow(UNREACHABLE_SEARCH_INDEX_MESSAGE);

    const client = await getMeiliClient();
    await expect(client.getIndexes()).rejects.toThrow(UNREACHABLE_SEARCH_INDEX_MESSAGE);
  });

  it('keeps dotenv.parse working, because operator scripts read profiles with it', () => {
    expect(dotenv.parse(Buffer.from(`${SYNTHETIC_KEY}=parsed\n`))).toEqual({
      [SYNTHETIC_KEY]: 'parsed',
    });
    expect(process.env[SYNTHETIC_KEY]).toBeUndefined();
  });
});
