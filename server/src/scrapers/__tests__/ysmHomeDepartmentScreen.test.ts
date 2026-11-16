import { describe, expect, it } from 'vitest';
import { withoutUncataloguedYsmHomeDepartments } from '../ysmHomeDepartmentScreen';

const catalog = { canonicalDepartment: (name: string) => (name === 'Surgery' ? name : undefined) };
const reading = (field: string, value: unknown, sourceName = 'ysm-faculty-directory') => ({
  field,
  value,
  sourceName,
});

describe('withoutUncataloguedYsmHomeDepartments', () => {
  it('drops a YSM home department the catalog does not name and keeps everything else', () => {
    expect(
      withoutUncataloguedYsmHomeDepartments(
        [
          reading('primaryDepartment', 'Fixture Center'),
          reading('primaryDepartment', 'Surgery'),
          reading('departments', ['Fixture Center']),
          reading('primaryDepartment', 'Fixture Center', 'dept-faculty-roster'),
        ],
        catalog,
      ),
    ).toEqual([
      reading('primaryDepartment', 'Surgery'),
      reading('departments', ['Fixture Center']),
      reading('primaryDepartment', 'Fixture Center', 'dept-faculty-roster'),
    ]);
  });

  it('screens nothing while the catalog is unavailable', () => {
    const kept = [reading('primaryDepartment', 'Fixture Center')];
    expect(withoutUncataloguedYsmHomeDepartments(kept, { canonicalDepartment: null })).toEqual(
      kept,
    );
  });
});
