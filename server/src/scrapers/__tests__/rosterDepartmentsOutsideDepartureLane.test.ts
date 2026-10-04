import { describe, expect, it } from 'vitest';
import { DEFAULT_DEPT_CONFIGS } from '../sources/departmentRosterScraper';
import {
  ROSTER_DEPARTMENTS_OUTSIDE_DEPARTURE_LANE,
  rosterDepartmentOutsideDepartureLaneReason,
} from '../rosterDepartmentsOutsideDepartureLane';

const configByKey = new Map(DEFAULT_DEPT_CONFIGS.map((config) => [config.deptKey, config]));

describe('roster departments outside the departure lane', () => {
  it('declares only roster keys that exist, each with a stated reason', () => {
    for (const [deptKey, reason] of Object.entries(ROSTER_DEPARTMENTS_OUTSIDE_DEPARTURE_LANE)) {
      expect(configByKey.has(deptKey), deptKey).toBe(true);
      expect(reason.trim().length).toBeGreaterThan(20);
    }
  });

  it('declares every affiliates roster, since affiliation is not a home department', () => {
    const affiliatesRosters = DEFAULT_DEPT_CONFIGS.filter(
      (config) => config.affiliatesOnly && config.officialProfileOnly,
    ).map((config) => config.deptKey);
    expect(affiliatesRosters.length).toBeGreaterThan(0);
    for (const deptKey of affiliatesRosters) {
      expect(rosterDepartmentOutsideDepartureLaneReason(deptKey), deptKey).toMatch(/affiliat/);
    }
  });

  it('declares the school-wide directories whose name is a school rather than a department', () => {
    for (const deptKey of ['divinity', 'nursing', 'law', 'drama', 'ysph']) {
      expect(configByKey.get(deptKey)?.schoolWideDirectory, deptKey).toBe(true);
      expect(rosterDepartmentOutsideDepartureLaneReason(deptKey), deptKey).toMatch(/school/);
    }
  });

  it('declares the 17 roster keys measured as unresolved, and nothing outside the roster', () => {
    expect(Object.keys(ROSTER_DEPARTMENTS_OUTSIDE_DEPARTURE_LANE)).toHaveLength(17);
    expect(rosterDepartmentOutsideDepartureLaneReason('physics')).toBeNull();
    expect(rosterDepartmentOutsideDepartureLaneReason(undefined)).toBeNull();
    expect(rosterDepartmentOutsideDepartureLaneReason('toString')).toBeNull();
  });
});
