import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { AUDITED_REPAIR_SCRIPTS } from '../auditPlansTheProjectionDeclines';

const PACKAGE_JSON = path.join(__dirname, '..', '..', '..', 'package.json');

function registeredScripts(): Set<string> {
  const scripts =
    (JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as { scripts?: Record<string, string> })
      .scripts ?? {};
  return new Set(Object.keys(scripts));
}

describe('audit-plans-the-projection-declines registry', () => {
  it('names only npm scripts that server/package.json registers', () => {
    const registered = registeredScripts();
    const unresolved = AUDITED_REPAIR_SCRIPTS.map((entry) => entry.script).filter(
      (script) => !registered.has(script),
    );
    expect(unresolved).toEqual([]);
  });

  it('names each script once and gives every entry a planner or a reason', () => {
    const names = AUDITED_REPAIR_SCRIPTS.map((entry) => entry.script);
    expect(new Set(names).size).toBe(names.length);
    for (const entry of AUDITED_REPAIR_SCRIPTS) {
      expect(Boolean(entry.plan) || Boolean(entry.unknownReason?.trim())).toBe(true);
    }
  });
});
