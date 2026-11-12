import { describe, expect, it } from 'vitest';
import { withoutDepartmentHeadingObservations } from '../departmentHeadingObservationScreen';

const HEADING = 'Other Departments & Organizations';

describe('withoutDepartmentHeadingObservations (#5795)', () => {
  it('drops a heading primary and every departments entry from the heading on', () => {
    expect(
      withoutDepartmentHeadingObservations([
        { field: 'primaryDepartment', value: HEADING },
        { field: 'departments', value: [HEADING, 'Fixture Center'] },
        { field: 'departments', value: [HEADING] },
        { field: 'departments', value: ['Fixture Surgery', HEADING, 'Fixture Pathology'] },
      ]),
    ).toEqual([{ field: 'departments', value: ['Fixture Surgery'] }]);
  });

  it('leaves every other observation as it is', () => {
    const kept = [
      { field: 'primaryDepartment', value: 'Fixture Studies' },
      { field: 'title', value: 'Professor of Fixture Studies' },
    ];
    expect(withoutDepartmentHeadingObservations(kept)).toEqual(kept);
  });
});
