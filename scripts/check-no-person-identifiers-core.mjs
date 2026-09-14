const PERSON_SLUG_PREFIXES = ['nih-pi-', 'nsf-pi-', 'ysm-faculty-', 'faculty-research-area-'];

const PERSON_SLUG_RE = new RegExp(
  `\\b(?:${PERSON_SLUG_PREFIXES.join('|')})[a-z0-9][a-z0-9+-]*`,
  'gi',
);

/**
 * Registered scraper source names that collide with a person-slug prefix. A source
 * name identifies a scraper, so pairing it with a claim names no person, but the
 * prefixes cannot see the difference: `ysm-faculty-directory` reads as
 * `ysm-faculty-<surname>`.
 *
 * This is an exact-match allowance, not a token stoplist, so `ysm-faculty-directors`
 * or any longer slug that merely starts the same way is still flagged. The set is
 * pinned against `server/src/scrapers/seedSources.ts` by this script's test, so a
 * future source name that collides fails there rather than silently widening what
 * the gate ignores.
 *
 * Without this, every pull request or issue body discussing the YSM directory
 * scraper is blocked, and the only way past is an `identifier-exempt:` line - which
 * suppresses the ENTIRE document, including a real name elsewhere in it. A detector
 * that has to be switched off to discuss ordinary work trains people to switch it
 * off, so a false positive here costs more than the match it catches.
 */
const NON_PERSON_SOURCE_NAMES = new Set(['ysm-faculty-directory']);

export const isRegisteredSourceName = (value) =>
  NON_PERSON_SOURCE_NAMES.has(String(value || '').toLowerCase());

const PROFILE_PATH_RE =
  /\b[a-z0-9.-]*yale\.edu\/(?:profile|profiles|people|faculty)\/[A-Za-z0-9._%-]+/gi;

const YALE_EMAIL_RE = /\b([A-Za-z0-9._%+-]+)@((?:[A-Za-z0-9-]+\.)*yale\.edu)\b/gi;

