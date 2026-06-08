import fs from 'fs/promises';
import path from 'path';

export function hasOutputPath(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function writeJsonOutputFile(outputPath: string, payload: unknown): Promise<string> {
  const resolvedPath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
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
