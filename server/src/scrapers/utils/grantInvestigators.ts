export interface GrantInvestigator {
  contact: boolean;
  researcherId?: string;
  profileId?: number;
}

export type GrantLeadRole = 'pi' | 'copi';

type GrantEntry = Record<string, unknown>;

const isPlainObject = (value: unknown): value is GrantEntry =>
  !!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

function investigatorResearcherId(value: unknown): string | undefined {
  const id = isPlainObject(value) ? value.researcherId : undefined;
  return typeof id === 'string' && id.trim() ? id.trim() : undefined;
}

export function creditedGrantInvestigator(
  researcherId: string,
  contact: boolean,
): GrantInvestigator {
  return { contact, researcherId };
}

export function mergeGrantInvestigators(
  ...lists: ReadonlyArray<readonly GrantInvestigator[] | undefined>
): GrantInvestigator[] {
  const merged: GrantInvestigator[] = [];
  const keyOf = (investigator: GrantInvestigator): string | undefined =>
    investigator.researcherId
      ? `researcher:${investigator.researcherId}`
      : typeof investigator.profileId === 'number'
        ? `profile:${investigator.profileId}`
        : undefined;
  const byKey = new Map<string, GrantInvestigator>();
  for (const investigator of lists.flatMap((list) => list ?? [])) {
    const key = keyOf(investigator);
    const held = key ? byKey.get(key) : undefined;
    if (held) {
      held.contact = held.contact || investigator.contact;
      if (held.profileId === undefined && investigator.profileId !== undefined) {
        held.profileId = investigator.profileId;
      }
      continue;
    }
    const copy = { ...investigator };
    if (key) byKey.set(key, copy);
    merged.push(copy);
  }
  return merged;
}

export function recordedGrantInvestigators(entry: unknown): unknown[] | undefined {
  if (!isPlainObject(entry)) return undefined;
  return Array.isArray(entry.investigators) ? entry.investigators : undefined;
}

export function grantRoleForLeads(
  investigators: readonly unknown[],
  leadPersonIds: ReadonlySet<string>,
): GrantLeadRole | undefined {
  let role: GrantLeadRole | undefined;
  for (const investigator of investigators) {
    const researcherId = investigatorResearcherId(investigator);
    if (!researcherId || !leadPersonIds.has(researcherId)) continue;
    if (isPlainObject(investigator) && investigator.contact === true) return 'pi';
    role = 'copi';
  }
  return role;
}

export type GrantEntryDerivation =
  | { outcome: 'labelled'; entry: GrantEntry; role: GrantLeadRole }
  | { outcome: 'held'; entry: GrantEntry }
  | { outcome: 'withheld' };

function withoutInvestigatorsOrRole(entry: GrantEntry): GrantEntry {
  const { investigators: _investigators, role: _role, ...rest } = entry;
  return rest;
}

// An entry written before lanes recorded investigators is held without a role rather
// than defaulted to `pi`: dropping it would empty every funded row until all six grant
// lanes re-read, and the next read replaces it with a listed entry (#5779).
export function deriveGrantEntryForLeads(
  entry: unknown,
  leadPersonIds: ReadonlySet<string>,
  { carriesRole }: { carriesRole: boolean },
): GrantEntryDerivation {
  if (!isPlainObject(entry)) return { outcome: 'withheld' };
  const investigators = recordedGrantInvestigators(entry);
  const stripped = withoutInvestigatorsOrRole(entry);
  if (!investigators) return { outcome: 'held', entry: stripped };
  const role = grantRoleForLeads(investigators, leadPersonIds);
  if (!role) return { outcome: 'withheld' };
  return { outcome: 'labelled', role, entry: carriesRole ? { ...stripped, role } : stripped };
}

export function withCreditedInvestigator<T extends object>(
  record: T,
  researcherId: string | undefined,
  contact = true,
): T & { investigators?: GrantInvestigator[] } {
  return researcherId
    ? { ...record, investigators: [creditedGrantInvestigator(researcherId, contact)] }
    : record;
}

export function withInvestigatorsUnioned<T extends { investigators?: GrantInvestigator[] }>(
  kept: T,
  other: T,
): T {
  if (!kept.investigators && !other.investigators) return kept;
  return {
    ...kept,
    investigators: mergeGrantInvestigators(kept.investigators, other.investigators),
  };
}
