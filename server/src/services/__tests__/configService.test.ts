import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  departmentFind: vi.fn(),
  researchAreaFind: vi.fn(),
}));

vi.mock('../../models/department', () => ({
  Department: {
    find: mocks.departmentFind,
  },
  DepartmentCategory: {
    COMPUTING_AI: 'Computing & AI',
  },
}));

vi.mock('../../models/researchArea', () => ({
  ResearchArea: {
    find: mocks.researchAreaFind,
  },
  ResearchField: {
    COMPUTING: 'Computing',
  },
  fieldColorKeys: {
    Computing: 'blue',
  },
}));

import { buildDeploymentFingerprint, getConfig, invalidateConfigCache } from '../configService';

const leanChain = (value: unknown) => {
  const chain = {
    select: vi.fn(),
    lean: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.lean.mockResolvedValue(value);
  return chain;
};

describe('configService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateConfigCache();
    mocks.researchAreaFind.mockReturnValue(leanChain([]));
  });

  it('includes department aliases in the public config payload', async () => {
    mocks.departmentFind.mockReturnValue(
      leanChain([
        {
          abbreviation: 'CPSC',
          name: 'Computer Science',
          displayName: 'CPSC - Computer Science',
          aliases: ['EASCPS Computer Science'],
          categories: ['Computing & AI'],
          primaryCategory: 'Computing & AI',
          colorKey: 0,
        },
      ]),
    );

    const config = await getConfig(true);

    expect(config.departments.list).toEqual([
      {
        abbreviation: 'CPSC',
        name: 'Computer Science',
        displayName: 'CPSC - Computer Science',
        aliases: ['EASCPS Computer Science'],
        categories: ['Computing & AI'],
        primaryCategory: 'Computing & AI',
        colorKey: 0,
      },
    ]);
  });

  it('exposes only the coarse deployment provider without leaking source or env values', () => {
    const fingerprint = buildDeploymentFingerprint({
      RENDER: 'true',
      RENDER_GIT_COMMIT: '852f4a05355bb17dbfce9d1197f4693ddf2ccb2a',
      RENDER_GIT_BRANCH: 'beta',
      RENDER_SERVICE_ID: 'srv-private-id',
      SESSION_SECRET: 'do-not-expose',
    });

    expect(fingerprint).toEqual({
      provider: 'render',
    });
    expect(JSON.stringify(fingerprint)).not.toContain('852f4a05355bb17dbfce9d1197f4693ddf2ccb2a');
    expect(JSON.stringify(fingerprint)).not.toContain('beta');
    expect(JSON.stringify(fingerprint)).not.toContain('srv-private-id');
    expect(JSON.stringify(fingerprint)).not.toContain('do-not-expose');
  });

  it('adds only the coarse deployment provider to the public config payload', async () => {
    mocks.departmentFind.mockReturnValue(leanChain([]));

    const config = await getConfig(true, {
      RENDER: 'true',
      RENDER_GIT_COMMIT: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      RENDER_GIT_BRANCH: 'main',
    });

    expect(config.deployment).toEqual({
      provider: 'render',
    });
    expect(JSON.stringify(config.deployment)).not.toContain('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(JSON.stringify(config.deployment)).not.toContain('main');
  });
});
