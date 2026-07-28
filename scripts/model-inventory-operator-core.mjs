import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const INVENTORY_PROFILES = Object.freeze({
  'beta-inventory': Object.freeze({
    environment: 'beta',
    databaseName: 'Beta',
    fileName: 'beta-inventory.env',
  }),
  'production-copy-inventory': Object.freeze({
    environment: 'production-copy',
    databaseName: 'ProductionCopy',
    fileName: 'production-copy-inventory.env',
  }),
});

const SAFE_CHILD_ENVIRONMENT_KEYS = Object.freeze([
  'CI',
  'COLORTERM',
  'COMSPEC',
  'COREPACK_HOME',
  'FORCE_COLOR',
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOGNAME',
  'NO_COLOR',
  'PATH',
  'PATHEXT',
  'SHELL',
  'SYSTEMROOT',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'USER',
  'WINDIR',
  'XDG_CACHE_HOME',
]);

const PLACEHOLDER_PATTERN =
  /[<>]|\b(?:change[-_ ]?me|placeholder|replace[-_ ]?me)\b|your[-_]|example\.(?:com|net|org)|example\.mongodb\.net/i;

const hasPathPrefix = (target, root) => {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
};

const octalMode = (stat) => stat.mode & 0o777;

function assertOwnedByCurrentUser(stat, label) {
  if (typeof process.getuid !== 'function') return;
  if (stat.uid !== process.getuid()) {
    throw new Error(`${label} must be owned by the current operating-system user.`);
  }
}

function assertPathHasNoSymlinkComponents(target, label) {
  const resolved = path.resolve(target);
  let real;
  try {
    real = fs.realpathSync.native(resolved);
  } catch {
    throw new Error(`${label} does not exist.`);
  }
  if (real !== resolved) {
    throw new Error(`${label} must not contain symlink path components.`);
  }
}

export function parseInventoryProfileInvocation(argv) {
  const profileName = argv[0];
  if (!Object.hasOwn(INVENTORY_PROFILES, profileName ?? '')) {
    throw new Error('The profile must be beta-inventory or production-copy-inventory.');
  }

  let profileDirectory;
  let output;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--profile-dir') {
      const value = argv[index + 1]?.trim();
      if (!value || value.startsWith('--')) {
        throw new Error('--profile-dir requires an absolute directory path.');
      }
      profileDirectory = value;
      index += 1;
    } else if (arg.startsWith('--profile-dir=')) {
      profileDirectory = arg.slice('--profile-dir='.length).trim();
    } else if (arg === '--output') {
      const value = argv[index + 1]?.trim();
      if (!value || value.startsWith('--')) {
        throw new Error(
          '--output requires a new absolute .json path under the system temp directory.',
        );
      }
      output = value;
      index += 1;
    } else if (arg.startsWith('--output=')) {
      output = arg.slice('--output='.length).trim();
    } else {
      throw new Error(
        `Unknown inventory-profile argument: ${arg}. Arbitrary child commands are not allowed.`,
      );
    }
  }

  if (!profileDirectory || !path.isAbsolute(profileDirectory)) {
    throw new Error(
      '--profile-dir requires an explicit absolute directory outside the repository.',
    );
  }
  if (!output || !path.isAbsolute(output)) {
    throw new Error('--output requires a new absolute .json path under the system temp directory.');
  }

  return {
    profileName,
    profileDirectory: path.resolve(profileDirectory),
    output: path.resolve(output),
  };
}

export function resolveSecureInventoryOutputPath(output) {
  if (/[\u0000-\u001f\u007f]/.test(output)) {
    throw new Error('--output contains invalid characters.');
  }
  const resolved = path.resolve(output);
  if (!path.isAbsolute(output) || path.extname(resolved).toLowerCase() !== '.json') {
    throw new Error('--output must be an absolute .json path.');
  }

  const parent = path.dirname(resolved);
  assertPathHasNoSymlinkComponents(parent, 'The output parent directory');
  const tempRoot = fs.realpathSync.native(path.resolve(os.tmpdir()));
  const realParent = fs.realpathSync.native(parent);
  if (!hasPathPrefix(realParent, tempRoot)) {
    throw new Error(`--output must be under the system temp directory ${tempRoot}.`);
  }
  if (fs.existsSync(resolved)) {
    throw new Error('--output already exists; preserved inventory evidence is never overwritten.');
  }
  return resolved;
}

