import { constants as fsConstants } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { resolveSafeJsonReportOutputPath } from '../scripts/scriptWriteGuards';

export function hasOutputPath(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function writeJsonOutputFile(outputPath: string, payload: unknown): Promise<string> {
  const resolvedPath = resolveSafeJsonReportOutputPath(outputPath);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  const handle = await fs.open(
    resolvedPath,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } finally {
    await handle.close();
  }
  return resolvedPath;
}

export async function writeOptionalJsonOutput({
  outputPath,
  payload,
  label,
  logger = console.log,
}: {
  outputPath: unknown;
  payload: unknown;
  label: string;
  logger?: (message: string) => void;
}): Promise<{ saved: true; outputPath: string } | { saved: false }> {
  if (!hasOutputPath(outputPath)) {
    return { saved: false };
  }
  const resolvedOutputPath = await writeJsonOutputFile(outputPath, payload);
  logger(`Saved ${label} to ${resolvedOutputPath}`);
  return { saved: true, outputPath: resolvedOutputPath };
}
