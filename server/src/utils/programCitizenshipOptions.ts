import {
  NON_US_CITIZENS_ELIGIBLE,
  US_CITIZENS_ELIGIBLE,
  US_PERMANENT_RESIDENTS_ELIGIBLE,
} from '../scrapers/utils/programCitizenship';

type StatementSet = readonly string[];

// A program stated open to non-U.S. citizens alone does not satisfy the permanent-resident
// option: "international students only" programs commonly exclude permanent residents, so
// only a program stated open to both U.S. and non-U.S. citizens joins the literal value
// (#6092). Changing this map also requires updating docs/decisions.md.
const CITIZENSHIP_OPTION_STATEMENT_SETS: Readonly<Record<string, readonly StatementSet[]>> = {
  [US_PERMANENT_RESIDENTS_ELIGIBLE]: [
    [US_PERMANENT_RESIDENTS_ELIGIBLE],
    [US_CITIZENS_ELIGIBLE, NON_US_CITIZENS_ELIGIBLE],
  ],
};

export const citizenshipOptionStatementSets = (option: string): readonly StatementSet[] =>
  CITIZENSHIP_OPTION_STATEMENT_SETS[option] ?? [[option]];

export const programSatisfiesCitizenshipOption = (
  citizenshipStatus: readonly unknown[] | null | undefined,
  option: string,
): boolean => {
  const stated = new Set(citizenshipStatus ?? []);
  return citizenshipOptionStatementSets(option).some((set) =>
    set.every((value) => stated.has(value)),
  );
};

export const citizenshipStatesOptionsClause = (field: string, options: readonly string[]) => {
  const sets = options.flatMap(citizenshipOptionStatementSets);
  return sets.length === 0
    ? { [field]: { $in: [] } }
    : { $or: sets.map((set) => ({ [field]: { $all: [...set] } })) };
};
