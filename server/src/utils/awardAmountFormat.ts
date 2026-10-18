const AMOUNT = /(\$\s?)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{2})?(?!\d|,\d{3}|\.\d|%)/g;

const MIN_BARE_AMOUNT = 100;

const COUNT_NOUN_AFTER =
  /^\s*(?:weeks?|months?|years?|days?|hours?|awards?|students?|grants?|fellowships?|recipients?)\b/i;

const OTHER_CURRENCY = /[£€¥]|\b(?:USD|EUR|GBP|dollars?)\b/i;

const YEAR = /^(?:19|20)\d{2}$/;

const FIGURES_ONLY = /^\s*\$?\s?[\d,.]+(?:\s*[-–]\s*\$?\s?[\d,.]+)*\s*$/;

function readsAsBareDollars(digits: string, after: string, whole: string): boolean {
  if (Number(digits.replace(/,/g, '')) < MIN_BARE_AMOUNT) return false;
  if (COUNT_NOUN_AFTER.test(after)) return false;
  return !YEAR.test(digits) || FIGURES_ONLY.test(whole);
}

function wholeDollars(digits: string, cents: string | undefined): string | undefined {
  if (cents && cents !== '.00') return undefined;
  return Number(digits.replace(/,/g, '')).toLocaleString('en-US');
}

/**
 * An award amount as a student reads one (#5205): "Up to 500.00" and "Maximum award of
 * 7500" are served as "Up to $500" and "Maximum award of $7,500". A figure with cents
 * other than .00 is left as written, and so is a whole string that names another currency
 * or the word dollars ("£2,500", "1,000 USD"). A figure with no dollar sign is also left
 * as written when it is under 100, is followed by a count noun ("3 awards", "10 weeks"),
 * or is a 19xx/20xx year in a string that has words besides its figures.
 */
export function formatServedAwardAmount(value: unknown): unknown {
  if (typeof value !== 'string' || OTHER_CURRENCY.test(value)) return value;
  return value.replace(
    AMOUNT,
    (match, dollar: string | undefined, digits: string, cents, offset: number, whole: string) => {
      if (!dollar && !readsAsBareDollars(digits, whole.slice(offset + match.length), whole)) {
        return match;
      }
      const dollars = wholeDollars(digits, cents);
      return dollars === undefined ? match : `$${dollars}`;
    },
  );
}
