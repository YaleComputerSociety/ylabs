export const DEFAULT_API_BASE = 'http://localhost:4000/api';
export const DEFAULT_APP_BASE = 'http://localhost:3000';

export const INTERNAL_LABELS = [
  'operator_review',
  'suppressed',
  'studentVisibilityTier',
  'Operator Board',
];

export const parseSmokeArgs = (argv) => {
  const args = new Map();
  const allowedArgs = new Set([
    'api-base',
    'app-base',
    'ui',
    'out',
    'opportunity-id',
    'cookie',
    'expect-commit',
  ]);
  const booleanArgs = new Set(['ui']);

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (raw === '--') continue;
    if (!raw.startsWith('--')) {
      throw new Error(`Unknown production promotion smoke argument: ${raw}`);
    }

    const [key, inlineValue] = raw.slice(2).split('=');
    if (!allowedArgs.has(key)) {
      throw new Error(`Unknown production promotion smoke argument: ${raw}`);
    }
    if (inlineValue !== undefined) {
      args.set(key, inlineValue);
    } else {
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        args.set(key, next);
        index += 1;
      } else if (booleanArgs.has(key)) {
        args.set(key, 'true');
      } else {
        throw new Error(`--${key} requires a value`);
      }
    }
  }
  return args;
};

export const parseSmokeConfig = (argv, env = process.env) => {
  const args = parseSmokeArgs(argv);

  return {
    apiBase: String(args.get('api-base') || env.SMOKE_API_BASE || DEFAULT_API_BASE).replace(/\/$/, ''),
    appBase: String(args.get('app-base') || env.SMOKE_APP_BASE || DEFAULT_APP_BASE).replace(/\/$/, ''),
    rawOutDir: String(args.get('out') || env.SMOKE_OUT_DIR || 'tmp/ui-smoke'),
    runUi: args.get('ui') !== 'false',
    explicitOpportunityId: args.get('opportunity-id') || env.SMOKE_OPPORTUNITY_ID || '',
    smokeCookie: String(args.get('cookie') || env.SMOKE_COOKIE || '').trim(),
    expectedCommit: String(args.get('expect-commit') || env.SMOKE_EXPECT_COMMIT || '').trim(),
  };
};

export const createSmokeReport = (config, now = new Date()) => ({
  generatedAt: now.toISOString(),
  apiBase: publicSmokeTargetUrl(config.apiBase),
  appBase: publicSmokeTargetUrl(config.appBase),
  mode: {
    writes: false,
    usesDevLogin: false,
    usesSmokeCookie: Boolean(config.smokeCookie),
    uiAuth: 'route-interception-only',
  },
  expected: {
    ...(config.expectedCommit ? { gitCommit: config.expectedCommit } : {}),
  },
  checks: [],
  discovered: {},
  artifacts: [],
  limitations: [],
});

const hasPlaceholderHost = (value) => /<host>/i.test(String(value));
const isAbsoluteHttpUrl = (value) => /^https?:\/\//i.test(String(value));
const urlHasCredentials = (value) => {
  try {
    const url = new URL(value);
    return Boolean(url.username || url.password);
  } catch {
    return false;
  }
};

const publicSmokeTargetUrl = (value) => {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return String(value || '');
  }
};

export const validateSmokeConfig = (config) => {
  const blockers = [];

  if (hasPlaceholderHost(config.apiBase)) {
    blockers.push('apiBase must replace the runbook placeholder <host> before smoke execution.');
  } else if (!isAbsoluteHttpUrl(config.apiBase)) {
    blockers.push('apiBase must be an absolute http(s) URL.');
  } else if (urlHasCredentials(config.apiBase)) {
    blockers.push('apiBase must not include username or password credentials.');
  }

  if (hasPlaceholderHost(config.appBase)) {
    blockers.push('appBase must replace the runbook placeholder <host> before smoke execution.');
  } else if (!isAbsoluteHttpUrl(config.appBase)) {
    blockers.push('appBase must be an absolute http(s) URL.');
  } else if (urlHasCredentials(config.appBase)) {
    blockers.push('appBase must not include username or password credentials.');
  }

  return blockers;
};

export const smokeBrowserOrigin = (appBase) => {
  try {
    return new URL(appBase).origin;
  } catch {
    return '';
  }
};

export const shouldSendSmokeOrigin = (method = 'GET') => {
  return !['GET', 'HEAD', 'OPTIONS'].includes(String(method).toUpperCase());
};

