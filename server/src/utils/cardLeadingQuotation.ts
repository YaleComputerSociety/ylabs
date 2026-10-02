const CLOSING_ONLY_MARKS = new Set(['”', '’']);
const CURLY_OPENER_TO_CLOSER: Record<string, string> = { '“': '”', '‘': '’' };
const TERMINAL_PUNCTUATION = /[.!?]$/;
const LEADING_ELISION = /^’(?:\d|tis\b|twas\b)/i;
const MAX_LEADING_MARKS = 3;

function curlyCloserFollows(text: string, closer: string): boolean {
  for (let i = 1; i < text.length; i += 1) {
    if (text[i] !== closer) continue;
    const between = /\p{L}/u.test(text[i - 1] || '') && /\p{L}/u.test(text[i + 1] || '');
    if (!between) return true;
  }
  return false;
}

const CLOSES_A_QUOTED_SPAN = /[\s.,;:!?)\]]/;

function straightCloserFollows(text: string): boolean {
  for (let i = 1; i < text.length; i += 1) {
    if (text[i] !== '"') continue;
    const afterWord = !/\s/.test(text[i - 1]);
    const endsSpan = i + 1 === text.length || CLOSES_A_QUOTED_SPAN.test(text[i + 1]);
    if (afterWord && endsSpan) return true;
  }
  return false;
}

function withoutLeadingMark(text: string): string {
  return text.slice(1).trimStart();
}

function closeOrDropUnclosedOpener(text: string, closer: string): string {
  return TERMINAL_PUNCTUATION.test(text) ? `${text}${closer}` : withoutLeadingMark(text);
}

function repairOneLeadingMark(text: string): string {
  const first = text[0];
  if (CLOSING_ONLY_MARKS.has(first)) {
    return first === '’' && LEADING_ELISION.test(text) ? text : withoutLeadingMark(text);
  }
  const curlyCloser = CURLY_OPENER_TO_CLOSER[first];
  if (curlyCloser) {
    return curlyCloserFollows(text, curlyCloser)
      ? text
      : closeOrDropUnclosedOpener(text, curlyCloser);
  }
  if (first === '"') {
    if (/\s/.test(text[1] || '')) return withoutLeadingMark(text);
    return straightCloserFollows(text) ? text : closeOrDropUnclosedOpener(text, '"');
  }
  if (first === "'" && /\s/.test(text[1] || '')) return withoutLeadingMark(text);
  return text;
}

export function withBalancedLeadingQuotation(card: string): string {
  let text = card.trimStart();
  for (let step = 0; step < MAX_LEADING_MARKS; step += 1) {
    const repaired = repairOneLeadingMark(text);
    if (repaired === text) break;
    text = repaired;
  }
  return text === card.trimStart() ? card : text;
}
