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

export function candidateSecretScanPaths(paths) {
  return Array.from(
    new Set(
      paths
        .map((file) => String(file || '').trim())
        .filter(Boolean)
        .filter((file) => !file.endsWith('.lock'))
        .filter((file) => file !== 'graphify-out/graph.json'),
    ),
  );
}

export function findSecretFindings(files) {
  const findings = [];

  for (const file of files) {
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
