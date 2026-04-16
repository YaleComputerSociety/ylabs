/**
 * Configuration service providing departments and research areas with caching.
 */
import { ResearchArea, ResearchField, fieldColorKeys } from '../models/researchArea';
import { Department, DepartmentCategory } from '../models/department';

let configCache: ConfigData | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 5 * 60 * 1000;

export interface ConfigData {
  researchAreas: {
    areas: Array<{
      name: string;
      field: string;
      colorKey: string;
      isDefault: boolean;
    }>;
    fields: Array<{
      name: string;
      colorKey: string;
    }>;
    fieldOrder: string[];
  };
  departments: {
    list: Array<{
      abbreviation: string;
      name: string;
      displayName: string;
      categories: string[];
      primaryCategory: string;
      colorKey: number;
    }>;
    categories: string[];
  };
  timestamp: string;
}

export const getConfig = async (forceRefresh: boolean = false): Promise<ConfigData> => {
  const now = Date.now();

  if (!forceRefresh && configCache && (now - cacheTimestamp) < CACHE_TTL) {
    return configCache;
  }

  const [researchAreas, departments] = await Promise.all([
    ResearchArea.find().select('name field colorKey isDefault').lean(),
    Department.find({ isActive: true }).select('-__v -createdAt -updatedAt').lean()
  ]);

  const fields: Array<{ name: string; colorKey: string }> = Object.values(ResearchField).map(field => ({
    name: field as string,
    colorKey: fieldColorKeys[field]
  }));

  const config: ConfigData = {
    researchAreas: {
      areas: researchAreas.map((area: any) => ({
        name: area.name,
        field: area.field,
        colorKey: area.colorKey || fieldColorKeys[area.field as ResearchField] || 'gray',
        isDefault: area.isDefault || false
      })),
      fields,
      fieldOrder: Object.values(ResearchField)
    },
    departments: {
      list: departments.map((dept: any) => ({
        abbreviation: dept.abbreviation,
        name: dept.name,
        displayName: dept.displayName,
        categories: dept.categories,
        primaryCategory: dept.primaryCategory,
        colorKey: dept.colorKey
      })),
      categories: Object.values(DepartmentCategory)
    },
    timestamp: new Date().toISOString()
  };

  configCache = config;
  cacheTimestamp = now;

  return config;
};

export const invalidateConfigCache = (): void => {
  configCache = null;
  cacheTimestamp = 0;
};
