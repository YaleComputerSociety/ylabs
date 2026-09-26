#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  candidateIdentifierScanPaths,
  findDirectoryDumpFindings,
  findPersonIdentifierFindings,
  formatFindings,
  hasBlockingFindings,
} from './check-no-person-identifiers-core.mjs';

const args = process.argv.slice(2);
const bodyFlagIndex = args.indexOf('--body-file');
const bodyFile = bodyFlagIndex === -1 ? null : args[bodyFlagIndex + 1];
const label = args.includes('--label') ? args[args.indexOf('--label') + 1] : 'body';

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
  shell: false,
}).trim();

const readTrackedFiles = () => {
  const candidates = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: repoRoot, encoding: 'utf8', shell: false },
  )
    .split('\n')
    .filter(Boolean);

  return candidateIdentifierScanPaths(candidates).flatMap((file) => {
    let content;
    try {
      content = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    } catch {
      return [];
    }
    if (content.includes('\0')) return [];
    return [{ path: file, content }];
  });
};

if (bodyFile) {
  const content = fs.readFileSync(bodyFile, 'utf8');
  const findings = findPersonIdentifierFindings([{ label, content }]);

  if (hasBlockingFindings(findings)) {
    console.error(`This ${label} names a person and makes a claim about them:`);
    console.error(formatFindings(findings));
    console.error(
      '\nIdentify rows by predicate, not by identifier, and state a claim about a predicate' +
        ' rather than about a person. See docs/person-identifier-convention.md.',
    );
    console.error(
      'If a literal identifier is genuinely required, add a line reading "identifier-exempt: <reason>".',
    );
    process.exit(1);
  }

  if (findings.length > 0) {
    console.log(`No claims about an identifiable person in ${label}. Notes only:`);
    console.log(formatFindings(findings));
    process.exit(0);
  }

  console.log(`No claims about an identifiable person in ${label}.`);
  process.exit(0);
}

const dumpFindings = findDirectoryDumpFindings(readTrackedFiles());

if (dumpFindings.length > 0) {
  console.error('Committed directory dumps of personal contact data found:');
  for (const finding of dumpFindings) {
    console.error(
      `- ${finding.path}: ${finding.distinctAddresses} distinct personal yale.edu addresses, ` +
        `${finding.distinctProfileUrls} distinct profile URLs (threshold ${finding.threshold})`,
    );
  }
  console.error('\nAGENTS.md forbids personal data in committed artifacts.');
  process.exit(1);
}

console.log('No committed directory dumps of personal contact data found.');
