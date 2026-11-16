import { describe, expect, it } from 'vitest';
import { withoutUncataloguedBackfillHomeDepartments } from '../backfillHomeDepartmentScreen';
import { withUserDepartmentObservationsScreened } from '../userDepartmentObservationScreens';

const catalog = { canonicalDepartment: (name: string) => (name === 'Surgery' ? name : undefined) };
const reading = (field: string, value: unknown, sourceName = 'official-profile-pi-backfill') => ({
  field,
  value,
  sourceName,
});

describe('withoutUncataloguedBackfillHomeDepartments', () => {
  it('drops a backfill home department the catalog does not name and keeps everything else', () => {
    expect(
      withoutUncataloguedBackfillHomeDepartments(
        [
          reading('primaryDepartment', 'Current Full Time Faculty'),
          reading('primaryDepartment', 'Surgery'),
          reading('departments', ['Current Full Time Faculty']),
          reading('primaryDepartment', 'Current Full Time Faculty', 'fixture-lane'),
        ],
        catalog,
      ),
    ).toEqual([
      reading('primaryDepartment', 'Surgery'),
      reading('departments', ['Current Full Time Faculty']),
      reading('primaryDepartment', 'Current Full Time Faculty', 'fixture-lane'),
    ]);
  });

  it('screens nothing while the catalog is unavailable', () => {
    const kept = [reading('primaryDepartment', 'Current Full Time Faculty')];
    expect(withoutUncataloguedBackfillHomeDepartments(kept, { canonicalDepartment: null })).toEqual(
      kept,
    );
  });

  it('is one of the resolver department screens', () => {
    expect(
      withUserDepartmentObservationsScreened(
        [reading('primaryDepartment', 'Current Full Time Faculty')],
        catalog,
      ),
    ).toEqual([]);
  });
});
