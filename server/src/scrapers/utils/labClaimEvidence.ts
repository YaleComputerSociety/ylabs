export interface PersonScopedResearchRecordIdentity {
  name: string;
  kind: 'lab' | 'individual';
  entityType: 'LAB' | 'FACULTY_RESEARCH_AREA';
}

const LAB_WORD_RE = /\b(?:lab|laboratory|research[-\s]?group|group)\b/;
const LAB_IN_URL_RE = /lab[./-]/;

/**
 * Whether the harvested text a lane is about to name a record from actually asserts
 * a lab, rather than merely naming a person a lane found on a page.
 *
 * One predicate for every lane, because the corpus otherwise gains a second
 * convention per lane: #3145 measured 364 rows a funding lane had named
 * "<person> Lab" on a grant record that asserts no organization, and the same
 * fabrication was live in an undergraduate-research lane that named every heading on
 * a department page a lab. A lane may name a lab only when its own evidence uses the
 * word, in the record's name or in the URL it links.
 */
export function evidenceAssertsALab(...evidence: Array<string | null | undefined>): boolean {
  const searchable = evidence
    .map((value) => String(value ?? ''))
    .join(' ')
    .toLowerCase();
  if (!searchable.trim()) return false;
  return LAB_WORD_RE.test(searchable) || LAB_IN_URL_RE.test(searchable);
}

/**
 * The name, kind and entity type a lane should emit for a person-scoped research
 * record, decided together off one lab-evidence verdict.
 *
 * The three travel together because emitting them separately is how a row ends up
 * internally inconsistent: the materializer derives `kind` from the observed-or-
 * stored `entityType` and discards an observed `kind`, so a lane that corrected the
 * name and left the type reads as fixed and serves a lab anyway.
 */
export function personScopedResearchRecordIdentity(
  personName: string,
  assertsALab: boolean,
): PersonScopedResearchRecordIdentity {
  const trimmed = personName.trim();
  return assertsALab
    ? { name: `${trimmed} Lab`, kind: 'lab', entityType: 'LAB' }
    : {
        name: `${trimmed} Faculty Research`,
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
      };
}