export function resolveSecureInventoryProfile(args) {
  const profile = INVENTORY_PROFILES[args.profileName];
  if (!profile) {
    throw new Error(`Unknown inventory profile: ${args.profileName}`);
  }

  const repoRoot = path.resolve(args.repoRoot);
  const profileDirectory = path.resolve(args.profileDirectory);
  if (!path.isAbsolute(args.profileDirectory) || hasPathPrefix(profileDirectory, repoRoot)) {
    throw new Error('The inventory profile directory must be absolute and outside the repository.');
  }

  assertPathHasNoSymlinkComponents(profileDirectory, 'The inventory profile directory');
  const directoryStat = fs.lstatSync(profileDirectory);
  if (!directoryStat.isDirectory()) {
    throw new Error('The inventory profile path must be a directory.');
  }
  assertOwnedByCurrentUser(directoryStat, 'The inventory profile directory');
  if ((octalMode(directoryStat) & 0o077) !== 0) {
    throw new Error('The inventory profile directory must not grant group or other permissions.');
  }

  const profilePath = path.join(profileDirectory, profile.fileName);
  assertPathHasNoSymlinkComponents(profilePath, `Inventory profile ${args.profileName}`);
  const profileStat = fs.lstatSync(profilePath);
  if (!profileStat.isFile()) {
    throw new Error(`Inventory profile ${args.profileName} must be a regular file.`);
  }
  assertOwnedByCurrentUser(profileStat, `Inventory profile ${args.profileName}`);
  if (octalMode(profileStat) !== 0o600) {
    throw new Error(`Inventory profile ${args.profileName} must have mode 0600.`);
  }

  return { profile, profilePath };
}

export function validateInventoryProfileValues(profileName, values) {
  const profile = INVENTORY_PROFILES[profileName];
  if (!profile) {
    throw new Error(`Unknown inventory profile: ${profileName}`);
  }
  const keys = Object.keys(values);
  if (keys.length !== 1 || keys[0] !== 'MONGODBURL') {
    throw new Error('Inventory profiles may contain only MONGODBURL.');
  }

  const mongoUrl = values.MONGODBURL?.trim();
  if (!mongoUrl) {
    throw new Error('MONGODBURL is required by the inventory profile.');
  }
  if (PLACEHOLDER_PATTERN.test(mongoUrl)) {
    throw new Error('MONGODBURL still contains a placeholder value.');
  }

  let parsed;
  try {
    parsed = new URL(mongoUrl);
  } catch {
    throw new Error('MONGODBURL must be a valid MongoDB Atlas connection URL.');
  }
  if (parsed.protocol !== 'mongodb+srv:') {
    throw new Error('Inventory profiles require a mongodb+srv Atlas connection URL.');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname.endsWith('.mongodb.net')) {
    throw new Error('Inventory profiles require a remote MongoDB Atlas hostname.');
  }
  if (!parsed.username || !parsed.password) {
    throw new Error('Inventory profiles require a dedicated database-scoped Atlas user.');
  }
  let decodedUsername;
  let decodedPassword;
  try {
    decodedUsername = decodeURIComponent(parsed.username);
    decodedPassword = decodeURIComponent(parsed.password);
  } catch {
    throw new Error('MONGODBURL contains invalid encoded Atlas credentials.');
  }
  if (PLACEHOLDER_PATTERN.test(decodedUsername) || PLACEHOLDER_PATTERN.test(decodedPassword)) {
    throw new Error('MONGODBURL still contains placeholder Atlas credentials.');
  }
  const connectionOptions = new Map();
  for (const [key, value] of parsed.searchParams) {
    const normalizedKey = key.toLowerCase();
    const values = connectionOptions.get(normalizedKey) ?? [];
    values.push(value.toLowerCase());
    connectionOptions.set(normalizedKey, values);
  }
  if (
    connectionOptions.get('tls')?.includes('false') ||
    connectionOptions.get('ssl')?.includes('false') ||
    connectionOptions.get('directconnection')?.includes('true')
  ) {
    throw new Error('Inventory profiles may not disable TLS or force a direct connection.');
  }

  let databaseName;
  try {
    databaseName = decodeURIComponent(parsed.pathname.slice(1)).trim();
  } catch {
    throw new Error('MONGODBURL contains an invalid encoded database name.');
  }
  if (!databaseName || databaseName.includes('/')) {
    throw new Error('MONGODBURL must include one explicit database name.');
  }
  if (databaseName.toLowerCase() === 'production') {
    throw new Error('Inventory profiles must never select the primary Production database.');
  }
  if (databaseName !== profile.databaseName) {
    throw new Error(
      `Profile ${profileName} requires MongoDB database ${profile.databaseName}; resolved ${databaseName}.`,
    );
  }

  return {
    mongoUrl,
    target: `${hostname}/${databaseName}`,
    profile,
  };
}

export function buildInventoryChildEnvironment(args) {
  const child = {};
  for (const key of SAFE_CHILD_ENVIRONMENT_KEYS) {
    const value = args.parentEnvironment[key];
    if (value !== undefined) child[key] = value;
  }
  child.MONGODBURL = args.mongoUrl;
  child.YLABS_INVENTORY_PROFILE_ACTIVE = 'true';
  child.YLABS_INVENTORY_SOURCE_COMMIT = args.sourceCommit;
  return child;
}

export function inventoryChildCommand(profileName, output) {
  const profile = INVENTORY_PROFILES[profileName];
  if (!profile) {
    throw new Error(`Unknown inventory profile: ${profileName}`);
  }
  return [
    '--cwd',
    'server',
    'model-refactor:inventory',
    '--environment',
    profile.environment,
    '--sample-limit',
    '0',
    '--output',
    output,
  ];
}
