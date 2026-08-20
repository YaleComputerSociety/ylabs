import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(__dirname, '..');
const serverPackageJsonPath = path.resolve(__dirname, '../../../package.json');

function readServerScripts(): Record<string, string> {
  return JSON.parse(fs.readFileSync(serverPackageJsonPath, 'utf8')).scripts;
}

function scriptSourceFiles(): string[] {
  return fs
    .readdirSync(scriptsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => path.join(scriptsDir, entry.name));
}

const CANONICAL_IDENTITY_WIPE = new RegExp(
  '(RoleAssignment|Researcher|Account|role_assignments|researchers|accounts)\\b' +
    '[^\\n]*\\.(deleteMany|drop)\\(',
);

describe('canonical identity write path is continuous, not batch-derived', () => {
  it('no longer exposes the destructive batch identity apply script', () => {
    const scripts = readServerScripts();
    expect(scripts).not.toHaveProperty('model-refactor:identity-apply');
    expect(scripts).toHaveProperty('model-refactor:identity-plan');
  });

  it('removed the destructive batch identity apply modules', () => {
    expect(fs.existsSync(path.join(scriptsDir, 'phase2IdentityMigrationApply.ts'))).toBe(false);
    expect(fs.existsSync(path.join(scriptsDir, 'phase2IdentityMigrationApplyCore.ts'))).toBe(false);
  });

  it('has no script that wipes canonical identity collections before rebuilding them', () => {
    const offenders = scriptSourceFiles().filter((file) =>
      CANONICAL_IDENTITY_WIPE.test(fs.readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
