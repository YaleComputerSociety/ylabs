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

  it('reads only a bounded tail from the end of a large step log', () => {
    const logPath = path.join(dir, 'huge.log');
    const line = `${'x'.repeat(1000)}`;
    fs.writeFileSync(logPath, `${Array.from({ length: 5000 }, (_, i) => `${i}-${line}`).join('\n')}\n`);
    const tail = readLogTail(logPath, 5, 8 * 1024);

    expect(tail).toHaveLength(5);
    expect(tail.at(-1)?.startsWith('4999-')).toBe(true);
    for (const captured of tail) {
      expect(captured).toMatch(/^\d+-x+$/);
    }
  });

  it('redacts scraped contact data and credentials captured in a failing step tail', () => {
    const logPath = path.join(dir, 'leaky.log');
    fs.writeFileSync(
      logPath,
      [
        'MongoServerError: connection to mongodb+srv://sweeper:hunter2@cluster.example.net/Development failed',
        'scraped contact: someone@example.edu / 203-555-0147',
      ].join('\n'),
    );
    const logger = new SweepRunLogger(dir, now);
    logger.logFailed('source:yale-directory', 1, logPath);

    const errors = fs.readFileSync(path.join(dir, 'errors.log'), 'utf8');
    expect(errors).not.toContain('sweeper:hunter2');
    expect(errors).not.toContain('someone@example.edu');
    expect(errors).not.toContain('203-555-0147');
    expect(errors).toContain('[credentials-redacted]');
    expect(errors).toContain('[email redacted]');
    expect(errors).toContain('[phone redacted]');
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
