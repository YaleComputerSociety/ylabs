import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveSafeJsonReportOutputPath } from '../../scripts/scriptWriteGuards';
import {
  approvedTempRootFor,
  inspectTempArtifactParent,
  realDirectoryPath,
  resolveRealPath,
  sharedTempRoot,
} from '../tempArtifactRoots';

describe('temp artifact roots', () => {
  let realRoot: string;
  let linkedRoot: string;
  let originalTmpDir: string | undefined;

  beforeEach(() => {
    originalTmpDir = process.env.TMPDIR;
    realRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ylabs-temp-root-'));
    linkedRoot = `${realRoot}-link`;
    fs.symlinkSync(realRoot, linkedRoot);
  });

  afterEach(() => {
    if (originalTmpDir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = originalTmpDir;
    fs.rmSync(linkedRoot, { force: true });
    fs.rmSync(realRoot, { recursive: true, force: true });
  });

  it('resolves a symlinked ancestor and keeps a path that does not exist yet', () => {
    expect(resolveRealPath(path.join(linkedRoot, 'reports', 'artifact.json'))).toBe(
      path.join(realRoot, 'reports', 'artifact.json'),
    );
    expect(realDirectoryPath(linkedRoot)).toBe(realRoot);
    expect(realDirectoryPath(path.join(realRoot, 'absent'))).toBeUndefined();
  });

  it('matches an approved root through a symlink in either direction', () => {
    expect(approvedTempRootFor(path.join(realRoot, 'artifact.json'), [linkedRoot])).toEqual({
      root: linkedRoot,
      realRoot,
    });
    expect(approvedTempRootFor(path.join(linkedRoot, 'artifact.json'), [realRoot])).toEqual({
      root: realRoot,
      realRoot,
    });
    expect(
      approvedTempRootFor(path.join(realRoot, '..', 'elsewhere.json'), [realRoot]),
    ).toBeUndefined();
  });

  it('accepts a real directory chain under a symlinked root and still refuses symlink components', () => {
    const accepted = inspectTempArtifactParent(path.join(linkedRoot, 'reports'), {
      createMissingDirectories: true,
      candidateRoots: [linkedRoot],
    });
    expect(accepted).toEqual({ realParent: path.join(realRoot, 'reports') });

    const sibling = path.join(realRoot, 'sibling');
    const linkedComponent = path.join(realRoot, 'linked');
    fs.mkdirSync(sibling, { mode: 0o700 });
    fs.symlinkSync(sibling, linkedComponent);
    expect(
      inspectTempArtifactParent(path.join(linkedComponent, 'nested'), {
        createMissingDirectories: true,
        candidateRoots: [realRoot],
      }),
    ).toEqual({ refusal: 'component-not-a-real-directory' });
    expect(fs.existsSync(path.join(sibling, 'nested'))).toBe(false);
  });

  it('refuses a component symlinked out of the approved root without creating anything', () => {
    const escape = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ylabs-temp-escape-'));
    const linkedComponent = path.join(realRoot, 'linked');
    fs.symlinkSync(escape, linkedComponent);
    try {
      expect(
        inspectTempArtifactParent(path.join(linkedComponent, 'nested'), {
          createMissingDirectories: true,
          candidateRoots: [realRoot],
        }),
      ).toEqual({ refusal: 'outside-approved-root' });
      expect(fs.existsSync(path.join(escape, 'nested'))).toBe(false);
    } finally {
      fs.rmSync(escape, { recursive: true, force: true });
    }
  });

  it('refuses a parent outside every approved root', () => {
    expect(inspectTempArtifactParent('/etc', { candidateRoots: [realRoot] })).toEqual({
      refusal: 'outside-approved-root',
    });
  });

  it('accepts the same JSON artifact path whichever spelling TMPDIR uses', () => {
    for (const tmpDir of [linkedRoot, realRoot]) {
      process.env.TMPDIR = tmpDir;
      expect(os.tmpdir()).toBe(tmpDir);
      for (const spelling of [linkedRoot, realRoot]) {
        const output = path.join(spelling, 'artifact.json');
        expect(resolveSafeJsonReportOutputPath(output)).toBe(output);
      }
      expect(() => resolveSafeJsonReportOutputPath('/etc/artifact.json')).toThrow(
        /must write under/,
      );
    }
  });

  it('accepts the shared temporary root even when TMPDIR points elsewhere', () => {
    process.env.TMPDIR = realRoot;
    const sharedOutput = path.join(sharedTempRoot(), 'ylabs-shared-root-artifact.json');
    expect(resolveSafeJsonReportOutputPath(sharedOutput)).toBe(sharedOutput);
    expect(() => resolveSafeJsonReportOutputPath('/var/tmp/ylabs-artifact.json')).toThrow(
      /must write under/,
    );
  });
});
