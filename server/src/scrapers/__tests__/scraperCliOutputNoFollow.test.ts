import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../scripts/scriptWriteGuards', () => ({
  resolveSafeJsonReportOutputPath: (output: string) => path.resolve(output),
}));

import { writeJsonOutputFile } from '../scraperCliOutput';

describe('a link planted after the report path is checked (#6366)', () => {
  it('refuses to follow it at open, so the link target is never written', async () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-nofollow-')));
    const target = path.join(dir, 'elsewhere.json');
    const output = path.join(dir, 'report.json');
    fs.symlinkSync(target, output);

    try {
      await expect(writeJsonOutputFile(output, { ok: true })).rejects.toMatchObject({
        code: 'ELOOP',
      });
      expect(fs.existsSync(target)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
