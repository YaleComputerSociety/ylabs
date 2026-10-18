const AMOUNT =
  /(\$\s?)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{2})?(?!\d|,\d{3}|\.\d|%|\s*(?:weeks?|months?|years?|days?|hours?|awards?|students?|grants?|fellowships?|recipients?|per\b))/g;

const MIN_BARE_AMOUNT = 100;

const YEAR = /^(?:19|20)\d{2}$/;

const YEAR_BEFORE =
  /(?:\b(?:in|for|the|fall|spring|summer|winter|academic|year|cycle|since|by|through|until)\s*|\b(?:19|20)\d{2}\s*[-\u2013/]\s*)$/i;

const YEAR_AFTER = /^\s*[-\u2013/]\s*(?:(?:19|20)\d{2}|\d{2})\b/;

function readsAsYear(digits: string, before: string, after: string): boolean {
  return YEAR.test(digits) && (YEAR_BEFORE.test(before) || YEAR_AFTER.test(after));
}

function wholeDollars(digits: string, cents: string | undefined): string | undefined {
  if (cents && cents !== '.00') return undefined;
  return Number(digits.replace(/,/g, '')).toLocaleString('en-US');
}

/**
 * An award amount as a student reads one (#5205): "Up to 500.00" and "Maximum award of
 * 7500" are served as "Up to $500" and "Maximum award of $7,500". A figure with cents
 * other than .00, a number under 100 with no dollar sign, and a number followed by a
 * count noun ("3 awards", "10 weeks") are left as written.
 */
export function formatServedAwardAmount(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.replace(
    AMOUNT,
    (match, dollar: string | undefined, digits: string, cents, offset: number, whole: string) => {
      const amount = Number(digits.replace(/,/g, ''));
      if (!dollar && amount < MIN_BARE_AMOUNT) return match;
      if (
        !dollar &&
        readsAsYear(digits, whole.slice(0, offset), whole.slice(offset + match.length))
      ) {
        return match;
      }
      const dollars = wholeDollars(digits, cents);
      return dollars === undefined ? match : `$${dollars}`;
    },
  );
}
