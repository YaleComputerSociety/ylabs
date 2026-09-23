import { personScopedResearchEntityNameFromPersonName } from '../../utils/researchHomeNameIdentityAuthority';

/**
 * A grant record asserts that a person is funded. It never asserts that an
 * organization exists, and never asserts that organization's name, so a funding
 * lane may not mint a `LAB` named "<person> Lab" (#3145). `individual` maps to
 * `FACULTY_RESEARCH_AREA`, the first-class person-scoped type (#2881), and the
 * name comes from the same authority the roster lanes use so the corpus keeps one
 * naming convention rather than gaining a second.
 */
export const GRANT_SHELL_KIND = 'individual';

export function grantShellResearchRecordName(personName: unknown, fallback: string): string {
  const derived = personScopedResearchEntityNameFromPersonName({
    candidateName: personName,
    kind: GRANT_SHELL_KIND,
  });
  return derived || fallback;
}
