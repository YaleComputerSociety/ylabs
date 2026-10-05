/**
 * Whether the current process was started by running this script module itself,
 * so a module with a CLI body can tell a direct run from being imported.
 *
 * The module path alone cannot answer that in a deployed server. `tsup` collapses
 * every module into `build/index.js`, so inside the bundle `import.meta.url` is
 * the bundle, and `node build/index.js` makes a bare `process.argv[1]` comparison
 * true for every script the bundle happens to contain (#4186). Requiring the
 * entry file to carry the script's own name keeps the bundle out, because the
 * bundle is named after the server entry instead.
 */
import path from 'path';
import { fileURLToPath } from 'url';

const entryFileName = (filePath: string): string => path.basename(filePath, path.extname(filePath));

export function isDirectScriptInvocation(moduleUrl: string, scriptModuleName: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const modulePath = fileURLToPath(moduleUrl);
  if (path.resolve(entry) !== modulePath) return false;
  return entryFileName(modulePath) === scriptModuleName;
}
