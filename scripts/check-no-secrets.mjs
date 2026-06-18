#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { candidateSecretScanPaths, findSecretFindings } from './check-no-secrets-core.mjs';

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
  shell: false,
}).trim();

const listFiles = () => {
  const candidates = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  })
    .split('\n')
    .filter(Boolean);

  return candidateSecretScanPaths(candidates);
};

const readFiles = (files) =>
  files.flatMap((file) => {
    const absolutePath = path.join(repoRoot, file);
    let content;
    try {
      content = fs.readFileSync(absolutePath, 'utf8');
    } catch {
      return [];
    }
    if (content.includes('\0')) return [];
    return [{ path: file, content }];
  });

const findings = findSecretFindings(readFiles(listFiles()));

if (findings.length > 0) {
  console.error('Potential committed secrets found:');
  for (const finding of findings) {
    console.error(`- ${finding.path}:${finding.line} ${finding.rule}`);
  }
  process.exit(1);
}

console.log('No high-confidence committed secrets found.');
