import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

import { hasOutputPath, writeJsonOutputFile, writeOptionalJsonOutput } from '../scraperCliOutput';

describe('scraperCliOutput', () => {
  it('writes pretty JSON output files with parent directories', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-scraper-cli-output-'));
    const outputPath = path.join(dir, 'nested', 'retention.json');

    const resolved = await writeJsonOutputFile(outputPath, {
      apply: false,
      candidates: 0,
      sourceName: 'openalex',
    });

    expect(resolved).toBe(path.resolve(outputPath));
    expect(JSON.parse(fs.readFileSync(outputPath, 'utf8'))).toEqual({
      apply: false,
      candidates: 0,
      sourceName: 'openalex',
    });
    expect(fs.readFileSync(outputPath, 'utf8')).toMatch(/\n$/);
  });

  it('recognizes non-empty output path flags only', () => {
    expect(hasOutputPath('/tmp/report.json')).toBe(true);
    expect(hasOutputPath('')).toBe(false);
    expect(hasOutputPath(true)).toBe(false);
    expect(hasOutputPath(undefined)).toBe(false);
  });

  it('writes optional JSON output and logs the resolved artifact path', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-scraper-cli-output-'));
    const outputPath = path.join(dir, 'run-report.json');
    const logger = vi.fn();

    const result = await writeOptionalJsonOutput({
      outputPath,
      payload: {
        run: { sourceName: 'orcid' },
        observations: { total: 0 },
      },
      label: 'ScrapeRun report',
      logger,
    });

    expect(result).toEqual({
      saved: true,
      outputPath: path.resolve(outputPath),
    });
    expect(JSON.parse(fs.readFileSync(outputPath, 'utf8'))).toEqual({
      run: { sourceName: 'orcid' },
      observations: { total: 0 },
    });
    expect(logger).toHaveBeenCalledWith(`Saved ScrapeRun report to ${path.resolve(outputPath)}`);
  });

  it('skips optional JSON output when no path is provided', async () => {
    const logger = vi.fn();

    await expect(
      writeOptionalJsonOutput({
        outputPath: undefined,
        payload: { ok: true },
        label: 'ScrapeRun report',
        logger,
      }),
    ).resolves.toEqual({ saved: false });
    expect(logger).not.toHaveBeenCalled();
  });
});
