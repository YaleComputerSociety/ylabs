/**
 * Strip the Unicode format characters that render as nothing but split a word for
 * every pattern that reads it.
 *
 * A Yale CMS emits U+00AD SOFT HYPHEN as a hyphenation hint inside words, so
 * `Assistant Professor of Economics` is stored with breaks a human cannot see and
 * `/professor/i` cannot match: the row drops out of every title-keyed
 * classification silently, which is how plain faculty reached an "unclassified"
 * bucket while reading correctly on screen (#2874). Its siblings (zero-width
 * space, zero-width non-joiner, zero-width joiner, word joiner, byte-order mark)
 * arrive the same way from copy-pasted rich text.
 *
 * `replaceAsciiControls` does not cover them, because a format character is not a
 * control, and neither does a `\s+` collapse: in JavaScript `\s` matches U+00A0
 * and U+FEFF but none of the zero-width characters. The two classes are therefore
 * handled separately. A zero-width character has no width to preserve and is
 * removed; a no-break space is a real space and folds to a plain one, one character
 * for one, so no offset into the text moves and no stored evidence quote shifts
 * under it.
 *
 * U+200C and U+200D are removed only between two ASCII letters, unlike the rest of
 * the family. They are the two members that carry meaning elsewhere: U+200D joins
 * an emoji sequence into one glyph, and Persian, Hindi and Malayalam orthography
 * uses both to select ligature forms, so removing them unconditionally would
 * silently rewrite a native-script name or a description's emoji into something
 * else. Inside a Latin word they can only be the hyphenation-hint defect, which is
 * the case this strip exists for.
 *
 * Spelled as escapes deliberately: writing these characters literally would leave
 * this file unreadable in review and unsearchable by `rg`, which is the defect.
 * U+200D is matched outside a character class because a zero-width joiner inside
 * one reads as a joined grapheme (`no-misleading-character-class`).
 */
const ZERO_WIDTH_FORMAT_CHARACTERS = /[\u00ad\u200b\u2060\ufeff]/g;

const LATIN_WORD_INTERIOR_JOINERS = /(?<=[A-Za-z])(?:\u200c|\u200d)+(?=[A-Za-z])/g;

const NO_BREAK_SPACE_CHARACTERS = /[\u00a0\u202f]/g;

export const stripInvisibleFormatCharacters = (value: string): string =>
  value
    .replace(ZERO_WIDTH_FORMAT_CHARACTERS, '')
    .replace(LATIN_WORD_INTERIOR_JOINERS, '')
    .replace(NO_BREAK_SPACE_CHARACTERS, ' ');
