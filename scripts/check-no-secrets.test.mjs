import assert from 'node:assert/strict';
import test from 'node:test';

import { candidateSecretScanPaths, findSecretFindings } from './check-no-secrets-core.mjs';

test('flags high-confidence committed secret patterns without echoing values', () => {
  const files = [
    {
      path: 'server/src/example.ts',
      content: [
        'const token = "' +
          'sk-proj-' +
          'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef";',
        'const mongo = "' +
          'mongodb+srv://' +
          'real-user:real-password@cluster.example.mongodb.net/Production";',
        'const aws = "' + 'AKIA' + 'ABCDEFGHIJKLMNOP";',
        'const google = "' + 'AIza' + 'SyA23456789012345678901234567890123";',
      ].join('\n'),
    },
  ];

  const findings = findSecretFindings(files);

  assert.equal(findings.length, 4);
  assert.deepEqual(
    findings.map((finding) => finding.rule).sort(),
    ['aws-access-key-id', 'google-api-key', 'mongodb-credentialed-uri', 'openai-api-key'].sort(),
  );
  assert.deepEqual(
    findings.map((finding) => finding.path),
    [
      'server/src/example.ts',
      'server/src/example.ts',
      'server/src/example.ts',
      'server/src/example.ts',
    ],
  );
  assert.ok(findings.every((finding) => !('secret' in finding)));
  assert.ok(findings.every((finding) => !JSON.stringify(finding).includes('real-password')));
});

test('allows documented placeholder credentials and env variable references', () => {
  const files = [
    {
      path: 'docs/example.md',
      content:
        'Run with MONGODBURL=mongodb://example.invalid/Beta and OPENAI_API_KEY=<redacted>.',
    },
    {
      path: 'server/src/example.ts',
      content: [
        'const apiKey = process.env.OPENAI_API_KEY;',
        'const fixture = "mongodb+srv://user:pass@prod.example.test/Production";',
      ].join('\n'),
    },
  ];

  assert.deepEqual(findSecretFindings(files), []);
});

test('flags private key blocks', () => {
  const findings = findSecretFindings([
    {
      path: 'certs/key.pem',
      content: [
        '-----BEGIN ' + 'PRIVATE KEY-----',
        'abc123',
        '-----END ' + 'PRIVATE KEY-----',
      ].join('\n'),
    },
  ]);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'private-key-block');
});

test('selects tracked and untracked non-ignored files for scanning', () => {
  const paths = candidateSecretScanPaths([
    'server/src/app.ts',
    'server/src/app.ts',
    'new-admin-note.md',
    'yarn.lock',
    'graphify-out/graph.json',
    '',
  ]);

  assert.deepEqual(paths, [
    'server/src/app.ts',
    'new-admin-note.md',
    'graphify-out/graph.json',
  ]);
});

test('flags synthetic Yalies credentials without returning their values', () => {
  const assignedCredential = ['synthetic', 'Yalies', 'Credential', '1234567890'].join('');
  const bearerCredential = ['another', 'Synthetic', 'Bearer', '0987654321'].join('');
  const findings = findSecretFindings([
    {
      path: 'operator.env',
      content: `YALIES_API_KEY=${assignedCredential}`,
    },
    {
      path: 'scratch/request.ts',
      content: [
        "const endpoint = 'https://api.yalies.io/v2/people';",
        `const header = 'Bearer ${bearerCredential}';`,
      ].join('\n'),
    },
  ]);

  assert.deepEqual(
    findings.map(({ path, line, rule }) => ({ path, line, rule })),
    [
      { path: 'operator.env', line: 1, rule: 'yalies-api-key-assignment' },
      { path: 'scratch/request.ts', line: 2, rule: 'yalies-bearer-token' },
    ],
  );
  assert.ok(!JSON.stringify(findings).includes(assignedCredential));
  assert.ok(!JSON.stringify(findings).includes(bearerCredential));
});

test('allows Yalies environment references and bearer examples outside Yalies context', () => {
  const genericBearer = ['generic', 'Bearer', 'Fixture', '1234567890'].join('');
  const files = [
    {
      path: 'server/src/service.ts',
      content: "const key = process.env.YALIES_API_KEY;\nAuthorization: `Bearer ${key}`;",
    },
    {
      path: 'docs/oauth.md',
      content: `Authorization: Bearer ${genericBearer}`,
    },
  ];

  assert.deepEqual(findSecretFindings(files), []);
});
