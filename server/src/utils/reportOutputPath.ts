/**
 * The one resolver for a script's `--output` report path (#6366).
 *
 * A report path is checked when the arguments are parsed, before the script connects or writes:
 * an apply that writes Development and only then finds its report path unusable loses the
 * per-row report while the writes land, and its non-zero exit invites re-running an apply that
 * already succeeded.
 */
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { containsAsciiControl } from './asciiControl';
import { resolveServerPackageRoot } from './serverPackageRoot';
import {
  SHARED_TEMP_ROOT,
  approvedTempRootFor,
  hasPathPrefix,
  realDirectoryPath,
  resolveRealPath,
} from './tempArtifactRoots';

export const REPORT_ROOT_ENV = 'YLABS_REPORT_ROOT';

export const REPOSITORY_ROOT = path.dirname(resolveServerPackageRoot(import.meta.url));

export interface ReportOutputPathOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  repositoryRoot?: string;
  /** The temp roots a system sweep may wipe; defaults to `os.tmpdir()` and `/tmp`. */
  tempRoots?: readonly string[];
  warn?: (message: string) => void;
}

/**
 * `YLABS_REPORT_ROOT`, when set, is one more approved root, for reports that must outlive a temp
 * sweep. It is refused unless it is an absolute path to an existing directory outside the
 * repository checkout, symlinks resolved, because a report names people and must never land in a
 * tree that can be committed.
 */
export function resolveReportRoot(
  env: NodeJS.ProcessEnv = process.env,
  repositoryRoot: string = REPOSITORY_ROOT,
): string | undefined {
  const raw = env[REPORT_ROOT_ENV]?.trim();
  if (!raw) return undefined;
  if (containsAsciiControl(raw)) throw new Error(`${REPORT_ROOT_ENV} contains invalid characters`);
  if (!path.isAbsolute(raw)) throw new Error(`${REPORT_ROOT_ENV} must be an absolute path`);
  const realRoot = realDirectoryPath(raw);
  if (!realRoot) throw new Error(`${REPORT_ROOT_ENV} must name an existing directory`);
  if (hasPathPrefix(realRoot, resolveRealPath(repositoryRoot))) {
    throw new Error(`${REPORT_ROOT_ENV} must lie outside the repository checkout`);
  }
  return realRoot;
}

const defaultTempRoots = (): string[] => [path.resolve(os.tmpdir()), SHARED_TEMP_ROOT];

const warnedPaths = new Set<string>();

const isDirectory = (target: string): boolean => {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
};

function assertParentWritable(resolved: string, flag: string): void {
  const parent = path.dirname(resolved);
  if (!isDirectory(parent)) {
    throw new Error(`${flag} directory ${parent} does not exist; create it before the run`);
  }
  const probe = path.join(parent, `.ylabs-report-probe-${process.pid}-${randomUUID()}`);
  try {
    fs.writeFileSync(probe, '', { flag: 'wx', mode: 0o600 });
    fs.unlinkSync(probe);
  } catch (error) {
    throw new Error(
      `${flag} directory ${parent} is not writable (${(error as NodeJS.ErrnoException).code ?? 'error'})`,
      { cause: error },
    );
  }
  if (fs.existsSync(resolved)) {
    try {
      fs.accessSync(resolved, fs.constants.W_OK);
    } catch (error) {
      throw new Error(`${flag} file ${resolved} exists and is not writable`, { cause: error });
    }
  }
}

/**
 * Where a script may read or write one of its JSON artifacts, without touching the file system
 * beyond resolving symlinks. A read of an existing artifact, or a pre-image snapshot the script
 * writes before any database write, takes this; a report written after the writes takes
 * `resolveSafeJsonReportOutputPath`, which also proves its directory is writable.
 */
export function resolveSafeJsonReportPath(
  value: string | undefined,
  flag = '--output',
  options: ReportOutputPathOptions = {},
): string {
  const output = value?.trim();
  if (!output || output.startsWith('--')) {
    throw new Error(`${flag} requires a path`);
  }
  if (containsAsciiControl(output)) {
    throw new Error(`${flag} path contains invalid characters`);
  }

  const resolved = path.resolve(options.cwd ?? process.cwd(), output);
  if (path.extname(resolved).toLowerCase() !== '.json') {
    throw new Error(`${flag} must point to a .json report file`);
  }

  const repositoryRoot = options.repositoryRoot ?? REPOSITORY_ROOT;
  const reportRoot = resolveReportRoot(options.env ?? process.env, repositoryRoot);
  const tempRoots = [...(options.tempRoots ?? defaultTempRoots())];
  const projectTmpRoot = path.resolve(options.cwd ?? process.cwd(), 'tmp');
  const approved = approvedTempRootFor(resolved, [
    ...tempRoots,
    projectTmpRoot,
    ...(reportRoot ? [reportRoot] : []),
  ]);
  if (!approved) {
    throw new Error(
      `${flag} must write under ${[...new Set([...tempRoots, './tmp'])].join(' or ')}${
        reportRoot
          ? ` or ${REPORT_ROOT_ENV} (${reportRoot})`
          : `, or under ${REPORT_ROOT_ENV} when it is set`
      }`,
    );
  }
  const realTarget = resolveRealPath(resolved);
  if (
    reportRoot &&
    approved.realRoot === reportRoot &&
    hasPathPrefix(realTarget, resolveRealPath(repositoryRoot))
  ) {
    throw new Error(`${flag} under ${REPORT_ROOT_ENV} resolves into the repository checkout`);
  }
  return resolved;
}

export function resolveSafeJsonReportOutputPath(
  value: string | undefined,
  flag = '--output',
  options: ReportOutputPathOptions = {},
): string {
  const resolved = resolveSafeJsonReportPath(value, flag, options);
  assertParentWritable(resolved, flag);

  const realTarget = resolveRealPath(resolved);
  const tempRoots = options.tempRoots ?? defaultTempRoots();
  if (
    tempRoots.some((root) => hasPathPrefix(realTarget, resolveRealPath(root))) &&
    !warnedPaths.has(resolved)
  ) {
    warnedPaths.add(resolved);
    (options.warn ?? console.warn)(
      `WARNING: ${flag} ${resolved} is under a temp directory the system may wipe; copy the report out after the run, or set ${REPORT_ROOT_ENV} to a directory outside the repository.`,
    );
  }
  return resolved;
}

const OUTPUT_FLAG = '--output';

/**
 * The `--output` value a script was started with, read from its own arguments. A script that
 * validates its report path only when it writes the report would otherwise connect and write
 * first; the shared connection entry points resolve this before they connect.
 */
export function outputFlagValueFromArgv(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === OUTPUT_FLAG) return argv[index + 1] ?? '';
    if (arg.startsWith(`${OUTPUT_FLAG}=`)) return arg.slice(OUTPUT_FLAG.length + 1);
  }
  return undefined;
}

export function assertProcessOutputFlagResolvable(argv: readonly string[] = process.argv): void {
  const value = outputFlagValueFromArgv(argv.slice(2));
  if (value === undefined) return;
  resolveSafeJsonReportOutputPath(value);
}
