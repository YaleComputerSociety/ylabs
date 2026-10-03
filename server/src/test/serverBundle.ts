import fs from 'node:fs';
import path from 'node:path';

import { build } from 'tsup';

export const SERVER_ROOT = path.resolve(__dirname, '../..');
const BUNDLE_PARENT = path.join(SERVER_ROOT, 'node_modules', '.cache');

export interface ServerBundle {
  directory: string;
  entryPath: string;
  sourceModules: () => string[];
  remove: () => void;
}

export async function buildServerBundle(label: string): Promise<ServerBundle> {
  fs.mkdirSync(BUNDLE_PARENT, { recursive: true });
  const directory = fs.mkdtempSync(path.join(BUNDLE_PARENT, `${label}-`));
  await build({
    config: path.join(SERVER_ROOT, 'tsup.config.ts'),
    outDir: directory,
    clean: false,
    silent: true,
    onSuccess: undefined,
  });
  const entryPath = path.join(directory, 'index.js');
  return {
    directory,
    entryPath,
    sourceModules: () => {
      const sourceMap = JSON.parse(fs.readFileSync(`${entryPath}.map`, 'utf8')) as {
        sources: string[];
      };
      return sourceMap.sources
        .map((source) => path.resolve(directory, source))
        .filter((source) => !source.split(path.sep).includes('node_modules'))
        .map((source) => path.relative(SERVER_ROOT, source));
    },
    remove: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}
