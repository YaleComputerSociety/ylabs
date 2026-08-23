export interface DisambiguatableResearchEntity {
  name?: unknown;
  departments?: unknown;
  school?: unknown;
  schools?: unknown;
}

function normalizedNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function firstNonEmptyString(value: unknown): string {
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = firstNonEmptyString(item);
      if (text) return text;
    }
    return '';
  }
  return typeof value === 'string' ? value.trim() : '';
}

function departmentLabel(entity: DisambiguatableResearchEntity): string {
  return firstNonEmptyString(entity.departments);
}

function schoolLabel(entity: DisambiguatableResearchEntity): string {
  return firstNonEmptyString(entity.school) || firstNonEmptyString(entity.schools);
}

const DISAMBIGUATOR_LABEL_EXTRACTORS = [departmentLabel, schoolLabel] as const;

function decoratedName(name: string, label: string): string {
  return `${name} (${label})`;
}

export function disambiguateCollidingResearchEntityNames<T extends DisambiguatableResearchEntity>(
  entities: T[],
): T[] {
  const indicesByName = new Map<string, number[]>();
  entities.forEach((entity, index) => {
    const name = typeof entity.name === 'string' ? entity.name : '';
    if (!name.trim()) return;
    const key = normalizedNameKey(name);
    const bucket = indicesByName.get(key);
    if (bucket) bucket.push(index);
    else indicesByName.set(key, [index]);
  });

  for (const indices of indicesByName.values()) {
    if (indices.length < 2) continue;

    for (const extractor of DISAMBIGUATOR_LABEL_EXTRACTORS) {
      const decorated = indices.map((index) => {
        const label = extractor(entities[index]);
        return label ? decoratedName(entities[index].name as string, label) : '';
      });
      if (decorated.some((value) => value === '')) continue;
      if (new Set(decorated).size !== indices.length) continue;
      indices.forEach((index, position) => {
        entities[index].name = decorated[position];
      });
      break;
    }
  }

  return entities;
}
