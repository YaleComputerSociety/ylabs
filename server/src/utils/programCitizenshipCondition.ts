const HOME_COUNTRY =
  /\b(?:home countr(?:y|ies)|country of origin|countries of origin|their own countr(?:y|ies))\b/i;

const INTERNATIONAL_GROUP = /\b(?:international|non-u\.?\s?s\.?|foreign)\b/i;

const ELIGIBILITY_TERM =
  /\b(?:(?:in|not )?eligible|may not|cannot|not permitted|not normally given|are not funded)\b/i;

function sentencesOf(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[a-z0-9)][.!?])\s*(?=[A-Z])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/**
 * The program's own sentence that conditions eligibility for international students on
 * where they would do the research, so the citizenship answer is served beside it (#5235).
 */
export function programCitizenshipCondition(prose: readonly unknown[]): string | undefined {
  for (const text of prose) {
    if (typeof text !== 'string') continue;
    const sentence = sentencesOf(text).find(
      (candidate) =>
        HOME_COUNTRY.test(candidate) &&
        INTERNATIONAL_GROUP.test(candidate) &&
        ELIGIBILITY_TERM.test(candidate),
    );
    if (sentence) return sentence;
  }
  return undefined;
}
