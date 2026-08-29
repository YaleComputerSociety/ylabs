import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SweepRunLogger,
  formatErrorLogEntry,
  readLogTail,
  tailLines,
} from '../scraperSweepLogging';

describe('scraper sweep logging', () => {
  let dir: string;
  const now = () => new Date('2026-08-27T00:00:00.000Z');

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-logging-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns only the last N non-empty-trailing lines', () => {
    const content = `${Array.from({ length: 100 }, (_, i) => `line-${i}`).join('\n')}\n`;
    const tail = tailLines(content, 40);
    expect(tail).toHaveLength(40);
    expect(tail[0]).toBe('line-60');
    expect(tail.at(-1)).toBe('line-99');
  });

  it('records a failing step in runner.log and captures the tail of its output in errors.log', () => {
    const logPath = path.join(dir, 'step.log');
    fs.writeFileSync(
      logPath,
      `${Array.from({ length: 60 }, (_, i) => `output-${i}`).join('\n')}\n`,
    );
    const logger = new SweepRunLogger(dir, now);
    logger.logStart('source:yale-directory');
    logger.logFailed('source:yale-directory', 7, logPath);

    const errors = fs.readFileSync(path.join(dir, 'errors.log'), 'utf8');
    expect(errors).toContain('source:yale-directory');
    expect(errors).toContain('exitCode=7');
    expect(errors).toContain('output-59');
    expect(errors).toContain('output-20');
    expect(errors).not.toContain('output-19');

    const runner = fs.readFileSync(path.join(dir, 'runner.log'), 'utf8');
    expect(runner).toContain('[start] source:yale-directory');
    expect(runner).toContain('[failed] source:yale-directory');
  });

  it('emits a placeholder when a failing step wrote no captured output', () => {
    expect(readLogTail(path.join(dir, 'missing.log'))).toEqual([]);
    const entry = formatErrorLogEntry({
      at: now().toISOString(),
      stepId: 'stage:search-rebuild',
      exitCode: 1,
      tail: [],
    });
    expect(entry).toContain('(no captured output)');
    expect(entry).toContain('stage:search-rebuild');
  });
});
