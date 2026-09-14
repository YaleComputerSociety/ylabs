import { orgUnitMatchKey, sameOrgUnitMatchKey } from '../scrapers/orgUnitCanonicalization';

export const OFFICIAL_DEPARTMENT_INDEX_URL = 'https://www.yale.edu/academics/departments-programs';

/**
 * A unit whose catalog name drifted from the name Yale's official department
 * index publishes.
 *
 * The index is the naming authority here because the canonical name is what a
 * student reads: `research_entities.departments` stores the canonical name and
 * the browse department facet filters on the stored value, so a stale canonical
 * name is a stale facet label. Ours is the drifted side rather than the index
 * being ahead - `departmentRosterScraper`'s own `DEFAULT_DEPT_CONFIGS` already
 * spell several of these units the official way and get canonicalized back down
 * to the stale value at ingest, and the checked-in `departments.txt` snapshot of
 * this same index pairs the official spelling with the abbreviation.
 *
 * `priorName` is retained as an alias rather than dropped, so both already-stored
 * values and raw source strings keep resolving across the rename.
 *
 * `linkedUnit` is the destination the index links the entry to. It is required
 * exactly when the rename changes the normalized match key, because only then is
 * the retained alias load-bearing and only then does the claim "these two names
 * denote one unit" need evidence beyond punctuation. `officialDepartmentNames`
 * tests enforce that pairing in both directions.
 */
export interface OfficialDepartmentRename {
  officialName: string;
  priorName: string;
  linkedUnit?: string;
}

export const OFFICIAL_DEPARTMENT_RENAMES: readonly OfficialDepartmentRename[] = [
  {
    officialName: 'Astronomy',
    priorName: 'Astronomy & Astrophysics',
    linkedUnit: 'https://astronomy.yale.edu/',
  },
  {
    // BIOL is the pairing `departments.txt` records for this index entry, and
    // Yale has no FAS department named "Biology": the undergraduate biology
    // course prefix and the graduate umbrella share the code, and the umbrella
    // is what the index lists. Renaming keeps the one row rather than leaving a
    // non-official "Biology" facet value live beside a new one.
    officialName: 'Biological & Biomedical Sciences',
    priorName: 'Biology',
    linkedUnit: 'https://medicine.yale.edu/bbs/',
  },
  {
    officialName: 'Chemical & Environmental Engineering',
    priorName: 'Chemical Engineering',
    linkedUnit:
      'https://engineering.yale.edu/academic-study/departments/chemical-and-environmental-engineering',
  },
  {
    officialName: 'Electrical & Computer Engineering',
    priorName: 'Electrical Engineering',
    linkedUnit:
      'https://engineering.yale.edu/academic-study/departments/electrical-and-computer-engineering',
  },
  {
    officialName: 'German',
    priorName: 'German Studies',
    linkedUnit: 'https://german.yale.edu/',
  },
  {
    officialName: 'Mechanical Engineering & Materials Science',
    priorName: 'Mechanical Engineering',
    linkedUnit: 'https://engineering.yale.edu/academic-study/departments/mechanical-engineering',
  },
  {
    officialName: 'Ophthalmology & Visual Science',
    priorName: 'Ophthalmology',
    linkedUnit: 'https://medicine.yale.edu/eyes/',
  },
  {
    officialName: 'Spanish & Portuguese',
    priorName: 'Spanish',
    linkedUnit: 'https://span-port.yale.edu/',
  },
  {
    officialName: 'Therapeutic Radiology/Radiation Oncology',
    priorName: 'Therapeutic Radiology',
    linkedUnit: 'https://medicine.yale.edu/therapeuticradiology/',
  },
  { officialName: 'Earth & Planetary Sciences', priorName: 'Earth and Planetary Sciences' },
  {
    officialName: 'East Asian Languages & Literatures',
    priorName: 'East Asian Languages and Literatures',
  },
  {
    officialName: 'Ecology & Evolutionary Biology',
    priorName: 'Ecology and Evolutionary Biology',
  },
  { officialName: 'Engineering & Applied Science', priorName: 'Engineering and Applied Science' },
  { officialName: 'English Language & Literature', priorName: 'English Language and Literature' },
  { officialName: 'Ethnicity, Race, & Migration', priorName: 'Ethnicity, Race, and Migration' },
  { officialName: 'Film & Media Studies', priorName: 'Film and Media Studies' },
  { officialName: 'History of Science & Medicine', priorName: 'History of Science and Medicine' },
  {
    officialName: 'International & Development Economics',
    priorName: 'International and Development Economics',
  },
  {
    officialName: 'Molecular Biophysics & Biochemistry',
    priorName: 'Molecular Biophysics and Biochemistry',
  },
  {
    officialName: 'Molecular, Cellular & Developmental Biology',
    priorName: 'Molecular, Cellular, and Developmental Biology',
  },
  {
    officialName: 'Near Eastern Languages & Civilizations',
    priorName: 'Near Eastern Languages and Civilizations',
  },
  { officialName: 'Slavic Languages & Literatures', priorName: 'Slavic Languages and Literatures' },
  { officialName: 'Statistics & Data Science', priorName: 'Statistics and Data Science' },
  {
    officialName: 'Theater, Dance, & Performance Studies',
    priorName: 'Theater, Dance, and Performance Studies',
  },
  {
    officialName: "Women's, Gender, & Sexuality Studies",
    priorName: "Women's, Gender, and Sexuality Studies",
  },
];

export function renameChangesMatchKey(rename: OfficialDepartmentRename): boolean {
  return orgUnitMatchKey(rename.officialName) !== orgUnitMatchKey(rename.priorName);
}

/**
 * The alias list a row carries after adopting `officialName`: the prior name is
 * retained, the adopted name is never also an alias of itself, and the result is
 * unique case-insensitively. `org_units.aliases` enforces exactly that uniqueness
 * (`hasBoundedUniqueAliases`), and the apply path writes through `updateOne`, so
 * a list built any other way is written without the validator ever seeing it and
 * fails the next time something loads and saves that document.
 */
export function aliasesAfterAdoptingName(
  currentAliases: readonly string[],
  priorName: string,
  officialName: string,
): string[] {
  const candidates = [
    ...currentAliases.filter((alias) => !sameOrgUnitMatchKey(alias, officialName)),
    priorName,
  ];
  const aliases: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = candidate.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    aliases.push(candidate);
  }
  return aliases;
}

/**
 * Index entries the catalog deliberately does not rename to, each because the
 * official spelling would name a different unit than the row it would land on.
 * Recorded here so a later reader does not read the omission as an oversight.
 */
export const OFFICIAL_NAMES_DELIBERATELY_NOT_ADOPTED: readonly {
  officialName: string;
  keptName: string;
  reason: string;
}[] = [
  {
    officialName: 'European & Russian Studies',
    keptName: 'Russian, East European, and Eurasian Studies',
    reason:
      'The index links this entry to macmillan.yale.edu/europe, a MacMillan Center council, while the row is the degree-granting FAS department. Adopting the label would replace a department name with a programme name; it stays an alias.',
  },
  {
    officialName: 'Environment',
    keptName: 'Environmental Studies',
    reason:
      'The index links this entry to environment.yale.edu, the School of the Environment. A school is not a peer of a department (#1384), so the label moves onto the school row where the school-is-not-a-department rule drops it.',
  },
  {
    officialName: 'Neuroscience, Interdepartmental Program',
    keptName: 'Neuroscience',
    reason:
      'The index links this entry to medicine.yale.edu/inp, distinct from the Neuroscience department it also lists. No stored value cites the programme, so splitting it would publish an empty facet value; it stays an alias of the department.',
  },
];
