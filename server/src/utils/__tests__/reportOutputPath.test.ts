import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  REPORT_ROOT_ENV,
  REPOSITORY_ROOT,
  outputFlagValueFromArgv,
  resolveReportRoot,
  resolveSafeJsonReportOutputPath,
} from '../reportOutputPath';

const created: string[] = [];
const scratch = (prefix: string): string => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  created.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of created.splice(0)) {
    fs.chmodSync(dir, 0o700);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A synthetic checkout and a report root beside it, with no temp root approved, so the report
 * root is the only thing that can approve a path.
 */
function isolatedRoots() {
  const repositoryRoot = scratch('ylabs-report-repo-');
  const reportRoot = scratch('ylabs-report-root-');
  return {
    repositoryRoot,
    reportRoot,
    resolve: (output: string, env: NodeJS.ProcessEnv = { [REPORT_ROOT_ENV]: reportRoot }) =>
      resolveSafeJsonReportOutputPath(output, '--output', {
        env,
        cwd: repositoryRoot,
        repositoryRoot,
        tempRoots: [],
        warn: () => undefined,
      }),
  };
}

describe('YLABS_REPORT_ROOT (#6366)', () => {
  it('approves a report root outside the checkout, and only while it is set', () => {
    const { reportRoot, resolve } = isolatedRoots();
    const output = path.join(reportRoot, 'report.json');

    expect(resolve(output)).toBe(output);
    expect(() => resolve(output, {})).toThrow('--output must write under');
  });

  it('refuses a report root inside the checkout', () => {
    const { repositoryRoot } = isolatedRoots();
    const inside = path.join(repositoryRoot, 'reports');
    fs.mkdirSync(inside);

    expect(() => resolveReportRoot({ [REPORT_ROOT_ENV]: inside }, repositoryRoot)).toThrow(
      'must lie outside the repository checkout',
    );
  });

  it('refuses a relative report root', () => {
    const { repositoryRoot } = isolatedRoots();
    expect(() => resolveReportRoot({ [REPORT_ROOT_ENV]: 'reports' }, repositoryRoot)).toThrow(
      'must be an absolute path',
    );
  });

  it('refuses a report root that is a symlink into the checkout', () => {
    const { repositoryRoot } = isolatedRoots();
    const inside = path.join(repositoryRoot, 'reports');
    fs.mkdirSync(inside);
    const link = path.join(scratch('ylabs-report-link-'), 'reports');
    fs.symlinkSync(inside, link);

    expect(() => resolveReportRoot({ [REPORT_ROOT_ENV]: link }, repositoryRoot)).toThrow(
      'must lie outside the repository checkout',
    );
  });

  it('refuses an --output whose parent is a symlink from the report root into the checkout', () => {
    const { repositoryRoot, reportRoot, resolve } = isolatedRoots();
    const inside = path.join(repositoryRoot, 'reports');
    fs.mkdirSync(inside);
    fs.symlinkSync(inside, path.join(reportRoot, 'into-repo'));

    expect(() => resolve(path.join(reportRoot, 'into-repo', 'report.json'))).toThrow(
      '--output must write under',
    );
  });

  it('refuses an --output into the checkout when the report root contains the checkout', () => {
    const reportRoot = scratch('ylabs-report-parent-');
    const repositoryRoot = path.join(reportRoot, 'checkout');
    fs.mkdirSync(path.join(repositoryRoot, 'reports'), { recursive: true });
    const options = {
      env: { [REPORT_ROOT_ENV]: reportRoot },
      cwd: repositoryRoot,
      repositoryRoot,
      tempRoots: [],
      warn: () => undefined,
    };

    expect(
      resolveSafeJsonReportOutputPath(path.join(reportRoot, 'report.json'), '--output', options),
    ).toBe(path.join(reportRoot, 'report.json'));
    expect(() =>
      resolveSafeJsonReportOutputPath(
        path.join(repositoryRoot, 'reports', 'report.json'),
        '--output',
        options,
      ),
    ).toThrow('resolves into the repository checkout');
  });

  it('locates the checkout as the parent of the server package', () => {
    expect(fs.existsSync(path.join(REPOSITORY_ROOT, 'server', 'package.json'))).toBe(true);
  });
});

describe('the report directory is checked before the run (#6366)', () => {
  it('accepts a writable directory and leaves no probe file behind', () => {
    const { reportRoot, resolve } = isolatedRoots();
    expect(resolve(path.join(reportRoot, 'report.json'))).toBe(
      path.join(reportRoot, 'report.json'),
    );
    expect(fs.readdirSync(reportRoot)).toEqual([]);
  });

  it('refuses a directory that does not exist', () => {
    const { reportRoot, resolve } = isolatedRoots();
    expect(() => resolve(path.join(reportRoot, 'missing', 'report.json'))).toThrow(
      'does not exist; create it before the run',
    );
  });

  it.skipIf(process.getuid?.() === 0)('refuses a directory it cannot write', () => {
    const { reportRoot, resolve } = isolatedRoots();
    const locked = path.join(reportRoot, 'locked');
    fs.mkdirSync(locked);
    fs.chmodSync(locked, 0o500);
    try {
      expect(() => resolve(path.join(locked, 'report.json'))).toThrow('is not writable');
    } finally {
      fs.chmodSync(locked, 0o700);
    }
  });
});

describe('the temp-root warning (#6366)', () => {
  it('warns once that a report under the temp directory may be wiped', () => {
    const dir = scratch('ylabs-report-warn-');
    const warn = vi.fn();
    const output = path.join(dir, 'report.json');

    resolveSafeJsonReportOutputPath(output, '--output', { env: {}, warn });
    resolveSafeJsonReportOutputPath(output, '--output', { env: {}, warn });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('may wipe');
    expect(warn.mock.calls[0][0]).toContain(REPORT_ROOT_ENV);
  });

  it('does not warn for a report under the report root', () => {
    const { reportRoot, repositoryRoot } = isolatedRoots();
    const warn = vi.fn();
    resolveSafeJsonReportOutputPath(path.join(reportRoot, 'report.json'), '--output', {
      env: { [REPORT_ROOT_ENV]: reportRoot },
      cwd: repositoryRoot,
      repositoryRoot,
      tempRoots: [],
      warn,
    });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('outputFlagValueFromArgv', () => {
  it('reads --output and --output=, and ignores longer flags', () => {
    expect(outputFlagValueFromArgv(['--apply', '--output', '/tmp/a.json'])).toBe('/tmp/a.json');
    expect(outputFlagValueFromArgv(['--output=/tmp/b.json'])).toBe('/tmp/b.json');
    expect(outputFlagValueFromArgv(['--output-dir', '/tmp/x', '--outputFile=y'])).toBeUndefined();
    expect(outputFlagValueFromArgv(['--output'])).toBe('');
  });
});
