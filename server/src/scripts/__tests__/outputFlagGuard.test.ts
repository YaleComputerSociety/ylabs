import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const SERVER_SRC = path.resolve(__dirname, '../..');
const SCANNED_DIRECTORIES = ['scripts', 'scrapers'];

const READS_OUTPUT_FLAG = [
  /(?:===|==)\s*['"`]--output['"`]/,
  /startsWith\(\s*['"`]--output/,
  /['"`]--output=['"`]\.length/,
  /case\s+['"`]--output['"`]/,
  /\bflags\.output\b/,
  /\bflags\[\s*['"`]output['"`]\s*\]/,
];

const GOES_THROUGH_THE_HELPER =
  /\bresolveSafeJsonReportOutputPath\b|\bwriteOptionalJsonOutput\b|\bwriteJsonOutputFile\b/;

export interface ScannedSource {
  file: string;
  source: string;
}

/**
 * Files that read a script's own `--output` flag without the shared report-path guard. A
 * `fooCore.ts` parser that hands the raw value to its `foo.ts` entry point passes when the entry
 * point resolves it, because that pairing is how a script keeps its parser free of I/O.
 *
 * When a file resolves the path is not scanned: a parser and the code that connects are routinely
 * separate functions called in an order no text scan can see. The shared connection entry points
 * resolve `--output` from the process arguments before they connect instead (#6366).
 */
export function unguardedOutputFlagReaders(sources: readonly ScannedSource[]): string[] {
  const byFile = new Map(sources.map((entry) => [entry.file, entry.source]));
  const guarded = (file: string): boolean => {
    if (GOES_THROUGH_THE_HELPER.test(byFile.get(file) ?? '')) return true;
    if (!file.endsWith('Core.ts')) return false;
    const entryPoint = byFile.get(file.replace(/Core\.ts$/, '.ts'));
    return entryPoint !== undefined && GOES_THROUGH_THE_HELPER.test(entryPoint);
  };
  return sources
    .filter(({ source }) => READS_OUTPUT_FLAG.some((pattern) => pattern.test(source)))
    .map(({ file }) => file)
    .filter((file) => !guarded(file))
    .sort();
}

function productionSources(): ScannedSource[] {
  const sources: ScannedSource[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        walk(full);
      } else if (/\.(ts|mts)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
        sources.push({
          file: path.relative(SERVER_SRC, full),
          source: fs.readFileSync(full, 'utf8'),
        });
      }
    }
  };
  for (const directory of SCANNED_DIRECTORIES) walk(path.join(SERVER_SRC, directory));
  return sources;
}

describe('every --output reader goes through the shared report-path guard (#6366)', () => {
  it('finds no script or scraper that reads --output without it', () => {
    expect(unguardedOutputFlagReaders(productionSources())).toEqual([]);
  });

  it('flags a planted reader that keeps the raw value', () => {
    const planted: ScannedSource = {
      file: 'scripts/plantedReport.ts',
      source: [
        'for (let i = 0; i < argv.length; i += 1) {',
        "  if (argv[i] === '--output') output = argv[i + 1];",
        '}',
        'fs.writeFileSync(output, JSON.stringify(report));',
      ].join('\n'),
    };
    const flagsReader: ScannedSource = {
      file: 'scrapers/plantedCli.ts',
      source: 'await fs.writeFile(flags.output as string, body);',
    };

    expect(unguardedOutputFlagReaders([planted, flagsReader])).toEqual([
      'scrapers/plantedCli.ts',
      'scripts/plantedReport.ts',
    ]);
  });

  it('passes a reader that resolves the value, and a parser whose entry point does', () => {
    const resolving: ScannedSource = {
      file: 'scripts/goodReport.ts',
      source: "if (arg === '--output') output = resolveSafeJsonReportOutputPath(argv[i + 1]);",
    };
    const parser: ScannedSource = {
      file: 'scripts/pairedReportCore.ts',
      source: "if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);",
    };
    const entryPoint: ScannedSource = {
      file: 'scripts/pairedReport.ts',
      source: 'const safe = resolveSafeJsonReportOutputPath(args.output);',
    };
    const unpaired: ScannedSource = { ...parser, file: 'scripts/loneReportCore.ts' };

    expect(unguardedOutputFlagReaders([resolving, parser, entryPoint, unpaired])).toEqual([
      'scripts/loneReportCore.ts',
    ]);
  });
});
