import fs from 'fs';
import os from 'os';
import path from 'path';

export const SHARED_TEMP_ROOT = '/tmp';

export const hasPathPrefix = (target: string, root: string): boolean =>
  target === root || target.startsWith(`${root}${path.sep}`);

export function resolveRealPath(target: string): string {
  const absolute = path.resolve(target);
  const missingSegments: string[] = [];
  let existing = absolute;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return absolute;
    missingSegments.unshift(path.basename(existing));
    existing = parent;
  }
  try {
    return path.join(fs.realpathSync.native(existing), ...missingSegments);
  } catch {
    return absolute;
  }
}

export function realDirectoryPath(target: string): string | undefined {
  try {
    const real = fs.realpathSync.native(path.resolve(target));
    return fs.statSync(real).isDirectory() ? real : undefined;
  } catch {
    return undefined;
  }
}

export function sharedTempRoot(): string {
  return realDirectoryPath(SHARED_TEMP_ROOT) ? SHARED_TEMP_ROOT : os.tmpdir();
}

export function defaultApprovedTempRoots(cwd: string = process.cwd()): string[] {
  return [os.tmpdir(), SHARED_TEMP_ROOT, path.join(cwd, 'tmp')];
}

export interface ApprovedTempRoot {
  root: string;
  realRoot: string;
}

export function approvedTempRootFor(
  target: string,
  candidateRoots: string[] = defaultApprovedTempRoots(),
): ApprovedTempRoot | undefined {
  const realTarget = resolveRealPath(target);
  for (const candidate of candidateRoots) {
    const root = path.resolve(candidate);
    const realRoot = resolveRealPath(root);
    if (hasPathPrefix(realTarget, realRoot)) return { root, realRoot };
  }
  return undefined;
}

export type TempArtifactParentRefusal =
  | 'outside-approved-root'
  | 'approved-root-not-a-real-directory'
  | 'component-missing'
  | 'component-not-a-real-directory'
  | 'resolves-outside-approved-root';

export interface TempArtifactParentOptions {
  createMissingDirectories?: boolean;
  candidateRoots?: string[];
}

export type TempArtifactParentVerdict =
  | { realParent: string }
  | { refusal: TempArtifactParentRefusal };

export function inspectTempArtifactParent(
  parent: string,
  options: TempArtifactParentOptions = {},
): TempArtifactParentVerdict {
  const approved = approvedTempRootFor(parent, options.candidateRoots);
  if (!approved) return { refusal: 'outside-approved-root' };
  if (options.createMissingDirectories && !fs.existsSync(approved.root)) {
    fs.mkdirSync(approved.root, { mode: 0o700 });
  }
  const realRoot = realDirectoryPath(approved.root);
  if (!realRoot) return { refusal: 'approved-root-not-a-real-directory' };

  const target = path.resolve(parent);
  const descentRoot = descentRootFor(target, approved.root, realRoot);
  if (!descentRoot) return { refusal: 'outside-approved-root' };

  let current = descentRoot;
  for (const segment of path.relative(descentRoot, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (options.createMissingDirectories && !fs.existsSync(current)) {
      fs.mkdirSync(current, { mode: 0o700 });
    }
    const componentStat = lstat(current);
    if (!componentStat) return { refusal: 'component-missing' };
    if (componentStat.isSymbolicLink() || !componentStat.isDirectory()) {
      return { refusal: 'component-not-a-real-directory' };
    }
    if (!hasPathPrefix(resolveRealPath(current), realRoot)) {
      return { refusal: 'resolves-outside-approved-root' };
    }
  }
  return { realParent: resolveRealPath(target) };
}

// The descent walks the spelling the caller supplied rather than its resolved form: resolving it
// first would follow a planted symlink component and hide the escape this guard exists to refuse.
function descentRootFor(target: string, root: string, realRoot: string): string | undefined {
  if (hasPathPrefix(target, root)) return root;
  if (hasPathPrefix(target, realRoot)) return realRoot;
  return undefined;
}

function lstat(target: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(target);
  } catch {
    return undefined;
  }
}
