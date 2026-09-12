const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const entityUrls = (entity: Record<string, any>): string[] =>
  [
    entity.websiteUrl,
    entity.website,
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
  ]
    .map(textValue)
    .filter((value) => /^https?:\/\//i.test(value));

const organizationalEngagementUrlPathPatterns = [
  /\/(?:people|staff|team|members?|membership|our-people|who-we-are|leadership)(?:\/|$)/i,
  /\/(?:get-involved|getinvolved|join(?:-us)?|participate|volunteer|opportunities|apply|how-to-apply|admissions)(?:\/|$)/i,
  /\/(?:programs?|education|academics|training|courses?|fellowships?|internships?|research-opportunities|for-students|students)(?:\/|$)/i,
  // Student-research engagement tokens carried mid-segment (e.g.
  // /undergraduate-program/undergraduate-research-in-x, /research-internship-program,
  // /research/undergraduate-research-opportunities, /undergraduates/senior-essay,
  // /what-directed-research-course). The segment-anchored patterns above miss these
  // even though the page itself is the student's way in. Directed/independent-research
  // and independent-study pages are the for-credit course pathway's own way in.
  /(?:^|[/-])(?:undergraduate-research|undergraduate-study|undergraduate-program|undergraduates|undergraduate|undergrad|directed-research|independent-research|independent-study|research-internship|research-opportunit(?:y|ies)|research-assistantships?|research-experience|for-undergraduates?)(?:[/-]|$)/i,
];

export function isOrganizationalEngagementUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/+$/g, '') || '/';
    if (path === '/') return false;
    return organizationalEngagementUrlPathPatterns.some((pattern) => pattern.test(path));
  } catch {
    return false;
  }
}

export function hasOrganizationalEngagementLink(entity: Record<string, any>): boolean {
  return entityUrls(entity).some(isOrganizationalEngagementUrl);
}

/**
 * The single owner of "this organizational home offers a way in other than a
 * named lead". Read by the student-visibility tier, which reports its absence as
 * `missing_alternate_access_path`, and by the access materializer, which must
 * refuse to mint the organizational REACH_OUT_PLAUSIBLE signal without one
 * (#1359). Changing this predicate changes both the signal and the tier - that
 * shared ownership is the point, per #2421.
 *
 * It lives in `utils` rather than beside the tier service because
 * `server/src/utils` never imports from `server/src/services`, and the
 * materializer must not pull the whole tier service in to ask one question.
 */
export function hasOrganizationalAlternateAccessPath({
  entity,
  relatedEntityAccessPathCount,
  rosterCount = 0,
}: {
  entity: Record<string, any>;
  relatedEntityAccessPathCount: number;
  rosterCount?: number;
}): boolean {
  if (relatedEntityAccessPathCount > 0) return true;
  if (rosterCount > 0) return true;
  return hasOrganizationalEngagementLink(entity);
}
