const SECRET_RULES = [
  {
    rule: 'private-key-block',
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g,
  },
  {
    rule: 'openai-api-key',
    pattern: /\bsk-(?:proj|live|test)?-[A-Za-z0-9_-]{48,}\b/g,
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
const YALIES_API_KEY_ASSIGNMENT_RE =
  /\bYALIES_API_KEY\b\s*[=:]\s*["']?([A-Za-z0-9._~+/=-]{20,})/gi;
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

const yaliesCredentialFindings = (file) => {
  const findings = [];
  const patterns = [
    { rule: 'yalies-api-key-assignment', pattern: YALIES_API_KEY_ASSIGNMENT_RE },
    ...(YALIES_API_HOST_RE.test(file.content)
      ? [{ rule: 'yalies-bearer-token', pattern: BEARER_TOKEN_RE }]
      : []),
  ];

  for (const { rule, pattern } of patterns) {
    pattern.lastIndex = 0;
    for (const match of file.content.matchAll(pattern)) {
      const credential = match[1] || '';
      if (isAllowedPlaceholder(credential)) continue;
      findings.push({
        path: file.path,
        line: lineNumberForIndex(file.content, match.index || 0),
        rule,
      });
    }
  }

  return findings;
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
    findings.push(...yaliesCredentialFindings(file));
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
