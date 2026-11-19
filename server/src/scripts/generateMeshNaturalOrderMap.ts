/**
 * Builds `server/src/scrapers/data/meshNaturalOrderHeadings.json`, the map from a MeSH inverted
 * heading ("Carcinoma, Hepatocellular") to MeSH's own natural-order entry term ("Hepatocellular
 * Carcinoma") that research-area canonicalization reads (#6358).
 *
 * MeSH is produced by the U.S. National Library of Medicine. Data courtesy of the U.S. National
 * Library of Medicine; use is subject to NLM's terms and conditions:
 * https://www.nlm.nih.gov/databases/download/terms_and_conditions.html
 *
 * A heading is mapped only when the NLM descriptor that carries it, as its preferred name or an
 * entry term, also lists an entry term that is exactly its comma-separated parts in another order.
 * No word order is ever invented, a heading with no such entry term stays unmapped, and a heading
 * whose candidates disagree, or that two descriptors carry, is refused as ambiguous. The
 * descriptor file is never committed; only the map is.
 *
 * To regenerate, for a new MeSH year or for headings the `ysm-mesh-keyword` lane newly emits:
 *   1. Download the descriptor file (descYYYY.gz) from NLM, outside the repository.
 *   2. Write a JSON array of the headings to cover: the map's current keys and its
 *      `unmappedHeadings`, plus every new heading the lane stores.
 *   3. yarn --cwd server mesh:natural-order-map --desc <descYYYY.gz> --headings <headings.json>
 *      [--mesh-year YYYY] [--map <path>]
 *   4. Review the diff of the map, including any `ambiguousHeadings` it prints.
 */
import fs from 'fs';
import path from 'path';
import { createGunzip } from 'zlib';
import { isDirectScriptInvocation } from './directScriptInvocation';
import { resolveServerPackageRoot } from '../utils/serverPackageRoot';

export const MESH_SOURCE_NOTE =
  'MeSH is produced by the U.S. National Library of Medicine. Data courtesy of the U.S. National Library of Medicine; see https://www.nlm.nih.gov/databases/download/terms_and_conditions.html';

export interface MeshDescriptorStrings {
  descriptorUI: string;
  descriptorName: string;
  entryTerms: string[];
}

export interface MeshNaturalOrderEntry {
  natural: string;
  descriptorUI: string;
}

export interface MeshNaturalOrderMap {
  meshYear: number;
  source: string;
  headings: Record<string, MeshNaturalOrderEntry>;
  unmappedHeadings: string[];
}

export interface AmbiguousMeshHeading {
  heading: string;
  candidates: string[];
  descriptorUIs: string[];
}

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

const decodeXmlText = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return XML_ENTITIES[entity.toLowerCase()] ?? whole;
  });

const DESCRIPTOR_NAME_PATH = 'DescriptorRecord/DescriptorName/String';
const DESCRIPTOR_UI_PATH = 'DescriptorRecord/DescriptorUI';
const ENTRY_TERM_PATH = 'DescriptorRecord/ConceptList/Concept/TermList/Term/String';

/**
 * Reads one `<DescriptorRecord>` element by element path, so only the record's own
 * DescriptorUI, DescriptorName/String and ConceptList/Concept/TermList/Term/String count. The
 * DescriptorName nested under a pharmacological action or a see-related reference names another
 * descriptor and is a different path.
 */
export function parseDescriptorRecord(recordXml: string): MeshDescriptorStrings | null {
  const stack: string[] = [];
  let descriptorUI = '';
  let descriptorName = '';
  const entryTerms: string[] = [];
  const tagPattern = /<(\/?)([A-Za-z_][\w.-]*)[^>]*?(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g;
  let textStart = 0;
  for (let match = tagPattern.exec(recordXml); match; match = tagPattern.exec(recordXml)) {
    const text = recordXml.slice(textStart, match.index);
    textStart = tagPattern.lastIndex;
    if (text.trim()) {
      const current = stack.join('/');
      const value = decodeXmlText(text.trim());
      if (current === DESCRIPTOR_UI_PATH && !descriptorUI) descriptorUI = value;
      else if (current === DESCRIPTOR_NAME_PATH && !descriptorName) descriptorName = value;
      else if (current === ENTRY_TERM_PATH) entryTerms.push(value);
    }
    const [, closing, name, selfClosing] = match;
    if (!name) continue;
    if (closing) {
      if (stack[stack.length - 1] === name) stack.pop();
    } else if (!selfClosing) {
      stack.push(name);
    }
  }
  if (!descriptorUI || !descriptorName) return null;
  return { descriptorUI, descriptorName, entryTerms };
}

const headingParts = (heading: string): string[] =>
  heading
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  );
}

/** Every other order of the heading's comma-separated parts, joined by spaces and lowercased. */
export function meshHeadingReorderings(heading: string): Set<string> {
  const parts = headingParts(heading);
  if (parts.length < 2) return new Set();
  const original = parts.join('\u0000');
  return new Set(
    permutations(parts)
      .filter((order) => order.join('\u0000') !== original)
      .map((order) => order.join(' ').toLowerCase()),
  );
}

