import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { connectScriptMongo } from '../../db/connections';
import { parseRematerializeResearchEntitiesArgs } from '../rematerializeResearchEntitiesCore';

const originalArgv = process.argv;
const created: string[] = [];

afterEach(() => {
  process.argv = originalArgv;
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const missingParentReport = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-output-before-connect-'));
  created.push(dir);
  return path.join(dir, 'missing', 'report.json');
};

describe('--output is resolved before a script connects (#6366)', () => {
  it('refuses a rematerialize report path whose directory does not exist, at parse time', () => {
    expect(() =>
      parseRematerializeResearchEntitiesArgs([
        '--slugs',
        'fixture-row',
        '--output',
        missingParentReport(),
      ]),
    ).toThrow('does not exist; create it before the run');
  });

  it('refuses before connecting when the process was started with an unusable --output', async () => {
    process.argv = ['node', 'fixture-script.ts', '--apply', '--output', missingParentReport()];

    await expect(
      connectScriptMongo('mongodb://127.0.0.1:1/ylabs-never-reached', {
        serverSelectionTimeoutMS: 50,
      }),
    ).rejects.toThrow('does not exist; create it before the run');
  });
});
