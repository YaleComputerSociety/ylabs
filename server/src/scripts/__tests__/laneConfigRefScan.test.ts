import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  codeShasReachableFromRefs,
  readRefTips,
  scanRefTipsForLaneConfigs,
  type GitRunner,
} from '../laneConfigRefScan';
import { scanLaneConfigRefs } from '../retireOrphanedLaneConfigs';

const ROSTER = 'dept-faculty-roster';
const CONFIG_FILE = 'server/src/scrapers/sources/rosterConfigs.ts';

describe('lane config ref scan (#5807)', () => {
  let workTree: string;
  let gitDir: string;
  let droppedLaneCommit: string;
  let deletedBranchCommit: string;

  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: workTree,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    });
  const commitFile = (file: string, content: string, message: string) => {
    fs.mkdirSync(path.dirname(path.join(workTree, file)), { recursive: true });
    fs.writeFileSync(path.join(workTree, file), content);
    git('add', '.');
    git('commit', '-q', '-m', message);
  };

  beforeAll(() => {
    workTree = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-config-ref-scan-'));
    git('init', '-q', '-b', 'beta');
    commitFile(CONFIG_FILE, "export const CONFIGS = [{ deptKey: 'chem' }];\n", 'base');
    git('switch', '-q', '-c', 'feat/pending-lane');
    commitFile(
      CONFIG_FILE,
      "export const CONFIGS = [{ deptKey: 'chem' }, { deptKey: 'pending-lane' }];\n",
      'pending lane',
    );
    git('switch', '-q', 'beta');
    git('switch', '-q', '-c', 'feat/added-then-dropped');
    commitFile(
      CONFIG_FILE,
      "export const CONFIGS = [{ deptKey: 'chem' }, { deptKey: 'dropped-lane' }];\n",
      'add dropped lane',
    );
    droppedLaneCommit = git('rev-parse', 'HEAD').trim();
    commitFile(CONFIG_FILE, "export const CONFIGS = [{ deptKey: 'chem' }];\n", 'drop it');
    git('switch', '-q', 'beta');
    git('switch', '-q', '-c', 'feat/root-lane');
    commitFile(
      'server/src/scrapers/rootConfigs.ts',
      "export const ROOT = [{ deptKey: 'root-lane' }];\n",
      'root lane',
    );
    git('switch', '-q', 'beta');
    git('switch', '-q', '-c', 'feat/deleted');
    commitFile(CONFIG_FILE, "export const CONFIGS = [{ deptKey: 'deleted-lane' }];\n", 'deleted');
    deletedBranchCommit = git('rev-parse', 'HEAD').trim();
    git('switch', '-q', 'beta');
    git('branch', '-q', '-D', 'feat/deleted');
    git('tag', '-a', 'v-tagged', '-m', 'tagged');
    commitFile(
      'server/src/scrapers/__tests__/fixture.test.ts',
      "const fixture = { deptKey: 'test-only-lane' };\n",
      'test fixture',
    );
    gitDir = path.join(workTree, '.git');
  });

  afterAll(() => {
    fs.rmSync(workTree, { recursive: true, force: true });
  });

  const scan = (configId: string) =>
    scanRefTipsForLaneConfigs(readRefTips(gitDir), [{ sourceName: ROSTER, configId }])[0];

  it('finds a config that only an unmerged branch defines', () => {
    const presence = scan('pending-lane');
    expect(presence.refs).toEqual([`${gitDir}#refs/heads/feat/pending-lane`]);
  });

  it('finds a config defined directly in the lane config root', () => {
    expect(scan('root-lane').refs).toEqual([`${gitDir}#refs/heads/feat/root-lane`]);
  });

  it('finds a config the checked-out branch and its tag define', () => {
    expect(scan('chem').refs.length).toBeGreaterThanOrEqual(4);
  });

  it('finds nothing for a config no ref tip defines, a test fixture included', () => {
    expect(scan('dropped-lane').refs).toEqual([]);
    expect(scan('test-only-lane').refs).toEqual([]);
    expect(scan('never-existed').refs).toEqual([]);
    expect(scan('deleted-lane').refs).toEqual([]);
  });

  it('reaches a recorded run commit only through a ref that still holds it', () => {
    const unknown = 'f'.repeat(40);
    expect(
      codeShasReachableFromRefs(
        [droppedLaneCommit, deletedBranchCommit, unknown, '--all'],
        [gitDir],
      ),
    ).toEqual(new Set([droppedLaneCommit]));
  });

  it('counts every ref, peeling an annotated tag to its commit', () => {
    const tips = readRefTips(gitDir);
    const commitRefs = [...tips.refsByCommit.values()].flat().sort();
    expect(commitRefs).toEqual([
      'HEAD',
      'refs/heads/beta',
      'refs/heads/feat/added-then-dropped',
      'refs/heads/feat/pending-lane',
      'refs/heads/feat/root-lane',
      'refs/tags/v-tagged',
    ]);
    expect(tips.refCount).toBeGreaterThanOrEqual(4);
  });

  it('fails closed when git cannot read the refs or grep a tree', () => {
    const broken: GitRunner = () => ({ status: 128, stdout: '' });
    expect(() => readRefTips(gitDir, broken)).toThrow(/for-each-ref failed/);
    const tips = readRefTips(gitDir);
    expect(() =>
      scanRefTipsForLaneConfigs(tips, [{ sourceName: ROSTER, configId: 'chem' }], broken),
    ).toThrow(/git grep failed/);
    expect(() => scanLaneConfigRefs({ configs: [], gitDirs: [] })).toThrow(/no git repository/);
  });
});
