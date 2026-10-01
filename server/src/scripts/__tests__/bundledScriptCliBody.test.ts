import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { build } from 'tsup';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hermeticChildEnvironment } from '../../test/hermeticEnvironment';

const SERVER_ROOT = path.resolve(__dirname, '../../..');
const SOURCE_HEALTH_CLI = path.join(SERVER_ROOT, 'src', 'scripts', 'sourceHealth.ts');
const BUNDLE_PARENT = path.join(SERVER_ROOT, 'node_modules', '.cache');

let bundleDir = '';

const runBundle = (bundleFileName: string) =>
  spawnSync(process.execPath, [path.join(bundleDir, bundleFileName)], {
    cwd: SERVER_ROOT,
    env: hermeticChildEnvironment({ MONGODBURL: '' }),
    encoding: 'utf8',
    timeout: 60000,
  });

describe('a bundle that contains a script with a CLI body', () => {
  beforeAll(async () => {
    fs.mkdirSync(BUNDLE_PARENT, { recursive: true });
    bundleDir = fs.mkdtempSync(path.join(BUNDLE_PARENT, 'bundled-script-cli-body-'));
    await build({
      entry: { index: SOURCE_HEALTH_CLI, sourceHealth: SOURCE_HEALTH_CLI },
      outDir: bundleDir,
      format: ['esm'],
      target: 'node20',
      bundle: true,
      splitting: false,
      sourcemap: false,
      clean: false,
      silent: true,
      config: false,
    });
  });

  afterAll(() => {
    if (bundleDir) fs.rmSync(bundleDir, { recursive: true, force: true });
  });

  it('runs nothing when the bundle is named after the server entry', () => {
    const run = runBundle('index.js');

    expect(`${run.stdout}${run.stderr}`.trim()).toBe('');
    expect(run.status).toBe(0);
  });

  it('still runs the CLI body when the bundle is the script itself', () => {
    const run = runBundle('sourceHealth.js');

    expect(`${run.stdout}${run.stderr}`).toContain('MONGODBURL');
    expect(run.status).not.toBe(0);
  });
});
