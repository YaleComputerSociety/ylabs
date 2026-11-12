/**
 * The one list of academic and professional credentials a name or a profile slug can carry
 * after the person's name (#5969). A roster's name normalizer and the profile-slug identity
 * both strip these, so a credential missing here is missed by both, never by one only.
 *
 * Tokens are compact: lower case with dots, spaces and hyphens removed, so "Ph.D.", "PhD"
 * and "ph-d" are one token, and a board-certified compound such as "FNP-C" or "RN-BC" is one
 * token too, which is the only way a profile slug's trailing "-c" or "-bc" is stripped.
 * Changing this list changes the key a roster mints from a name, so it also needs a frozen
 * copy of the old list in `ROSTER_NAME_NORMALIZER_LEGACY_TOKENS` for key continuity.
 */
export const DEGREE_TOKENS: ReadonlySet<string> = new Set([
  'phd',
  'md',
  'mph',
  'mphs',
  'jd',
  'scd',
  'dphil',
  'drph',
  'edd',
  'pharmd',
  'mscr',
  'msc',
  'ms',
  'ma',
  'mba',
  'mhs',
  'mha',
  'mphil',
  'mfa',
  'mls',
  'lmsw',
  'lmft',
  'esq',
  'dvm',
  'dds',
  'do',
  'rn',
  'rnbc',
  'bs',
  'ba',
  'bsc',
  'bse',
  'bsn',
  'msn',
  'dnp',
  'aprn',
  'aprnbc',
  'fnp',
  'fnpc',
  'fnpbc',
  'np',
  'npc',
  'anp',
  'anpc',
  'anpbc',
  'pnp',
  'pnpbc',
  'pmhnp',
  'pmhnpbc',
  'agpcnp',
  'agpcnpbc',
  'agacnp',
  'agacnpbc',
  'agnp',
  'agnpc',
  'agnpbc',
  'whnp',
  'whnpbc',
  'nnp',
  'nnpbc',
  'cnm',
  'cnmbc',
  'cns',
  'crna',
  'ccrn',
  'achpn',
  'fpcn',
  'faan',
  'faha',
  'faanp',
  'faap',
  'facp',
]);

export const GENERATIONAL_SUFFIX_TOKENS: ReadonlySet<string> = new Set([
  'jr',
  'sr',
  'ii',
  'iii',
  'iv',
]);

export function compactCredential(text: string | undefined | null): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[.\s-]+/g, '');
}

export function isDegreeToken(
  text: string | undefined | null,
  tokens: ReadonlySet<string> = DEGREE_TOKENS,
): boolean {
  const compact = compactCredential(text);
  return compact.length > 0 && tokens.has(compact);
}

/**
 * Version 1 of the roster name normalizer's credential list, frozen. A roster row's key was
 * minted from the name this list produced, so the lane derives the version 1 key to find a
 * row a later list change would otherwise strand under its old key. It is also the default
 * of the shared `normalizeName`, so every other lane keeps deriving the keys it minted.
 */
export const ROSTER_NAME_NORMALIZER_LEGACY_TOKENS: Readonly<Record<'v1', ReadonlySet<string>>> =
  Object.freeze({
    v1: new Set([
      'phd',
      'md',
      'mphs',
      'mph',
      'jd',
      'scd',
      'dphil',
      'drph',
      'edd',
      'pharmd',
      'mscr',
      'msc',
      'ms',
      'ma',
      'mba',
      'mhs',
      'mha',
      'mphil',
      'mfa',
      'mls',
      'lmsw',
      'lmft',
      'esq',
    ]),
  });
