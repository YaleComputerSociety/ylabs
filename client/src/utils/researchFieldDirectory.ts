export interface ResearchFieldDirectoryAreaOption {
  value: string;
  count?: number;
}

export interface ResearchFieldDirectoryArea {
  name: string;
  count: number;
}

export interface ResearchFieldDirectoryDomain {
  field: string;
  colorKey: string;
  areas: ResearchFieldDirectoryArea[];
}

interface BuildResearchFieldDirectoryInput {
  areaOptions: ResearchFieldDirectoryAreaOption[];
  fieldForArea: (name: string) => string | undefined;
  fieldOrder: string[];
  colorKeyForField: (field: string) => string | undefined;
}

const orderIndex = (fieldOrder: string[], field: string): number => {
  const index = fieldOrder.indexOf(field);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

export const buildResearchFieldDirectory = ({
  areaOptions,
  fieldForArea,
  fieldOrder,
  colorKeyForField,
}: BuildResearchFieldDirectoryInput): ResearchFieldDirectoryDomain[] => {
  const domainsByField = new Map<string, ResearchFieldDirectoryDomain>();

  for (const option of areaOptions) {
    const name = option.value.trim();
    if (!name) continue;
    const count = option.count ?? 0;
    if (!Number.isFinite(count) || count <= 0) continue;
    const field = fieldForArea(name)?.trim();
    if (!field) continue;

    const existing = domainsByField.get(field);
    if (existing) {
      existing.areas.push({ name, count });
    } else {
      domainsByField.set(field, {
        field,
        colorKey: colorKeyForField(field)?.trim() || 'gray',
        areas: [{ name, count }],
      });
    }
  }

  return Array.from(domainsByField.values())
    .map((domain) => ({
      ...domain,
      areas: domain.areas.sort(
        (a, b) => b.count - a.count || a.name.localeCompare(b.name),
      ),
    }))
    .sort((a, b) => {
      const orderDiff = orderIndex(fieldOrder, a.field) - orderIndex(fieldOrder, b.field);
      if (orderDiff !== 0) return orderDiff;
      return a.field.localeCompare(b.field);
    });
};
