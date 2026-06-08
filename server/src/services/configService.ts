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
      aliases: string[];
      categories: string[];
      primaryCategory: string;
      colorKey: number;
    }>;
    categories: string[];
  };
  deployment: {
    provider: 'render' | 'unknown';
    gitCommit: string;
    gitBranch: string;
  };
  timestamp: string;
}

type DeploymentFingerprint = ConfigData['deployment'];

type DeploymentEnvKey =
  | 'RENDER'
  | 'RENDER_GIT_COMMIT'
  | 'RENDER_GIT_BRANCH'
  | 'GIT_COMMIT'
  | 'GIT_BRANCH'
  | 'SOURCE_VERSION'
  | 'COMMIT_SHA'
  | 'VERCEL_GIT_COMMIT_SHA'
  | 'VERCEL_GIT_COMMIT_REF';

type DeploymentEnv = Partial<Record<DeploymentEnvKey, string | undefined>> & {
  [key: string]: string | undefined;
};

const normalizePublicText = (value: unknown): string =>
  String(value || '')
    .trim()
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 160);

const normalizeCommitSha = (value: unknown): string => {
  const normalized = normalizePublicText(value);
  return /^[a-f0-9]{7,64}$/i.test(normalized) ? normalized : '';
};

export const buildDeploymentFingerprint = (
  env: DeploymentEnv = process.env,
): DeploymentFingerprint => ({
  provider: env.RENDER === 'true' ? 'render' : 'unknown',
  gitCommit: normalizeCommitSha(
    env.RENDER_GIT_COMMIT ||
      env.GIT_COMMIT ||
      env.SOURCE_VERSION ||
      env.COMMIT_SHA ||
      env.VERCEL_GIT_COMMIT_SHA,
  ),
  gitBranch: normalizePublicText(
    env.RENDER_GIT_BRANCH || env.GIT_BRANCH || env.VERCEL_GIT_COMMIT_REF,
  ),
});

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
        name: area.name,
        field: area.field,
        colorKey: area.colorKey || fieldColorKeys[area.field as ResearchField] || 'gray',
        isDefault: area.isDefault || false,
      })),
      fields,
      fieldOrder: Object.values(ResearchField),
    },
    departments: {
      list: departments.map((dept: any) => ({
        abbreviation: dept.abbreviation,
        name: dept.name,
        displayName: dept.displayName,
        aliases: dept.aliases || [],
        categories: dept.categories,
        primaryCategory: dept.primaryCategory,
        colorKey: dept.colorKey,
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
