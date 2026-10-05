import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveServerPackageRoot } from '../serverPackageRoot';

const writeManifest = (directory: string, name: string) => {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name }));
};

describe('resolveServerPackageRoot', () => {
  let checkout = '';
  let serverRoot = '';

  beforeAll(() => {
    checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'server-package-root-'));
    serverRoot = path.join(checkout, 'server');
    writeManifest(checkout, 'ylabs');
    writeManifest(serverRoot, 'server');
    writeManifest(path.join(serverRoot, 'node_modules', 'some-dependency'), 'some-dependency');
  });

  afterAll(() => {
    fs.rmSync(checkout, { recursive: true, force: true });
  });

  const moduleUrl = (...segments: string[]) =>
    pathToFileURL(path.join(serverRoot, ...segments)).href;

  it('finds the server package from a source module', () => {
    expect(resolveServerPackageRoot(moduleUrl('src', 'scripts', 'gateRefreshScheduler.ts'))).toBe(
      serverRoot,
    );
  });

  it('finds the same server package from inside the bundle', () => {
    expect(resolveServerPackageRoot(moduleUrl('build', 'index.js'))).toBe(serverRoot);
  });

  it('passes over a nested package that is not the server', () => {
    expect(
      resolveServerPackageRoot(moduleUrl('node_modules', 'some-dependency', 'lib', 'index.js')),
    ).toBe(serverRoot);
  });

  it('refuses a module outside any server package', () => {
    expect(() =>
      resolveServerPackageRoot(pathToFileURL(path.join(checkout, 'scripts', 'tool.mjs')).href),
    ).toThrow(/package\.json/);
  });

  it('resolves this checkout to the directory that holds the server manifest', () => {
    const resolved = resolveServerPackageRoot(pathToFileURL(__filename).href);
    expect(JSON.parse(fs.readFileSync(path.join(resolved, 'package.json'), 'utf8')).name).toBe(
      'server',
    );
  });
});
