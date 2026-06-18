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

  assert.deepEqual(paths, ['server/src/app.ts', 'new-admin-note.md']);
});
