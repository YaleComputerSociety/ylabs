import { describe, expect, it } from 'vitest';
import { ResearchEntity, researchEntitySchemaVersion } from '../researchEntity';

function validEntity(overrides: Record<string, unknown> = {}) {
  return new ResearchEntity({
    slug: 'fixture-lab',
    name: 'Fixture Lab',
    ...overrides,
  });
}

describe('ResearchEntity canonical schema version', () => {
  it('defaults a new document to the collection current version', () => {
    const document = validEntity();

    expect(researchEntitySchemaVersion.currentVersion).toBe(1);
    expect(document.schemaVersion).toBe(1);
    expect(document.validateSync()).toBeUndefined();
  });

  it('accepts an explicitly supplied supported version', () => {
    const document = validEntity({ schemaVersion: 1 });

    expect(document.validateSync()).toBeUndefined();
  });

  it.each([0, -1, 1.5, 2])('rejects unsupported schema version %s', (schemaVersion) => {
    const document = validEntity({ schemaVersion });

    expect(document.validateSync()?.errors.schemaVersion).toBeTruthy();
  });
});

describe('ResearchEntity kind enum', () => {
  it.each(['lab', 'center', 'institute', 'program', 'core_facility'])(
    'accepts canonical research group kind %s',
    (kind) => {
      const document = validEntity({ kind });

      expect(document.validateSync()?.errors.kind).toBeUndefined();
    },
  );

  it('rejects a kind outside the canonical research group kinds', () => {
    const document = validEntity({ kind: 'not_a_kind' });

    expect(document.validateSync()?.errors.kind).toBeTruthy();
  });
});
