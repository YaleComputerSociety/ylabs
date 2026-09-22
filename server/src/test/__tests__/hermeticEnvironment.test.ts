import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { afterEach, describe, expect, it } from 'vitest';

import { getMeiliClient, getMeiliIndex } from '../../utils/meiliClient';
import { UNREACHABLE_SEARCH_INDEX_MESSAGE, fencedEnvironmentKeys } from '../hermeticEnvironment';

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

  it('fences every name the committed env template declares', () => {
    const template = Object.keys(
      dotenv.parse(fs.readFileSync(path.join(SERVER_ROOT, '.env.example'))),
    );
    expect(template).toContain('MEILISEARCH_API_KEY');
    expect(fencedEnvironmentKeys()).toEqual(expect.arrayContaining(template));
    expect(fencedEnvironmentKeys()).toContain('MONGODBURL');
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
