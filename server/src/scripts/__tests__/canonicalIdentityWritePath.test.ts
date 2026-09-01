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
    '[^\\n]*\\.(?:drop\\(|deleteMany\\((?!\\s*\\{\\s*_id\\b))',
);

function wipesCanonicalIdentityCollections(source: string): boolean {
  return CANONICAL_IDENTITY_WIPE.test(source);
}

describe('canonical identity write path is continuous, not batch-derived', () => {
  it('treats unscoped identity deletes as wipes and enumerated-id prunes as safe', () => {
    expect(wipesCanonicalIdentityCollections('await Researcher.deleteMany({});')).toBe(true);
    expect(wipesCanonicalIdentityCollections('await Account.deleteMany();')).toBe(true);
    expect(wipesCanonicalIdentityCollections('await RoleAssignment.collection.drop();')).toBe(true);
    expect(wipesCanonicalIdentityCollections('await Researcher.deleteMany(filter);')).toBe(true);

    expect(
      wipesCanonicalIdentityCollections('await Researcher.deleteMany({ _id: { $in: ids } });'),
    ).toBe(false);
    expect(
      wipesCanonicalIdentityCollections('await Account.deleteMany({ _id: { $in: ids } });'),
    ).toBe(false);
  });

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
      wipesCanonicalIdentityCollections(fs.readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
