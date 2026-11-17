import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../reportOutputPath', () => ({
  resolveSafeJsonReportOutputPath: (output: string) => path.resolve(output),
}));

import { writeJsonReportFileSync, writeReportFileSync } from '../reportFileWriter';

const scratchDirectories: string[] = [];
const scratch = (): string => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-report-writer-')));
  scratchDirectories.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of scratchDirectories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('the shared report writer (#6375)', () => {
  it('refuses a link planted after the path was resolved, so its target is never written', () => {
    const dir = scratch();
    const target = path.join(dir, 'elsewhere.json');
    const output = path.join(dir, 'report.json');
    fs.symlinkSync(target, output);

    expect(() => writeReportFileSync(output, '{}\n')).toThrow(
      expect.objectContaining({ code: 'ELOOP' }),
    );
    expect(() => writeJsonReportFileSync(output, { ok: true })).toThrow(
      expect.objectContaining({ code: 'ELOOP' }),
    );
    expect(fs.existsSync(target)).toBe(false);
  });

  it('writes the exact contents with mode 0600, narrowing a pre-existing wider file', () => {
    const dir = scratch();
    const output = path.join(dir, 'report.json');
    fs.writeFileSync(output, 'old', { mode: 0o644 });
    fs.chmodSync(output, 0o644);

    writeReportFileSync(output, 'new contents\n');

    expect(fs.readFileSync(output, 'utf8')).toBe('new contents\n');
    expect(fs.statSync(output).mode & 0o777).toBe(0o600);
  });

  it('refuses to overwrite an existing file when exclusive, leaving it untouched', () => {
    const dir = scratch();
    const output = path.join(dir, 'report.json');
    fs.writeFileSync(output, 'kept');

    expect(() => writeReportFileSync(output, 'replaced', { exclusive: true })).toThrow(
      expect.objectContaining({ code: 'EEXIST' }),
    );
    expect(fs.readFileSync(output, 'utf8')).toBe('kept');
  });

  it('creates a new file with mode 0600 when exclusive', () => {
    const dir = scratch();
    const output = path.join(dir, 'report.json');

    writeReportFileSync(output, 'fresh\n', { exclusive: true });

    expect(fs.readFileSync(output, 'utf8')).toBe('fresh\n');
    expect(fs.statSync(output).mode & 0o777).toBe(0o600);
  });

  it('refuses an exclusive write through a planted link, so its target is never created', () => {
    const dir = scratch();
    const target = path.join(dir, 'elsewhere.json');
    const output = path.join(dir, 'report.json');
    fs.symlinkSync(target, output);

    expect(() => writeReportFileSync(output, '{}\n', { exclusive: true })).toThrow();
    expect(fs.existsSync(target)).toBe(false);
  });

  it('formats a JSON payload the way the async JSON writer does', () => {
    const dir = scratch();
    const output = path.join(dir, 'report.json');

    writeJsonReportFileSync(output, { a: 1 });

    expect(fs.readFileSync(output, 'utf8')).toBe('{\n  "a": 1\n}\n');
  });
});
