import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SERVER_SRC = path.resolve(__dirname, '../..');
const CLIENT_FILE = path.join('utils', 'modelClient.ts');
const OPENAI_HOST = /api\.openai\.com/;

function productionSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory())
      return entry.name === '__tests__' ? [] : productionSourceFiles(fullPath);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [fullPath] : [];
  });
}

describe('the shared model client', () => {
  it('is the only production module that names the OpenAI host', () => {
    const offenders = productionSourceFiles(SERVER_SRC)
      .map((file) => path.relative(SERVER_SRC, file))
      .filter((relative) => relative !== CLIENT_FILE)
      .filter((relative) =>
        OPENAI_HOST.test(fs.readFileSync(path.join(SERVER_SRC, relative), 'utf8')),
      );
    expect(offenders).toEqual([]);
  });

  it('names the OpenAI host itself, so the scan above is not vacuous', () => {
    expect(OPENAI_HOST.test(fs.readFileSync(path.join(SERVER_SRC, CLIENT_FILE), 'utf8'))).toBe(
      true,
    );
  });
});
