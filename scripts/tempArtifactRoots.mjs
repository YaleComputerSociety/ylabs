import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SHARED_TEMP_ROOT = '/tmp';

export const hasPathPrefix = (target, root) =>
  target === root || target.startsWith(`${root}${path.sep}`);

export function resolveRealPath(target) {
  const absolute = path.resolve(target);
  const missingSegments = [];
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

export function realDirectoryPath(target) {
  try {
    const real = fs.realpathSync.native(path.resolve(target));
    return fs.statSync(real).isDirectory() ? real : undefined;
  } catch {
    return undefined;
  }
}

export function approvedTempRoots() {
  return [os.tmpdir(), SHARED_TEMP_ROOT];
}

export function approvedTempRootFor(target, candidateRoots = approvedTempRoots()) {
  const realTarget = resolveRealPath(target);
  for (const candidate of candidateRoots) {
    const root = path.resolve(candidate);
    const realRoot = resolveRealPath(root);
    if (hasPathPrefix(realTarget, realRoot)) return { root, realRoot };
  }
  return undefined;
}

export function approvedTempRootLabel() {
  return [...new Set(approvedTempRoots().map((root) => path.resolve(root)))].join(' or ');
}

// The descent walks the spelling the caller supplied rather than its resolved form: resolving it
// first would follow a planted symlink component and hide the escape this guard exists to refuse.
export function assertTempArtifactParent(parent, label) {
  const approved = approvedTempRootFor(parent);
  if (!approved) {
    throw new Error(`${label} must be under the system temp directory ${approvedTempRootLabel()}.`);
  }
  const realRoot = realDirectoryPath(approved.root);
  if (!realRoot) {
    throw new Error(`${label} must be under a real temporary directory.`);
  }
  const target = path.resolve(parent);
  const descentRoot = hasPathPrefix(target, approved.root)
    ? approved.root
    : hasPathPrefix(target, realRoot)
      ? realRoot
      : undefined;
  if (!descentRoot) {
    throw new Error(`${label} must be under the system temp directory ${approvedTempRootLabel()}.`);
  }

  let current = descentRoot;
  for (const segment of path.relative(descentRoot, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch {
      throw new Error(`${label} does not exist.`);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`${label} must not contain symlink path components.`);
    }
    if (!hasPathPrefix(resolveRealPath(current), realRoot)) {
      throw new Error(
        `${label} must be under the system temp directory ${approvedTempRootLabel()}.`,
      );
    }
  }
  return resolveRealPath(target);
}
