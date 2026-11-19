import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveSafeJsonReportOutputPath } from '../reportOutputPath';
import { writeReportFileSync } from '../reportFileWriter';

const scratchDirectories: string[] = [];
const scratch = (prefix: string): string => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  scratchDirectories.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of scratchDirectories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('the shared report writer resolves the path again at write time (#6375)', () => {
  it('refuses a directory swapped for a link out of the approved root after the caller resolved', () => {
    const approved = scratch('ylabs-report-approved-');
    const elsewhere = scratch('ylabs-report-elsewhere-');
    const subdirectory = path.join(approved, 'reports');
    fs.mkdirSync(subdirectory);
    const output = path.join(subdirectory, 'report.json');
    const options = { tempRoots: [approved], env: {}, warn: () => {} };

    expect(resolveSafeJsonReportOutputPath(output, '--output', options)).toBe(output);
    fs.rmSync(subdirectory, { recursive: true });
    fs.symlinkSync(elsewhere, subdirectory);

    expect(() => writeReportFileSync(output, '{}\n', options)).toThrow(/--output/);
    expect(fs.existsSync(path.join(elsewhere, 'report.json'))).toBe(false);
  });

  it("names the caller's own flag when the fresh resolve refuses", () => {
    const approved = scratch('ylabs-report-approved-');
    const outside = scratch('ylabs-report-outside-');

    expect(() =>
      writeReportFileSync(path.join(outside, 'report.json'), '{}\n', {
        flag: '--slugs-out',
        tempRoots: [approved],
        env: {},
        warn: () => {},
      }),
    ).toThrow(/--slugs-out/);
  });
});
