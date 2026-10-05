import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const SERVER_PACKAGE_NAME = 'server';

const readPackageName = (directory: string): string | undefined => {
  const manifestPath = path.join(directory, 'package.json');
  if (!fs.existsSync(manifestPath)) return undefined;
  try {
    const manifest: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return typeof manifest === 'object' && manifest !== null && 'name' in manifest
      ? String(manifest.name)
      : undefined;
  } catch {
    return undefined;
  }
};

export function resolveServerPackageRoot(moduleUrl: string): string {
  const modulePath = fileURLToPath(moduleUrl);
  let directory = path.dirname(modulePath);
  for (;;) {
    if (readPackageName(directory) === SERVER_PACKAGE_NAME) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error(`No "${SERVER_PACKAGE_NAME}" package.json encloses ${modulePath}`);
    }
    directory = parent;
  }
}