const NETID_LABELLED_RE = /\bnet_?id\b\s*[:=]?\s*["'`]?([a-z]{2,4}\d{2,4})\b/gi;

const EXEMPTION_RE = /identifier-exempt:\s*\S+/i;

// Grounded in the stored vocabularies rather than invented, so the detector
// tracks the claims the product actually makes: `yaleStatusCache` and
// `yaleStatusReasonCache` in server/src/models/researchEntity.ts,
// `studentVisibilityTiers` in server/src/models/studentVisibility.ts, and the
// lifecycle literals. The prose forms carry the same meaning in a body.
const CLAIM_TERMS = [
  'departed',
  'departure',
  'departures',
  'deceased',
  'died',
  'on leave',
  'retired',
  'resigned',
  'left yale',
  'no longer at yale',
  'inactive',
  'inactive_at_yale',
  'delisted',
  'suppressed',
  'withheld',
  'operator_review',
  'permanently_closed',
  'permanently closed',
  'closed',
  'defunct',
  'dead',
  'stale',
  'wrong',
  'incorrect',
  'defect',
];

const CLAIM_RE = new RegExp(`\\b(?:${CLAIM_TERMS.join('|')})\\b`, 'i');

// A name-shaped run of capitalised tokens. Deliberately fuzzy, and therefore
// only ever reported by the advisory body arm: the blocking file arm calls
// findDirectoryDumpFindings, which does not use this.
const PROSE_NAME_RE = /\b[A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+){1,2}\b/g;

// A capitalised pair is a person candidate only when neither token is
// institutional. Department and school keys are not people, and redacting them
// destroys the artifact for zero privacy gain.
const NON_PERSON_TOKENS = new Set(
  [
    'yale',
    'university',
    'college',
    'school',
    'schools',
    'department',
    'departments',
    'division',
    'office',
    'program',
    'programs',
    'center',
    'centre',
    'institute',
    'faculty',
    'research',
    'lab',
    'labs',
    'laboratory',
    'group',
    'core',
    'council',
    'society',
    'studies',
    'science',
    'sciences',
    'medicine',
    'nursing',
    'health',
    'public',
    'environment',
    'divinity',
    'law',
    'management',
    'drama',
    'music',
    'art',
    'architecture',
    'engineering',
    'computer',
    'new',
    'haven',
    'united',
    'states',
    'development',
    'production',
    'beta',
    'prod',
    'dev',
    'atlas',
    'mongodb',
    'mongo',
    'meilisearch',
    'github',
    'node',
    'react',
    'vite',
    'closes',
    'fixes',
    'the',
    'this',
    'that',
    'these',
    'those',
    'every',
    'each',
    'both',
    'one',
    'two',
    'its',
    'their',
    'when',
    'while',
    'after',
    'before',
    'not',
    'no',
    'and',
    'but',
    'so',
    'a',
    'an',
  ].map((token) => token.toLowerCase()),
);

const isAcronymOrCode = (token) =>
  /\d/.test(token) || (token.length >= 2 && token === token.toUpperCase());

const isPersonShapedName = (candidate) =>
  candidate.split(/\s+/).every((token) => {
    if (isAcronymOrCode(token)) return false;
    return !NON_PERSON_TOKENS.has(token.replace(/[^A-Za-z'’-]/g, '').toLowerCase());
  });

// A heading or a Title Case phrase capitalises every word, so a capitalised
// pair inside one carries no signal. Prose does not, which is what a sentence
// naming somebody looks like. Two lower-case words is the cheapest test that
// separates them without an endless stoplist of technical phrases.
const PROSE_WORD_RE = /(?:^|\s)[a-z][a-z'’-]{2,}\b/g;

const readsAsProse = (segment) => [...segment.matchAll(PROSE_WORD_RE)].length >= 2;

// A quoted Title Case phrase is a title, most often a decision-log entry this
// repository cites by name. A body naming a person does not put quotes round
// them.
const QUOTE_CHARS = new Set(['"', "'", '“', '”', '‘', '’']);

const isQuotedTitle = (segment, start, end) =>
  QUOTE_CHARS.has(segment[start - 1] || '') && QUOTE_CHARS.has(segment[end] || '');

// Blanked rather than removed so every remaining index still lines up with the
// original content, which is what the reported line number is derived from.
const blankNonProse = (content) => {
  const blank = (match) => ' '.repeat(match.length);
  return String(content)
    .replace(/```[\s\S]*?```/g, blank)
    .replace(/^[ \t]*#{1,6}[^\n]*/gm, blank)
    .replace(/^[ \t]*\|[^\n]*/gm, blank)
    .replace(/^[ \t]{4,}[^\n]*/gm, blank);
};

// Sentence rather than a character window, because the repository writes one
// sentence per physical line, which makes a finding explainable as "this
// sentence names a person and makes a claim about them".
const sentenceSpans = (content) => {
  const spans = [];
  const boundary = /(?<=[.!?])\s+|\n/g;
  let start = 0;
  for (const match of String(content).matchAll(boundary)) {
    spans.push({ start, text: content.slice(start, match.index) });
    start = (match.index || 0) + match[0].length;
  }
  spans.push({ start, text: content.slice(start) });
  return spans.filter((span) => span.text.trim().length > 0);
};

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

const isPlaceholderAddress = (localPart) => PLACEHOLDER_LOCAL_PARTS.has(localPart.toLowerCase());

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
      severity: 'finding',
      evidence: accepted,
    });
  }
  return findings;
};

const sentenceAt = (spans, index) => {
  let containing = spans[0];
  for (const span of spans) {
    if (span.start > index) break;
    containing = span;
  }
  return containing ? containing.text : '';
};

// A public directory URL cited as evidence that a link resolves is not the
// harm the convention is about: the name and department are already published
// in Yale's own directories. The harm is the claim attached to it. So a bare
// citation is a note, a citation inside a claim is a finding, and a run of them
// is a finding whatever the prose says, because a list is itself a dump.
const profileUrlFindings = (document) => {
  const content = String(document.content || '');
  const spans = sentenceSpans(content);
  PROFILE_PATH_RE.lastIndex = 0;
  const matches = [...content.matchAll(PROFILE_PATH_RE)];
  const distinct = new Set(matches.map((match) => match[0].toLowerCase()));
  const isList = distinct.size >= DIRECTORY_DUMP_THRESHOLD;

  return matches.map((match) => {
    const index = match.index || 0;
    const claimed = CLAIM_RE.test(sentenceAt(spans, index));
    return {
      label: document.label,
      line: lineNumberForIndex(content, index),
      rule: 'personal-profile-url',
      severity: isList || claimed ? 'finding' : 'note',
      evidence: isList
        ? 'a run of directory profile paths, which is dump shape'
        : claimed
          ? 'a directory profile path in a sentence that claims something about that person'
          : 'a directory profile path cited without a claim',
    };
  });
};

// The rule the identifier shapes could never reach. A prose name is what a
// body actually uses when it calls somebody departed, and no slug, address or
// netid appears in that sentence at all.
const personClaimFindings = (document) => {
  const content = String(document.content || '');
  const findings = [];

  for (const span of sentenceSpans(blankNonProse(content))) {
    if (!CLAIM_RE.test(span.text)) continue;
    if (!readsAsProse(span.text)) continue;
    PROSE_NAME_RE.lastIndex = 0;
    for (const match of span.text.matchAll(PROSE_NAME_RE)) {
      if (!isPersonShapedName(match[0])) continue;
      const start = match.index || 0;
      if (isQuotedTitle(span.text, start, start + match[0].length)) continue;
      findings.push({
        label: document.label,
        line: lineNumberForIndex(content, span.start + (match.index || 0)),
        rule: 'person-claim-pairing',
        severity: 'finding',
        evidence: 'a person named in a sentence that makes a status claim about them',
      });
    }
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
        isPlaceholderSlug(match[0]) || isRegisteredSourceName(match[0])
          ? null
          : 'a person-bearing slug prefix',
      ),
      ...profileUrlFindings(document),
      ...collect(document, YALE_EMAIL_RE, 'personal-yale-address', (match) => {
        const localPart = match[1] || '';
        if (isRoleAddress(localPart)) return null;
        if (isPlaceholderAddress(localPart)) return null;
        return 'a personal yale.edu address';
      }),
      ...collect(document, NETID_LABELLED_RE, 'yale-netid', () => 'a Yale netid'),
      ...personClaimFindings(document),
    );
  }

  return findings;
}

export function isFinding(entry) {
  return (entry?.severity ?? 'finding') === 'finding';
}

export function hasBlockingFindings(findings) {
  return findings.some(isFinding);
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
      const prefix = isFinding(finding) ? '' : 'note, not a finding: ';
      const key = `${prefix}${finding.rule} (${finding.evidence})`;
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
