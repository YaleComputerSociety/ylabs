export function normalizeToken(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]+/g, '') : '';
}

export function tokenize(value: unknown): string[] {
  return typeof value === 'string'
    ? value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 0)
    : [];
}

export function jaroWinkler(a: string, b: string): number {
  const s1 = a ?? '';
  const s2 = b ?? '';
  if (s1 === s2) return s1.length === 0 ? 0 : 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const matchDistance = Math.max(0, Math.floor(Math.max(s1.length, s2.length) / 2) - 1);
  const s1Matches = new Array<boolean>(s1.length).fill(false);
  const s2Matches = new Array<boolean>(s2.length).fill(false);
  let matches = 0;

  for (let i = 0; i < s1.length; i += 1) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, s2.length);
    for (let j = start; j < end; j += 1) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < s1.length; i += 1) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k += 1;
    if (s1[i] !== s2[k]) transpositions += 1;
    k += 1;
  }
  const t = transpositions / 2;
  const m = matches;
  const jaro = (m / s1.length + m / s2.length + (m - t) / m) / 3;

  let prefix = 0;
  const maxPrefix = Math.min(4, s1.length, s2.length);
  for (let i = 0; i < maxPrefix; i += 1) {
    if (s1[i] === s2[i]) prefix += 1;
    else break;
  }
  if (jaro < 0.7) return jaro;
  return jaro + prefix * 0.1 * (1 - jaro);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_unused, i) => i);
  let curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min((curr[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[b.length] ?? 0;
}

export function levenshteinRatio(a: string, b: string): number {
  const s1 = a ?? '';
  const s2 = b ?? '';
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 0;
  return 1 - levenshtein(s1, s2) / maxLen;
}

export function tokenSortRatio(a: string, b: string): number {
  const sortedA = tokenize(a).sort().join(' ');
  const sortedB = tokenize(b).sort().join(' ');
  return levenshteinRatio(sortedA, sortedB);
}

export function tokenSetRatio(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  const intersection = [...setA].filter((token) => setB.has(token)).sort();
  const onlyA = [...setA].filter((token) => !setB.has(token)).sort();
  const onlyB = [...setB].filter((token) => !setA.has(token)).sort();
  const t0 = intersection.join(' ');
  const combinedA = [...intersection, ...onlyA].join(' ').trim();
  const combinedB = [...intersection, ...onlyB].join(' ').trim();
  return Math.max(
    levenshteinRatio(t0, combinedA),
    levenshteinRatio(t0, combinedB),
    levenshteinRatio(combinedA, combinedB),
  );
}

export interface SoftTfIdfOptions {
  theta?: number;
  secondary?: (a: string, b: string) => number;
  defaultIdf?: number;
}

function tfIdfWeights(
  tokens: string[],
  idf: Map<string, number>,
  defaultIdf: number,
): Map<string, number> {
  const unique = [...new Set(tokens)];
  const raw = new Map<string, number>();
  let norm = 0;
  for (const token of unique) {
    const weight = idf.get(token) ?? defaultIdf;
    raw.set(token, weight);
    norm += weight * weight;
  }
  norm = Math.sqrt(norm);
  if (norm === 0) return raw;
  const normalized = new Map<string, number>();
  for (const [token, weight] of raw) normalized.set(token, weight / norm);
  return normalized;
}

export function softTfIdf(
  tokensA: string[],
  tokensB: string[],
  idf: Map<string, number>,
  options: SoftTfIdfOptions = {},
): number {
  const theta = options.theta ?? 0.9;
  const secondary = options.secondary ?? jaroWinkler;
  const defaultIdf = options.defaultIdf ?? 1;
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const weightsA = tfIdfWeights(tokensA, idf, defaultIdf);
  const weightsB = tfIdfWeights(tokensB, idf, defaultIdf);
  let score = 0;
  for (const [tokenA, weightA] of weightsA) {
    let bestSim = 0;
    let bestWeightB = 0;
    for (const [tokenB, weightB] of weightsB) {
      const sim = secondary(tokenA, tokenB);
      if (sim > bestSim) {
        bestSim = sim;
        bestWeightB = weightB;
      }
    }
    if (bestSim >= theta) score += weightA * bestWeightB * bestSim;
  }
  return score;
}

export interface PhoneticCode {
  primary: string;
  alternate: string;
}

const METAPHONE_VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

export function metaphone(name: string, useAlternate = false): string {
  let word = (typeof name === 'string' ? name : '').toUpperCase().replace(/[^A-Z]/g, '');
  if (word.length === 0) return '';

  if (/^(AE|GN|KN|PN|WR)/.test(word)) word = word.slice(1);
  else if (word.startsWith('X')) word = `S${word.slice(1)}`;
  else if (word.startsWith('WH')) word = `W${word.slice(2)}`;

  const chars = word.split('');
  let code = '';
  const at = (index: number): string => chars[index] ?? '';
  const isVowel = (ch: string): boolean => METAPHONE_VOWELS.has(ch);

  for (let i = 0; i < chars.length; i += 1) {
    const c = at(i);
    const prev = at(i - 1);
    const next = at(i + 1);
    if (c === prev && c !== 'C') continue;

    if (isVowel(c)) {
      if (i === 0) code += c;
      continue;
    }

    switch (c) {
      case 'B':
        if (!(i === chars.length - 1 && prev === 'M')) code += 'B';
        break;
      case 'C':
        if (next === 'I' && at(i + 2) === 'A') code += 'X';
        else if (next === 'H') {
          if (prev === 'S') code += 'K';
          else code += useAlternate ? 'K' : 'X';
        } else if (next === 'I' || next === 'E' || next === 'Y') {
          if (prev !== 'S') code += 'S';
        } else code += 'K';
        break;
      case 'D':
        if (next === 'G' && (at(i + 2) === 'E' || at(i + 2) === 'I' || at(i + 2) === 'Y'))
          code += 'J';
        else code += 'T';
        break;
      case 'G':
        if (next === 'H') {
          if (!(i > 0 && isVowel(prev))) code += 'K';
        } else if (next === 'N') {
          code += '';
        } else if (next === 'I' || next === 'E' || next === 'Y') code += 'J';
        else code += 'K';
        break;
      case 'H':
        if (isVowel(prev) && !isVowel(next)) break;
        if (prev === 'C' || prev === 'S' || prev === 'P' || prev === 'T' || prev === 'G') break;
        code += 'H';
        break;
      case 'J':
        code += 'J';
        break;
      case 'K':
        if (prev !== 'C') code += 'K';
        break;
      case 'L':
        code += 'L';
        break;
      case 'M':
        code += 'M';
        break;
      case 'N':
        code += 'N';
        break;
      case 'P':
        code += next === 'H' ? 'F' : 'P';
        break;
      case 'Q':
        code += 'K';
        break;
      case 'R':
        code += 'R';
        break;
      case 'S':
        if (next === 'H') code += 'X';
        else if (next === 'I' && (at(i + 2) === 'O' || at(i + 2) === 'A')) code += 'X';
        else code += 'S';
        break;
      case 'T':
        if (next === 'H') code += '0';
        else if (next === 'I' && (at(i + 2) === 'O' || at(i + 2) === 'A')) code += 'X';
        else code += 'T';
        break;
      case 'V':
        code += 'F';
        break;
      case 'W':
      case 'Y':
        if (isVowel(next)) code += c;
        break;
      case 'X':
        code += 'KS';
        break;
      case 'Z':
        code += 'S';
        break;
      default:
        break;
    }
  }
  return code;
}

export function doubleMetaphone(name: string): PhoneticCode {
  return { primary: metaphone(name), alternate: metaphone(name, true) };
}

function firstNameToken(value: unknown): string {
  const tokens = tokenize(value);
  return tokens[0] ?? '';
}

export type FirstNameCompatibility = 'shared' | 'initial-compatible' | 'conflicting';

export function firstNameCompatibility(a: unknown, b: unknown): FirstNameCompatibility {
  const first = firstNameToken(a);
  const second = firstNameToken(b);
  if (first === '' || second === '') return 'initial-compatible';
  if (first === second) return 'shared';
  const firstIsInitial = first.length === 1;
  const secondIsInitial = second.length === 1;
  if (firstIsInitial || secondIsInitial) {
    return first[0] === second[0] ? 'initial-compatible' : 'conflicting';
  }
  return 'conflicting';
}

export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const setA = new Set(
    [...a].map((value) => normalizeToken(value)).filter((value) => value.length > 0),
  );
  const setB = new Set(
    [...b].map((value) => normalizeToken(value)).filter((value) => value.length > 0),
  );
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const value of setA) if (setB.has(value)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface PiRoleLike {
  personId?: unknown;
  state?: unknown;
  confidence?: unknown;
}

function piRoleWeight(role: PiRoleLike): number {
  const confidence = typeof role.confidence === 'number' ? role.confidence : undefined;
  if (confidence !== undefined) return Math.max(0, Math.min(1, confidence));
  if (typeof role.state === 'string' && role.state.toLowerCase() !== 'active') return 0.5;
  return 1;
}

export function piOverlap(a: PiRoleLike[], b: PiRoleLike[]): number {
  const weightsA = new Map<string, number>();
  for (const role of a) {
    const id =
      role.personId === undefined || role.personId === null ? '' : String(role.personId).trim();
    if (!id) continue;
    weightsA.set(id, Math.max(weightsA.get(id) ?? 0, piRoleWeight(role)));
  }
  let best = 0;
  for (const role of b) {
    const id =
      role.personId === undefined || role.personId === null ? '' : String(role.personId).trim();
    if (!id) continue;
    const weightA = weightsA.get(id);
    if (weightA === undefined) continue;
    best = Math.max(best, Math.min(weightA, piRoleWeight(role)));
  }
  return best;
}

export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function hostOf(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    return new URL(value).host.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export interface ComparableEntity {
  name?: unknown;
  surname?: unknown;
  firstName?: unknown;
  departments?: unknown;
  researchAreas?: unknown;
  methods?: unknown;
  websiteUrl?: unknown;
  embedding?: unknown;
  pi?: PiRoleLike[];
}

export interface EntityFeatureVector {
  nameJaroWinkler: number;
  nameTokenSetRatio: number;
  surnameMetaphoneMatch: boolean;
  firstNameCompatibility: FirstNameCompatibility;
  departmentJaccard: number;
  researchAreaJaccard: number;
  methodJaccard: number;
  hostMatch: boolean;
  embeddingCosine: number;
  piOverlap: number;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter((entry): entry is string => typeof entry === 'string');
  return [];
}

function asNumberArray(value: unknown): number[] {
  if (Array.isArray(value))
    return value.filter((entry): entry is number => typeof entry === 'number');
  return [];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function compareEntities(a: ComparableEntity, b: ComparableEntity): EntityFeatureVector {
  const nameA = asString(a.name);
  const nameB = asString(b.name);
  const surnameA = asString(a.surname) || tokenize(nameA).slice(-1)[0] || '';
  const surnameB = asString(b.surname) || tokenize(nameB).slice(-1)[0] || '';
  const metaA = metaphone(surnameA);
  const metaB = metaphone(surnameB);
  return {
    nameJaroWinkler: jaroWinkler(normalizeToken(nameA), normalizeToken(nameB)),
    nameTokenSetRatio: tokenSetRatio(nameA, nameB),
    surnameMetaphoneMatch: metaA !== '' && metaA === metaB,
    firstNameCompatibility: firstNameCompatibility(a.firstName ?? nameA, b.firstName ?? nameB),
    departmentJaccard: jaccard(asStringArray(a.departments), asStringArray(b.departments)),
    researchAreaJaccard: jaccard(asStringArray(a.researchAreas), asStringArray(b.researchAreas)),
    methodJaccard: jaccard(asStringArray(a.methods), asStringArray(b.methods)),
    hostMatch: hostOf(a.websiteUrl) !== '' && hostOf(a.websiteUrl) === hostOf(b.websiteUrl),
    embeddingCosine: cosine(asNumberArray(a.embedding), asNumberArray(b.embedding)),
    piOverlap: piOverlap(a.pi ?? [], b.pi ?? []),
  };
}
