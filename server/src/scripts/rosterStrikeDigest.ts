/**
 * research-homes:roster-strike-digest - prints the digest an owner's roster refusal is
 * stored as in `officialRosterConfigs.ts`, so a reviewer can add a strike without writing
 * the name into the public repository.
 *
 * It reads one value per line from stdin, so the name stays out of shell history and the
 * process list, and prints one digest per line in the same order.
 *
 *   pbpaste | yarn --cwd server research-homes:roster-strike-digest
 *   pbpaste | yarn --cwd server research-homes:roster-strike-digest --denied-key
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { deniedRosterKeyDigest, withheldNameDigest } from '../scrapers/rosterStrikeDigests';

export function rosterStrikeDigestLines(input: string, deniedKey: boolean): string[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (deniedKey ? deniedRosterKeyDigest(line) : withheldNameDigest(line)));
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function main(argv: string[]): Promise<void> {
  const unknown = argv.filter((arg) => arg !== '--denied-key');
  if (unknown.length > 0) {
    throw new Error('Pass values on stdin, one per line; the only flag is --denied-key');
  }
  const lines = rosterStrikeDigestLines(await readStdin(), argv.includes('--denied-key'));
  process.stdout.write(lines.length > 0 ? `${lines.join('\n')}\n` : '');
}

const invokedDirectly = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
