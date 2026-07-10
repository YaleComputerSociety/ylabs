/**
 * Configuration service providing departments and research areas with caching.
 */
import { ResearchArea, ResearchField, fieldColorKeys } from '../models/researchArea';
import { Department, DepartmentCategory } from '../models/department';
import { redactDirectContactInfo } from '../utils/contactRedaction';

let configCache: ConfigData | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 5 * 60 * 1000;
const MAX_PUBLIC_CONFIG_TEXT_LENGTH = 160;
const MAX_PUBLIC_CONFIG_ALIAS_COUNT = 25;
const MAX_PUBLIC_CONFIG_ALIAS_LENGTH = 120;
const MAX_PUBLIC_CONFIG_COLOR_KEY = 8;

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
      aliases: string[];
      categories: string[];
      primaryCategory: string;
      colorKey: number;
    }>;
    categories: string[];
  };
  deployment: {
    provider: 'render' | 'unknown';
  };
  timestamp: string;
}

type DeploymentFingerprint = ConfigData['deployment'];

type DeploymentEnvKey = 'RENDER';

type DeploymentEnv = Partial<Record<DeploymentEnvKey, string | undefined>> & {
  [key: string]: string | undefined;
};

export const buildDeploymentFingerprint = (
  env: DeploymentEnv = process.env,
): DeploymentFingerprint => ({
  provider: env.RENDER === 'true' ? 'render' : 'unknown',
});

const publicConfigText = (
  value: unknown,
  maxLength: number = MAX_PUBLIC_CONFIG_TEXT_LENGTH,
): string => {
  const text = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
  return redactDirectContactInfo(text).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
};

const publicConfigTextArray = (
  values: unknown,
  maxItems: number,
  maxLength: number,
): string[] => {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .slice(0, maxItems)
        .map((value) => publicConfigText(value, maxLength))
        .filter(Boolean),
    ),
  );
};

const publicDepartmentCategories = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];
  const allowed = new Set<string>(Object.values(DepartmentCategory));
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && allowed.has(value))));
};

const publicDepartmentColorKey = (value: unknown): number => {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_PUBLIC_CONFIG_COLOR_KEY ? value : 0;
};

const publicResearchAreaColorKey = (value: unknown, fallback: unknown): string => {
  const allowed = new Set([...Object.values(fieldColorKeys), 'gray']);
  const color = publicConfigText(value, 20);
  const fallbackColor = publicConfigText(fallback, 20);
  if (allowed.has(color)) return color;
  if (allowed.has(fallbackColor)) return fallbackColor;
  return 'gray';
};

export const getConfig = async (
  forceRefresh: boolean = false,
  env: DeploymentEnv = process.env,
): Promise<ConfigData> => {
  const now = Date.now();

  if (!forceRefresh && configCache && now - cacheTimestamp < CACHE_TTL) {
    return configCache;
  }

  const [researchAreas, departments] = await Promise.all([
    ResearchArea.find().select('name field colorKey isDefault').lean(),
    Department.find({ isActive: true }).select('-__v -createdAt -updatedAt').lean(),
  ]);

  const fields: Array<{ name: string; colorKey: string }> = Object.values(ResearchField).map(
    (field) => ({
      name: field as string,
      colorKey: fieldColorKeys[field],
    }),
  );

  const config: ConfigData = {
    researchAreas: {
      areas: researchAreas.map((area: any) => ({
        name: publicConfigText(area.name),
        field: publicConfigText(area.field),
        colorKey: publicResearchAreaColorKey(area.colorKey, fieldColorKeys[area.field as ResearchField]),
        isDefault: area.isDefault || false,
      })),
      fields,
      fieldOrder: Object.values(ResearchField),
    },
    departments: {
      list: departments.map((dept: any) => ({
        abbreviation: publicConfigText(dept.abbreviation, MAX_PUBLIC_CONFIG_ALIAS_LENGTH),
        name: publicConfigText(dept.name),
        displayName: publicConfigText(dept.displayName),
        aliases: publicConfigTextArray(
          dept.aliases,
          MAX_PUBLIC_CONFIG_ALIAS_COUNT,
          MAX_PUBLIC_CONFIG_ALIAS_LENGTH,
        ),
        categories: publicDepartmentCategories(dept.categories),
        primaryCategory: publicDepartmentCategories([dept.primaryCategory])[0] || DepartmentCategory.COMPUTING_AI,
        colorKey: publicDepartmentColorKey(dept.colorKey),
      })),
      categories: Object.values(DepartmentCategory),
    },
    deployment: buildDeploymentFingerprint(env),
    timestamp: new Date().toISOString(),
  };

  configCache = config;
  cacheTimestamp = now;

  return config;
};

export const invalidateConfigCache = (): void => {
  configCache = null;
  cacheTimestamp = 0;
};
