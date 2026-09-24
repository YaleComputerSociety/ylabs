/**
 * The audit's own copy of the person-page mirror key.
 *
 * Mirrors `isRosterNestedPersonPageUrl` and `officialProfileMirrorKey` in
 * client/src/utils/researchDetailSources.ts, which decide the same question at render
 * time; changing the arms here requires updating that copy. The parity is pinned by
 * contracts/rosterNestedPersonPage.cases.json, which both suites read, rather than by a
 * comment asking the next author to remember.
 *
 * A copy rather than an import because the client module reaches DOM globals through its
 * URL helpers, and the server tsconfig has no DOM lib: importing it made the server
 * typecheck fail on browser code it has no business compiling.
 */

const ROSTER_COLLECTIVE_TOKEN =
  /^(?:faculty|faculties|staff|professor|professors|lecturer|lecturers|instructor|instructors|people|persons|humans|member|members|membership|fellow|fellows|affiliate|affiliates|associates|scholars|researchers|team|teams|directory|listing|roster|index|primary|emeriti|emeritus)$/i;

const PERSON_PAGE_ROOT_SEGMENT =
  /^(?:people|persons|person|profile|profiles|bio|bios|faculty|directory|who-we-are|our-people|our-faculty)$/i;

const PERSON_PROFILE_MIRROR_PATH =
  /\/(?:profile|profiles|bio|person|people|faculty)\/([a-z0-9][a-z0-9%._-]*)$/i;

const NON_PERSON_PROFILE_LEAF =
  /^(?:faculty|staff|people|members|fellows|affiliates|directory|index|all|list|search)$/i;

const hasCollectiveToken = (segment: string): boolean =>
  segment.split('-').some((token) => ROSTER_COLLECTIVE_TOKEN.test(token));

const hasFileExtension = (segment: string): boolean => /\.[a-z0-9]{2,5}$/.test(segment);

const yaleHostPathSegments = (
  url: string,
): { host: string; segments: string[]; path: string } | undefined => {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/i.test(parsed.protocol)) return undefined;
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    if (!/(^|\.)yale\.edu$/i.test(host)) return undefined;
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');
    return { host, segments: path.split('/').filter(Boolean), path };
  } catch {
    return undefined;
  }
};

export const isRosterNestedPersonPageUrl = (url: string): boolean => {
  const parts = yaleHostPathSegments(url);
  if (!parts || parts.segments.length < 3) return false;
  const [root, ...rest] = parts.segments;
  const leaf = rest[rest.length - 1];
  if (!PERSON_PAGE_ROOT_SEGMENT.test(root)) return false;
  if (!rest.slice(0, -1).every(hasCollectiveToken)) return false;
  return (
    !hasFileExtension(leaf) && !hasCollectiveToken(leaf) && !NON_PERSON_PROFILE_LEAF.test(leaf)
  );
};

export const personPageMirrorKey = (url: string): string | null => {
  const parts = yaleHostPathSegments(url);
  if (!parts) return null;
  const flat = parts.path.match(PERSON_PROFILE_MIRROR_PATH);
  if (flat) {
    const slug = flat[1].toLowerCase();
    return NON_PERSON_PROFILE_LEAF.test(slug) ? null : `${parts.host}\u0000${slug}`;
  }
  if (!isRosterNestedPersonPageUrl(url)) return null;
  return `${parts.host}\u0000${parts.segments[parts.segments.length - 1]}`;
};

export const citationDestination = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${host}${path}`;
  } catch {
    return null;
  }
};

export interface PersonPageMirrorFinding {
  slug: string;
  entityType?: string;
  host: string;
  /** Paths only. A full URL would pair a person's name with a defect judgement. */
  paths: string[];
}

export interface PersonPageCitationMirrorAudit {
  rowsRead: number;
  rowsWithCitations: number;
  rowsWithMirroredCitations: number;
  mirrorGroups: PersonPageMirrorFinding[];
  redundantCitationCount: number;
}

export interface AuditCitationRow {
  slug: string;
  entityType?: string;
  sourceUrls?: unknown;
}

export const auditPersonPageCitationMirrors = (
  rows: Iterable<AuditCitationRow>,
): PersonPageCitationMirrorAudit => {
  const audit: PersonPageCitationMirrorAudit = {
    rowsRead: 0,
    rowsWithCitations: 0,
    rowsWithMirroredCitations: 0,
    mirrorGroups: [],
    redundantCitationCount: 0,
  };

  for (const row of rows) {
    audit.rowsRead += 1;
    const urls = (Array.isArray(row.sourceUrls) ? row.sourceUrls : []).filter(
      (url): url is string => typeof url === 'string' && url.trim().length > 0,
    );
    if (urls.length === 0) continue;
    audit.rowsWithCitations += 1;

    const byMirrorKey = new Map<string, Set<string>>();
    for (const url of urls) {
      const key = personPageMirrorKey(url);
      const destination = citationDestination(url);
      if (!key || !destination) continue;
      const bucket = byMirrorKey.get(key);
      if (bucket) bucket.add(destination);
      else byMirrorKey.set(key, new Set([destination]));
    }

    const groups = Array.from(byMirrorKey.values()).filter((destinations) => destinations.size > 1);
    if (groups.length === 0) continue;
    audit.rowsWithMirroredCitations += 1;

    for (const destinations of groups) {
      const paths = Array.from(destinations).map((destination) =>
        destination.slice(destination.indexOf('/')),
      );
      audit.redundantCitationCount += paths.length - 1;
      audit.mirrorGroups.push({
        slug: row.slug,
        entityType: row.entityType,
        host: Array.from(destinations)[0].split('/')[0],
        paths,
      });
    }
  }

  return audit;
};

export const formatPersonPageCitationMirrorAudit = (
  audit: PersonPageCitationMirrorAudit,
): string => {
  const counts = new Map<string, number>();
  audit.mirrorGroups.forEach((group) => counts.set(group.host, (counts.get(group.host) || 0) + 1));
  const byHost =
    Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([host, count]) => `      ${host}: ${count}`)
      .join('\n') || '      (none)';

  return [
    `rows read:                         ${audit.rowsRead}`,
    `rows carrying any citation:        ${audit.rowsWithCitations}`,
    `rows citing one person page twice: ${audit.rowsWithMirroredCitations}`,
    `redundant citations to drop:       ${audit.redundantCitationCount}`,
    '',
    'mirror groups by citing host:',
    byHost,
  ].join('\n');
};