export function buildMeshNaturalOrderMap(
  descriptors: Iterable<MeshDescriptorStrings>,
  headings: readonly string[],
  meshYear: number,
): { map: MeshNaturalOrderMap; ambiguous: AmbiguousMeshHeading[] } {
  const wanted = new Map<string, string>();
  for (const heading of headings) {
    const trimmed = heading.trim();
    if (trimmed) wanted.set(trimmed.toLowerCase(), trimmed);
  }
  const reorderingsByKey = new Map(
    [...wanted].map(([key, heading]) => [key, meshHeadingReorderings(heading)] as const),
  );
  const hits = new Map<string, Array<{ descriptorUI: string; candidates: string[] }>>();
  for (const descriptor of descriptors) {
    const strings = [descriptor.descriptorName, ...descriptor.entryTerms];
    const lowered = new Set(strings.map((value) => value.toLowerCase()));
    for (const [key] of wanted) {
      if (!lowered.has(key)) continue;
      const reorderings = reorderingsByKey.get(key) ?? new Set<string>();
      const candidates = [
        ...new Set(strings.filter((value) => reorderings.has(value.toLowerCase()))),
      ].sort();
      hits.set(key, [
        ...(hits.get(key) ?? []),
        { descriptorUI: descriptor.descriptorUI, candidates },
      ]);
    }
  }

  const map: MeshNaturalOrderMap = {
    meshYear,
    source: MESH_SOURCE_NOTE,
    headings: {},
    unmappedHeadings: [],
  };
  const ambiguous: AmbiguousMeshHeading[] = [];
  for (const [key, heading] of [...wanted].sort(([, left], [, right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    const found = hits.get(key) ?? [];
    const candidates = [...new Set(found.flatMap((hit) => hit.candidates))].sort();
    if (found.length === 0 || candidates.length === 0) {
      map.unmappedHeadings.push(heading);
      continue;
    }
    const descriptorUIs = [...new Set(found.map((hit) => hit.descriptorUI))].sort();
    if (
      new Set(candidates.map((value) => value.toLowerCase())).size > 1 ||
      descriptorUIs.length > 1
    ) {
      ambiguous.push({ heading, candidates, descriptorUIs });
      continue;
    }
    map.headings[heading] = { natural: candidates[0], descriptorUI: descriptorUIs[0] };
  }
  return { map, ambiguous };
}

const RECORD_CLOSE = '</DescriptorRecord>';

/** Streams `<DescriptorRecord>` elements out of a descriptor file, gzipped or plain. */
export async function* readMeshDescriptors(
  filePath: string,
): AsyncGenerator<MeshDescriptorStrings> {
  const raw = fs.createReadStream(filePath);
  const stream = filePath.endsWith('.gz') ? raw.pipe(createGunzip()) : raw;
  stream.setEncoding('utf8');
  let buffer = '';
  for await (const chunk of stream as AsyncIterable<string>) {
    buffer += chunk;
    for (let end = buffer.indexOf(RECORD_CLOSE); end >= 0; end = buffer.indexOf(RECORD_CLOSE)) {
      const start = buffer.lastIndexOf('<DescriptorRecord', end);
      const record = start >= 0 ? buffer.slice(start, end + RECORD_CLOSE.length) : '';
      buffer = buffer.slice(end + RECORD_CLOSE.length);
      const parsed = record ? parseDescriptorRecord(record) : null;
      if (parsed) yield parsed;
    }
  }
}

export interface GenerateMeshNaturalOrderMapArgs {
  desc: string;
  headings: string;
  meshYear: number;
  map: string;
}

const DEFAULT_MAP_PATH = path.join(
  resolveServerPackageRoot(import.meta.url),
  'src',
  'scrapers',
  'data',
  'meshNaturalOrderHeadings.json',
);

export function parseGenerateMeshNaturalOrderMapArgs(
  argv: readonly string[],
): GenerateMeshNaturalOrderMapArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [flag, inline] = arg.split(/=(.*)/s, 2);
    if (!['--desc', '--headings', '--mesh-year', '--map'].includes(flag)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const value = inline ?? argv[(index += 1)];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    values.set(flag, value);
  }
  const desc = values.get('--desc');
  const headings = values.get('--headings');
  if (!desc) throw new Error('--desc <descYYYY.gz> is required');
  if (!headings) throw new Error('--headings <headings.json> is required');
  const yearText = values.get('--mesh-year') ?? path.basename(desc).match(/desc(\d{4})/)?.[1];
  const meshYear = Number(yearText);
  if (!Number.isInteger(meshYear) || meshYear < 1960) {
    throw new Error('--mesh-year is required when the descriptor file name carries no year');
  }
  return { desc, headings, meshYear, map: values.get('--map') ?? DEFAULT_MAP_PATH };
}

async function main(): Promise<void> {
  const args = parseGenerateMeshNaturalOrderMapArgs(process.argv.slice(2));
  const headings: unknown = JSON.parse(fs.readFileSync(args.headings, 'utf8'));
  if (!Array.isArray(headings) || !headings.every((value) => typeof value === 'string')) {
    throw new Error('--headings must be a JSON array of heading strings');
  }
  const descriptors: MeshDescriptorStrings[] = [];
  for await (const descriptor of readMeshDescriptors(args.desc)) descriptors.push(descriptor);
  const { map, ambiguous } = buildMeshNaturalOrderMap(descriptors, headings, args.meshYear);
  fs.writeFileSync(args.map, `${JSON.stringify(map, null, 2)}\n`);
  console.log(
    `MeSH ${args.meshYear}: ${descriptors.length} descriptors read; ${headings.length} headings, ${Object.keys(map.headings).length} mapped, ${map.unmappedHeadings.length} unmapped, ${ambiguous.length} refused as ambiguous`,
  );
  for (const entry of ambiguous) {
    console.log(
      `ambiguous: ${entry.heading} -> ${entry.candidates.join(' | ')} (${entry.descriptorUIs.join(', ')})`,
    );
  }
}

if (isDirectScriptInvocation(import.meta.url, 'generateMeshNaturalOrderMap')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
