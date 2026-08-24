import { useMemo, useState } from 'react';
import type { ResearchFieldDirectoryDomain } from '../../utils/researchFieldDirectory';

interface ResearchFieldDirectoryProps {
  domains: ResearchFieldDirectoryDomain[];
  selectedAreas: string[];
  onSelectArea: (area: string) => void;
  onSelectField?: (field: string) => void;
  initialAreasPerDomain?: number;
}

const DEFAULT_AREAS_PER_DOMAIN = 8;

const colorKeyToDotClass: Record<string, string> = {
  blue: 'bg-blue-500',
  green: 'bg-green-500',
  yellow: 'bg-yellow-500',
  red: 'bg-red-500',
  purple: 'bg-purple-500',
  pink: 'bg-pink-500',
  teal: 'bg-teal-500',
  orange: 'bg-orange-500',
  indigo: 'bg-indigo-500',
  gray: 'bg-slate-400',
};

const pluralizeAreas = (count: number): string =>
  `${count} ${count === 1 ? 'area' : 'areas'}`;

const ResearchFieldDirectory = ({
  domains,
  selectedAreas,
  onSelectArea,
  onSelectField,
  initialAreasPerDomain = DEFAULT_AREAS_PER_DOMAIN,
}: ResearchFieldDirectoryProps) => {
  const [expandedFields, setExpandedFields] = useState<Set<string>>(() => new Set());
  const selectedAreaSet = useMemo(
    () => new Set(selectedAreas.map((area) => area.toLowerCase())),
    [selectedAreas],
  );

  if (domains.length === 0) return null;

  const toggleExpanded = (field: string) =>
    setExpandedFields((current) => {
      const next = new Set(current);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });

  return (
    <section aria-labelledby="research-field-directory-heading" className="min-w-0">
      <div className="mb-3">
        <h2 id="research-field-directory-heading" className="yr-kicker">
          Browse by field
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Explore the landscape of Yale research by topic. Select a field to see its research
          homes.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {domains.map((domain) => {
          const isExpanded = expandedFields.has(domain.field);
          const visibleAreas = isExpanded
            ? domain.areas
            : domain.areas.slice(0, initialAreasPerDomain);
          const hiddenCount = domain.areas.length - visibleAreas.length;
          return (
            <div key={domain.field} className="yr-card min-w-0 rounded-md p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-950">
                  <span
                    aria-hidden="true"
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      colorKeyToDotClass[domain.colorKey] ?? colorKeyToDotClass.gray
                    }`}
                  />
                  {onSelectField ? (
                    <button
                      type="button"
                      onClick={() => onSelectField(domain.field)}
                      aria-label={`View the ${domain.field} field page`}
                      className="yr-focus-ring min-w-0 truncate rounded-sm text-left hover:text-blue-900 hover:underline"
                    >
                      {domain.field}
                    </button>
                  ) : (
                    <span className="min-w-0 truncate">{domain.field}</span>
                  )}
                </h3>
                <span className="shrink-0 text-xs text-slate-500">
                  {pluralizeAreas(domain.areas.length)}
                </span>
              </div>
              <ul className="mt-3 flex min-w-0 flex-wrap gap-2">
                {visibleAreas.map((area) => {
                  const isSelected = selectedAreaSet.has(area.name.toLowerCase());
                  return (
                    <li key={area.name} className="min-w-0">
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        aria-label={`Browse ${area.name}, ${area.count} research ${
                          area.count === 1 ? 'home' : 'homes'
                        }`}
                        onClick={() => onSelectArea(area.name)}
                        className={`yr-focus-ring inline-flex min-h-9 max-w-full min-w-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors ${
                          isSelected
                            ? 'border-blue-700 bg-[var(--yr-panel)] text-blue-900'
                            : 'border-[var(--yr-line)] bg-[var(--yr-panel)] text-slate-700 hover:bg-[var(--yr-panel-muted)]'
                        }`}
                      >
                        <span className="min-w-0 truncate">{area.name}</span>
                        <span aria-hidden="true" className="shrink-0 text-xs text-slate-500">
                          {area.count}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {domain.areas.length > initialAreasPerDomain && (
                <button
                  type="button"
                  onClick={() => toggleExpanded(domain.field)}
                  aria-expanded={isExpanded}
                  className="yr-focus-ring mt-2 inline-flex min-h-9 items-center rounded-md px-1 text-sm font-semibold text-blue-800 hover:text-blue-900"
                >
                  {isExpanded ? 'Show fewer' : `Show all ${domain.areas.length}`}
                  {!isExpanded && hiddenCount > 0 ? ` (+${hiddenCount})` : ''}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default ResearchFieldDirectory;