export const deploymentFingerprintCheck = (configJson, expectedCommit = '') => {
  const deployment = configJson?.deployment || {};
  const actualCommit = String(deployment.gitCommit || '').trim();
  const expected = String(expectedCommit || '').trim();
  const result = {
    expectedCommit: expected,
    actualCommit,
    provider: String(deployment.provider || ''),
    gitBranch: String(deployment.gitBranch || ''),
  };

  if (!expected) {
    return {
      status: actualCommit ? 'pass' : 'warn',
      ...result,
      ...(actualCommit ? {} : { reason: 'Deployment fingerprint is missing from /api/config.' }),
    };
  }

  if (!actualCommit) {
    return {
      status: 'fail',
      ...result,
      reason: 'Deployment fingerprint is missing from /api/config.',
    };
  }

  if (!actualCommit.startsWith(expected)) {
    return {
      status: 'fail',
      ...result,
      reason: 'Deployed commit does not match the expected commit.',
    };
  }

  return {
    status: 'pass',
    ...result,
  };
};

export const deploymentFingerprintCheckFromSmokeConfig = (smokeConfig, configJson) =>
  deploymentFingerprintCheck(configJson, smokeConfig?.expectedCommit || '');

const headerValue = (headers, name) => {
  if (!headers) return '';
  if (typeof headers.get === 'function') return String(headers.get(name) || '').trim();
  return String(headers[name] || headers[name.toLowerCase()] || '').trim();
};

export const buildSecurityHeaderChecks = (prefix, headers) => {
  const csp = headerValue(headers, 'content-security-policy');
  const permissionsPolicy = headerValue(headers, 'permissions-policy');
  const xFrameOptions = headerValue(headers, 'x-frame-options');
  const xContentTypeOptions = headerValue(headers, 'x-content-type-options');
  const referrerPolicy = headerValue(headers, 'referrer-policy');
  const crossOriginOpenerPolicy = headerValue(headers, 'cross-origin-opener-policy');
  const strictTransportSecurity = headerValue(headers, 'strict-transport-security');

  const checks = [
    {
      name: `${prefix}.contentSecurityPolicy`,
      status:
        csp.includes("default-src 'self'") &&
        csp.includes("object-src 'none'") &&
        csp.includes("frame-ancestors 'none'")
          ? 'pass'
          : 'fail',
      header: 'content-security-policy',
    },
    {
      name: `${prefix}.permissionsPolicy`,
      status:
        permissionsPolicy.includes('camera=()') &&
        permissionsPolicy.includes('microphone=()') &&
        permissionsPolicy.includes('geolocation=()')
          ? 'pass'
          : 'fail',
      header: 'permissions-policy',
    },
    {
      name: `${prefix}.xFrameOptions`,
      status: xFrameOptions.toUpperCase() === 'DENY' ? 'pass' : 'fail',
      header: 'x-frame-options',
    },
    {
      name: `${prefix}.xContentTypeOptions`,
      status: xContentTypeOptions.toLowerCase() === 'nosniff' ? 'pass' : 'fail',
      header: 'x-content-type-options',
    },
    {
      name: `${prefix}.referrerPolicy`,
      status: referrerPolicy.toLowerCase() === 'strict-origin-when-cross-origin' ? 'pass' : 'fail',
      header: 'referrer-policy',
    },
    {
      name: `${prefix}.crossOriginOpenerPolicy`,
      status: crossOriginOpenerPolicy.toLowerCase() === 'same-origin' ? 'pass' : 'fail',
      header: 'cross-origin-opener-policy',
    },
    {
      name: `${prefix}.strictTransportSecurity`,
      status: /^max-age=\d+/i.test(strictTransportSecurity) ? 'pass' : 'fail',
      header: 'strict-transport-security',
    },
  ];

  return checks.map((check) => ({
    ...check,
    present: Boolean(headerValue(headers, check.header)),
  }));
};

export const summarizeSmokeReport = (report, reportPath) => {
  const failures = report.checks
    .filter((check) => check.status === 'fail')
    .map((check) => check.name);
  const warnings = report.checks
    .filter((check) => check.status === 'warn')
    .map((check) => check.name);

  return {
    status: failures.length > 0 ? 'fail' : 'pass',
    failures,
    warnings,
    reportPath,
  };
};

export const containsInternalLabels = (value, options = {}) => {
  const haystack = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return INTERNAL_LABELS.filter((label) => {
    if (options.allowOperatorBoard && label === 'Operator Board') return false;
    return haystack.includes(label);
  });
};
