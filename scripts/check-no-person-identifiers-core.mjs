const PERSON_SLUG_PREFIXES = ['nih-pi-', 'nsf-pi-', 'ysm-faculty-', 'faculty-research-area-'];

const PERSON_SLUG_RE = new RegExp(
  `\\b(?:${PERSON_SLUG_PREFIXES.join('|')})[a-z0-9][a-z0-9+-]*`,
  'gi',
);

const PROFILE_PATH_RE =
  /\b[a-z0-9.-]*yale\.edu\/(?:profile|profiles|people|faculty)\/[A-Za-z0-9._%-]+/gi;

const YALE_EMAIL_RE = /\b([A-Za-z0-9._%+-]+)@((?:[A-Za-z0-9-]+\.)*yale\.edu)\b/gi;

const NETID_LABELLED_RE = /\bnet_?id\b\s*[:=]?\s*["'`]?([a-z]{2,4}\d{2,4})\b/gi;

const EXEMPTION_RE = /identifier-exempt:\s*\S+/i;

const PLACEHOLDER_LOCAL_PARTS = new Set([
  'firstname.lastname',
  'first.last',
  'given.family',
  'example',
  'someone',
  'test.user',
  'person.name',
  'a.b',
]);

const PLACEHOLDER_SLUG_SEGMENTS = new Set([
  'example',
  'placeholder',
  'someone',
  'person',
  'redacted',
  'test',
  'sample',
  'name',
  'surname',
]);

const isRoleAddress = (localPart) => !localPart.includes('.');

const isPlaceholderAddress = (localPart) =>
  PLACEHOLDER_LOCAL_PARTS.has(localPart.toLowerCase());

const slugSegment = (slug) => {
  for (const prefix of PERSON_SLUG_PREFIXES) {
    if (slug.toLowerCase().startsWith(prefix)) return slug.slice(prefix.length).toLowerCase();
  }
  return '';
};

const isPlaceholderSlug = (slug) => {
  const segment = slugSegment(slug);
  if (!segment) return true;
  return segment
    .split(/[+-]/)
    .filter(Boolean)
    .every((part) => PLACEHOLDER_SLUG_SEGMENTS.has(part));
};

const lineNumberForIndex = (content, index) => content.slice(0, index).split('\n').length;

const collect = (document, pattern, rule, accept) => {
  const findings = [];
  pattern.lastIndex = 0;
  for (const match of String(document.content || '').matchAll(pattern)) {
    const accepted = accept(match);
    if (!accepted) continue;
    findings.push({
      label: document.label,
      line: lineNumberForIndex(document.content, match.index || 0),
      rule,
      evidence: accepted,
    });
  }
  return findings;
};

export function isExempt(content) {
  return EXEMPTION_RE.test(String(content || ''));
}

export function findPersonIdentifierFindings(documents) {
  const findings = [];

  for (const document of documents) {
    if (isExempt(document.content)) continue;

    findings.push(
      ...collect(document, PERSON_SLUG_RE, 'person-bearing-entity-slug', (match) =>
        isPlaceholderSlug(match[0]) ? null : 'a person-bearing slug prefix',
      ),
      ...collect(
        document,
        PROFILE_PATH_RE,
        'personal-profile-url',
        () => 'a directory profile path naming a person',
      ),
      ...collect(document, YALE_EMAIL_RE, 'personal-yale-address', (match) => {
        const localPart = match[1] || '';
        if (isRoleAddress(localPart)) return null;
        if (isPlaceholderAddress(localPart)) return null;
        return 'a personal yale.edu address';
      }),
      ...collect(document, NETID_LABELLED_RE, 'yale-netid', () => 'a Yale netid'),
    );
  }

  return findings;
}

export function formatFindings(findings) {
  const byLabel = new Map();
  for (const finding of findings) {
    if (!byLabel.has(finding.label)) byLabel.set(finding.label, []);
    byLabel.get(finding.label).push(finding);
  }

  const lines = [];
  for (const [label, group] of byLabel) {
    lines.push(`${label}:`);
    const counts = new Map();
    for (const finding of group) {
      const key = `${finding.rule} (${finding.evidence})`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    for (const [key, count] of counts) lines.push(`  ${count}x ${key}`);
  }
  return lines.join('\n');
}

export function candidateIdentifierScanPaths(paths) {
  const skippedExtensions = ['.lock', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf'];
  return Array.from(
    new Set(
      paths
        .map((file) => String(file || '').trim())
        .filter(Boolean)
        .filter((file) => !skippedExtensions.some((extension) => file.endsWith(extension))),
    ),
  );
}

const DATA_FILE_RE = /\.(?:json|ndjson|csv|tsv)$/i;
const TEST_PATH_RE = /(?:^|\/)(?:__tests__|__fixtures__|fixtures|test|tests)(?:\/|$)/;

export const DIRECTORY_DUMP_THRESHOLD = 5;

export function isDirectoryDumpCandidate(path) {
  const file = String(path || '');
  return DATA_FILE_RE.test(file) && !TEST_PATH_RE.test(file);
}

export function findDirectoryDumpFindings(files, threshold = DIRECTORY_DUMP_THRESHOLD) {
  const findings = [];

  for (const file of files) {
    if (!isDirectoryDumpCandidate(file.path)) continue;
    if (isExempt(file.content)) continue;

    const addresses = new Set();
    YALE_EMAIL_RE.lastIndex = 0;
    for (const match of String(file.content || '').matchAll(YALE_EMAIL_RE)) {
      const localPart = match[1] || '';
      if (isRoleAddress(localPart) || isPlaceholderAddress(localPart)) continue;
      addresses.add(match[0].toLowerCase());
    }

    const profiles = new Set();
    PROFILE_PATH_RE.lastIndex = 0;
    for (const match of String(file.content || '').matchAll(PROFILE_PATH_RE)) {
      profiles.add(match[0].toLowerCase());
    }

    const worst = Math.max(addresses.size, profiles.size);
    if (worst < threshold) continue;

    findings.push({
      path: file.path,
      rule: 'committed-directory-dump',
      distinctAddresses: addresses.size,
      distinctProfileUrls: profiles.size,
      threshold,
    });
  }

  return findings;
}
