import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { isDirectScriptInvocation } from '../directScriptInvocation';

const originalArgv = [...process.argv];

const runWithEntry = <T>(entry: string | undefined, read: () => T): T => {
  if (entry === undefined) {
    process.argv.splice(1, 1);
  } else {
    process.argv[1] = entry;
  }
  return read();
};

const BUNDLE = path.join(path.sep, 'app', 'server', 'build', 'index.js');
const SOURCE_CLI = path.join(path.sep, 'app', 'server', 'src', 'scripts', 'sourceHealth.ts');

describe('isDirectScriptInvocation', () => {
  afterEach(() => {
    process.argv.length = 0;
    process.argv.push(...originalArgv);
  });

  it('is true for the script module run as the entry point', () => {
    expect(
      runWithEntry(SOURCE_CLI, () =>
        isDirectScriptInvocation(pathToFileURL(SOURCE_CLI).href, 'sourceHealth'),
      ),
    ).toBe(true);
  });

  it('is false inside the bundled server entry, where the module path is the bundle', () => {
    expect(
      runWithEntry(BUNDLE, () =>
        isDirectScriptInvocation(pathToFileURL(BUNDLE).href, 'sourceHealth'),
      ),
    ).toBe(false);
  });

  it('is false when another script is the entry point', () => {
    const otherCli = path.join(path.sep, 'app', 'server', 'src', 'scripts', 'claimGate.ts');
    expect(
      runWithEntry(otherCli, () =>
        isDirectScriptInvocation(pathToFileURL(SOURCE_CLI).href, 'sourceHealth'),
      ),
    ).toBe(false);
  });

  it('is false when the process has no entry argument', () => {
    expect(
      runWithEntry(undefined, () =>
        isDirectScriptInvocation(pathToFileURL(SOURCE_CLI).href, 'sourceHealth'),
      ),
    ).toBe(false);
  });

  it('accepts the compiled single-file form of the same script', () => {
    const compiled = path.join(path.sep, 'app', 'server', 'build', 'scripts', 'sourceHealth.js');
    expect(
      runWithEntry(compiled, () =>
        isDirectScriptInvocation(pathToFileURL(compiled).href, 'sourceHealth'),
      ),
    ).toBe(true);
  });
});
