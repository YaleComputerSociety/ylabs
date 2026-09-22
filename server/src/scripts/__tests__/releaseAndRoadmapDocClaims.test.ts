import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../../..');

const readDoc = (relativePath: string): string =>
  fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

describe('release-process and priority-roadmap doc claims', () => {
  /**
   * `git merge-base --is-ancestor origin/main origin/beta` fails permanently, because the
   * `-s ours` reconciliation records `main` as a second parent of a commit that lives only
   * on `main`. A runbook that treats that failure as "still severed" sends an operator back
   * through a recipe the same document warns silently discards `main`-only work (#2387).
   */
  it('does not claim main becomes an ancestor of beta', () => {
    const releaseProcess = readDoc('docs/release-process.md');

    expect(releaseProcess).not.toMatch(/`main` is an ancestor of `beta`/);
    expect(releaseProcess).not.toMatch(/is-ancestor origin\/main origin\/beta`?: while that fails/);
    expect(releaseProcess).toMatch(/git merge-tree --write-tree origin\/main origin\/beta/);
  });

  /**
   * A hand-maintained date header goes stale silently and then asserts a freshness the
   * content does not have. The roadmap's header read `2026-08-02` while the file's own last
   * commit was `2026-08-26`, so the header was false by the repository's own history (#2387).
   */
  it('keeps no hand-maintained freshness header on the roadmap', () => {
    expect(readDoc('docs/tasks/priority-roadmap.md')).not.toMatch(/^\s*Last updated:/im);
  });

  /**
   * `AGENTS.md` makes GitHub issues the tracker, so a second document claiming to be the
   * task source of truth competes with it and loses, while still being read as authoritative
   * (#2387).
   */
  it('lets nothing claim the roadmap is a task source of truth', () => {
    const claimants = [
      'docs/decisions.md',
      'docs/agent-workflow.md',
      'skills/finishing-work/SKILL.md',
    ]
      .map((relativePath) => ({ relativePath, text: readDoc(relativePath) }))
      .filter(({ text }) => /priority-roadmap\.md[^\n]*source of truth/.test(text))
      .map(({ relativePath }) => relativePath);

    expect(claimants).toEqual([]);
  });
});
