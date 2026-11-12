import { describe, expect, it } from 'vitest';
import { planStoredDirectoryExportDepartments } from '../retireDirectoryExportDepartmentsCore';

const canonical = (name: string) => (name === 'History' ? 'History' : undefined);

describe('planStoredDirectoryExportDepartments (#5796)', () => {
  it('decodes an export code to its catalog department, clears one with none, and leaves the rest', () => {
    expect(
      planStoredDirectoryExportDepartments(
        [
          { id: 'a', primaryDepartment: 'FASHIS History' },
          { id: 'b', primaryDepartment: 'ENVOTH Other Units' },
          { id: 'c', primaryDepartment: 'History' },
        ],
        canonical,
      ),
    ).toEqual({
      canonical: [{ id: 'a', from: 'FASHIS History', to: 'History' }],
      cleared: [{ id: 'b', from: 'ENVOTH Other Units' }],
    });
  });
});
