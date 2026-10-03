import fs from 'node:fs';
import path from 'node:path';

import { build } from 'tsup';

export const SERVER_ROOT = path.resolve(__dirname, '../..');
const BUNDLE_PARENT = path.join(SERVER_ROOT, 'node_modules', '.cache');

export interface ServerBundle {
  directory: string;
  entryPath: string;
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
    remove: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}
