import { createHash } from 'node:crypto';

export const GRAPHIFY_ARTIFACTS = ['graphify-out/graph.json', 'graphify-out/GRAPH_REPORT.md'];

const GRAPH_INPUT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.go',
  '.graphql',
  '.html',
  '.java',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.mjs',
  '.py',
  '.rb',
  '.rs',
  '.scss',
  '.sql',
  '.toml',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);

const GRAPH_INPUT_BASENAMES = new Set([
  '.graphify-version',
  '.graphifyignore',
  'AGENTS.md',
  'Dockerfile',
  'package.json',
  'tsconfig.json',
]);

const normalizePath = (value) =>
  String(value || '')
    .replaceAll('\\', '/')
    .replace(/^\.\//, '');

export const isGraphInputPath = (value) => {
  const filePath = normalizePath(value);
  if (!filePath || filePath.startsWith('graphify-out/')) return false;
  if (
    filePath.includes('/node_modules/') ||
    filePath.startsWith('node_modules/') ||
    filePath.startsWith('.git/') ||
    filePath.startsWith('.yarn/') ||
    filePath.includes('/.yarn/') ||
    filePath.startsWith('client/build/') ||
    filePath.startsWith('client/dist/') ||
    filePath.startsWith('server/build/') ||
    filePath.startsWith('coverage/')
  ) {
    return false;
  }

  const basename = filePath.split('/').at(-1) || '';
  if (GRAPH_INPUT_BASENAMES.has(basename)) return true;
  const extensionIndex = basename.lastIndexOf('.');
  const extension = extensionIndex >= 0 ? basename.slice(extensionIndex).toLowerCase() : '';
  return GRAPH_INPUT_EXTENSIONS.has(extension);
};

export const parseInstalledGraphifyVersion = (output) => {
  const match = String(output || '')
    .trim()
    .match(/^graphify\s+([^\s]+)$/i);
  return match?.[1] || '';
};

export const parseReportSourceCommit = (report) => {
  const match = String(report || '').match(/Built from commit:\s*`([0-9a-f]{7,40})`/i);
  return match?.[1]?.toLowerCase() || '';
};

export const commitsMatch = (head, reportCommit) => {
  const normalizedHead = String(head || '')
    .trim()
    .toLowerCase();
  const normalizedReportCommit = String(reportCommit || '')
    .trim()
    .toLowerCase();
  if (!normalizedHead || !normalizedReportCommit) return false;
  return (
    normalizedHead.startsWith(normalizedReportCommit) ||
    normalizedReportCommit.startsWith(normalizedHead)
  );
};

export const hashInputs = (entries) => {
  const hash = createHash('sha256');
  for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(normalizePath(entry.path));
    hash.update('\0');
    hash.update(entry.content);
    hash.update('\0');
  }
  return hash.digest('hex');
};

export const cacheRefreshReasons = ({
  artifactsExist,
  expectedVersion,
  installedVersion,
  head,
  reportCommit,
  inputFingerprint,
  state,
}) => {
  const reasons = [];
  if (!artifactsExist) reasons.push('graph artifacts are missing');
  if (!installedVersion) reasons.push('Graphify is not installed');
  else if (installedVersion !== expectedVersion) {
    reasons.push(`installed Graphify ${installedVersion} does not match ${expectedVersion}`);
  }
  if (!state) reasons.push('cache state is missing');
  if (!state && !commitsMatch(head, reportCommit)) {
    reasons.push('graph source commit differs from HEAD');
  }
  if (state?.graphifyVersion !== expectedVersion) {
    reasons.push('cached Graphify version differs from the required version');
  }
  if (state?.head !== head) reasons.push('cached HEAD differs from current HEAD');
  if (state?.inputFingerprint !== inputFingerprint) {
    reasons.push('graph-relevant working-tree inputs changed');
  }
  return [...new Set(reasons)];
};
