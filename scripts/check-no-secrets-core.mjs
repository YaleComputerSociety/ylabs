const SECRET_RULES = [
  {
    rule: 'private-key-block',
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g,
  },
  {
    rule: 'openai-api-key',
    pattern: /\bsk-(?:[a-z]+-)?(?=[A-Za-z0-9_-]*[0-9])(?=[A-Za-z0-9_-]*[A-Z])[A-Za-z0-9_-]{32,}/g,
  },
  {
    rule: 'github-token',
    pattern: /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/g,
  },
  {
    rule: 'aws-access-key-id',
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  },
  {
    rule: 'google-api-key',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    rule: 'mongodb-credentialed-uri',
    pattern: /\bmongodb(?:\+srv)?:\/\/[^/\s:@'"]+:[^@\s/'"]+@[^/\s'"]+/g,
  },
];

const YALIES_API_HOST_RE = /\bapi\.yalies\.io\b/i;
const SECRET_ENV_NAMES = [
  'OPENAI_API_KEY',
  'SESSION_SECRET',
  'MEILISEARCH_API_KEY',
  'YALIES_API_KEY',
  'YALIES_NEW_API_KEY',
  'YALIES_OLD_API_KEY',
  'BRAVE_SEARCH_API_KEY',
  'EXA_API_KEY',
  'PARALLEL_API_KEY',
  'TAVILY_API_KEY',
];
const SECRET_ENV_ASSIGNMENT_RE = new RegExp(
  `\\b(${SECRET_ENV_NAMES.join('|')})\\b["']?\\s*[=:]\\s*["']?([A-Za-z0-9._~+/=-]{20,})`,
  'gi',
);
const assignmentRuleFor = (name) => `${name.toLowerCase().replaceAll('_', '-')}-assignment`;
const BEARER_TOKEN_RE = /\bBearer\s+([A-Za-z0-9._~+/=-]{20,})\b/gi;

const PLACEHOLDER_PATTERNS = [
  /<redacted>/i,
  /<user>:<password>@<cluster>/i,
  /example\.invalid/i,
  /example\.test/i,
  /mongodb(?:\+srv)?:\/\/user:pass@/i,
  /mongodb:\/\/example\.invalid\//i,
  /process\.env\.[A-Z0-9_]+/,
  /\b(?:AKIA|ASIA)I{16}\b/,
  /\bAIzaI{35}\b/,
];

const lineNumberForIndex = (content, index) => content.slice(0, index).split('\n').length;

const isAllowedPlaceholder = (matchText) =>
  PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(matchText));

const looksLikeGeneratedCredential = (value) => /[0-9]/.test(value) && /[A-Za-z]/.test(value);

const secretEnvAssignmentFindings = (file) =>
  Array.from(file.content.matchAll(SECRET_ENV_ASSIGNMENT_RE))
    .filter((match) => looksLikeGeneratedCredential(match[2] || ''))
    .filter((match) => !isAllowedPlaceholder(match[2] || ''))
    .map((match) => ({
      path: file.path,
      line: lineNumberForIndex(file.content, match.index || 0),
      rule: assignmentRuleFor(match[1]),
    }));

const yaliesBearerFindings = (file) => {
  if (!YALIES_API_HOST_RE.test(file.content)) return [];
  return Array.from(file.content.matchAll(BEARER_TOKEN_RE))
    .filter((match) => !isAllowedPlaceholder(match[1] || ''))
    .map((match) => ({
      path: file.path,
      line: lineNumberForIndex(file.content, match.index || 0),
      rule: 'yalies-bearer-token',
    }));
};

export function candidateSecretScanPaths(paths) {
  return Array.from(
    new Set(
      paths
        .map((file) => String(file || '').trim())
        .filter(Boolean)
        .filter((file) => !file.endsWith('.lock')),
    ),
  );
}

export function findSecretFindings(files) {
  const findings = [];

  for (const file of files) {
    findings.push(...secretEnvAssignmentFindings(file), ...yaliesBearerFindings(file));
    for (const rule of SECRET_RULES) {
      rule.pattern.lastIndex = 0;
      for (const match of file.content.matchAll(rule.pattern)) {
        const matchText = match[0] || '';
        if (isAllowedPlaceholder(matchText)) continue;
        findings.push({
          path: file.path,
          line: lineNumberForIndex(file.content, match.index || 0),
          rule: rule.rule,
        });
      }
    }
  }

  return findings;
}
