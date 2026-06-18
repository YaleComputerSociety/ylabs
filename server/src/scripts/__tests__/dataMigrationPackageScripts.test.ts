import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataMigrationPackageJsonPath = path.resolve(
  __dirname,
  '../../../../data-migration/package.json',
);

function readDataMigrationScripts(): Record<string, string> {
  return JSON.parse(fs.readFileSync(dataMigrationPackageJsonPath, 'utf8')).scripts;
}

describe('data-migration package scripts', () => {
  it('does not expose aggregate migration aliases that bypass per-step review artifacts', () => {
    const scripts = readDataMigrationScripts();

    expect(scripts).not.toHaveProperty('migrate:all');
    expect(scripts).not.toHaveProperty('migrate:v4:identity');
    expect(scripts).not.toHaveProperty('migrate:v4:all');
  });
});
