import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gitCommitIsAncestor, readCodeSha } from '../scrapeRunCodeIdentity';

const git = (repo: string, ...args: string[]) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();

describe('the commit a scrape run records', () => {
  let repo: string;
  let first: string;
  let second: string;
  let sideBranch: string;

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-scrape-run-code-identity-'));
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 'fixture@example.org');
    git(repo, 'config', 'user.name', 'fixture');
    git(repo, 'config', 'commit.gpgsign', 'false');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'first');
    first = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'second');
    second = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'checkout', '-q', '-b', 'side', first);
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'side');
    sideBranch = git(repo, 'rev-parse', 'HEAD');
  });

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('reads the checkout HEAD when no deploy commit is declared', () => {
    expect(readCodeSha({}, repo)).toBe(sideBranch);
  });

  it('prefers a declared deploy commit over the checkout', () => {
    expect(readCodeSha({ SOURCE_COMMIT: second.toUpperCase() }, repo)).toBe(second);
  });

  it('records nothing rather than a value that is not a commit', () => {
    expect(readCodeSha({ SOURCE_COMMIT: 'main; rm -rf /' }, repo)).toBeUndefined();
    expect(readCodeSha({}, path.join(repo, 'missing'))).toBeUndefined();
  });

  it('answers ancestry from the repository', () => {
    expect(gitCommitIsAncestor(first, second, repo)).toBe(true);
    expect(gitCommitIsAncestor(second, second, repo)).toBe(true);
    expect(gitCommitIsAncestor(second, sideBranch, repo)).toBe(false);
  });

  it('answers unknown for a commit the repository does not hold or a value that is not a commit', () => {
    expect(gitCommitIsAncestor('0'.repeat(40), second, repo)).toBeUndefined();
    expect(gitCommitIsAncestor(first, '--all', repo)).toBeUndefined();
  });
});
