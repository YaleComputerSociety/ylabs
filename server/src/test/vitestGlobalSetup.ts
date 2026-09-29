import fs from 'node:fs';
import os from 'node:os';

import { SHARED_TEMP_ROOT } from '../utils/tempArtifactRoots';
import { createRunTempRoot, reapStaleTempResidue, removeTempDirectory } from './runTempRoot';

const systemTempDirectories = (): string[] => {
  const candidates = [os.tmpdir(), SHARED_TEMP_ROOT].filter((candidate) =>
    fs.existsSync(candidate),
  );
  const byRealPath = new Map(
    candidates.map((candidate) => [fs.realpathSync(candidate), candidate]),
  );
  return [...byRealPath.values()];
};

export default function setup(): () => void {
  const reaped = systemTempDirectories().flatMap((directory) => reapStaleTempResidue(directory));
  if (reaped.length > 0) {
    console.log(
      `[vitest temp root] removed ${reaped.length} stale temp directories from earlier runs`,
    );
  }

  const previousTmpDir = process.env.TMPDIR;
  const runTempRoot = createRunTempRoot(os.tmpdir());
  process.env.TMPDIR = runTempRoot;

  return () => {
    if (previousTmpDir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpDir;
    removeTempDirectory(runTempRoot);
  };
}
