// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

const CLIENT_ROOT = join(__dirname, '..', '..');
const REPO_ROOT = join(CLIENT_ROOT, '..');
const SOURCE_DIR = join(CLIENT_ROOT, 'src');

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) return [];
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });

describe('PostHog project key', () => {
  it('commits no PostHog project key', () => {
    const scanned = [
      ...filesUnder(SOURCE_DIR),
      ...filesUnder(join(REPO_ROOT, 'docs')),
      join(CLIENT_ROOT, '.env.example'),
      join(REPO_ROOT, 'server', '.env.example'),
    ].filter((file) => {
      try {
        return statSync(file).isFile();
      } catch {
        return false;
      }
    });
    const keys = scanned.flatMap((file) =>
      (readFileSync(file, 'utf8').match(/phc_[A-Za-z0-9]{20,}/g) ?? [])
        .filter((key) => !key.startsWith('phc_synthetic'))
        .map((key) => `${relative(REPO_ROOT, file)} ${key.slice(0, 8)}`),
    );

    expect(keys).toEqual([]);
  });
});
