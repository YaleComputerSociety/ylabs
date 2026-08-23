export interface DisambiguatableResearchEntity {
  name?: unknown;
  displayName?: unknown;
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

function titleText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function renderedTitle(entity: DisambiguatableResearchEntity): string {
  return titleText(entity.displayName) || titleText(entity.name);
}

export function disambiguateCollidingResearchEntityNames<T extends DisambiguatableResearchEntity>(
  entities: T[],
): T[] {
  const indicesByTitle = new Map<string, number[]>();
  entities.forEach((entity, index) => {
    const title = renderedTitle(entity);
    if (!title) return;
    const key = normalizedNameKey(title);
    const bucket = indicesByTitle.get(key);
    if (bucket) bucket.push(index);
    else indicesByTitle.set(key, [index]);
  });

  for (const indices of indicesByTitle.values()) {
    if (indices.length < 2) continue;

    for (const extractor of DISAMBIGUATOR_LABEL_EXTRACTORS) {
      const labels = indices.map((index) => extractor(entities[index]));
      if (labels.some((label) => !label)) continue;
      const decoratedTitles = indices.map(
        (index, position) => `${renderedTitle(entities[index])} (${labels[position]})`,
      );
      if (new Set(decoratedTitles).size !== indices.length) continue;
      indices.forEach((index, position) => {
        const entity = entities[index];
        const label = labels[position];
        if (titleText(entity.name)) entity.name = `${entity.name as string} (${label})`;
        if (titleText(entity.displayName)) {
          entity.displayName = `${entity.displayName as string} (${label})`;
        }
      });
      break;
    }
  }

  return entities;
}
