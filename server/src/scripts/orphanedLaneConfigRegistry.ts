import {
  DEFAULT_DEPT_CONFIGS,
  DepartmentRosterScraper,
  namespacedDeptKey,
} from '../scrapers/sources/departmentRosterScraper';
import {
  DEFAULT_YALE_RESEARCH_DIRECTORY_CONFIGS,
  YaleResearchOfficialScraper,
} from '../scrapers/sources/yaleResearchOfficialScraper';
import type { OrphanLaneDefinition } from './retireOrphanedLaneConfigsCore';

const lowerUnique = (values: readonly string[]) => [
  ...new Set(values.map((value) => value.trim().toLowerCase())),
];

export function orphanedLaneConfigRegistry(): OrphanLaneDefinition[] {
  return [
    {
      sourceName: new DepartmentRosterScraper().name,
      currentConfigIds: lowerUnique(DEFAULT_DEPT_CONFIGS.map((config) => config.deptKey)),
      currentKeyNamespaces: lowerUnique(
        DEFAULT_DEPT_CONFIGS.map((config) => namespacedDeptKey(config.deptKey)),
      ),
      keyNamespaceOf: (configId) => namespacedDeptKey(configId),
    },
    {
      sourceName: new YaleResearchOfficialScraper().name,
      currentConfigIds: lowerUnique(DEFAULT_YALE_RESEARCH_DIRECTORY_CONFIGS.map((c) => c.key)),
      currentKeyNamespaces: [],
    },
  ];
}
