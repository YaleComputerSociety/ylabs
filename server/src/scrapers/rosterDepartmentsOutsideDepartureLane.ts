const SCHOOL_WIDE_DIRECTORY =
  'a school-wide directory names a school, and no research row carries a school in departments';
const AFFILIATES_ROSTER =
  'an affiliates roster lists affiliation rather than a home department, so absence from it is not departure evidence';

export const ROSTER_DEPARTMENTS_OUTSIDE_DEPARTURE_LANE: Readonly<Record<string, string>> = {
  divinity: SCHOOL_WIDE_DIRECTORY,
  nursing: SCHOOL_WIDE_DIRECTORY,
  law: SCHOOL_WIDE_DIRECTORY,
  drama: SCHOOL_WIDE_DIRECTORY,
  ysph: SCHOOL_WIDE_DIRECTORY,
  yibs: AFFILIATES_ROSTER,
  'ysph-global-health': AFFILIATES_ROSTER,
  'council-east-asian-studies': AFFILIATES_ROSTER,
  'south-asian-studies-council': AFFILIATES_ROSTER,
  'ysph-climate-change-and-health': AFFILIATES_ROSTER,
  'ysph-implementation-science': AFFILIATES_ROSTER,
  'ysph-maternal-child-health-promotion': AFFILIATES_ROSTER,
  'ysph-public-health-modeling': AFFILIATES_ROSTER,
  'ysph-us-health-justice': AFFILIATES_ROSTER,
  'stem-cell-center':
    'a research-center roster of members who hold their appointment in another department',
  'physician-associate-program':
    'a degree programme team page whose people hold their appointment in another department',
  'west-campus':
    'a campus-location roster of institute members, which no research row carries as a department',
};

export function rosterDepartmentOutsideDepartureLaneReason(deptKey: unknown): string | null {
  if (typeof deptKey !== 'string' || !deptKey) return null;
  return Object.prototype.hasOwnProperty.call(ROSTER_DEPARTMENTS_OUTSIDE_DEPARTURE_LANE, deptKey)
    ? ROSTER_DEPARTMENTS_OUTSIDE_DEPARTURE_LANE[deptKey]
    : null;
}
