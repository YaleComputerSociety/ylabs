import nodeAssert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import {
  ORCID_PATTERN,
  orcidIsUnsafeForFixtures,
  SYNTHETIC_ORCID_EXAMPLE,
} from './orcidFixtureShape.mjs';
import nodeTest, { after } from 'node:test';
import {
  findUnguardedOutboundFetches,
  listOutboundFetchScanFiles,
  REVIEWED_OUTBOUND_FETCHES,
  unreviewedOutboundFetches,
} from './unguardedOutboundFetchScan.mjs';

import {
  DEFAULT_AUDIT_TIMEOUT_MS,
  REGISTRY_UNAVAILABLE_EXIT_CODE,
} from './dependency-audit-core.mjs';

// Every policy below pins a rule by reading source and asserting against it. When
// the code a policy pinned is retired, the pin list can be emptied while the test
// body survives: the loop iterates zero times, no assertion runs, and the suite
// still reports ok. That is a guard that reports health by construction, which is
// worse than no guard at all because it occupies the slot of a real one.
// `publication and scholarly audit artifacts use safe JSON output paths` sat empty
// this way from #2141 until #2366. Counting executed assertions per test makes the
// next one fail instead of passing quietly.
const executedAssertions = new Map();
let runningTest = null;

const countAssertion = () => {
  if (runningTest === null) return;
  executedAssertions.set(runningTest, (executedAssertions.get(runningTest) ?? 0) + 1);
};

const assert = new Proxy(nodeAssert, {
  apply: (target, thisArg, args) => {
    countAssertion();
    return Reflect.apply(target, thisArg, args);
  },
  get: (target, property) => {
    const value = target[property];
    if (typeof value !== 'function') return value;
    return (...args) => {
      countAssertion();
      return value.apply(target, args);
    };
  },
});

const test = (name, implementation) =>
  nodeTest(name, async (...args) => {
    runningTest = name;
    executedAssertions.set(name, executedAssertions.get(name) ?? 0);
    try {
      return await implementation(...args);
    } finally {
      runningTest = null;
    }
  });

after(() => {
  const vacuous = [...executedAssertions].filter(([, count]) => count === 0).map(([name]) => name);

  nodeAssert.deepEqual(
    vacuous,
    [],
    `these security policies executed zero assertions and therefore pass by construction, not by checking anything: ${vacuous.join('; ')}. Either repoint the policy at the code that replaced what it pinned, or delete it.`,
  );
});

const packageJson = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const ciWorkflow = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const keepAliveWorkflow = fs.readFileSync(
  new URL('../.github/workflows/keep-alive.yml', import.meta.url),
  'utf8',
);
const postPromotionVerifyWorkflow = fs.readFileSync(
  new URL('../.github/workflows/post-promotion-verify.yml', import.meta.url),
  'utf8',
);
const releaseHoldWorkflow = fs.readFileSync(
  new URL('../.github/workflows/release-hold.yml', import.meta.url),
  'utf8',
);
const e2eSmokeWorkflow = fs.readFileSync(
  new URL('../.github/workflows/e2e-smoke.yml', import.meta.url),
  'utf8',
);
const yarnrc = fs.readFileSync(new URL('../.yarnrc.yml', import.meta.url), 'utf8');

test('TypeScript source files do not contain nested import declarations', () => {
  const roots = ['../server/src', '../client/src'];
  const files = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {
      const child = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', 'build'].includes(entry.name)) visit(child);
      } else if (entry.isFile() && /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
        files.push(child);
      }
    }
  };

  for (const root of roots) visit(root);
  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /import\s+\{\s*\n\s*import\s+\{/);
  }
});

test('Yarn git dependency allowlist is narrow', () => {
  assert.match(
    yarnrc,
    /approvedGitRepositories:\s*\n\s*- "https:\/\/github\.com\/coursetable\/passport-cas"/,
  );
  assert.match(yarnrc, /npmMinimalAgeGate: 1d/);
  assert.doesNotMatch(yarnrc, /approvedGitRepositories:\s*\n\s*- "\*\*"/);
  assert.doesNotMatch(yarnrc, /\n\s*- "\*"/);
  assert.doesNotMatch(yarnrc, /npmMinimalAgeGate: 0/);
});

test('test fixtures do not contain known real Yale identifiers', () => {
  const denied = [
    'Toma_Tebaldi',
    'Toma Tebaldi',
    'yongli-zhang',
    'anna-arnal-estape',
    'james-e-hansen',
    'eric-winer',
    'Eric P. Winer',
    'christopher-whitlow',
    'paul-bloom',
    'alison-galvani',
    'lucila-ohno-machado',
    'john-tsang',
    'Mehran M. Sadeghi',
    'Cardiovascular Molecular Imaging Laboratory',
    'Nadya Dimitrova',
    'nadya-dimitrova',
    'Sofia, Bulgaria',
    'a-higginschen',
    'lawrence-guan',
    'br574',
    'dglahn',
    'jp2492',
    'jdp52',
    'dtm27',
    't-zhu',
    'Deb Vargas',
    'deb-vargas',
    'deb.vargas',
    'Fatima El-Tayeb',
    'fatima-el-tayeb',
  ];
  const roots = ['../server/src', '../client/src'];
  const testFilePattern = /(__tests__|\.test\.|\.spec\.).*\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

  const files = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {
      const child = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', 'build'].includes(entry.name)) visit(child);
      } else if (entry.isFile() && testFilePattern.test(child)) {
        files.push(child);
      }
    }
  };

  for (const root of roots) visit(root);
  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const value of denied) {
      assert.equal(
        source.includes(value),
        false,
        `${file} contains real Yale identifier fixture: ${value}`,
      );
    }
    // The four ORCIDs this list used to name are gone, superseded by a shape rule rather
    // than kept as a second authority that drifts: each was checksum-valid and inside
    // ORCID's allocated space, so the rule below catches all four and every value like
    // them. A denylist catches the iDs somebody noticed; the shape catches the risk.
    for (const [orcid] of source.matchAll(ORCID_PATTERN)) {
      assert.equal(
        orcidIsUnsafeForFixtures(orcid),
        false,
        `${file} contains an ORCID fixture that could be a real person's iD: ${orcid}. ` +
          `It is checksum-valid and inside ORCID's allocated space. Use a value outside ` +
          `that space instead, such as ${SYNTHETIC_ORCID_EXAMPLE}, which still passes the ` +
          `checksum so it exercises a serve path that requires a valid iD.`,
      );
    }
  }
});

test('operator scripts sanitize raw caught error messages before logging', () => {
  const files = [
    '../server/src/scripts/crossSourceObservationConflictReview.ts',
    '../server/src/scripts/repairDuplicateAccessSignals.ts',
    '../server/src/scripts/betaDataQuality.ts',
    '../server/src/scripts/betaReadinessGate.ts',
    '../server/src/scripts/sourceHealth.ts',
    '../server/src/scripts/researchEntityCoverageAudit.ts',
    '../server/src/scripts/clearBetaStudentAnalytics.ts',
    '../server/src/scripts/promoteAcceptedBetaCopy.ts',
    '../server/src/scripts/staleObservationConflictReview.ts',
    '../server/src/scripts/duplicateEntityNameReview.ts',
  ];

  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /sanitizeLogValue/);
    assert.doesNotMatch(
      source,
      /console\.error\(error instanceof Error \? error\.message : error\)/,
    );
    assert.doesNotMatch(source, /console\.error\([^;\n]*err\.message\)/);
    assert.doesNotMatch(source, /console\.error\([^;\n]*\(error as Error\)\.message\)/);
    assert.doesNotMatch(source, /candidate\.netid[^;\n]*error/);
  }
});

test('analytics query controls are parsed through allowlisted route guards', () => {
  const source = fs.readFileSync(
    new URL('../server/src/routes/analytics.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const ANALYTICS_USER_SORTS: readonly AnalyticsUserSort\[\]/);
  assert.match(source, /const ANALYTICS_SORT_DIRECTIONS: readonly AnalyticsSortDirection\[\]/);
  assert.match(
    source,
    /const parseAnalyticsLimit = \(limit: unknown, max: number\): number \| undefined =>/,
  );
  assert.match(
    source,
    /const parseAnalyticsUserSort = \(sort: unknown\): AnalyticsUserSort \| undefined =>/,
  );
  assert.match(
    source,
    /const parseAnalyticsSortDirection = \(direction: unknown\): AnalyticsSortDirection \| undefined =>/,
  );
  assert.match(
    source,
    /const parseAnalyticsActiveSince = \(activeSince: unknown\): string \| undefined =>/,
  );
  assert.match(source, /userType: parseAnalyticsUserType\(userType\)/);
  assert.match(source, /activeSince: parseAnalyticsActiveSince\(activeSince\)/);
  assert.match(source, /sort: parseAnalyticsUserSort\(sort\)/);
  assert.match(source, /direction: parseAnalyticsSortDirection\(direction\)/);
  assert.match(source, /limit: parseAnalyticsLimit\(limit, 200\)/);
  assert.match(source, /limit: parseAnalyticsLimit\(request\.query\.limit, 100\)/);
  assert.match(source, /const limit = parseAnalyticsLimit\(request\.query\.limit, 300\)/);
  assert.doesNotMatch(
    source,
    /sort: typeof sort === 'string' \? \(sort as AnalyticsUserSort\) : undefined/,
  );
  assert.doesNotMatch(
    source,
    /direction: typeof direction === 'string' \? \(direction as AnalyticsSortDirection\) : undefined/,
  );
  assert.doesNotMatch(source, /limit: typeof limit === 'string' \? Number\(limit\) : undefined/);
  assert.doesNotMatch(
    source,
    /typeof request\.query\.limit === 'string' \? Number\(request\.query\.limit\) : undefined/,
  );
});

test('research description LLM backfill redacts prompt contact data before provider calls', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/backfillResearchDescriptions.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ redactDirectContactInfo \} from '\.\.\/utils\/contactRedaction'/);
  assert.match(source, /const MAX_REWRITE_PROMPT_SOURCE_CHARS = 12000/);
  assert.match(source, /const MAX_REWRITE_PROMPT_NAME_CHARS = 240/);
  assert.match(
    source,
    /const safeName = redactDirectContactInfo\(name\)\.slice\(0, MAX_REWRITE_PROMPT_NAME_CHARS\)/,
  );
  assert.match(
    source,
    /const safeSourceText = redactDirectContactInfo\(sourceText\)\.slice\(\s*0,\s*MAX_REWRITE_PROMPT_SOURCE_CHARS,?\s*\)/,
  );
  assert.match(source, /`Research home: \$\{safeName\}`/);
  assert.match(source, /safeSourceText/);
  assert.doesNotMatch(source, /`Research home: \$\{name\}`/);
  assert.doesNotMatch(source, /sourceText\.slice\(0, 12000\)/);
});

test('research description LLM backfill observation ids use safe serialization', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/backfillResearchDescriptions.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /const entityId = serializedDocumentId\(entity\._id\)/);
  assert.match(source, /entityId,/);
  assert.doesNotMatch(source, /entityId: String\(entity\._id\)/);
  assert.doesNotMatch(source, /String\(entity\._id\)/);
});

test('scraper LLM extractors redact prompt page text before provider calls', () => {
  const rawPageTextExtractors = [
    '../server/src/scrapers/sources/labMicrositeDescriptionLLMExtractor.ts',
    '../server/src/scrapers/sources/centerDirectorLLMExtractor.ts',
    '../server/src/scrapers/sources/centerAffiliationLLMExtractor.ts',
  ];

  for (const file of rawPageTextExtractors) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(
      source,
      /import \{ redactDirectContactInfo \} from '\.\.\/\.\.\/utils\/contactRedaction'/,
    );
    assert.match(
      source,
      /const safeSourceUrl = redactDirectContactInfo\(input\.sourceUrl\)\.slice\(0, 2048\)/,
    );
    assert.match(
      source,
      /const safePageText = redactDirectContactInfo\(input\.pageText\)\.slice\(0, MAX_PROMPT_CHARS\)/,
    );
    assert.match(source, /`Source URL: \$\{safeSourceUrl\}`/);
    assert.match(source, /safePageText/);
    assert.doesNotMatch(source, /`Source URL: \$\{input\.sourceUrl\}`/);
    assert.doesNotMatch(source, /\binput\.pageText,\n\s*\]\.join/);
  }

  const undergradSource = fs.readFileSync(
    new URL('../server/src/scrapers/sources/labMicrositeUndergradLLMExtractor.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    undergradSource,
    /import \{ redactDirectContactInfo \} from '\.\.\/\.\.\/utils\/contactRedaction'/,
  );
  assert.match(
    undergradSource,
    /const safeGroupName = redactDirectContactInfo\(groupName\)\.slice\(0, 240\)/,
  );
  assert.match(
    undergradSource,
    /const safeHomeUrl = redactDirectContactInfo\(homeUrl\)\.slice\(0, 2048\)/,
  );
  assert.match(undergradSource, /redactDirectContactInfo\(homeText\) \|\| '\(empty\)'/);
  assert.match(
    undergradSource,
    /const safeSubPageUrl = redactDirectContactInfo\(subPageUrl\)\.slice\(0, 2048\)/,
  );
  assert.match(undergradSource, /redactDirectContactInfo\(subPageText\)/);
  assert.match(
    undergradSource,
    /const safePageUrl = redactDirectContactInfo\(page\.url\)\.slice\(0, 2048\)/,
  );
  assert.match(undergradSource, /redactDirectContactInfo\(page\.text\)/);
  assert.doesNotMatch(undergradSource, /parts\.push\(homeText \|\| '\(empty\)'\)/);
  assert.doesNotMatch(undergradSource, /parts\.push\(subPageText\)/);
  assert.doesNotMatch(undergradSource, /parts\.push\(page\.text\)/);
});

test('rendered fetch process boundary constrains env-selected command and bridge inputs', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/renderedFetch.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const PYTHON_COMMAND_RE = \/\^python/);
  assert.match(source, /const RENDERED_FETCH_MODES = new Set\(\['dynamic', 'stealthy'\]\)/);
  assert.match(source, /const MAX_RENDERED_FETCH_SELECTOR_LENGTH = 256/);
  assert.match(source, /const normalizeRenderedPythonCommand = \(value: string\): string =>/);
  assert.match(source, /command\.includes\('\/'\) \|\| command\.includes\('\\\\'\)/);
  assert.match(source, /!PYTHON_COMMAND_RE\.test\(command\)/);
  assert.match(source, /return basename\(command\)/);
  assert.match(source, /const normalizeRenderedFetchBridgePath = \(value: string\): string =>/);
  assert.match(source, /basename\(bridgePath\) !== 'scraplingBridge\.py'/);
  assert.match(
    source,
    /const normalizeRenderedFetchMode = \(value: unknown\): 'dynamic' \| 'stealthy' =>/,
  );
  assert.match(
    source,
    /const normalizeRenderedFetchSelector = \(value: unknown\): string \| undefined =>/,
  );
  assert.match(source, /const pythonCommand = normalizeRenderedPythonCommand\(/);
  assert.match(source, /const bridgePath = normalizeRenderedFetchBridgePath\(/);
  assert.match(source, /normalizeRenderedFetchMode\(request\.mode \|\| defaultMode\)/);
  assert.match(
    source,
    /const waitSelector = normalizeRenderedFetchSelector\(request\.waitSelector\)/,
  );
  assert.doesNotMatch(
    source,
    /const pythonCommand =\s*\n\s*options\.pythonCommand \|\| process\.env\.SCRAPLING_PYTHON_COMMAND \|\| 'python3'/,
  );
  assert.doesNotMatch(
    source,
    /const bridgePath =\s*\n\s*options\.bridgePath \|\| process\.env\.SCRAPLING_BRIDGE_PATH \|\| DEFAULT_BRIDGE_PATH/,
  );
});

test('service-layer search and materialization sync logs sanitize caught errors', () => {
  const files = ['../server/src/services/meiliSyncService.ts'];

  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /import \{ sanitizeLogValue \} from '\.\.\/utils\/logSanitizer'/);
    assert.doesNotMatch(source, /console\.error\([^;\n]*,\s*error\)/);
    assert.doesNotMatch(source, /console\.error\([^;\n]*,\s*err\)/);
    assert.doesNotMatch(source, /console\.error\(error\)/);
    assert.doesNotMatch(source, /console\.error\(err\)/);
  }
});

test('external directory integration sanitizes fetch errors before logging', () => {
  const directorySource = fs.readFileSync(
    new URL('../server/src/services/directoryService.ts', import.meta.url),
    'utf8',
  );

  assert.match(directorySource, /import \{ sanitizeLogValue \} from '\.\.\/utils\/logSanitizer'/);
  assert.match(directorySource, /const MAX_DIRECTORY_QUERY_LENGTH = 120/);
  assert.match(directorySource, /const DIRECTORY_SEARCH_TYPES = new Set\(\['netid', 'name'\]\)/);
  assert.match(
    directorySource,
    /query\.trim\(\)\.replace\(\s*\/\\s\+\/g, ' '\)\.slice\(0, MAX_DIRECTORY_QUERY_LENGTH\)/,
  );
  assert.match(
    directorySource,
    /const safeSearchType = DIRECTORY_SEARCH_TYPES\.has\(searchType\) \? searchType : 'netid'/,
  );
  assert.match(directorySource, /params: \{ search: safeQuery, searchType: safeSearchType \}/);
  assert.match(
    directorySource,
    /console\.error\('Directory lookup failed:', sanitizeLogValue\(error\)\)/,
  );
  assert.doesNotMatch(directorySource, /Directory lookup for/);
  assert.doesNotMatch(directorySource, /error\.message/);
});

test('shared pagination validation rejects object and array query controls before numeric coercion', () => {
  const source = fs.readFileSync(
    new URL('../server/src/middleware/validation.ts', import.meta.url),
    'utf8',
  );
  const adminSource = fs.readFileSync(
    new URL('../server/src/routes/admin.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const COMPACT_POSITIVE_INTEGER_RE = \/\^\[1-9\]\\d\{0,5\}\$\//);
  assert.match(source, /const MAX_VALIDATED_PAGE_SIZE = 500/);
  assert.match(source, /const compactPositiveInteger = \(value: unknown\): number \| undefined =>/);
  assert.match(source, /if \(typeof value !== 'string'\) return undefined/);
  assert.match(source, /Number\.parseInt\(trimmed, 10\)/);
  assert.match(source, /if \(page !== undefined && compactPositiveInteger\(page\) === undefined\)/);
  assert.match(
    source,
    /const parsedPageSize = pageSize === undefined \? undefined : compactPositiveInteger\(pageSize\)/,
  );
  assert.match(
    source,
    /parsedPageSize === undefined \|\| parsedPageSize > MAX_VALIDATED_PAGE_SIZE/,
  );
  assert.doesNotMatch(source, /isNaN\(Number\(page\)\)/);
  assert.doesNotMatch(source, /Number\(pageSize\)/);
  assert.match(adminSource, /page: req\.query\.page/);
  assert.match(adminSource, /pageSize: req\.query\.pageSize/);
  assert.doesNotMatch(adminSource, /page: Number\(req\.query\.page\)/);
  assert.doesNotMatch(adminSource, /pageSize: Number\(req\.query\.pageSize\)/);
});

test('log sanitizer redacts common token, secret, and header forms', () => {
  const source = fs.readFileSync(
    new URL('../server/src/utils/logSanitizer.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const BEARER_TOKEN_RE/);
  assert.match(source, /const BASIC_TOKEN_RE/);
  assert.match(source, /const OPENAI_KEY_RE/);
  assert.match(source, /const SECRET_FIELD_NAME_PATTERN/);
  assert.match(source, /accessToken/);
  assert.match(source, /refreshToken/);
  assert.match(source, /idToken/);
  assert.match(source, /csrfToken/);
  assert.match(source, /clientSecret/);
  assert.match(source, /setCookie/);
  assert.match(source, /x\[_-\]\?seed\[_-\]\?token/);
  assert.match(source, /const SECRET_HEADER_RE/);
  assert.match(source, /const TOKEN_ASSIGNMENT_RE/);
  assert.match(source, /authorization\|cookie\|set-cookie/);
  assert.match(source, /const SECRET_QUOTED_FIELD_RE/);
  assert.match(source, /const SECRET_BARE_FIELD_RE/);
  assert.match(source, /MAX_SANITIZED_LOG_VALUE_LENGTH = 12000/);
  assert.match(source, /TRUNCATED_LOG_SUFFIX = '\[log-truncated\]'/);
  assert.match(source, /const truncateSanitizedLogValue = \(value: string\): string => \{/);
  assert.match(source, /api\[_-\]\?key/);
  assert.match(source, /const sanitized = raw/);
  assert.match(source, /\.replace\(BASIC_TOKEN_RE, '\$1\[token-redacted\]'\)/);
  assert.match(source, /\.replace\(OPENAI_KEY_RE, 'sk-\[secret-redacted\]'\)/);
  assert.match(source, /\.replace\(SECRET_HEADER_RE, '\$1: \[secret-redacted\]'\)/);
  assert.match(source, /\.replace\(SECRET_QUOTED_FIELD_RE, '\$1\$2\[secret-redacted\]\$2'\)/);
  assert.match(source, /\.replace\(SECRET_BARE_FIELD_RE, '\$1\[secret-redacted\]'\)/);
  assert.match(source, /return truncateSanitizedLogValue\(sanitized\)/);
});

test('global error handler does not log stack traces in deployed runtimes', () => {
  const source = fs.readFileSync(
    new URL('../server/src/middleware/errorHandler.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /import \{ requiresDeployedRuntimeSecurity \} from '\.\.\/utils\/environment'/,
  );
  assert.match(source, /if \(!requiresDeployedRuntimeSecurity\(\) && sanitizedError\.stack\) \{/);
  assert.match(source, /console\.error\('Stack:', sanitizedError\.stack\)/);
  assert.match(source, /if \(res\.headersSent\) \{\s*return next\(error\);\s*\}/);
  assert.doesNotMatch(
    source,
    /console\.error\('Stack:', sanitizedError\.stack\);\n\n\s*if \(error instanceof NotFoundError\)/,
  );
});

test('client dynamic internal route segments are encoded before rendering', () => {
  const files = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {
      const child = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', 'build'].includes(entry.name)) visit(child);
      } else if (entry.isFile() && /\.(?:ts|tsx|js|jsx)$/.test(entry.name)) {
        files.push(child);
      }
    }
  };

  visit('../client/src');

  const dynamicInternalRoutePattern =
    /(?:to|href)=\{`\/(?:research|profile|opportunities|programs)[^`]*\$\{(?!safeRouteSegment\()/;
  const urlSource = fs.readFileSync(new URL('../client/src/utils/url.ts', import.meta.url), 'utf8');
  const serverUrlSafetySource = fs.readFileSync(
    new URL('../server/src/utils/urlSafety.ts', import.meta.url),
    'utf8',
  );
  const researchHomeCardSource = fs.readFileSync(
    new URL('../client/src/components/research/ResearchHomeCard.tsx', import.meta.url),
    'utf8',
  );
  assert.match(urlSource, /hasUnsafeRawUrlCharacter\(trimmed\)/);
  assert.match(serverUrlSafetySource, /hasUnsafeRawPublicUrlCharacter\(trimmed\)/);
  assert.match(urlSource, /export const safeRouteSegment = \(raw: unknown\): string => \{/);
  assert.match(urlSource, /if \(trimmed === '\.' \|\| trimmed === '\.\.'\) return ''/);
  assert.match(urlSource, /\^%\(\?:2e\)\(\?:%\(\?:2e\)\)\?\$/i);
  assert.match(urlSource, /return encodeURIComponent\(trimmed\)/);
  assert.match(
    researchHomeCardSource,
    /const primaryProfileUrl = primaryLinkedEntity\s*\?\s*`\/research\/\$\{safeRouteSegment\(primaryLinkedEntity\.slug\)\}`\s*:\s*''/,
  );
  assert.doesNotMatch(researchHomeCardSource, /`\/research\/\$\{primaryLinkedEntity\.slug\}`/);

  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(
      source,
      dynamicInternalRoutePattern,
      `${file} has raw dynamic route segment`,
    );
  }
});

test('application and official-route CTAs use HTTP(S)-only URL helpers', () => {
  const labDetail = fs.readFileSync(
    new URL('../client/src/pages/labDetail.tsx', import.meta.url),
    'utf8',
  );
  const fellowshipModal = fs.readFileSync(
    new URL('../client/src/components/fellowship/FellowshipModal.tsx', import.meta.url),
    'utf8',
  );
  const programLinks = fs.readFileSync(
    new URL('../client/src/utils/programLinks.ts', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(labDetail, /const officialRouteUrl = safeUrl\(officialRoute\?\.url\)/);

  assert.match(
    fellowshipModal,
    /const applicationHref = safeHttpUrl\(fellowship\.applicationLink\)/,
  );
  assert.doesNotMatch(fellowshipModal, /safeUrl\(fellowship\.applicationLink\)/);
  assert.match(fellowshipModal, /const linkHref = safeHttpUrl\(match\[2\]\)/);
  assert.match(
    fellowshipModal,
    /const safeLinks = buildSafeProgramLinks\(fellowship\.links, fellowship\.sourceUrl\)/,
  );
  assert.match(fellowshipModal, /href=\{link\.href\}/);
  assert.doesNotMatch(fellowshipModal, /const linkHref = safeUrl\(match\[2\]\)/);
  assert.doesNotMatch(fellowshipModal, /href=\{link\.url\}/);
  assert.match(fellowshipModal, /safeMailtoHref\(fellowship\.contactEmail\)/);

  assert.match(programLinks, /href: safeHttpUrl\(link\.url\)/);
  assert.doesNotMatch(programLinks, /href: safeUrl\(link\.url\)/);
  assert.doesNotMatch(programLinks, /href: link\.url/);
});

test('public research detail queries cap unauthenticated fan-out before serialization', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/researchGroupService.ts', import.meta.url),
    'utf8',
  );

  for (const constant of [
    'MAX_PUBLIC_DETAIL_ACCESS_SIGNALS',
    'MAX_PUBLIC_DETAIL_RELATIONSHIP_QUERY_LIMIT',
  ]) {
    assert.match(source, new RegExp(`const ${constant} = \\d+`));
    assert.match(source, new RegExp(`\\.limit\\(${constant}\\)`));
  }

  assert.match(source, /const MAX_PUBLIC_DETAIL_MEMBERS = \d+/);
  assert.match(source, /\.slice\(0, MAX_PUBLIC_DETAIL_MEMBERS\)/);

  assert.doesNotMatch(source, /ResearchEntityRelationship\.find\(\{[^;]*?\}\)\.lean\(\)/);
  assert.doesNotMatch(
    source,
    /EntryPathway\.find\(\{ researchEntityId: \(group as any\)\._id, archived: false \}\)\.lean\(\)/,
  );
  assert.doesNotMatch(
    source,
    /PostedOpportunity\.find\(\{ researchEntityId: \(group as any\)\._id, archived: false \}\)\.lean\(\)/,
  );
});

test('root package exposes a deploy security preflight', () => {
  assert.equal(
    packageJson.scripts['security:policy'],
    'node --test scripts/security-preflight.test.mjs scripts/dependency-audit.test.mjs scripts/check-no-secrets.test.mjs scripts/check-no-person-identifiers.test.mjs scripts/gh-identifier-guard.test.mjs',
  );
  assert.equal(
    packageJson.scripts['security:preflight'],
    'yarn security:policy && yarn security:secrets && yarn security:identifiers && yarn security:audit:production',
  );
  assert.equal(
    packageJson.scripts['security:identifiers'],
    'node scripts/check-no-person-identifiers.mjs',
  );
  // No repo file invokes install:all:immutable: a Render dashboard build command
  // configured before #4035 may still call it. It looks dead to a caller search,
  // so do not delete it on that evidence.
  assert.equal(
    packageJson.scripts['install:all:immutable'],
    'bash scripts/install-all.sh --immutable',
  );
});

test('root package exposes the production security smoke used by deploy gates', () => {
  assert.equal(
    packageJson.scripts['security:smoke:production'],
    'node client/scripts/productionPromotionSmoke.mjs --api-base ${SMOKE_API_BASE:-https://yalelabs.io/api} --app-base ${SMOKE_APP_BASE:-https://yalelabs.io} --ui=false',
  );
});

const parseDependencyAuditScript = (script) => {
  const tokens = script.split(' ');
  assert.deepEqual(tokens.slice(0, 2), ['node', 'scripts/run-dependency-audit.mjs']);
  const separatorIndex = tokens.indexOf('--');
  return {
    directories: tokens.slice(2, separatorIndex),
    auditArgs: tokens.slice(separatorIndex + 1),
  };
};

test('production dependency audit covers root, server, and client workspaces', () => {
  const audit = parseDependencyAuditScript(packageJson.scripts['security:audit:production']);

  assert.deepEqual(audit.directories, ['.', 'server', 'client']);
  assert.deepEqual(audit.auditArgs, ['--severity', 'moderate', '--environment', 'production']);
});

test('all-environment dependency audit covers every workspace recursively', () => {
  const audit = parseDependencyAuditScript(packageJson.scripts['security:audit:all-environments']);

  assert.deepEqual(audit.directories, ['.', 'server', 'client']);
  assert.deepEqual(audit.auditArgs, ['--recursive', '--severity', 'moderate']);
  assert.match(ciWorkflow, /run:\s*yarn security:audit:all-environments/);
});

const PATCHED_BRACE_EXPANSION_BY_MAJOR = new Map([
  [1, [1, 1, 21]],
  [2, [2, 1, 7]],
  [3, [3, 0, 9]],
  [5, [5, 0, 12]],
]);

const lockfileVersionsOf = (lockfileText, packageName) =>
  [
    ...lockfileText.matchAll(
      new RegExp(`^"${packageName}@[^\\n]*":\\n  version: ([0-9.]+)$`, 'gm'),
    ),
  ].map((match) => match[1].split('.').map(Number));

const isAtLeast = (version, floor) => {
  for (let index = 0; index < floor.length; index += 1) {
    if (version[index] !== floor[index]) return version[index] > floor[index];
  }
  return true;
};

test('every locked brace-expansion is on a patched release of its own major', () => {
  for (const lockfile of ['../yarn.lock', '../server/yarn.lock', '../client/yarn.lock']) {
    const versions = lockfileVersionsOf(
      fs.readFileSync(new URL(lockfile, import.meta.url), 'utf8'),
      'brace-expansion',
    );
    assert.ok(
      versions.length > 0,
      `${lockfile} locks no brace-expansion, so this pin reads nothing`,
    );
    for (const version of versions) {
      const floor = PATCHED_BRACE_EXPANSION_BY_MAJOR.get(version[0]);
      assert.ok(
        floor,
        `${lockfile} locks brace-expansion ${version.join('.')}, a major with no patched floor here`,
      );
      assert.ok(
        isAtLeast(version, floor),
        `${lockfile} locks brace-expansion ${version.join('.')}, below the patched ${floor.join('.')}`,
      );
    }
  }
});

test('the minimatch the root lint toolchain loads can expand a brace set', () => {
  const requireFromConfigArray = createRequire(
    new URL('../node_modules/@eslint/config-array/package.json', import.meta.url),
  );
  const minimatch = requireFromConfigArray('minimatch');
  const match = typeof minimatch === 'function' ? minimatch : minimatch.minimatch;

  assert.equal(match('a.js', '*.{js,ts}'), true);
  assert.equal(match('a.md', '*.{js,ts}'), false);
});

const splitDescriptor = (descriptor) => {
  const [, name, range] = descriptor.match(/^(@?[^@]+)(?:@(.*))?$/);
  return { name, range };
};

const lockfileDescriptorsOf = (lockfileText) => {
  const entries = Object.entries(yaml.load(lockfileText)).filter(([key]) => key !== '__metadata');
  const locked = entries.flatMap(([key]) => key.split(', ').map(splitDescriptor));
  const requested = entries.flatMap(([, entry]) =>
    Object.entries(entry.dependencies ?? {}).map(([name, range]) => ({ name, range })),
  );
  return { locked, requested };
};

const overrideIsLoadBearing = (key, { locked, requested }) => {
  const segments = key.split('/');
  const scope = segments.at(-2);
  const target = scope?.startsWith('@') ? `${scope}/${segments.at(-1)}` : segments.at(-1);
  const { name, range } = splitDescriptor(target);
  if (range === undefined) return locked.some((descriptor) => descriptor.name === name);
  return [...locked, ...requested].some(
    (descriptor) => descriptor.name === name && descriptor.range === range,
  );
};

test('every dependency override matches a descriptor its own lockfile resolves', () => {
  for (const workspace of ['.', 'server', 'client']) {
    const manifest = JSON.parse(
      fs.readFileSync(new URL(`../${workspace}/package.json`, import.meta.url), 'utf8'),
    );
    const descriptors = lockfileDescriptorsOf(
      fs.readFileSync(new URL(`../${workspace}/yarn.lock`, import.meta.url), 'utf8'),
    );
    const overrides = Object.keys(manifest.resolutions ?? {});
    assert.ok(
      overrides.length > 0,
      `${workspace} declares no resolutions, so this pin reads nothing`,
    );
    for (const key of overrides) {
      assert.ok(
        overrideIsLoadBearing(key, descriptors),
        `${workspace}/package.json overrides ${key}, which no ${workspace}/yarn.lock descriptor matches, so the pin does nothing`,
      );
    }
  }
});

test('the advisory verdict is published as an artifact, never as a merge-gating check', () => {
  // The verdict distinguishes exit 1 (advisories found) from exit 75 (registry
  // unreachable) for a merge consumer, but it must stay informational: a
  // non-required check a consumer misread as passing would rebuild the
  // exit-0-when-unreachable soft pass #2364 removed (ylabs#2381). An artifact
  // cannot gate a merge by construction, and it needs no write-capable token,
  // which the read-only-permissions policy above forbids anyway.
  assert.match(ciWorkflow, /DEPENDENCY_AUDIT_VERDICT_FILE:/);
  assert.match(ciWorkflow, /name:\s*Publish advisory verdict/);
  assert.match(ciWorkflow, /uses:\s*actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(ciWorkflow, /if:\s*always\(\)/);
  // The emitter must never make writing the artifact load-bearing on the exit code.
  const runner = fs.readFileSync(
    new URL('../scripts/run-dependency-audit.mjs', import.meta.url),
    'utf8',
  );
  const core = fs.readFileSync(
    new URL('../scripts/dependency-audit-core.mjs', import.meta.url),
    'utf8',
  );
  assert.match(runner, /writeAuditVerdict\(AUDIT_VERDICTS\.CLEAN\)/);
  assert.match(runner, /writeAuditVerdict\(AUDIT_VERDICTS\.ADVISORIES_FOUND/);
  assert.match(runner, /writeAuditVerdict\(AUDIT_VERDICTS\.REGISTRY_UNREACHABLE\b/);
  assert.match(runner, /writeAuditVerdict\(AUDIT_VERDICTS\.REGISTRY_UNREACHABLE_OVERRIDDEN/);
  // A failed artifact write must be swallowed, not allowed to change the verdict.
  assert.match(core, /could not write audit verdict artifact/);
});

test('an unreachable advisory registry fails closed and stays bounded', () => {
  const runner = fs.readFileSync(
    new URL('../scripts/run-dependency-audit.mjs', import.meta.url),
    'utf8',
  );
  const core = fs.readFileSync(
    new URL('../scripts/dependency-audit-core.mjs', import.meta.url),
    'utf8',
  );

  // #2366: an audit that green-lights on "we could not check" lies exactly when it
  // matters, and an outage window is a plausible time to publish a bad package.
  // beta promotes to production, so unreachable must never exit 0 by default. A
  // no-mistakes "apply CI fixes" round already reverted this once to get a green
  // build; this policy is what makes that revert fail the suite instead of shipping.
  assert.equal(REGISTRY_UNAVAILABLE_EXIT_CODE, 75);
  assert.notEqual(REGISTRY_UNAVAILABLE_EXIT_CODE, 0);
  assert.match(runner, /process\.exit\(REGISTRY_UNAVAILABLE_EXIT_CODE\)/);
  assert.match(runner, /advisory registry unreachable, verdict unknown/);
  assert.doesNotMatch(runner, /inconclusive rather than failed/);

  // The override must be an exact opt-in, never a truthiness check that a stray
  // "false" or "0" in CI config would satisfy.
  assert.match(runner, /process\.env\.DEPENDENCY_AUDIT_ALLOW_UNREACHABLE === '1'/);

  // CI reaches the override through a repository variable, never a literal. A
  // hardcoded "1" here would silently disable the gate for every future run, and
  // an unset variable must leave it strict.
  assert.match(
    ciWorkflow,
    /DEPENDENCY_AUDIT_ALLOW_UNREACHABLE: \$\{\{ vars\.ALLOW_UNREACHABLE_ADVISORY_AUDIT \}\}/,
  );
  assert.doesNotMatch(ciWorkflow, /DEPENDENCY_AUDIT_ALLOW_UNREACHABLE:\s*['"]?1['"]?\s*$/m);

  // Yarn defaults to httpTimeout 60s and httpRetry 3, so one audit can burn three
  // minutes on a dead registry and six workspace audits far longer. The runner caps
  // both per invocation rather than in .yarnrc.yml, because a global httpTimeout
  // would also cap install tarball fetches and make installs flaky on slow links.
  assert.ok(DEFAULT_AUDIT_TIMEOUT_MS > 0 && DEFAULT_AUDIT_TIMEOUT_MS < 60_000);
  assert.match(core, /YARN_HTTP_TIMEOUT: String\(timeoutMs\)/);
  assert.match(core, /YARN_HTTP_RETRY: YARN_AUDIT_HTTP_RETRY/);
  assert.doesNotMatch(yarnrc, /httpTimeout/);

  // SIGKILL stays as a backstop for a yarn that ignores its own timeout, and
  // resolving on the timer rather than on 'close' is what makes the bound real:
  // a killed yarn's grandchildren can hold the stdio pipes open indefinitely.
  assert.match(core, /timeoutMs = DEFAULT_AUDIT_TIMEOUT_MS/);
  assert.match(core, /child\.kill\('SIGKILL'\)/);
  assert.match(core, /settle\(\{ code: 1, output: output \+ notice \}\)/);
  assert.match(core, /timeoutMs \+ KILL_GRACE_MS/);
});

test('CI runs immutable installs and the same deploy security preflight used locally', () => {
  assert.match(ciWorkflow, /name:\s*Install dependencies from lockfiles/);
  // Installs are invoked as yarn builtins (a fresh runner cannot execute
  // package.json scripts before an install exists); all three workspaces
  // must stay immutable and no mutable install may sneak in.
  assert.match(ciWorkflow, /yarn install --immutable/);
  assert.match(ciWorkflow, /yarn --cwd server install --immutable/);
  assert.match(ciWorkflow, /yarn --cwd client install --immutable/);
  assert.doesNotMatch(ciWorkflow, /run:\s*yarn install:all(?::immutable)?(?:\s|$)/);
  assert.match(ciWorkflow, /name:\s*Run deploy security preflight/);
  assert.match(ciWorkflow, /run:\s*yarn security:preflight/);
});

test('CI gates on ESLint errors, leaves warnings advisory, and lints before the suites', () => {
  const lintRun = /^\s*run:\s*yarn lint\s*$/m;
  assert.match(
    ciWorkflow,
    lintRun,
    'ci.yml must run yarn lint so a lint error fails the required check (ylabs#3070)',
  );

  // Warnings stay advisory: --max-warnings would make the two standing
  // unused-variable warnings blocking, which #3070 deliberately declined.
  assert.doesNotMatch(ciWorkflow, /^\s*run:[^\n]*yarn lint[^\n]*--max-warnings/m);
  assert.doesNotMatch(packageJson.scripts.lint, /--max-warnings/);

  // A lint error is seconds to report and the suites are minutes, so the gate
  // is worth nothing behind them.
  const lintAt = ciWorkflow.search(lintRun);
  const firstSuiteAt = ciWorkflow.search(/^\s*run:\s*yarn --cwd server test\s*$/m);
  assert.ok(firstSuiteAt > 0, 'ci.yml must still run the server suite');
  assert.ok(lintAt > 0 && lintAt < firstSuiteAt, 'the lint step must run before the server suite');

  // verify:fast is the documented pre-push predictor of CI's cheap gates, so a
  // gate CI enforces and verify:fast omits would surprise every author.
  assert.match(packageJson.scripts['verify:fast'], /yarn lint/);
  assert.match(packageJson.scripts.verify, /verify:fast/);
});

test('CI runs the server registration guards ahead of the full server suite', () => {
  const guardRun = /^\s*run:\s*yarn --cwd server test:guards\s*$/m;
  const guardAt = ciWorkflow.search(guardRun);
  const lintAt = ciWorkflow.search(/^\s*run:\s*yarn lint\s*$/m);
  const firstSuiteAt = ciWorkflow.search(/^\s*run:\s*yarn --cwd server test\s*$/m);
  assert.ok(guardAt > 0, 'ci.yml must run the server guard tests (ylabs#3737)');
  assert.ok(lintAt < guardAt, 'the guard step runs after lint');
  assert.ok(guardAt < firstSuiteAt, 'the guard step must run before the full server suite');
  assert.match(packageJson.scripts['verify:fast'], /yarn --cwd server test:guards/);
});

const everyWorkflowFile = () => {
  const directory = new URL('../.github/workflows/', import.meta.url);
  const files = fs
    .readdirSync(directory)
    .filter((file) => /\.ya?ml$/.test(file))
    .map((file) => [file, yaml.load(fs.readFileSync(new URL(file, directory), 'utf8'))]);
  assert.ok(files.length > 0, 'the workflow directory must hold at least one workflow');
  return files;
};

const workflowJobs = (workflow) => Object.entries(workflow?.jobs ?? {});

// An allowlist of values rather than a denylist of scope names: a denylist
// has to be extended for every write-capable scope GitHub adds, and the old
// one already missed statuses, issues, packages and write-all (ylabs#3912).
const WRITE_FREE_SCOPE_LEVELS = new Set(['read', 'none']);

const permissionViolations = (where, permissions) => {
  if (permissions === undefined || permissions === 'read-all') return [];
  if (permissions === null || typeof permissions !== 'object' || Array.isArray(permissions)) {
    return [`${where} grants \`permissions: ${JSON.stringify(permissions)}\``];
  }
  return Object.entries(permissions)
    .filter(([, level]) => !WRITE_FREE_SCOPE_LEVELS.has(level))
    .map(([scope, level]) => `${where} requests \`${scope}: ${JSON.stringify(level)}\``);
};

const tokenPermissionViolations = (workflow) => [
  ...(workflow?.permissions?.contents === 'read'
    ? []
    : [
        'the top level must pin GITHUB_TOKEN to `contents: read`, or the token takes the repository default scopes',
      ]),
  ...permissionViolations('the top level', workflow?.permissions),
  ...workflowJobs(workflow).flatMap(([job, definition]) =>
    permissionViolations(`job ${job}`, definition?.permissions),
  ),
];

const checkoutSteps = (workflow) =>
  workflowJobs(workflow).flatMap(([job, definition]) =>
    (definition?.steps ?? [])
      .filter((step) => typeof step?.uses === 'string' && step.uses.startsWith('actions/checkout@'))
      .map((step) => ({ job, persistsCredentials: step.with?.['persist-credentials'] !== false })),
  );

test('GitHub workflows run with read-only repository token permissions', () => {
  for (const [file, workflow] of everyWorkflowFile()) {
    assert.deepEqual(
      tokenPermissionViolations(workflow),
      [],
      `${file} must run with read-only token scopes, and a read scope beyond contents is admitted explicitly rather than by widening a pattern`,
    );
  }
});

test('the token-permission guard rejects a write-capable scope anywhere in a workflow', () => {
  const workflowWith = (topLevel, jobLevel) =>
    yaml.load(
      [
        'on: push',
        'permissions:',
        '  contents: read',
        ...topLevel,
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        ...jobLevel,
        '    steps:',
        '      - run: |',
        '          permissions: write-all',
      ].join('\n'),
    );

  assert.deepEqual(tokenPermissionViolations(workflowWith([], [])), []);
  assert.deepEqual(tokenPermissionViolations(workflowWith([], ['    permissions: read-all'])), []);
  assert.deepEqual(tokenPermissionViolations(workflowWith([], ['    permissions: {}'])), []);
  for (const [description, topLevel, jobLevel] of [
    ['a job-level contents write', [], ['    permissions:', '      contents: write']],
    ['a job-level write-all', [], ['    permissions: write-all']],
    ['a top-level statuses write', ['  statuses: write'], []],
    [
      'a job-level flow mapping with a write',
      [],
      ['    permissions: { contents: read, issues: write }'],
    ],
  ]) {
    assert.equal(
      tokenPermissionViolations(workflowWith(topLevel, jobLevel)).length,
      1,
      `${description} must be rejected`,
    );
  }
  assert.notDeepEqual(
    tokenPermissionViolations(yaml.load('on: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n')),
    [],
    'a workflow without a top-level permissions block must be rejected',
  );
});

test('GitHub checkout steps do not persist repository credentials', () => {
  let checkouts = 0;
  for (const [file, workflow] of everyWorkflowFile()) {
    for (const { job, persistsCredentials } of checkoutSteps(workflow)) {
      checkouts += 1;
      assert.equal(
        persistsCredentials,
        false,
        `${file} job ${job} checkout must set persist-credentials: false, or GITHUB_TOKEN stays in local git config for every later step`,
      );
    }
  }
  assert.ok(checkouts > 0, 'at least one workflow must still check out the repository');
});

test('the checkout guard rejects a checkout that leaves credentials in git config', () => {
  const persistence = (step) =>
    checkoutSteps(
      yaml.load(
        ['jobs:', '  build:', '    runs-on: ubuntu-latest', '    steps:', ...step].join('\n'),
      ),
    ).map(({ persistsCredentials }) => persistsCredentials);

  assert.deepEqual(
    persistence([
      '      - uses: actions/checkout@v4',
      '        with:',
      '          persist-credentials: false',
    ]),
    [false],
  );
  assert.deepEqual(persistence(['      - uses: actions/checkout@v4']), [true]);
  assert.deepEqual(persistence(["      - uses: 'actions/checkout@v4'"]), [true]);
  assert.deepEqual(
    persistence([
      '      - uses: actions/checkout@v4',
      '        with: { ref: main }',
      '        env:',
      '          persist-credentials: false',
    ]),
    [true],
  );
  assert.deepEqual(
    persistence([
      '      - uses: actions/checkout@v4',
      '        with:',
      "          persist-credentials: 'false'",
    ]),
    [true],
  );
});

const runScript = (script, env, args = []) =>
  new Promise((resolve, reject) => {
    const child = spawn(fileURLToPath(new URL(script, import.meta.url)), args, {
      env: { ...process.env, ...env },
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });

const withStubEndpoint = async (statusCode, probe) => {
  let requests = 0;
  const server = http.createServer((request, response) => {
    requests += 1;
    response.writeHead(statusCode).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    return { ...(await probe(url)), requests: () => requests };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

const probeBeta = (url) =>
  runScript('./keep-alive-probe.sh', {
    BETA_HEALTH_URL: url,
    KEEP_ALIVE_RETRY_DELAY_SECONDS: '0',
  });

test('the keep-alive probe fails after retrying a beta endpoint that answers 500', async () => {
  const result = await withStubEndpoint(500, probeBeta);
  assert.equal(result.code, 1, 'a persistent 500 must fail the job (ylabs#3910)');
  assert.equal(result.requests(), 3, 'the probe retries before failing');
  assert.match(result.output, /::error::.*last HTTP 500/, 'a red run names the status it saw');
});

test('the keep-alive probe passes when beta answers 2xx', async () => {
  const result = await withStubEndpoint(204, probeBeta);
  assert.equal(result.code, 0);
  assert.equal(result.requests(), 1);
});

test('the keep-alive probe retries and reports a transport failure instead of aborting', async () => {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));

  const result = await probeBeta(`http://127.0.0.1:${port}/`);
  assert.equal(result.code, 1);
  assert.equal(result.output.match(/^attempt \d\/3: HTTP 000$/gm)?.length, 3);
  assert.match(result.output, /::error::.*last HTTP 000/);
});

const checkReleaseHold = (liveState) => {
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-hold-gh-'));
  const ghStub = path.join(stubDir, 'gh');
  fs.writeFileSync(
    ghStub,
    liveState === null
      ? '#!/usr/bin/env bash\necho "gh: HTTP 502" >&2\nexit 1\n'
      : `#!/usr/bin/env bash\ncat <<'JSON'\n${JSON.stringify(liveState)}\nJSON\n`,
    { mode: 0o755 },
  );
  return runScript('./release-hold-check.sh', {
    PATH: `${stubDir}${path.delimiter}${process.env.PATH}`,
    PR_NUMBER: '1',
    TARGET_REPO: 'example/example',
  }).finally(() => fs.rmSync(stubDir, { recursive: true, force: true }));
};

test('release-hold decides from the live pull request state it reads at run time', async () => {
  // A re-run replays the original event payload, so the check must read the
  // labels and draft flag live or it would clear a hold still in effect (ylabs#3911).
  const clear = await checkReleaseHold({ isDraft: false, labels: [{ name: 'ready' }] });
  assert.equal(clear.code, 0, clear.output);

  const draft = await checkReleaseHold({ isDraft: true, labels: [] });
  assert.equal(draft.code, 1);
  assert.match(draft.output, /::error::This promotion is still a draft/);

  for (const spelling of ['hold', 'Hold', 'HOLD']) {
    const held = await checkReleaseHold({ isDraft: false, labels: [{ name: spelling }] });
    assert.equal(held.code, 1, `a '${spelling}' label must block the promotion`);
    assert.match(held.output, /::error::The 'hold' label is set/);
  }

  const unreadable = await checkReleaseHold(null);
  assert.notEqual(unreadable.code, 0, 'an unreadable live state must fail closed');
});

// The behaviour tests above run the scripts, so they cannot see the workflow
// wiring them up. These pin the wiring: what the job probes, and where its
// decision comes from. Both defects were in the workflow, not in a script.
test('the keep-alive job probes the served API and keeps its exit status', () => {
  assert.match(
    keepAliveWorkflow,
    /BETA_HEALTH_URL:\s*https:\/\/ylabs-gr4v\.onrender\.com\/api\/config\s*$/m,
    'keep-alive must probe /api/config: the service root answers 2xx while the API answers 500, which is exactly the green history ylabs#3910 reports',
  );
  for (const [name, source] of [
    ['keep-alive.yml', keepAliveWorkflow],
    [
      'keep-alive-probe.sh',
      fs.readFileSync(new URL('./keep-alive-probe.sh', import.meta.url), 'utf8'),
    ],
  ]) {
    assert.doesNotMatch(
      source,
      /curl[^\n]*\|\|\s*(echo|true)/,
      `${name} must not discard the probe exit status: \`|| echo\` turned three days of HTTP 500 on beta into an unbroken green history (ylabs#3910)`,
    );
  }
});

test('the release-hold job reads live state rather than the replayed event payload', () => {
  // github.event is a frozen copy of the payload that started the run, so a
  // re-run of an earlier attempt re-reads the labels and draft flag as they were
  // then and would clear a hold that is still in effect (ylabs#3911).
  assert.doesNotMatch(
    releaseHoldWorkflow,
    /github\.event\.pull_request\.labels/,
    'release-hold must not read labels from the event payload',
  );
  assert.doesNotMatch(
    releaseHoldWorkflow,
    /github\.event\.pull_request\.draft/,
    'release-hold must not read draft state from the event payload',
  );
  assert.match(
    releaseHoldWorkflow,
    /pull-requests:\s*read/,
    'reading the live pull request state needs the pull-requests: read scope',
  );
  assert.match(
    fs.readFileSync(new URL('./release-hold-check.sh', import.meta.url), 'utf8'),
    /gh pr view[^\n]*--json isDraft,labels/,
    'the check must read the live label and draft state at run time',
  );
  for (const trigger of [
    'labeled',
    'unlabeled',
    'ready_for_review',
    'converted_to_draft',
    'synchronize',
  ]) {
    assert.match(
      releaseHoldWorkflow,
      new RegExp(`\\b${trigger}\\b`),
      `release-hold must keep the ${trigger} trigger so a state change still produces a new run`,
    );
  }
  assert.match(
    releaseHoldWorkflow,
    /name:\s*release-hold/,
    'the job name is the required context name on the main ruleset and must not change',
  );
});

const workflowDirectory = new URL('../.github/workflows/', import.meta.url);
const parsedWorkflows = () =>
  fs
    .readdirSync(workflowDirectory)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .map((file) => [file, yaml.load(fs.readFileSync(new URL(file, workflowDirectory), 'utf8'))]);
const workflowSteps = (workflow) =>
  Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? []);
const runsCommand = (step, ...tokens) =>
  typeof step.run === 'string' &&
  step.run
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .some((line) => tokens.every((token, index) => line[index] === token));

test('every workflow takes its Node major from .node-version', () => {
  const declared = fs.readFileSync(new URL('../.node-version', import.meta.url), 'utf8').trim();
  assert.match(
    declared,
    /^\d+$/,
    '.node-version must hold a bare major, because it is read by setup-node and by the hosting provider',
  );

  for (const [file, workflow] of parsedWorkflows()) {
    for (const step of workflowSteps(workflow)) {
      if (!step.uses?.startsWith('actions/setup-node@')) continue;
      assert.equal(
        step.with?.['node-version-file'],
        '.node-version',
        `${file} must read the Node major from .node-version so CI and the deployed runtime cannot drift (ylabs#3915)`,
      );
      assert.equal(
        step.with?.['node-version'],
        undefined,
        `${file} must not pin a Node major inline beside the file it is supposed to read`,
      );
    }
  }

  // A bump is one commit that moves the file and every manifest together, so a
  // manifest floor can never sit below the only major CI exercises.
  const bound = `>=${declared} <${Number(declared) + 1}`;
  for (const manifest of ['../package.json', '../server/package.json', '../client/package.json']) {
    const { engines } = JSON.parse(fs.readFileSync(new URL(manifest, import.meta.url), 'utf8'));
    assert.equal(
      engines?.node,
      bound,
      `${manifest} must bound engines.node to the major .node-version declares`,
    );
  }
});

test('the documented installs use the Corepack pin and builtin installer CI uses', () => {
  const readDoc = (doc) => fs.readFileSync(new URL(doc, import.meta.url), 'utf8');
  const ciCorepack = ciWorkflow.match(/npm install -g (corepack@\d+\.\d+\.\d+)/)?.[1];
  assert.ok(ciCorepack, 'ci.yml must pin a Corepack version for the documented build to match');
  assert.ok(
    readDoc('../docs/release-process.md').includes(
      `\`npm install -g ${ciCorepack} && corepack enable && bash scripts/install-all.sh --immutable\``,
    ),
    'docs/release-process.md must give the Render build the Corepack pin ci.yml installs and the builtin immutable installs, because a package.json script cannot run on a fresh checkout',
  );
  for (const doc of ['../README.md', '../DEVELOPER_GUIDE.md']) {
    const text = readDoc(doc);
    const pins = [...text.matchAll(/npm install -g (corepack@\S+)/g)].map((match) => match[1]);
    assert.ok(pins.length > 0, `${doc} must tell contributors to install Corepack`);
    for (const pin of pins) {
      assert.equal(pin, ciCorepack, `${doc} must install the Corepack version ci.yml pins`);
    }
    assert.match(
      text,
      /^bash scripts\/install-all\.sh$/m,
      `${doc} must give the builtin installer as the first install`,
    );
  }
});

const runInstallAll = (args) => {
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-all-yarn-'));
  const log = path.join(stubDir, 'yarn.log');
  fs.writeFileSync(
    path.join(stubDir, 'yarn'),
    '#!/usr/bin/env bash\necho "$PWD|$*" >> "$YARN_STUB_LOG"\n',
    { mode: 0o755 },
  );
  return runScript(
    './install-all.sh',
    { PATH: `${stubDir}${path.delimiter}${process.env.PATH}`, YARN_STUB_LOG: log },
    args,
  )
    .then((result) => ({
      ...result,
      calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [],
    }))
    .finally(() => fs.rmSync(stubDir, { recursive: true, force: true }));
};

test('the first-install entry point runs only yarn install builtins', async () => {
  const repoRoot = fs.realpathSync(fileURLToPath(new URL('..', import.meta.url)));
  const expectedCalls = (flag) =>
    ['install', '--cwd server install', '--cwd client install'].map(
      (argv) => `${repoRoot}|${argv}${flag}`,
    );

  const plain = await runInstallAll([]);
  assert.equal(plain.code, 0, plain.output);
  assert.deepEqual(plain.calls, expectedCalls(''));

  const immutable = await runInstallAll(['--immutable']);
  assert.equal(immutable.code, 0, immutable.output);
  assert.deepEqual(immutable.calls, expectedCalls(' --immutable'));

  const unknown = await runInstallAll(['--frozen']);
  assert.notEqual(unknown.code, 0, 'an unknown flag must fail rather than install');
  assert.deepEqual(unknown.calls, []);
});

test('workflows pin Corepack instead of installing whatever is latest', () => {
  for (const [file, workflow] of parsedWorkflows()) {
    const steps = workflowSteps(workflow);
    const enableIndex = steps.findIndex((step) => runsCommand(step, 'corepack', 'enable'));
    if (enableIndex === -1) continue;
    const installs = steps
      .slice(0, enableIndex)
      .flatMap((step) => step.run?.trim().split(/\s+/) ?? [])
      .filter((token) => token.startsWith('corepack@'));
    assert.equal(
      installs.length,
      1,
      `${file} must install Corepack exactly once before enabling it`,
    );
    assert.match(
      installs[0],
      /^corepack@\d+\.\d+\.\d+$/,
      `${file} must pin the Corepack version: an unpinned install lets a new release change the tool that selects Yarn between two runs of the same commit (ylabs#3915)`,
    );
  }
});

test('every workflow job bounds its runtime', () => {
  for (const [file, workflow] of parsedWorkflows()) {
    const jobs = Object.entries(workflow.jobs ?? {});
    assert.ok(jobs.length > 0, `${file} must declare at least one job`);
    for (const [jobId, job] of jobs) {
      assert.ok(
        Number.isInteger(job['timeout-minutes']) && job['timeout-minutes'] > 0,
        `${file} job ${jobId} must set timeout-minutes: the 360-minute default holds a required check pending for six hours before it fails (ylabs#3916)`,
      );
    }
  }
});

test('the required checks also run on the commit that lands on beta', () => {
  // The beta ruleset does not require branches to be up to date (#3425), so a
  // pull request is tested against the base it last saw. The push run is the
  // only test of the squash commit that actually reaches beta (#1151, #1153).
  for (const [file, workflowSource] of [
    ['ci.yml', ciWorkflow],
    ['e2e-smoke.yml', e2eSmokeWorkflow],
  ]) {
    const workflow = yaml.load(workflowSource);
    assert.deepEqual(
      workflow.on.push?.branches,
      ['beta'],
      `${file} must run on pushes to beta so the merged result is tested (ylabs#3913)`,
    );
    assert.deepEqual(
      workflow.on.pull_request?.branches,
      ['main', 'beta'],
      `${file} must keep its pull request trigger so the required context still reports`,
    );
    // A cancelled or queued pull request run delays or fails a required
    // context, so only push runs share a concurrency group.
    assert.deepEqual(
      workflow.concurrency,
      {
        group:
          "${{ github.workflow }}-${{ github.event_name == 'push' && github.ref || github.run_id }}",
        'cancel-in-progress': true,
      },
      `${file} must share a concurrency group between push runs only`,
    );
  }
});

test('third-party actions stay SHA-pinned beside the version comment Dependabot rewrites', () => {
  const workflowDir = new URL('../.github/workflows/', import.meta.url);
  let pins = 0;
  for (const file of fs.readdirSync(workflowDir)) {
    const source = fs.readFileSync(new URL(file, workflowDir), 'utf8');
    const workflow = yaml.load(source);
    const references = Object.values(workflow.jobs ?? {}).flatMap((job) => [
      ...(job.uses ? [job.uses] : []),
      ...(job.steps ?? []).flatMap((step) => (step.uses ? [step.uses] : [])),
    ]);
    for (const reference of references) {
      pins += 1;
      assert.match(
        reference,
        /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/,
        `${file} pins ${reference} by name: a mutable tag lets an upstream force-push change what runs here`,
      );
      // The same-line `# vX` comment is the text contract Dependabot reads and
      // rewrites alongside the SHA, and YAML drops comments, so this one check
      // reads the source line. A pin without it gets no update proposal (ylabs#3914).
      const pinLines = source.split('\n').filter((line) => line.includes(`uses: ${reference}`));
      assert.ok(pinLines.length > 0, `${file} must declare ${reference} on a single uses line`);
      for (const line of pinLines) {
        assert.match(
          line,
          /@[0-9a-f]{40}\s+#\s*v\d+(\.\d+)*\s*$/,
          `${file} must name the release beside ${reference} so the pin stays maintainable`,
        );
      }
    }
  }
  assert.ok(pins > 0, 'the workflows must still use at least one pinned action');
});

test('a Dependabot updater keeps the action pins from freezing', () => {
  const config = yaml.load(
    fs.readFileSync(new URL('../.github/dependabot.yml', import.meta.url), 'utf8'),
  );
  assert.equal(config.version, 2);
  const actionUpdaters = (config.updates ?? []).filter(
    (update) => update['package-ecosystem'] === 'github-actions',
  );
  assert.equal(
    actionUpdaters.length,
    1,
    'a SHA pin never updates itself, so an updater is what keeps it from freezing on a deprecated runtime (ylabs#3914)',
  );
  const [updater] = actionUpdaters;
  assert.equal(updater.directory, '/', 'the workflows live at the repository root');
  assert.equal(
    updater['target-branch'],
    'beta',
    'pull requests are based on beta here, so an updater left on the default target would open against the production branch',
  );
  assert.equal(updater.schedule?.interval, 'weekly');
  const groupPatterns = Object.values(updater.groups ?? {}).flatMap(
    (group) => group.patterns ?? [],
  );
  assert.ok(
    groupPatterns.includes('*'),
    'a group matching every action keeps a bump to one pull request rather than one per action',
  );
});

// The live-prod smoke now runs only on a promotion, so post-promotion-verify is
// the sole workflow carrying these assertions. Deleting the standing schedule
// left `security:smoke:production` reachable from this workflow and from an
// operator's shell; the visibility-label guarantee it used to police lives in
// server/src/services/__tests__/researchEntityDto.test.ts, which blocks a merge
// instead of reporting after the fact.
test('post-promotion verify checks live hardening headers and current API routes', () => {
  assert.match(postPromotionVerifyWorkflow, /name:\s*Post-Promotion Verify/);
  assert.match(postPromotionVerifyWorkflow, /branches:\s*\n\s*-\s*main/);
  assert.match(postPromotionVerifyWorkflow, /yarn security:smoke:production/);
  assert.match(postPromotionVerifyWorkflow, /SMOKE_API_BASE:/);
  assert.match(postPromotionVerifyWorkflow, /SMOKE_APP_BASE:/);
  assert.doesNotMatch(postPromotionVerifyWorkflow, /github\.sha/);
  assert.match(postPromotionVerifyWorkflow, /run:\s*corepack enable/);
  assert.match(postPromotionVerifyWorkflow, /yarn install --immutable/);
  assert.match(postPromotionVerifyWorkflow, /yarn --cwd server install --immutable/);
  assert.match(postPromotionVerifyWorkflow, /yarn --cwd client install --immutable/);
  assert.doesNotMatch(
    postPromotionVerifyWorkflow,
    /run:\s*[^\n]*yarn install:all(?::immutable)?(?:\s|$)/,
  );
});

test('no workflow reintroduces a standing schedule against production', () => {
  const workflowDir = new URL('../.github/workflows/', import.meta.url);
  for (const file of fs.readdirSync(workflowDir)) {
    const workflow = fs.readFileSync(new URL(file, workflowDir), 'utf8');
    if (!/yarn security:smoke:production/.test(workflow)) continue;
    assert.doesNotMatch(
      workflow,
      /schedule:/,
      `${file} must not run the production smoke on a schedule: an unread standing check prints production payloads into this public repository's Actions log`,
    );
  }
});

test('deployed runtime emits HSTS independent of proxy request shape', () => {
  const source = fs.readFileSync(
    new URL('../server/src/middleware/securityHeaders.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /requiresDeployedRuntimeSecurity/);
  assert.match(source, /if \(!allowLocalDevelopmentConnect\) \{/);
  assert.match(source, /directives\.push\('upgrade-insecure-requests'\)/);
  assert.match(source, /"base-uri 'none'"/);
  assert.doesNotMatch(source, /"base-uri 'self'"/);
  assert.match(source, /"frame-src 'none'"/);
  assert.doesNotMatch(source, /"frame-src 'self' https:\/\/accounts\.google\.com"/);
  assert.match(
    source,
    /"form-action 'self' https:\/\/secure\.its\.yale\.edu https:\/\/secure\.its\.yale\.edu\/cas"/,
  );
  assert.doesNotMatch(source, /form-action[^"]*accounts\.google\.com/);
  assert.match(source, /"script-src-attr 'none'"/);
  assert.match(source, /X-XSS-Protection', '0'/);
  assert.match(source, /X-Download-Options', 'noopen'/);
  assert.match(source, /X-Permitted-Cross-Domain-Policies', 'none'/);
  assert.match(
    source,
    /requiresDeployedRuntimeSecurity\(\)[\s\S]*req\.secure[\s\S]*x-forwarded-proto/,
  );
  assert.match(source, /Strict-Transport-Security', 'max-age=31536000; includeSubDomains'/);
});

test('served browser assets do not expose source maps or hidden static files', () => {
  const appSource = fs.readFileSync(new URL('../server/src/app.ts', import.meta.url), 'utf8');
  const staticSource = fs.readFileSync(
    new URL('../server/src/middleware/clientStaticAssets.ts', import.meta.url),
    'utf8',
  );
  const tsupSource = fs.readFileSync(new URL('../server/tsup.config.ts', import.meta.url), 'utf8');

  assert.match(
    staticSource,
    /function blockSourceMapAssetRequests\(\s*req: express\.Request,\s*res: express\.Response,\s*next: express\.NextFunction,?\s*\)/,
  );
  assert.match(staticSource, /req\.path\.endsWith\('\.map'\)/);
  assert.match(staticSource, /res\.setHeader\('Cache-Control', 'no-store, private, max-age=0'\)/);
  assert.match(staticSource, /res\.status\(404\)\.type\('text\/plain'\)\.send\('Not found'\)/);
  assert.match(staticSource, /router\.use\(blockSourceMapAssetRequests\);[\s\S]*express\.static/);
  assert.match(staticSource, /express\.static\(clientDistPath, \{/);
  assert.match(staticSource, /dotfiles: 'ignore'/);
  assert.match(staticSource, /index: false/);
  assert.match(appSource, /function shouldServeSpaFallback\(req: express\.Request\): boolean/);
  assert.match(appSource, /segments\.some\(\(segment\) => segment\.startsWith\('\.'\)\)/);
  assert.match(appSource, /path\.extname\(lastSegment\)/);
  assert.match(appSource, /function sendStaticNotFound\(res: express\.Response\)/);
  assert.match(appSource, /return sendStaticNotFound\(res\)/);
  assert.doesNotMatch(
    appSource,
    /app\.use\(express\.static\(path\.join\(__dirname, '\.\.\/\.\.\/client\/dist'\)\)\)/,
  );
  assert.match(tsupSource, /sourcemap: false/);
  assert.doesNotMatch(tsupSource, /sourcemap: true/);
});

test('server start refuses stale build artifacts', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(new URL('../server/package.json', import.meta.url), 'utf8'),
  );
  const guardSource = fs.readFileSync(
    new URL('../scripts/ensure-server-build-fresh.mjs', import.meta.url),
    'utf8',
  );

  assert.equal(
    packageJson.scripts.start,
    'node ../scripts/ensure-server-build-fresh.mjs && node build/index.js',
  );
  assert.match(
    guardSource,
    /const buildEntrypoint = path\.join\(serverRoot, 'build', 'index\.js'\)/,
  );
  assert.match(
    guardSource,
    /const forbiddenBuildArtifacts = \[path\.join\(buildDir, 'index\.js\.map'\)\]/,
  );
  assert.match(guardSource, /path\.join\(serverRoot, 'src'\)/);
  assert.match(guardSource, /path\.join\(serverRoot, 'tsup\.config\.ts'\)/);
  assert.match(guardSource, /fs\.existsSync\(buildEntrypoint\)/);
  assert.match(guardSource, /for \(const artifact of forbiddenBuildArtifacts\)/);
  assert.match(guardSource, /server build contains source-map artifacts/);
  assert.match(guardSource, /sourceMtimeMs > buildMtimeMs \+ 1000/);
  assert.match(guardSource, /Run `yarn build:server` before start/);
});

test('server startup fails closed and sanitizes initialization errors', () => {
  const source = fs.readFileSync(new URL('../server/src/index.ts', import.meta.url), 'utf8');

  assert.match(source, /import \{ sanitizeLogValue \} from '\.\/utils\/logSanitizer'/);
  assert.match(source, /console\.error\('Failed to start app:', sanitizeLogValue\(error\)\)/);
  assert.match(source, /process\.exit\(1\)/);
  assert.doesNotMatch(source, /Failed to start app with error[\s\S]*\$\{e\}/);
});

test('NIH Reporter matched user ids use safe serialization', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/sources/nihReporterScraper.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const researcherId = resolution\.researcherId\.toString\(\)/);
  assert.match(source, /_id: researcherId,/);
  assert.doesNotMatch(source, /_id: String\(candidate\._id\)/);
  assert.doesNotMatch(source, /String\(candidate\._id\)/);
});

test('credentialed scraper backfills do not log raw caught error messages', () => {
  const files = [
    '../server/src/scripts/backfillResearchDescriptions.ts',
    '../server/src/scrapers/entityMaterializer.ts',
    '../server/src/scrapers/sources/nihReporterScraper.ts',
    '../server/src/scrapers/sources/undergradFellowshipRecipientScraper.ts',
    '../server/src/scrapers/sources/centersInstitutesScraper.ts',
    '../server/src/scrapers/sources/departmentRosterScraper.ts',
    '../server/src/scrapers/sources/centerDirectorLLMExtractor.ts',
    '../server/src/scrapers/sources/centerAffiliationLLMExtractor.ts',
    '../server/src/scrapers/sources/labMicrositeUndergradLLMExtractor.ts',
  ];

  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /sanitizeLogValue/);
    assert.doesNotMatch(source, /\(error as Error\)\.message/);
    assert.doesNotMatch(source, /err\?\.message \|\| err/);
    assert.doesNotMatch(source, /retryErr\?\.message \|\| retryErr/);
    assert.doesNotMatch(source, /errorMessage: retryErr\?\.message/);
    assert.doesNotMatch(source, /error\?\.message \|\| error/);
    assert.doesNotMatch(source, /failed for \$\{user\.netid \|\| orcid\}/);
    assert.doesNotMatch(source, /fetch failed for \$\{doi\}/);
    assert.doesNotMatch(source, /error fetching for \$\{yaleNetId\}/);
  }
});

test('credentialed lab microsite WorkPlanner logs avoid name fallbacks', () => {
  const files = [
    '../server/src/scrapers/sources/labMicrositeDescriptionLLMExtractor.ts',
    '../server/src/scrapers/sources/labMicrositeUndergradLLMExtractor.ts',
  ];

  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\[\$\{lab\.name\}\] skipped by WorkPlanner/);
    assert.doesNotMatch(source, /\[\$\{lab\.slug \|\| lab\.name\}\] skipped by WorkPlanner/);
  }
});

test('audit and index id stringifiers avoid arbitrary object toString coercion', () => {
  const files = [
    '../server/src/services/visibilityRepairQueueService.ts',
    '../server/src/scripts/staleObservationConflictReview.ts',
    '../server/src/scripts/betaDataQuality.ts',
    '../server/src/scripts/duplicateEntityNameReview.ts',
  ];

  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /typeof value === 'object' && 'toString' in value/);
    assert.doesNotMatch(source, /\(value as \{ toString\(\): string \}\)\.toString\(\)/);
    assert.doesNotMatch(source, /value\.toString\(\)/);
  }
});

test('public client providers avoid raw auth and config error logs', () => {
  const userProvider = fs.readFileSync(
    new URL('../client/src/providers/UserContextProvider.tsx', import.meta.url),
    'utf8',
  );
  const configProvider = fs.readFileSync(
    new URL('../client/src/providers/ConfigContextProvider.tsx', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(userProvider, /console\.error\('Auth check failed:',\s*error\)/);
  assert.doesNotMatch(configProvider, /console\.error\('Error fetching config:',\s*err\)/);
  assert.doesNotMatch(configProvider, /rawResponse:\s*data/);
});

test('public favorite and save flows avoid raw Axios console errors', () => {
  const files = [
    '../client/src/hooks/useFavorites.ts',
    '../client/src/pages/fellowships.tsx',
    '../client/src/components/accounts/ProgramWatch.tsx',
  ];

  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /console\.error\([^;\n]*,\s*error\)/);
    assert.doesNotMatch(source, /console\.error\([^;\n]*,\s*err\)/);
  }
});

test('public search loaders avoid raw Axios console errors', () => {
  const files = ['../client/src/providers/FellowshipSearchContextProvider.tsx'];

  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /console\.error\([^;\n]*,\s*error\)/);
    assert.doesNotMatch(source, /console\.error\([^;\n]*,\s*err\)/);
  }
});

test('admin client surfaces avoid raw caught console errors', () => {
  const files = [
    '../client/src/pages/analytics.tsx',
    '../client/src/components/admin/AdminOperatorBoard.tsx',
    '../client/src/components/admin/AdminResearchAreas.tsx',
    '../client/src/components/admin/AdminFellowshipsTable.tsx',
    '../client/src/components/admin/AdminFellowshipEditModal.tsx',
    '../client/src/components/admin/AdminDepartments.tsx',
  ];

  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /console\.error\(err\)/);
    assert.doesNotMatch(source, /console\.error\([^;\n]*,\s*error\)/);
    assert.doesNotMatch(source, /console\.error\([^;\n]*,\s*err\)/);
    assert.doesNotMatch(source, /error instanceof Error \? error\.message/);
    assert.doesNotMatch(source, /err instanceof Error \? err\.message/);
  }
});

test('analytics route error responses do not trust thrown message prefixes', () => {
  const source = fs.readFileSync(
    new URL('../server/src/routes/analytics.ts', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(source, /error instanceof Error \? error\.message/);
  assert.doesNotMatch(source, /message\.startsWith\('Invalid'\)/);
  assert.doesNotMatch(source, /json\(\{ error: error\.message \}\)/);
});

test('admin grant route error responses do not trust thrown message prefixes', () => {
  const routeSource = fs.readFileSync(
    new URL('../server/src/routes/admin.ts', import.meta.url),
    'utf8',
  );
  const serviceSource = fs.readFileSync(
    new URL('../server/src/services/adminGrantService.ts', import.meta.url),
    'utf8',
  );

  assert.match(serviceSource, /export class AdminGrantValidationError extends Error/);
  assert.match(
    serviceSource,
    /throw new AdminGrantValidationError\('Invalid admin grant request'\)/,
  );
  assert.match(routeSource, /AdminGrantValidationError/);
  assert.match(routeSource, /error instanceof AdminGrantValidationError/);
  assert.doesNotMatch(routeSource, /message\.startsWith\('Invalid'\)/);
  assert.doesNotMatch(routeSource, /error instanceof Error \? error\.message/);
});

test('admin list search responses map coded validation failures to fixed copy', () => {
  const source = fs.readFileSync(new URL('../server/src/routes/admin.ts', import.meta.url), 'utf8');

  assert.match(source, /type AdminSearchErrorCode = 'notString' \| 'tooLong'/);
  assert.match(source, /const ADMIN_SEARCH_ERROR_MESSAGES: Record<AdminSearchErrorCode, string>/);
  assert.match(source, /errorCode: 'notString'/);
  assert.match(source, /errorCode: 'tooLong'/);
  assert.match(source, /ADMIN_SEARCH_ERROR_MESSAGES\[adminSearch\.errorCode\]/);
  assert.doesNotMatch(source, /json\(\{ error: adminSearch\.error \}\)/);
});

test('session secret validation trims before enforcing deployed length', () => {
  const source = fs.readFileSync(new URL('../server/src/app.ts', import.meta.url), 'utf8');

  assert.match(source, /const sessionSecret = \(process\.env\.SESSION_SECRET \?\? ''\)\.trim\(\)/);
  assert.match(source, /const MIN_SESSION_SECRET_LENGTH = 32/);
  assert.match(source, /const MIN_SESSION_SECRET_UNIQUE_CHARS = 8/);
  assert.match(source, /function isWeakSessionSecret\(value: string\): boolean/);
  assert.match(source, /uniqueChars < MIN_SESSION_SECRET_UNIQUE_CHARS/);
  assert.match(source, /compact\.includes\(token\)/);
  assert.match(source, /'sessionsecret'/);
  assert.match(source, /'testsecret'/);
  assert.match(
    source,
    /if \(sessionSecret\.length < MIN_SESSION_SECRET_LENGTH \|\| isWeakSessionSecret\(sessionSecret\)\)/,
  );
  assert.match(source, /keys: \[sessionSecret\]/);
  assert.doesNotMatch(source, /process\.env\.SESSION_SECRET\.length < 32/);
  assert.doesNotMatch(source, /keys: \[process\.env\.SESSION_SECRET \?\? ''\]/);
});

test('API body parsers have explicit abuse-resistant size and parameter limits', () => {
  const source = fs.readFileSync(new URL('../server/src/app.ts', import.meta.url), 'utf8');

  assert.match(source, /const API_BODY_LIMIT = '64kb'/);
  assert.match(source, /const API_URLENCODED_PARAMETER_LIMIT = 100/);
  assert.match(source, /\.set\('query parser', 'simple'\)/);
  assert.match(source, /express\.json\(\{ limit: API_BODY_LIMIT \}\)/);
  assert.match(
    source,
    /express\.urlencoded\(\{\s*extended: false,\s*limit: API_BODY_LIMIT,\s*parameterLimit: API_URLENCODED_PARAMETER_LIMIT,/,
  );
  assert.doesNotMatch(source, /\.set\('query parser', 'extended'\)/);
  assert.doesNotMatch(source, /express\.json\(\)/);
  assert.doesNotMatch(source, /express\.urlencoded\(\{ extended: false \}\)/);
});

// Named for the wiring it pins, not for a metering guarantee. It asserts that one
// limiter covers /api with no discovery carve-out and that the key function is the
// netid-validating one. It does NOT assert that every caller is effectively
// metered: the anonymous key is caller-resettable, so an earlier name claiming
// "all API traffic is metered" asserted a property the measurement in #2420
// contradicts.
test('a single /api limiter is wired with no anonymous discovery carve-out', () => {
  const source = fs.readFileSync(new URL('../server/src/app.ts', import.meta.url), 'utf8');

  const limiterSource = fs.readFileSync(
    new URL('../server/src/middleware/rateLimiters.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const WRITE_LIKE_SAFE_METHOD_API_PATHS = new Set<string>\(\)/);
  assert.match(limiterSource, /const RATE_LIMIT_NETID_RE = \/\^\[A-Za-z0-9\]\{2,12\}\$\/;/);
  assert.match(
    limiterSource,
    /const normalizedRateLimitNetId = \(value: unknown\): string \| undefined =>/,
  );
  assert.match(limiterSource, /if \(typeof value !== 'string'\) return undefined/);
  assert.match(limiterSource, /RATE_LIMIT_NETID_RE\.test\(normalized\) \? normalized : undefined/);
  assert.match(limiterSource, /normalizedRateLimitNetId\(user\?\.netId \?\? user\?\.netid\)/);
  assert.doesNotMatch(limiterSource, /return `user:\$\{user\.netId\}`/);
  assert.doesNotMatch(limiterSource, /publicDiscoveryLimiter/);
  assert.doesNotMatch(source, /publicDiscoveryLimiter/);
  assert.doesNotMatch(limiterSource, /Too many discovery requests/);
  assert.match(limiterSource, /export const globalLimiter = rateLimit\(\{/);
  assert.match(limiterSource, /max: 1000,/);
  assert.match(
    limiterSource,
    /const requestWasSuccessful = \(_req: Request, res: Response\): boolean => res\.statusCode < 500/,
  );
  assert.match(limiterSource, /skipFailedRequests: true,/);
  assert.match(source, /\.use\('\/api', globalLimiter\)/);
  assert.doesNotMatch(source, /\.use\('\/api\/research'/);
  assert.doesNotMatch(source, /\.use\('\/api\/opportunities'/);
  assert.doesNotMatch(
    source,
    /req\.method === 'GET' \|\| req\.method === 'HEAD' \|\| req\.method === 'OPTIONS'/,
  );

  // Write limiting is opt-in per route and login has a dedicated per-IP limiter;
  // neither introduces an anonymous discovery carve-out.
  assert.match(limiterSource, /export const writeLimit = rateLimit\(\{/);
  assert.match(limiterSource, /export const authLimiter = rateLimit\(\{/);
});

test('no rate limiter declares a 5xx exemption that express-rate-limit never applies', () => {
  const limiterSource = fs.readFileSync(
    new URL('../server/src/middleware/rateLimiters.ts', import.meta.url),
    'utf8',
  );

  // Brace-matched rather than read with a lazy `\n});` terminator, because a
  // terminator truncates an options block at the first line-initial `});` and
  // would then silently miss any property declared after it. Over-reading fails
  // loudly; under-reading reports success.
  const blocks = [];
  const declaration = /export const (\w+) = rateLimit\(\{/g;
  for (const match of limiterSource.matchAll(declaration)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let cursor = start;
    while (cursor < limiterSource.length && depth > 0) {
      if (limiterSource[cursor] === '{') depth += 1;
      else if (limiterSource[cursor] === '}') depth -= 1;
      cursor += 1;
    }
    assert.equal(depth, 0, `${match[1]} has an unbalanced rateLimit() options block`);
    blocks.push({ name: match[1], options: limiterSource.slice(start, cursor - 1) });
  }

  // A limiter configured out of line would leave this scan reading nothing and
  // reporting success, so the call sites and the readable blocks must agree.
  // Counted over the source with line comments stripped, so a prose mention of
  // the call does not read as one.
  const callSites = limiterSource.replace(/^[ \t]*\/\/.*$/gm, '').match(/\brateLimit\(/g) ?? [];
  assert.equal(
    blocks.length,
    callSites.length,
    'every rateLimit() call must pass an inline options block this policy can read',
  );

  // express-rate-limit consults `requestWasSuccessful` only inside
  // `if (config.skipFailedRequests || config.skipSuccessfulRequests)`, so a
  // limiter that declares the predicate without one of those flags advertises an
  // exemption that does not exist (#2990). Matched by anchored property name
  // rather than by one formatting of it, so the shorthand, an explicit
  // `requestWasSuccessful: requestWasSuccessful`, and an inline predicate all
  // count.
  const refunding = [];
  for (const { name, options } of blocks) {
    const declaresPredicate = /^\s*requestWasSuccessful\s*[,:]/m.test(options);
    const consultsPredicate = /^\s*skip(?:Failed|Successful)Requests:\s*true\s*,?$/m.test(options);
    assert.ok(
      !declaresPredicate || consultsPredicate,
      `${name} declares requestWasSuccessful but sets neither skipFailedRequests nor skipSuccessfulRequests, so the predicate is never consulted and every response counts`,
    );
    if (declaresPredicate) refunding.push(name);
  }

  // First contact meters the session mint, which `ensureAnonymousRateLimitId`
  // performs before this limiter runs, so a failed response has already spent
  // the resource and is deliberately not refunded. Compared as a set, because
  // declaration order is not the invariant. Changing this also requires updating
  // the rate-limit section of `skills/auth-security/SKILL.md`.
  assert.deepEqual(
    [...refunding].sort(),
    ['authLimiter', 'globalLimiter', 'writeLimit'],
    'the set of limiters that refund a 5xx changed; update the rate-limit section of skills/auth-security/SKILL.md to match',
  );
  const firstContact = blocks.find(({ name }) => name === 'firstContactLimiter');
  assert.ok(firstContact, 'firstContactLimiter must be configured inline');
  assert.doesNotMatch(firstContact.options, /requestWasSuccessful/);
  assert.doesNotMatch(firstContact.options, /skip(?:Failed|Successful)Requests/);
});

test('API responses default to private no-store cache headers', () => {
  const source = fs.readFileSync(new URL('../server/src/app.ts', import.meta.url), 'utf8');

  assert.match(
    source,
    /function setPrivateApiCacheHeaders\(\s*_req: express\.Request,\s*res: express\.Response,\s*next: express\.NextFunction,?\s*\)/,
  );
  assert.match(source, /res\.setHeader\('Cache-Control', 'no-store, private, max-age=0'\)/);
  assert.match(source, /res\.setHeader\('Pragma', 'no-cache'\)/);
  assert.match(source, /res\.setHeader\('Surrogate-Control', 'no-store'\)/);
  assert.match(source, /res\.setHeader\('Expires', '0'\)/);
  assert.match(source, /res\.setHeader\('X-Content-Type-Options', 'nosniff'\)/);
  assert.match(
    source,
    /\.use\('\/api', setPrivateApiCacheHeaders\)\s*\.use\(\s*'\/api',\s*csrfOriginGuard\(allowList/,
  );
});

test('mounted API routes sanitize caught errors before logging', () => {
  const routeFiles = [
    '../server/src/routes/admin.ts',
    '../server/src/routes/analytics.ts',
    '../server/src/routes/config.ts',
    '../server/src/routes/fellowships.ts',
    '../server/src/routes/programs.ts',
    '../server/src/routes/users.ts',
  ];

  for (const file of routeFiles) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(
      source,
      /console\.error\([^;\n]*(?:,\s*(?:err|error|analyticsError)\s*)\)/,
      `${file} logs a raw caught error instead of sanitizeLogValue(error)`,
    );
  }
});

test('research discovery write services reject object-shaped ids before Mongo upserts', () => {
  for (const [name, file, requiredGuard] of [
    [
      'access signal',
      '../server/src/services/signalService.ts',
      /if \(!researchEntityId\) return \{\}/,
    ],
  ]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(
      source,
      /const STORED_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/,
      `${name} must use strict 24-hex id checks`,
    );
    assert.match(
      source,
      /function toStoredId\(value\??: unknown\): unknown/,
      `${name} must normalize stored ids from unknown input`,
    );
    assert.match(
      source,
      /value instanceof mongoose\.Types\.ObjectId/,
      `${name} must preserve real ObjectIds`,
    );
    assert.match(source, /typeof value !== 'string'/, `${name} must reject object-shaped ids`);
    assert.match(source, /const id = value\.trim\(\)/, `${name} must trim string ids only`);
    assert.match(
      source,
      requiredGuard,
      `${name} must stop before upsert when required ids are invalid`,
    );
    assert.doesNotMatch(
      source,
      /ObjectId\.isValid\(value\)/,
      `${name} must not pass arbitrary values to Mongoose id validation`,
    );
    assert.doesNotMatch(
      source,
      /new mongoose\.Types\.ObjectId\(value\)/,
      `${name} must not construct ObjectIds from arbitrary values`,
    );
  }
});

test('research discovery write service return ids use safe serialization', () => {
  for (const [name, file, returnPattern] of [
    [
      'access signal',
      '../server/src/services/signalService.ts',
      /signalId: serializedDocumentId\(doc\?\._id\)/,
    ],
  ]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(
      source,
      /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/,
      `${name} must import the safe serializer`,
    );
    assert.match(source, returnPattern, `${name} must serialize returned ids safely`);
    assert.doesNotMatch(
      source,
      /String\(doc\._id\)/,
      `${name} must not stringify returned document ids`,
    );
    assert.doesNotMatch(
      source,
      /doc\?\._id \? String\(doc\._id\) : undefined/,
      `${name} must not conditionally stringify returned ids`,
    );
  }
});

test('same-PI research entity dedupe apply IDs reject object-shaped values', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/dedupeResearchEntitiesByPi.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const RESEARCH_ENTITY_PI_DEDUPE_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(source, /export function normalizeResearchEntityPiDedupeObjectId/);
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(source, /typeof value !== 'string'/);
  assert.match(source, /const trimmed = value\.trim\(\)/);
  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /id: serializedDocumentId\(entity\._id\) \|\| ''/);
  assert.match(
    source,
    /researchEntityId: serializedDocumentId\(row\._id\.researchEntityId\) \|\| ''/,
  );
  assert.match(source, /userId: serializedDocumentId\(row\._id\.userId\) \|\| ''/);
  assert.match(source, /serializedDocumentId\(row\._id\) \|\| ''/);
  assert.doesNotMatch(source, /ObjectId\.isValid/);
  assert.doesNotMatch(source, /new mongoose\.Types\.ObjectId\(group\.canonicalEntityId\)/);
  assert.doesNotMatch(source, /new mongoose\.Types\.ObjectId\(id\)/);
  assert.doesNotMatch(source, /new mongoose\.Types\.ObjectId\(value\)/);
  assert.doesNotMatch(source, /id: String\(entity\._id\)/);
  assert.doesNotMatch(source, /researchEntityId: String\(row\._id\.researchEntityId\)/);
  assert.doesNotMatch(source, /userId: String\(row\._id\.userId\)/);
});

test('stale observation supersession IDs reject object-shaped values', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/staleObservationConflictReview.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const STALE_OBSERVATION_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(source, /export function normalizeStaleObservationObjectId/);
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(source, /typeof value !== 'string'/);
  assert.match(source, /const trimmed = value\.trim\(\)/);
  assert.match(source, /const objectId = normalizeStaleObservationObjectId\(value\)/);
  assert.doesNotMatch(source, /ObjectId\.isValid/);
  assert.doesNotMatch(source, /new mongoose\.Types\.ObjectId\(value\)/);
});

test('surname lab disambiguation apply IDs reject object-shaped values', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/disambiguateSurnameLabNames.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const SURNAME_LAB_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(source, /export function normalizeSurnameLabObjectId/);
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(source, /typeof value !== 'string'/);
  assert.match(source, /const trimmed = value\.trim\(\)/);
  assert.match(source, /const entityObjectId = normalizeSurnameLabObjectId\(plan\.entityId\)/);
  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /id: serializedDocumentId\(entity\._id\) \|\| ''/);
  assert.match(
    source,
    /researchEntityId: serializedDocumentId\(member\.researchEntityId\) \|\| ''/,
  );
  assert.match(source, /userId: serializedDocumentId\(member\.userId\)/);
  assert.match(source, /id: serializedDocumentId\(user\._id\) \|\| ''/);
  assert.doesNotMatch(source, /new mongoose\.Types\.ObjectId\(plan\.entityId\)/);
  assert.doesNotMatch(source, /String\(entity\._id\)/);
  assert.doesNotMatch(source, /String\(member\.researchEntityId\)/);
  assert.doesNotMatch(source, /String\(user\._id\)/);
});

test('center director backfill only filters reject object-shaped IDs', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/backfillCenterDirectors.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /const CENTER_DIRECTOR_BACKFILL_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(source, /export function normalizeCenterDirectorBackfillObjectId/);
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(source, /typeof value !== 'string'/);
  assert.match(source, /const trimmed = value\.trim\(\)/);
  assert.match(source, /normalizeCenterDirectorBackfillObjectId\(value\)/);
  assert.match(source, /const rosterByEntityId = await getResearchEntityRosterByEntityId\(/);
  assert.match(source, /const withLeadSet = new Set<string>\(\)/);
  assert.match(source, /withLeadSet\.add\(entityId\)/);
  assert.match(source, /const centerId = serializedDocumentId\(doc\._id\) \|\| ''/);
  assert.match(source, /_id: centerId/);
  assert.match(
    source,
    /materializeInferredDirectorMembership\(\n\s*serializedDocumentId\(candidate\._id\) \|\| '',/,
  );
  assert.doesNotMatch(source, /ObjectId\.isValid/);
  assert.doesNotMatch(source, /new mongoose\.Types\.ObjectId\(value\)/);
  assert.doesNotMatch(source, /String\(doc\._id\)/);
  assert.doesNotMatch(source, /String\(candidate\._id\)/);
});

test('duplicate entity name review IDs reject object-shaped values', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/duplicateEntityNameReview.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /const DUPLICATE_ENTITY_NAME_REVIEW_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/,
  );
  assert.match(source, /export function normalizeDuplicateEntityNameReviewObjectId/);
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(source, /typeof value !== 'string'/);
  assert.match(source, /const trimmed = value\.trim\(\)/);
  assert.match(source, /normalizeDuplicateEntityNameReviewObjectId\(id\)/);
  assert.doesNotMatch(source, /ObjectId\.isValid/);
  assert.doesNotMatch(source, /new mongoose\.Types\.ObjectId\(id\)/);
});

test('legacy cleanup ObjectId lookups reject object-shaped values', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/cleanupLegacyMongoCollections.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const LEGACY_CLEANUP_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(source, /export function normalizeLegacyCleanupObjectId/);
  assert.match(source, /value instanceof Types\.ObjectId/);
  assert.match(source, /typeof value !== 'string'/);
  assert.match(source, /const raw = value\.trim\(\)/);
  assert.doesNotMatch(source, /Types\.ObjectId\.isValid/);
  assert.doesNotMatch(source, /const raw = toString\(value\)/);
});

test('research quality search review entity fan-out rejects object-shaped IDs', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/researchQualitySearchReview.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /const RESEARCH_QUALITY_SEARCH_REVIEW_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/,
  );
  assert.match(source, /export function normalizeResearchQualitySearchReviewObjectId/);
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(source, /typeof value !== 'string'/);
  assert.match(source, /const trimmed = value\.trim\(\)/);
  assert.match(source, /normalizeResearchQualitySearchReviewObjectId\(id\)/);
  assert.doesNotMatch(source, /ObjectId\.isValid/);
  assert.doesNotMatch(source, /new mongoose\.Types\.ObjectId\(id\)/);
});

test('scrape run report lookups reject object-shaped IDs', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/runReport.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const SCRAPE_RUN_REPORT_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /return serializedDocumentId\(value\)/);
  assert.match(source, /id: stringifyId\(run\._id\) \|\| ''/);
  assert.match(source, /export function normalizeScrapeRunReportObjectId/);
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(source, /typeof value !== 'string'/);
  assert.match(source, /const trimmed = value\.trim\(\)/);
  assert.match(source, /const scrapeRunObjectId = normalizeScrapeRunReportObjectId\(scrapeRunId\)/);
  assert.match(source, /ScrapeRun\.findById\(scrapeRunObjectId\)/);
  assert.match(source, /Observation\.find\(\{ scrapeRunId: scrapeRunObjectId \}\)/);
  assert.doesNotMatch(source, /ObjectId\.isValid/);
  assert.doesNotMatch(source, /return String\(value\)/);
  assert.doesNotMatch(source, /id: String\(run\._id\)/);
});

test('observation store identifiers use safe serialization before fingerprinting or source snapshots', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/observationStore.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /const entityId = stringifyIdentifier\(input\.entityId\)/);
  assert.match(source, /const entityKey = stringifyIdentifier\(input\.entityKey\)/);
  assert.match(source, /return serializedDocumentId\(value\)/);
  assert.match(source, /_id: serializedDocumentId\(src\._id\) \|\| ''/);
  assert.doesNotMatch(source, /return String\(value\)/);
  assert.doesNotMatch(source, /_id: String\(src\._id\)/);
});

test('admin routes use full private no-store response headers', () => {
  const source = fs.readFileSync(new URL('../server/src/routes/admin.ts', import.meta.url), 'utf8');

  assert.match(
    source,
    /function setPrivateAdminCacheHeaders\(_req: Request, res: Response, next: \(\) => void\)/,
  );
  assert.match(source, /res\.setHeader\('Cache-Control', 'no-store, private, max-age=0'\)/);
  assert.match(source, /res\.setHeader\('Pragma', 'no-cache'\)/);
  assert.match(source, /res\.setHeader\('Surrogate-Control', 'no-store'\)/);
  assert.match(source, /res\.setHeader\('Expires', '0'\)/);
  assert.match(source, /res\.setHeader\('X-Content-Type-Options', 'nosniff'\)/);
  assert.match(source, /router\.use\(setPrivateAdminCacheHeaders, isAuthenticated, isAdmin\)/);
});

test('admin taxonomy write routes bound labels and category arrays before persistence', () => {
  const source = fs.readFileSync(new URL('../server/src/routes/admin.ts', import.meta.url), 'utf8');
  const researchAreaClientSource = fs.readFileSync(
    new URL('../client/src/components/admin/AdminResearchAreas.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /MAX_ADMIN_PAGINATION_PARAM_LENGTH = 16/);
  assert.match(source, /typeof value !== 'string' && typeof value !== 'number'/);
  assert.match(source, /raw\.length > MAX_ADMIN_PAGINATION_PARAM_LENGTH/);
  assert.match(source, /value\.length > MAX_ADMIN_SEARCH_QUERY_LENGTH/);
  assert.match(source, /const searchTerm = value\.trim\(\)/);
  assert.match(source, /MAX_ADMIN_TAXONOMY_LABEL_LENGTH = 160/);
  assert.match(source, /MAX_ADMIN_DEPARTMENT_ABBREVIATION_LENGTH = 24/);
  assert.match(source, /MAX_ADMIN_DEPARTMENT_CATEGORIES = 10/);
  assert.match(source, /const ADMIN_ACTOR_NETID_RE = \/\^\[A-Za-z0-9\]\{2,12\}\$\//);
  assert.match(source, /const adminActorNetid = \(value: unknown\): string => \{/);
  assert.match(
    source,
    /const normalized = typeof value === 'string' \? value\.trim\(\)\.toLowerCase\(\) : ''/,
  );
  assert.match(source, /return ADMIN_ACTOR_NETID_RE\.test\(normalized\) \? normalized : ''/);
  assert.match(
    source,
    /adminActorNetid\(\(req\.user as any\)\?\.netId\) \|\| adminActorNetid\(\(req\.user as any\)\?\.netid\)/,
  );
  assert.doesNotMatch(
    source,
    /String\(\(req\.user as any\)\?\.netId \|\| \(req\.user as any\)\?\.netid/,
  );
  assert.match(source, /const ADMIN_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(source, /const adminPayloadId = \(value: unknown\): string => \{/);
  assert.match(source, /if \(typeof value === 'string'\) return value\.trim\(\)/);
  assert.match(
    source,
    /if \(typeof value === 'number' && Number\.isFinite\(value\)\) return String\(value\)/,
  );
  assert.match(
    source,
    /if \(value instanceof mongoose\.Types\.ObjectId\) return value\.toHexString\(\)/,
  );
  assert.doesNotMatch(
    source,
    /const adminPayloadId = \(value: any\): string => value\?\.toString\?\.\(\)/,
  );
  assert.match(
    source,
    /export const normalizeAdminObjectId = \(value: unknown\): string \| undefined =>/,
  );
  assert.match(source, /typeof value === 'string'/);
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(source, /return ADMIN_OBJECT_ID_RE\.test\(id\) \? id : undefined/);
  assert.match(source, /const safeId = normalizeAdminObjectId\(req\.params\.id\)/);
  assert.match(source, /ResearchArea\.findByIdAndUpdate\(safeId/);
  assert.match(source, /ResearchArea\.findByIdAndDelete\(safeId\)/);
  assert.match(source, /Department\.findByIdAndUpdate\(safeId/);
  assert.match(source, /Department\.findByIdAndDelete\(safeId\)/);
  assert.match(source, /export const normalizeAdminTaxonomyLabel/);
  assert.match(source, /redactDirectContactInfo\(normalized\) !== normalized/);
  assert.match(source, /export const normalizeAdminDepartmentCategories/);
  assert.match(source, /export const adminResearchAreaDto = \(area: any\) => \(\{/);
  assert.match(source, /export const adminDepartmentDto = \(dept: any\) => \(\{/);
  assert.match(source, /researchAreas: areas\.map\(adminResearchAreaDto\)/);
  assert.match(source, /departments: departments\.map\(adminDepartmentDto\)/);
  assert.match(source, /res\.json\(\{ researchArea: adminResearchAreaDto\(area\) \}\)/);
  assert.match(source, /res\.status\(201\)\.json\(\{ department: adminDepartmentDto\(dept\) \}\)/);
  assert.match(source, /res\.json\(\{ department: adminDepartmentDto\(dept\) \}\)/);
  assert.doesNotMatch(source, /res\.json\(\{ researchAreas: areas \}\)/);
  assert.doesNotMatch(source, /res\.json\(\{ departments \}\)/);
  assert.doesNotMatch(source, /res\.json\(\{ researchArea: area \}\)/);
  assert.doesNotMatch(source, /res\.status\(201\)\.json\(\{ department: dept \}\)/);
  assert.doesNotMatch(source, /res\.json\(\{ department: dept \}\)/);
  assert.doesNotMatch(researchAreaClientSource, /addedBy/);
  assert.match(
    source,
    /rawValues\.length === 0 \|\| rawValues\.length > MAX_ADMIN_DEPARTMENT_CATEGORIES/,
  );
  assert.match(
    source,
    /update\.name = normalizeAdminTaxonomyLabel\(\s*name,\s*'research area name',\s*MAX_RESEARCH_AREA_NAME_LENGTH,?\s*\)/,
  );
  assert.match(source, /const normalizedAbbreviation = normalizeAdminTaxonomyLabel/);
  assert.match(source, /const normalizedCategories = normalizeAdminDepartmentCategories/);
  assert.match(source, /update\.categories = normalizeAdminDepartmentCategories\(categories\)/);
  assert.doesNotMatch(source, /update\.name = name\.trim\(\)/);
  assert.doesNotMatch(source, /update\.categories = categories/);
  assert.doesNotMatch(source, /abbreviation: abbreviation\.trim\(\)/);
  assert.doesNotMatch(source, /new mongoose\.Types\.ObjectId\(req\.params\.id\)/);
  assert.doesNotMatch(source, /findById\(req\.params\.id\)/);
  assert.doesNotMatch(source, /findByIdAndUpdate\(req\.params\.id/);
  assert.doesNotMatch(source, /findByIdAndDelete\(req\.params\.id\)/);
});

test('scraper integrity report outputs are constrained to safe JSON artifact paths', () => {
  const guards = fs.readFileSync(
    new URL('../server/src/scripts/scriptWriteGuards.ts', import.meta.url),
    'utf8',
  );
  const scraperCliOutput = fs.readFileSync(
    new URL('../server/src/scrapers/scraperCliOutput.ts', import.meta.url),
    'utf8',
  );
  const integrityGate = fs.readFileSync(
    new URL('../server/src/scripts/scraperIntegrityGate.ts', import.meta.url),
    'utf8',
  );
  const duplicateReview = fs.readFileSync(
    new URL('../server/src/scripts/scraperIntegrityDuplicateReview.ts', import.meta.url),
    'utf8',
  );
  assert.match(guards, /export function resolveSafeJsonReportOutputPath/);
  assert.match(guards, /path\.extname\(resolved\)\.toLowerCase\(\) !== '\.json'/);
  assert.match(guards, /const tmpRoot = path\.resolve\(os\.tmpdir\(\)\)/);
  assert.match(guards, /const projectTmpRoot = path\.resolve\(process\.cwd\(\), 'tmp'\)/);
  assert.match(
    scraperCliOutput,
    /import \{ resolveSafeJsonReportOutputPath \} from '\.\.\/scripts\/scriptWriteGuards'/,
  );
  assert.match(
    scraperCliOutput,
    /const resolvedPath = resolveSafeJsonReportOutputPath\(outputPath\)/,
  );
  assert.match(integrityGate, /resolveSafeJsonReportOutputPath\(outputValue\)/);
  assert.match(integrityGate, /resolveSafeJsonReportOutputPath\(output\)/);
  assert.match(duplicateReview, /resolveSafeJsonReportOutputPath\(outputValue\)/);
  assert.match(duplicateReview, /resolveSafeJsonReportOutputPath\(output\)/);
  assert.match(
    guards,
    /approvedTempRootFor\(resolved, \[tmpRoot, SHARED_TEMP_ROOT, projectTmpRoot\]\)/,
  );
});

test('temporary artifact root comparisons resolve both sides before comparing', () => {
  const roots = fs.readFileSync(
    new URL('../server/src/utils/tempArtifactRoots.ts', import.meta.url),
    'utf8',
  );

  assert.match(roots, /export function resolveRealPath/);
  assert.match(roots, /fs\.realpathSync\.native\(existing\)/);
  assert.match(roots, /const realTarget = resolveRealPath\(target\)/);
  assert.match(roots, /const realRoot = resolveRealPath\(root\)/);
  assert.match(roots, /hasPathPrefix\(realTarget, realRoot\)/);
  assert.match(roots, /componentStat\.isSymbolicLink\(\) \|\| !componentStat\.isDirectory\(\)/);
  assert.match(roots, /!hasPathPrefix\(resolveRealPath\(current\), realRoot\)/);
  assert.doesNotMatch(roots, /fs\.realpathSync[^\n]*!== (?:target|parent|current|absolute)/);
});

test('scraper cache invalidation escapes and bounds regex prefixes', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/snapshotCache.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ escapeRegex \} from '\.\.\/utils\/regex'/);
  assert.match(source, /MAX_REQUEST_KEY_PREFIX_LENGTH = 512/);
  assert.match(source, /requestKeyPrefix\.length > MAX_REQUEST_KEY_PREFIX_LENGTH/);
  assert.match(source, /throw new Error\('Cache request key prefix is too long'\)/);
  assert.match(
    source,
    /filter\.requestKey = \{ \$regex: `\^\$\{escapeRegex\(requestKeyPrefix\)\}` \}/,
  );
  assert.doesNotMatch(source, /\$regex: `\^\$\{requestKeyPrefix\}`/);
});

test('shared search regex helper bounds terms and allowlists Mongo regex options', () => {
  const source = fs.readFileSync(new URL('../server/src/utils/regex.ts', import.meta.url), 'utf8');
  assert.match(source, /const SAFE_REGEX_OPTIONS = new Set\(\['i', 'm', 's', 'x'\]\)/);
  assert.match(source, /const normalizeRegexOptions = \(options: string\): string => \{/);
  assert.match(source, /SAFE_REGEX_OPTIONS\.has\(option\)/);
  assert.match(source, /return normalized \|\| 'i'/);
  assert.match(source, /escapeRegex\(input\.trim\(\)\.slice\(0, MAX_SEARCH_LEN\)\)/);
});

test('operator board gate artifact reads are constrained to safe JSON artifact paths', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/adminOperatorBoardService.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /import \{ resolveSafeJsonReportOutputPath \} from '\.\.\/scripts\/scriptWriteGuards'/,
  );
  assert.match(source, /const UNSAFE_ARTIFACT_PATH = '\[unsafe artifact path\]'/);
  assert.match(source, /const MAX_GATE_ARTIFACT_BYTES = 2 \* 1024 \* 1024/);
  assert.match(
    source,
    /function resolveGateArtifactReadPath\(artifactPath: string\): string \| undefined/,
  );
  assert.match(source, /resolveSafeJsonReportOutputPath\(artifactPath, 'artifact path'\)/);
  assert.match(source, /function invalidArtifactPath\(\)/);
  assert.match(source, /function readGateArtifactJson\(safeArtifactPath: string\): any/);
  assert.match(source, /if \(!stat\.isFile\(\) \|\| stat\.size > MAX_GATE_ARTIFACT_BYTES\)/);
  assert.match(source, /return JSON\.parse\(fs\.readFileSync\(safeArtifactPath, 'utf8'\)\)/);
  assert.match(source, /const safeArtifactPath = resolveGateArtifactReadPath\(artifactPath\)/);
  assert.match(source, /const path = resolveGateArtifactReadPath\(configuredPath\)/);
  assert.match(source, /const safeOutputPath = resolveGateArtifactReadPath\(outputPath\)/);
  assert.match(source, /fs\.existsSync\(safeOutputPath\)/);
  assert.match(source, /readGateArtifactJson\(safeOutputPath\)/);
  assert.match(source, /readGateArtifactJson\(safeArtifactPath\)/);
  assert.match(source, /readGateArtifactJson\(path\)/);
  assert.doesNotMatch(source, /fs\.readFileSync\(outputPath, 'utf8'\)/);
  assert.doesNotMatch(source, /JSON\.parse\(fs\.readFileSync\(safeOutputPath, 'utf8'\)\)/);
  assert.doesNotMatch(source, /JSON\.parse\(fs\.readFileSync\(path, 'utf8'\)\)/);
});

test('operator board DTO ids use safe document serialization', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/adminOperatorBoardService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(
    source,
    /function operatorBoardDocumentId\(value: unknown\): string \{\s*return serializedDocumentId\(value\) \|\| '';\s*\}/,
  );
  assert.match(source, /id: operatorBoardDocumentId\(run\._id\)/);
  assert.match(source, /const id = operatorBoardDocumentId\(row\._id\)/);
  assert.match(source, /id: operatorBoardDocumentId\(sample\._id\)/);
  assert.doesNotMatch(source, /id: String\((?:run|row|sample)\._id\)/);
  assert.doesNotMatch(source, /label: row\.(?:name|title) \|\| String\(row\._id\)/);
});

test('beta launch gate report paths are constrained to safe JSON artifact roots', () => {
  for (const [name, file] of [
    ['beta readiness', '../server/src/scripts/betaReadinessGate.ts'],
    ['beta repair queue', '../server/src/scripts/betaRepairQueue.ts'],
    ['launch acquisition', '../server/src/scripts/launchAcquisitionReport.ts'],
    ['claim gate', '../server/src/scripts/claimGate.ts'],
    ['launch trust contract', '../server/src/scripts/launchTrustContract.ts'],
    ['launch review exceptions', '../server/src/scripts/launchReviewExceptions.ts'],
    ['beta seed environment', '../server/src/scripts/betaSeedEnvironment.ts'],
    ['beta data quality', '../server/src/scripts/betaDataQualityCore.ts'],
  ]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(
      source,
      /resolveSafeJsonReportOutputPath/,
      `${name} must import the shared safe artifact path resolver`,
    );
    assert.match(
      source,
      /const safeOutput = resolveSafeJsonReportOutputPath\((?:output|outputPath)\)/,
      `${name} must re-check output paths at write time`,
    );
  }

  const betaRepairQueue = fs.readFileSync(
    new URL('../server/src/scripts/betaRepairQueue.ts', import.meta.url),
    'utf8',
  );
  assert.match(betaRepairQueue, /resolveSafeJsonReportOutputPath\(next, '--apply-from'\)/);
  assert.match(betaRepairQueue, /resolveSafeJsonReportOutputPath\(applyFrom, '--apply-from'\)/);
  assert.match(
    betaRepairQueue,
    /const artifactPath = resolveSafeJsonReportOutputPath\(options\.applyFrom, '--apply-from'\)/,
  );
  assert.match(betaRepairQueue, /fs\.readFileSync\(artifactPath, 'utf8'\)/);
  assert.doesNotMatch(betaRepairQueue, /fs\.readFileSync\(options\.applyFrom, 'utf8'\)/);

  const launchReviewExceptions = fs.readFileSync(
    new URL('../server/src/scripts/launchReviewExceptions.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    launchReviewExceptions,
    /const safeInputPath = resolveSafeJsonReportOutputPath\(inputPath, '--accepted-decisions'\)/,
  );
  assert.match(launchReviewExceptions, /fs\.readFileSync\(safeInputPath, 'utf8'\)/);
  assert.doesNotMatch(launchReviewExceptions, /fs\.readFileSync\(inputPath, 'utf8'\)/);

  const betaSeedEnvironment = fs.readFileSync(
    new URL('../server/src/scripts/betaSeedEnvironment.ts', import.meta.url),
    'utf8',
  );
  assert.match(betaSeedEnvironment, /function resolveSafeArtifactDir/);
  assert.match(betaSeedEnvironment, /path\.join\(parsed, 'artifact-root\.json'\)/);

  const betaDataQualityCore = fs.readFileSync(
    new URL('../server/src/scripts/betaDataQualityCore.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    betaDataQualityCore,
    /const safeOutputPath = resolveSafeJsonReportOutputPath\(\s*outputPath,\s*'--accepted-decision-validation-output',\s*\)/,
  );
  assert.match(betaDataQualityCore, /fs\.existsSync\(safeOutputPath\)/);
  assert.match(betaDataQualityCore, /fs\.readFileSync\(safeOutputPath, 'utf8'\)/);
  assert.match(
    betaDataQualityCore,
    /const safeReviewArtifactPath = resolveSafeJsonReportOutputPath\(\s*reviewArtifactPath,\s*'--review-artifact',\s*\)/,
  );
  assert.match(betaDataQualityCore, /fs\.existsSync\(safeReviewArtifactPath\)/);
  assert.match(betaDataQualityCore, /fs\.readFileSync\(safeReviewArtifactPath, 'utf8'\)/);
  assert.doesNotMatch(betaDataQualityCore, /fs\.existsSync\(outputPath\)/);
  assert.doesNotMatch(betaDataQualityCore, /fs\.readFileSync\(outputPath, 'utf8'\)/);
  assert.doesNotMatch(betaDataQualityCore, /fs\.existsSync\(reviewArtifactPath\)/);
  assert.doesNotMatch(betaDataQualityCore, /fs\.readFileSync\(reviewArtifactPath, 'utf8'\)/);
});

test('launch and visibility promotion artifacts are constrained to safe JSON roots', () => {
  for (const [name, file] of [
    [
      'formalization review exceptions',
      '../server/src/scripts/acceptFormalizationReviewExceptions.ts',
    ],
    ['accepted beta copy promotion', '../server/src/scripts/promoteAcceptedBetaCopy.ts'],
    ['student visibility gate', '../server/src/scripts/studentVisibilityGate.ts'],
  ]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /resolveSafeJsonReportOutputPath/, `${name} must use safe JSON paths`);
    assert.match(
      source,
      /const safeOutput = resolveSafeJsonReportOutputPath\((?:output|options\.output)/,
      `${name} must re-check report output paths at write time`,
    );
  }
});

test('local process execution remains shell-free', () => {
  for (const [name, file] of [
    ['rendered fetch bridge', '../server/src/scrapers/renderedFetch.ts'],
    ['gate scorecard refresh', '../server/src/scripts/refreshGateScorecards.ts'],
    ['beta seed environment', '../server/src/scripts/betaSeedEnvironment.ts'],
    ['gate refresh scheduler', '../server/src/scripts/gateRefreshScheduler.ts'],
    ['secret scanner', '../scripts/check-no-secrets.mjs'],
  ]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /shell: false/, `${name} must explicitly disable shell execution`);
    assert.doesNotMatch(source, /shell:\s*true/, `${name} must not execute through a shell`);
  }
});

test('visibility repair queue ObjectId model work is primitive-normalized', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/visibilityRepairQueueService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /VISIBILITY_REPAIR_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(
    source,
    /export function normalizeVisibilityRepairObjectId\(value: unknown\): string \| undefined/,
  );
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(source, /toVisibilityRepairObjectId\(id\)/);
  assert.match(source, /toVisibilityRepairObjectId\(researchEntityId\)/);
  assert.match(source, /const safeId = normalizeVisibilityRepairObjectId\(id\)/);
  assert.match(source, /const userId = normalizeVisibilityRepairObjectId\(user\._id\) \|\| ''/);
  assert.doesNotMatch(source, /ObjectId\.isValid/);
  assert.doesNotMatch(source, /const userId = String\(user\._id\)/);
});

test('research entity browse-rank service ids use safe serialization for map keys', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/researchEntityBrowseRankService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(
    source,
    /const browseRankDocumentId = \(value: unknown\): string => serializedDocumentId\(value\) \|\| ''/,
  );
  assert.match(source, /const key = browseRankDocumentId\(relationship\.sourceResearchEntityId\)/);
  assert.match(source, /const id = browseRankDocumentId\(entity\._id\)/);
  assert.doesNotMatch(source, /String\(signal\.researchEntityId/);
  assert.doesNotMatch(source, /String\(relationship\.sourceResearchEntityId/);
  assert.doesNotMatch(source, /String\(entity\._id\)/);
});

test('research entity membership accessor keys rosters with safe serialization', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/researchEntityMembershipAccessor.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /const key = serializedDocumentId\(entry\.researchEntityId\)/);
  assert.doesNotMatch(source, /const key = String\(entry\.researchEntityId/);
  assert.doesNotMatch(source, /const key = entry\.researchEntityId\.toString\(\)/);
});

test('student visibility gate ObjectId model work is primitive-normalized', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/studentVisibilityGateService.ts', import.meta.url),
    'utf8',
  );
  const normalizedSource = source.replace(/\s+/g, ' ');

  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.ok(
    normalizedSource.includes(
      "const studentVisibilityGateDocumentId = (value: unknown): string => serializedDocumentId(value) || ''",
    ),
    'student visibility gate document IDs must use the safe primitive serializer',
  );
  assert.match(source, /studentVisibilityGateDocumentId\(row\._id\)/);
  assert.match(source, /studentVisibilityGateDocumentId\(entity\._id\)/);
  assert.match(source, /studentVisibilityGateDocumentId\(row\.researchEntityId\)/);
  assert.match(source, /studentVisibilityGateDocumentId\(row\.userId\)/);
  assert.match(source, /studentVisibilityGateDocumentId\(program\._id\)/);
  assert.match(source, /STUDENT_VISIBILITY_GATE_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(
    source,
    /export function normalizeStudentVisibilityGateObjectId\(value: unknown\): string \| undefined/,
  );
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(source, /toStudentVisibilityGateObjectId\(id\)/);
  assert.doesNotMatch(source, /recordIds\.map\(\(id\) => new mongoose\.Types\.ObjectId\(id\)\)/);
  assert.doesNotMatch(source, /String\(row\._id\)/);
  assert.doesNotMatch(source, /String\(entity\._id\)/);
  assert.doesNotMatch(source, /String\(row\.researchEntityId\)/);
  assert.doesNotMatch(source, /String\(row\.userId\)/);
  assert.doesNotMatch(source, /String\(lead\.userId\)/);
  assert.doesNotMatch(source, /String\(program\._id\)/);
});

test('launch acquisition report record ids are normalized before entity fan-out', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/launchAcquisitionReportService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /LAUNCH_ACQUISITION_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(
    source,
    /function normalizeLaunchAcquisitionObjectId\(value: unknown\): string \| undefined/,
  );
  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /const serialized = serializedDocumentId\(value\)/);
  assert.match(source, /if \(serialized\) return serialized\.trim\(\)/);
  assert.match(source, /const safeId = normalizeLaunchAcquisitionObjectId\(id\)/);
  assert.match(source, /ResearchEntity\.findById\(safeId\)/);
  assert.match(source, /researchEntityId: safeId/);
  assert.doesNotMatch(source, /ResearchEntity\.findById\(id\)/);
  assert.doesNotMatch(source, /researchEntityId: id/);
  assert.doesNotMatch(source, /typeof \(value as any\)\.toHexString === 'function'/);
  assert.doesNotMatch(source, /return \(value as any\)\.toHexString\(\)/);
  assert.doesNotMatch(source, /return String\(value\)\.trim\(\)/);
});

test('research entity evidence coverage report ids use safe serialization', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/researchEntityEvidenceCoverage.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(
    source,
    /const evidenceCoverageDocumentId = \(value: unknown\): string => serializedDocumentId\(value\) \|\| ''/,
  );
  assert.match(source, /const entityId = evidenceCoverageDocumentId\(observation\.entityId\)/);
  assert.match(source, /const id = evidenceCoverageDocumentId\(\(entity as any\)\._id\)/);
  assert.match(
    source,
    /const entityId = evidenceCoverageDocumentId\(first\.entityId\) \|\| undefined/,
  );
  assert.doesNotMatch(source, /String\(observation\.entityId\)/);
  assert.doesNotMatch(source, /String\(\(entity as any\)\._id\)/);
  assert.doesNotMatch(source, /String\(first\.entityId\)/);
});

test('entity materializer ObjectId handling is primitive-normalized', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/entityMaterializer.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /MATERIALIZER_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(
    source,
    /const materializerDocumentId = \(value: unknown\): string => serializedDocumentId\(value\) \|\| ''/,
  );
  assert.match(
    source,
    /export function normalizeMaterializerObjectId\(value: unknown\): string \| undefined/,
  );
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(
    source,
    /function toMaterializerObjectId\(value: unknown\): mongoose\.Types\.ObjectId \| undefined/,
  );
  assert.match(source, /const researcherId = toMaterializerObjectId\(researcherIdString\)/);
  assert.match(source, /const runObjectId = toMaterializerObjectId\(scrapeRunId\)/);
  assert.match(source, /const entityId = normalizeMaterializerObjectId\(identifier\.entityId\)/);
  assert.match(
    source,
    /const researchEntityId = normalizeMaterializerObjectId\(entity\._id\) \|\| ''/,
  );
  assert.match(source, /entityId: materializerDocumentId\(entity\._id\)/);
  assert.match(source, /return resolution\.status === 'matched' && resolution\.researcherId/);
  assert.match(source, /normalizeMaterializerObjectId\(assignment\?\.target\?\.id\)/);
  assert.match(source, /const providedId = normalizeMaterializerObjectId\(identity\.userId\)/);
  assert.match(source, /entityId: materializerDocumentId\(source\._id\)/);
  assert.match(
    source,
    /const sourceResearchEntityId = normalizeMaterializerObjectId\(source\._id\) \|\| ''/,
  );
  assert.match(
    source,
    /const targetResearchEntityId = normalizeMaterializerObjectId\(resolvedTarget\._id\) \|\| ''/,
  );
  assert.match(source, /entityIdString = materializerDocumentId\(created_\._id\)/);
  assert.doesNotMatch(source, /new mongoose\.Types\.ObjectId\(scrapeRunId\)/);
  assert.doesNotMatch(source, /mongoose\.Types\.ObjectId\.isValid\(userId\)/);
  assert.doesNotMatch(source, /mongoose\.Types\.ObjectId\.isValid\(identifier\.entityId\)/);
  assert.doesNotMatch(source, /String\(entity\._id\)/);
  assert.doesNotMatch(source, /String\(user\._id\)/);
  assert.doesNotMatch(source, /String\(source\._id\)/);
  assert.doesNotMatch(source, /String\(target\._id\)/);
  assert.doesNotMatch(source, /String\(created_\._id\)/);
});

test('access materializer ObjectId handling is primitive-normalized', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/accessMaterializer.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /ACCESS_MATERIALIZER_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /return serializedDocumentId\(obs\._id\)/);
  assert.match(source, /return normalizeAccessMaterializerObjectId\(group\?\._id\) \|\| null/);
  assert.match(
    source,
    /export function normalizeAccessMaterializerObjectId\(value: unknown\): string \| undefined/,
  );
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(
    source,
    /const researchEntityObjectId = toAccessMaterializerObjectId\(researchEntityId\)/,
  );
  // The `findById(researchEntityObjectId)` read this used to require lived only in
  // `deriveIdentifiedLeadWaysInForEntity`, retired in #2578. The remaining entity
  // read is `resolveResearchEntityId`, which queries by `slug` and then hands the
  // result through `normalizeAccessMaterializerObjectId`, so the property this
  // assertion protected is still asserted by the normalize/regex checks around it.
  assert.match(source, /return normalizeAccessMaterializerObjectId\(group\?\._id\) \|\| null/);
  assert.match(source, /\{ entityId: researchEntityObjectId \}/);
  assert.doesNotMatch(source, /ObjectId\.isValid/);
  assert.doesNotMatch(source, /new mongoose\.Types\.ObjectId\(researchEntityId\)/);
  assert.doesNotMatch(source, /return String\(obs\._id\)/);
  assert.doesNotMatch(source, /String\(group\._id\)/);
});

test('scraper orchestrator run ids use safe serialization before context handoff', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/orchestrator.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /const scrapeRunId = serializedDocumentId\(run\._id\) \|\| ''/);
  assert.match(source, /scrapeRunId,/);
  assert.match(source, /runId: scrapeRunId/);
  assert.doesNotMatch(source, /scrapeRunId: String\(run\._id\)/);
  assert.doesNotMatch(source, /runId: String\(run\._id\)/);
});

test('LLM source-acquisition ObjectId filters are primitive-normalized', () => {
  for (const [name, file, helper] of [
    [
      'lab microsite description LLM',
      '../server/src/scrapers/sources/labMicrositeDescriptionLLMExtractor.ts',
      'normalizeDescriptionLlmObjectId',
    ],
    [
      'center director LLM',
      '../server/src/scrapers/sources/centerDirectorLLMExtractor.ts',
      'normalizeCenterDirectorObjectId',
    ],
    [
      'center affiliation LLM',
      '../server/src/scrapers/sources/centerAffiliationLLMExtractor.ts',
      'normalizeCenterAffiliationObjectId',
    ],
  ]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(
      source,
      new RegExp(`export function ${helper}\\(value: unknown\\): string \\| undefined`),
      `${name} must expose a strict ObjectId normalizer`,
    );
    assert.match(
      source,
      /value instanceof mongoose\.Types\.ObjectId/,
      `${name} must accept real ObjectIds`,
    );
    assert.match(
      source,
      new RegExp(`\\.map\\(\\(value\\) => ${helper}\\(value\\)\\)`),
      `${name} must route only filters through the helper`,
    );
    assert.doesNotMatch(
      source,
      /ObjectId\.isValid/,
      `${name} must not use permissive Mongoose ObjectId validation`,
    );
    if (name === 'center director LLM' || name === 'center affiliation LLM') {
      assert.match(
        source,
        /import \{ serializedDocumentId \} from '\.\.\/\.\.\/utils\/idSerialization'/,
        `${name} must import safe serializer`,
      );
      assert.match(
        source,
        /_id: serializedDocumentId\(doc\._id\)/,
        `${name} must serialize candidate ids safely`,
      );
      assert.doesNotMatch(
        source,
        /_id: doc\._id \? String\(doc\._id\) : undefined/,
        `${name} must not stringify candidate ids`,
      );
    }
  }
});

test('duplicate access signal repair ids are primitive-normalized', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/repairDuplicateAccessSignals.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /DUPLICATE_ACCESS_SIGNAL_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(
    source,
    /export function normalizeDuplicateAccessSignalObjectId\(value: unknown\): string \| undefined/,
  );
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(
    source,
    /function objectId\(value: unknown\): mongoose\.Types\.ObjectId \| undefined/,
  );
  assert.match(source, /\.map\(\(id\) => normalizeDuplicateAccessSignalObjectId\(id\)\)/);
  assert.match(source, /\.map\(\(id\) => objectId\(id\)\)/);
  assert.match(
    source,
    /function stringId\(value: unknown\): string \{\s*return serializedDocumentId\(value\) \|\| '';\s*\}/,
  );
  assert.doesNotMatch(source, /ObjectId\.isValid/);
  assert.doesNotMatch(
    source,
    /typeof \(value as \{ toHexString\?: \(\) => string \}\)\.toHexString === 'function'/,
  );
  assert.doesNotMatch(source, /\(value as \{ toHexString: \(\) => string \}\)\.toHexString\(\)/);
  assert.doesNotMatch(source, /return String\(value\)/);
});

test('maintenance and scraper id helpers do not execute duck-typed toHexString hooks', () => {
  const files = [
    '../server/src/scrapers/sources/labMicrositeDescriptionLLMExtractor.ts',
    '../server/src/scrapers/sources/officialProfilePiBackfillScraper.ts',
    '../server/src/services/visibilityRepairQueueService.ts',
    '../server/src/scripts/staleObservationConflictReview.ts',
    '../server/src/scripts/crossSourceObservationConflictReview.ts',
    '../server/src/scripts/duplicateEntityNameReview.ts',
    '../server/src/scripts/betaDataQuality.ts',
    '../server/src/scrapers/entityMaterializer.ts',
    '../server/src/scripts/repairArchivedEntityArtifacts.ts',
    '../server/src/scripts/repairDuplicateAccessSignals.ts',
  ];

  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /serializedDocumentId/);
    assert.doesNotMatch(source, /typeof \(value as any\)\.toHexString === 'function'/);
    assert.doesNotMatch(
      source,
      /typeof value === 'object' && typeof \(value as any\)\.toHexString === 'function'/,
    );
    assert.doesNotMatch(
      source,
      /typeof value === 'object' && value !== null && 'toString' in value/,
    );
    assert.doesNotMatch(source, /return \(value as any\)\.toHexString\(\)/);
    assert.doesNotMatch(source, /return String\(value\)/);
    assert.doesNotMatch(source, /return String\(value\)\.trim\(\)/);
  }
});

test('audit planning and source seed artifacts are constrained to safe JSON roots', () => {
  for (const [name, file] of [
    ['source registry seed', '../server/src/scrapers/seedSources.ts'],
    ['surname lab disambiguation', '../server/src/scripts/disambiguateSurnameLabNames.ts'],
  ]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /resolveSafeJsonReportOutputPath/, `${name} must use safe JSON paths`);
  }
});

test('manual fellowship recipient scraper inputs stay under safe local roots', () => {
  const source = fs.readFileSync(
    new URL(
      '../server/src/scrapers/sources/undergradFellowshipRecipientScraper.ts',
      import.meta.url,
    ),
    'utf8',
  );

  assert.match(source, /import os from 'os'/);
  assert.match(source, /SAFE_MANUAL_RECIPIENT_SEGMENT_RE = \/\^\[A-Za-z0-9\._-\]\{1,120\}\$\//);
  assert.match(source, /MANUAL_RECIPIENT_FILE_EXTENSIONS = new Set\(\['\.csv', '\.pdf'\]\)/);
  assert.match(source, /export function resolveSafeManualRecipientInputPath/);
  assert.match(source, /path\.resolve\(resolvedRoot, `\$\{programKey\}\$\{extension\}`\)/);
  assert.match(source, /const tmpRoot = path\.resolve\(os\.tmpdir\(\)\)/);
  assert.match(source, /const projectTmpRoot = path\.resolve\(process\.cwd\(\), 'tmp'\)/);
  assert.match(source, /Manual recipient input root must be under system temp or \.\/tmp/);
  assert.match(
    source,
    /approvedTempRootFor\(resolvedRoot, \[tmpRoot, SHARED_TEMP_ROOT, projectTmpRoot\]\)/,
  );
  assert.doesNotMatch(
    source,
    /DEFAULT_ACCEPTED_FELLOWSHIP_RECIPIENT_CSV_DIR =\s*\n?\s*'\/tmp/,
    'the default recipient input root must be derived from a resolved temp root',
  );
  assert.match(
    source,
    /resolveSafeManualRecipientInputPath\(\s*manualRecipientCsvDir,\s*config\.programKey,\s*'\.csv'/,
  );
  assert.match(
    source,
    /resolveSafeManualRecipientInputPath\(\s*manualRecipientPdfDir,\s*config\.programKey,\s*'\.pdf'/,
  );
  assert.doesNotMatch(
    source,
    /path\.resolve\(\s*manualRecipientCsvDir,\s*`\$\{config\.programKey\}\.csv`/,
  );
  assert.doesNotMatch(
    source,
    /path\.resolve\(\s*manualRecipientPdfDir,\s*`\$\{config\.programKey\}\.pdf`/,
  );
});

test('duplicate review decision artifacts are constrained to safe JSON roots', () => {
  for (const [name, file] of [
    ['same PI dedupe', '../server/src/scripts/dedupeResearchEntitiesByPi.ts'],
    ['duplicate entity name review', '../server/src/scripts/duplicateEntityNameReview.ts'],
  ]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(
      source,
      /resolveSafeJsonReportOutputPath/,
      `${name} must use the safe path resolver`,
    );
    assert.match(
      source,
      /const safeOutput = resolveSafeJsonReportOutputPath\(output\)/,
      `${name} must re-check report output paths at write time`,
    );
    assert.match(
      source,
      /const safeOutput = resolveSafeJsonReportOutputPath\(output, '--decision-template-output'\)/,
      `${name} must re-check decision-template output paths at write time`,
    );
    assert.match(
      source,
      /const safeInputPath = resolveSafeJsonReportOutputPath\(inputPath, '--accepted-decisions'\)/,
      `${name} must resolve accepted decision reads before file access`,
    );
    assert.match(source, /fs\.readFileSync\(safeInputPath, 'utf8'\)/);
    assert.doesNotMatch(source, /fs\.readFileSync\(inputPath, 'utf8'\)/);
  }
});

test('lab microsite description LLM entity ids use safe serialization before observation shaping', () => {
  const source = fs.readFileSync(
    new URL(
      '../server/src/scrapers/sources/labMicrositeDescriptionLLMExtractor.ts',
      import.meta.url,
    ),
    'utf8',
  );

  assert.match(
    source,
    /import \{ serializedDocumentId \} from '\.\.\/\.\.\/utils\/idSerialization'/,
  );
  assert.match(source, /entityId: serializedDocumentId\(lab\._id\)/);
  assert.doesNotMatch(source, /entityId: lab\._id \? String\(lab\._id\) : undefined/);
  assert.doesNotMatch(source, /String\(lab\._id\)/);
});

test('observation conflict decision artifacts are constrained to safe JSON roots', () => {
  for (const [name, file] of [
    [
      'stale observation conflict review',
      '../server/src/scripts/staleObservationConflictReview.ts',
    ],
    [
      'cross-source observation conflict review',
      '../server/src/scripts/crossSourceObservationConflictReview.ts',
    ],
  ]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(
      source,
      /resolveSafeJsonReportOutputPath/,
      `${name} must use the safe path resolver`,
    );
    assert.match(source, /const safeOutput = resolveSafeJsonReportOutputPath\(output\)/);
    assert.match(
      source,
      /const safeOutput = resolveSafeJsonReportOutputPath\(output, '--decision-template-output'\)/,
    );
    assert.match(
      source,
      /const safeInputPath = resolveSafeJsonReportOutputPath\(inputPath, '--accepted-decisions'\)/,
    );
    assert.match(source, /fs\.readFileSync\(safeInputPath, 'utf8'\)/);
    assert.doesNotMatch(source, /fs\.readFileSync\(inputPath, 'utf8'\)/);
  }
});

test('source health report artifacts are constrained to safe JSON roots', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/sourceHealth.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /import \{ assertScriptApplyAllowed, resolveSafeJsonReportOutputPath \} from '\.\/scriptWriteGuards'/,
  );
  assert.match(
    source,
    /const parseRequiredOutputPath = \(value: string \| undefined\): string =>\s*resolveSafeJsonReportOutputPath\(value\)/,
  );
  assert.match(source, /const safeOutput = resolveSafeJsonReportOutputPath\(output\)/);
  assert.match(source, /function readJsonIfExists\(reportPath: string\): unknown \| undefined/);
  assert.match(
    source,
    /safeReportPath = resolveSafeJsonReportOutputPath\(reportPath, 'report path'\)/,
  );
  assert.match(source, /fs\.existsSync\(safeReportPath\)/);
  assert.match(source, /fs\.readFileSync\(safeReportPath, 'utf8'\)/);
  assert.doesNotMatch(source, /fs\.readFileSync\(reportPath, 'utf8'\)/);
});

test('source health operator commands quote unsafe stored identifiers', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/sourceHealthService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /MAX_SOURCE_HEALTH_DATE_LENGTH = 64/);
  assert.match(source, /MAX_SOURCE_HEALTH_COMMAND_ARG_LENGTH = 160/);
  assert.match(source, /SAFE_BARE_COMMAND_ARG = \/\^\[A-Za-z0-9_\.:-\]\+\$\//);
  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /return serializedDocumentId\(value\) \|\| ''/);
  assert.doesNotMatch(source, /typeof \(value as any\)\.toHexString === 'function'/);
  assert.doesNotMatch(source, /'toString' in value/);
  assert.match(source, /new Date\(value\.slice\(0, MAX_SOURCE_HEALTH_DATE_LENGTH\)\)/);
  assert.match(source, /function commandArg\(value: string\): string/);
  assert.match(source, /bounded\.replace\(\/'\/g/);
  assert.match(source, /--source \$\{commandArg\(sourceName\)\}/);
  assert.match(source, /--run \$\{commandArg\(runId\)\}/);
});

test('identity cleanup report outputs are constrained to safe JSON roots', () => {
  for (const [name, file] of [
    ['beta student analytics core', '../server/src/scripts/clearBetaStudentAnalyticsCore.ts'],
    ['beta student analytics wrapper', '../server/src/scripts/clearBetaStudentAnalytics.ts'],
  ]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /resolveSafeJsonReportOutputPath/, `${name} must use safe JSON paths`);
  }

  for (const file of ['../server/src/scripts/clearBetaStudentAnalytics.ts']) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /const safeOutput = resolveSafeJsonReportOutputPath\(output\)/);
    assert.match(source, /fs\.writeFileSync\(safeOutput,/);
  }
});

test('Phase 0 complementary audits enforce fail-closed summary-only output', () => {
  const contracts = [
    [
      'duplicate entity name review',
      '../server/src/scripts/duplicateEntityNameReview.ts',
      '../server/src/scripts/duplicateEntityNameReview.ts',
      '../server/src/scripts/duplicateEntityNameReview.ts',
      'buildDuplicateEntityNameReviewSummaryOnlyOutput',
    ],
    [
      'research entity coverage audit',
      '../server/src/scripts/researchEntityCoverageAudit.ts',
      '../server/src/scripts/researchEntityCoverageAudit.ts',
      '../server/src/scripts/researchEntityCoverageAudit.ts',
      'buildResearchEntityCoverageSummaryOnlyOutput',
    ],
  ];

  for (const [name, parserFile, wrapperFile, builderFile, summaryBuilder] of contracts) {
    const parserSource = fs.readFileSync(new URL(parserFile, import.meta.url), 'utf8');
    const wrapperSource = fs.readFileSync(new URL(wrapperFile, import.meta.url), 'utf8');
    const builderSource = fs.readFileSync(new URL(builderFile, import.meta.url), 'utf8');
    assert.match(parserSource, /arg === '--summary-only'/, `${name} must parse --summary-only`);
    assert.match(
      parserSource,
      /--summary-only does not accept a value/,
      `${name} must reject assigned summary-only values`,
    );
    assert.match(parserSource, /--environment/, `${name} must parse an explicit environment`);
    assert.match(
      parserSource,
      /parsePhase0SummaryOnlyEnvironment/,
      `${name} must use the shared summary environment parser`,
    );
    assert.match(
      builderSource,
      new RegExp(`export function ${summaryBuilder}`),
      `${name} must expose an explicit aggregate-only serializer`,
    );
    assert.match(
      wrapperSource,
      new RegExp(`summaryOnly[\\s\\S]{0,160}\\? ${summaryBuilder}\\(`),
      `${name} must select the aggregate serializer before stdout and file output`,
    );
    assert.match(
      wrapperSource,
      /assertPhase0SummaryOnlyConfiguredTarget/,
      `${name} must validate the configured database before connecting`,
    );
    assert.match(
      wrapperSource,
      /assertPhase0SummaryOnlyConnectedTarget/,
      `${name} must validate the connected database before querying`,
    );
  }

  const sharedSource = fs.readFileSync(
    new URL('../server/src/scripts/phase0SummaryOnlyAudit.ts', import.meta.url),
    'utf8',
  );
  assert.match(sharedSource, /args\.summaryOnly && args\.apply/);
  assert.match(sharedSource, /--summary-only cannot be combined with --apply/);
  assert.match(sharedSource, /databaseNameFromMongoUrl/);
  assert.match(sharedSource, /assertOperatorEnvironmentMatchesDatabase/);
  assert.match(sharedSource, /--summary-only requires --environment/);
  assert.match(sharedSource, /--environment requires development, beta, or production-copy/);

  const duplicateSource = fs.readFileSync(
    new URL('../server/src/scripts/duplicateEntityNameReview.ts', import.meta.url),
    'utf8',
  );
  assert.match(duplicateSource, /args\.decisionTemplateOutput/);
  assert.match(duplicateSource, /cannot be combined with decision input/);

  const coverageSource = fs.readFileSync(
    new URL('../server/src/scripts/researchEntityCoverageAudit.ts', import.meta.url),
    'utf8',
  );
  assert.match(coverageSource, /options\.summaryOnly && options\.slug/);
  assert.match(coverageSource, /--summary-only cannot be combined with --slug/);
});

test('Mongo sanitizer rejects operator-shaped requests and bounds recursive traversal', () => {
  const source = fs.readFileSync(
    new URL('../server/src/middleware/sanitizeMongo.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const MAX_SANITIZE_DEPTH = 32/);
  assert.match(source, /const MAX_SANITIZE_ARRAY_ITEMS = 200/);
  assert.match(source, /const MAX_SANITIZE_OBJECT_KEYS = 200/);
  assert.match(source, /if \(depth > MAX_SANITIZE_DEPTH\) return undefined/);
  assert.match(source, /value\.slice\(0, MAX_SANITIZE_ARRAY_ITEMS\)\.map/);
  assert.match(source, /Object\.keys\(value\)\.slice\(0, MAX_SANITIZE_OBJECT_KEYS\)/);
  assert.match(source, /key\.startsWith\('\$'\)/);
  assert.match(source, /key\.includes\('\.'\)/);
  assert.match(source, /key\.includes\('\['\)/);
  assert.match(source, /key\.includes\('\]'\)/);
  assert.match(source, /PROTOTYPE_POLLUTION_KEYS\.has\(key\)/);
  assert.match(source, /const hasUnsafeMongoShape = \(value: unknown, depth = 0\): boolean => \{/);
  assert.match(source, /if \(value\.length > MAX_SANITIZE_ARRAY_ITEMS\) return true/);
  assert.match(source, /if \(keys\.length > MAX_SANITIZE_OBJECT_KEYS\) return true/);
  assert.match(source, /keys\.some\(\(key\) => isUnsafeMongoKey\(key\) \|\| hasUnsafeMongoShape/);
  assert.match(
    source,
    /if \(hasUnsafeMongoShape\(req\.body\) \|\| hasUnsafeMongoShape\(req\.query\)\)/,
  );
  assert.match(source, /return res\.status\(400\)\.json\(\{ error: 'Invalid request payload' \}\)/);
  assert.match(source, /const cleaned = scrub\(val, depth \+ 1\)/);
  assert.match(source, /if \(cleaned !== undefined\) out\[key\] = cleaned/);
});

test('required body field validation ignores inherited prototype properties', () => {
  const source = fs.readFileSync(
    new URL('../server/src/middleware/validation.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /const body = req\.body && typeof req\.body === 'object' \? req\.body : \{\}/,
  );
  assert.match(source, /Object\.prototype\.hasOwnProperty\.call\(body, field\)/);
  assert.doesNotMatch(source, /!\(field in req\.body\)/);
});

test('shared ObjectId route validator rejects non-hex coercible ids', () => {
  const source = fs.readFileSync(
    new URL('../server/src/middleware/validation.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const OBJECT_ID_RE = \/\^\[a-fA-F0-9\]\{24\}\$\/;/);
  assert.match(source, /if \(!OBJECT_ID_RE\.test\(id\)\)/);
  assert.doesNotMatch(source, /ObjectId\.isValid\(id\)/);
});

test('client API base URL builder rejects hostile backend origins', () => {
  const source = fs.readFileSync(
    new URL('../client/src/utils/apiBaseUrl.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /export const isProductionWebHost = \(host: string\): boolean =>/);
  assert.match(source, /hostname === 'yalelabs\.io' \|\| hostname === 'www\.yalelabs\.io'/);
  assert.doesNotMatch(source, /window\.location\.host\.includes\('yalelabs\.io'\)/);
  assert.match(source, /export const normalizeBackendOrigin = \(/);
  assert.match(source, /const MAX_BACKEND_ORIGIN_LENGTH = 2048/);
  assert.match(source, /const hasUnsafeBackendOriginCharacter/);
  assert.match(source, /trimmed\.length > MAX_BACKEND_ORIGIN_LENGTH/);
  assert.match(source, /hasUnsafeBackendOriginCharacter\(trimmed\)/);
  assert.match(source, /parsed\.protocol !== 'http:' && parsed\.protocol !== 'https:'/);
  assert.match(source, /parsed\.username \|\| parsed\.password/);
  assert.match(source, /return `\$\{parsed\.origin\}\$\{pathPrefix === '\/' \? '' : pathPrefix\}`/);
});

test('client logout navigation uses the safe API URL builder', () => {
  const userButton = fs.readFileSync(
    new URL('../client/src/components/UserButton.tsx', import.meta.url),
    'utf8',
  );
  const signOutButton = fs.readFileSync(
    new URL('../client/src/components/SignOutButton.tsx', import.meta.url),
    'utf8',
  );
  const signInButton = fs.readFileSync(
    new URL('../client/src/components/SignInButton.tsx', import.meta.url),
    'utf8',
  );

  for (const source of [userButton, signOutButton]) {
    assert.match(source, /import \{ buildApiUrl \} from '\.\.\/utils\/apiBaseUrl'/);
    assert.match(source, /const MAX_LOGOUT_RETURN_PATH_LENGTH = 2048/);
    assert.match(source, /returnPath\.length <= MAX_LOGOUT_RETURN_PATH_LENGTH/);
    assert.match(source, /window\.location\.href = buildApiUrl\('\/logout'\)/);
    assert.doesNotMatch(source, /axios\.defaults\.baseURL \+ '\/logout'/);
  }
  const returnPathUtil = fs.readFileSync(
    new URL('../client/src/utils/returnPath.ts', import.meta.url),
    'utf8',
  );
  assert.match(signInButton, /import \{ normalizeReturnPath \} from '\.\.\/utils\/returnPath'/);
  assert.match(returnPathUtil, /const MAX_RETURN_PATH_LENGTH = 2048/);
  assert.match(returnPathUtil, /trimmed\.length > MAX_RETURN_PATH_LENGTH/);
  assert.match(returnPathUtil, /const url = new URL\(trimmed, window\.location\.origin\)/);
  assert.match(returnPathUtil, /url\.origin !== window\.location\.origin/);
  assert.match(signInButton, /buildApiUrl\(`\/cas\$\{redirectParam\}`\)/);
});

test('program and fellowship search bound query and filter inputs before search work', () => {
  const programController = fs.readFileSync(
    new URL('../server/src/controllers/programController.ts', import.meta.url),
    'utf8',
  );
  const fellowshipService = fs.readFileSync(
    new URL('../server/src/services/fellowshipService.ts', import.meta.url),
    'utf8',
  );

  assert.match(programController, /MAX_PROGRAM_SEARCH_QUERY_LENGTH = 512/);
  assert.match(programController, /MAX_PROGRAM_SEARCH_FILTER_VALUES = 50/);
  assert.match(programController, /MAX_PROGRAM_SEARCH_FILTER_VALUE_LENGTH = 120/);
  assert.match(programController, /MAX_PROGRAM_SEARCH_PAGINATION_PARAM_LENGTH = 16/);
  assert.match(programController, /const POSITIVE_INTEGER_PARAM_RE = \/\^\[1-9\]\\d\*\$\/;/);
  assert.match(programController, /typeof value !== 'string' && typeof value !== 'number'/);
  assert.match(programController, /raw\.length > MAX_PROGRAM_SEARCH_PAGINATION_PARAM_LENGTH/);
  assert.match(programController, /Number\.isSafeInteger\(value\) && value > 0/);
  assert.match(programController, /!POSITIVE_INTEGER_PARAM_RE\.test\(raw\)/);
  assert.match(programController, /Number\.isSafeInteger\(parsed\) \? parsed : undefined/);
  assert.doesNotMatch(programController, /Number\.isFinite\(parsed\) \? parsed : undefined/);
  assert.match(programController, /query:\s*boundedSearchQuery\(query\)/);
  assert.match(programController, /yearOfStudy:\s*parseFilter\(yearOfStudy\)/);

  assert.match(fellowshipService, /MAX_SEARCH_QUERY_LENGTH = 512/);
  assert.match(fellowshipService, /MAX_SEARCH_FILTER_VALUES = 50/);
  assert.match(fellowshipService, /MAX_SEARCH_FILTER_VALUE_LENGTH = 120/);
  assert.match(fellowshipService, /MAX_SEARCH_PAGINATION_PARAM_LENGTH = 16/);
  assert.match(fellowshipService, /MAX_PUBLIC_FELLOWSHIP_TEXT_LENGTH = 5000/);
  assert.match(fellowshipService, /MAX_PUBLIC_FELLOWSHIP_ARRAY_ITEMS = 50/);
  assert.match(fellowshipService, /MAX_PUBLIC_FELLOWSHIP_LINKS = 50/);
  assert.match(fellowshipService, /MAX_FELLOWSHIP_ID_READS = 100/);
  assert.match(fellowshipService, /MAX_ADMIN_FELLOWSHIP_NUMBER = 1_000_000/);
  assert.match(fellowshipService, /MONGO_OBJECT_ID_RE = \/\^\[a-fA-F0-9\]\{24\}\$\//);
  assert.match(fellowshipService, /const POSITIVE_INTEGER_PARAM_RE = \/\^\[1-9\]\\d\*\$\/;/);
  assert.match(
    fellowshipService,
    /const normalizeFellowshipObjectId = \(id: unknown\): string \| undefined =>/,
  );
  assert.match(
    fellowshipService,
    /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/,
  );
  assert.match(fellowshipService, /const value = serializedDocumentId\(id\)/);
  assert.match(fellowshipService, /if \(field === '_id'\) return serializedDocumentId\(value\)/);
  assert.match(fellowshipService, /typeof value !== 'string' && typeof value !== 'number'/);
  assert.match(fellowshipService, /raw\.length > MAX_SEARCH_PAGINATION_PARAM_LENGTH/);
  assert.match(fellowshipService, /Number\.isSafeInteger\(value\) && value > 0/);
  assert.match(fellowshipService, /!POSITIVE_INTEGER_PARAM_RE\.test\(raw\)/);
  assert.match(fellowshipService, /Number\.isSafeInteger\(parsed\) \? parsed : undefined/);
  assert.doesNotMatch(fellowshipService, /Number\.isFinite\(parsed\) \? parsed : undefined/);
  assert.match(fellowshipService, /if \(typeof value !== 'string'\) continue/);
  assert.match(fellowshipService, /links\.slice\(0, MAX_PUBLIC_FELLOWSHIP_LINKS\)/);
  assert.match(fellowshipService, /value\.slice\(0, MAX_PUBLIC_FELLOWSHIP_ARRAY_ITEMS\)/);
  assert.match(fellowshipService, /ids\s*\.slice\(0, MAX_FELLOWSHIP_ID_READS\)/);
  assert.match(fellowshipService, /PUBLIC_FELLOWSHIP_PRIMITIVE_FIELDS/);
  assert.match(fellowshipService, /const safeQuery = boundedSearchQuery\(query\)/);
  assert.match(
    fellowshipService,
    /const safeYearOfStudy = boundedSearchFilterValues\(yearOfStudy\)/,
  );
  assert.match(fellowshipService, /const querySubjects = resolveTopicSubjects\(\[safeQuery\]\)/);
  assert.match(
    fellowshipService,
    /const searchTerms = \[safeQuery, \.\.\.queryTopicAliases\]\.filter\(Boolean\)/,
  );
  assert.match(fellowshipService, /filter\.\$text = \{ \$search: searchTerms\.join\(' '\) \}/);
  assert.match(
    fellowshipService,
    /const adminFellowshipText = \(value: unknown\): string \| undefined =>/,
  );
  assert.match(
    fellowshipService,
    /const adminFellowshipStringArray = \(value: unknown\): string\[\] \| undefined => \{/,
  );
  assert.match(
    fellowshipService,
    /const adminFellowshipLinks = \(\s*value: unknown,?\s*\): Array<\{ label\?: string; url: string \}> \| undefined =>/,
  );
  assert.match(fellowshipService, /if \('links' in update\) \{/);
  assert.match(fellowshipService, /if \('hoursPerWeek' in update\) \{/);
  assert.match(fellowshipService, /!isStudentVisibilityTier\(update\[field\]\)/);
  assert.match(fellowshipService, /!PROGRAM_CATEGORIES\.has\(update\.programCategory\)/);
  assert.match(
    fellowshipService,
    /normalizeFellowshipObjectId\(update\.studentVisibilityReviewedByAccountId\)/,
  );
});

test('shared item view and favorite mutations normalize ObjectIds before model work', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/itemOperations.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /OBJECT_ID_RE = \/\^\[a-fA-F0-9\]\{24\}\$\//);
  assert.match(source, /const normalizeItemObjectId = \(id: unknown\): string =>/);
  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /const value = serializedDocumentId\(id\)/);
  assert.match(source, /const safeId = normalizeItemObjectId\(id\)/);
  assert.match(source, /\{ _id: safeId, \.\.\.filter, favorites: \{ \$gt: 0 \} \}/);
  assert.doesNotMatch(source, /mongoose\.Types\.ObjectId\.isValid\(id\)/);
  assert.doesNotMatch(source, /typeof \(id as any\)\?\.toHexString === 'function'/);
  assert.doesNotMatch(source, /\(id as any\)\.toHexString\(\)/);
});

test('research, program, and fellowship nonpublic payloads require active admin authority', () => {
  const researchGroupController = fs.readFileSync(
    new URL('../server/src/controllers/researchGroupController.ts', import.meta.url),
    'utf8',
  );
  const programController = fs.readFileSync(
    new URL('../server/src/controllers/programController.ts', import.meta.url),
    'utf8',
  );
  const fellowshipController = fs.readFileSync(
    new URL('../server/src/controllers/fellowshipController.ts', import.meta.url),
    'utf8',
  );
  const adminGrantService = fs.readFileSync(
    new URL('../server/src/services/adminGrantService.ts', import.meta.url),
    'utf8',
  );

  assert.match(adminGrantService, /export const hasAdminAuthorityForUser = async/);
  assert.match(
    researchGroupController,
    /import \{ hasAdminAuthorityForUser \} from '\.\.\/services\/adminGrantService'/,
  );
  assert.match(
    researchGroupController,
    /const hasAdminAuthority = await hasAdminAuthorityForUser\(currentUser\)/,
  );
  assert.match(researchGroupController, /includeNonPublic: hasAdminAuthority/);
  assert.match(
    researchGroupController,
    /const lowQualityFirst = hasAdminAuthority && body\.browseQuality === 'low-first'/,
  );
  assert.match(
    programController,
    /import \{ hasAdminAuthorityForUser \} from '\.\.\/services\/adminGrantService'/,
  );
  assert.match(
    programController,
    /const hasAdminAuthority = await hasAdminAuthorityForUser\(currentUser\)/,
  );
  assert.match(programController, /includeNonPublic: hasAdminAuthority/);
  assert.doesNotMatch(researchGroupController, /currentUser\?\.userType === 'admin'/);
  assert.doesNotMatch(programController, /currentUser\?\.userType === 'admin'/);
  assert.doesNotMatch(fellowshipController, /currentUser\?\.userType === 'admin'/);
});

test('rendered scraper fetch blocks cross-origin redirect content', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/renderedFetch.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /import \{\s*assertPublicHttpUrl,\s*SsrfBlockedError,\s*ssrfSafeAgents,\s*stripIpv6Brackets,\s*\} from '\.\/\.\.\/utils\/ssrfGuard'/,
  );
  assert.match(source, /const defaultRenderedSeedRedirectCheck = \(/);
  assert.match(source, /method: 'GET'/);
  assert.match(
    source,
    /agent: url\.protocol === 'https:' \? agents\.httpsAgent : agents\.httpAgent/,
  );
  assert.match(source, /if \(await seedRedirectCheck\(seedUrl, timeoutMs\)\)/);
  assert.match(source, /blockedReason: 'redirected-before-render'/);
  assert.match(source, /blockedReason: 'rendered-seed-preflight-failed'/);
  assert.match(source, /const seedUrl = await assertPublicHttpUrl\(request\.url\)/);
  assert.match(source, /finalUrl = await assertPublicHttpUrl\(renderedUrl\)/);
  assert.match(source, /if \(finalUrl\.origin !== seedUrl\.origin\)/);
  assert.match(source, /blockedReason: 'redirected-cross-origin'/);
  assert.match(source, /MAX_RENDERED_FETCH_TIMEOUT_MS = 30_000/);
  assert.match(source, /function boundedRenderedFetchTimeout/);
  assert.match(
    source,
    /const timeoutMs = boundedRenderedFetchTimeout\(request\.timeoutMs, defaultTimeoutMs\)/,
  );
  assert.doesNotMatch(
    source,
    /url:\s*parsed\.url \|\| request\.url,\s*html:\s*parsed\.html \|\| ''/,
  );
});

test('server code never sends a non-constant URL outside the shared SSRF guard', () => {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const files = listOutboundFetchScanFiles(repoRoot);
  assert.ok(files.length > 100, `expected to scan the server tree, found ${files.length} files`);

  const unreviewed = [];
  const exemptionsStillNeeded = new Set();
  for (const file of files) {
    const relative = path.relative(repoRoot, file).split(path.sep).join('/');
    const findings = findUnguardedOutboundFetches(fs.readFileSync(file, 'utf8'));
    if (findings.length === 0) continue;
    if (REVIEWED_OUTBOUND_FETCHES.has(relative)) exemptionsStillNeeded.add(relative);
    for (const finding of unreviewedOutboundFetches(relative, findings)) {
      unreviewed.push(`${relative}:${finding.line} ${finding.kind}(${finding.argument})`);
    }
  }

  assert.deepEqual(
    unreviewed,
    [],
    'route these through fetchPublicHttpUrl (server/src/scrapers/utils/httpFetch.ts), or assertPublicHttpUrl plus ssrfSafeAgents, so neither the first host nor any redirect hop can be private',
  );
  assert.deepEqual(
    [...REVIEWED_OUTBOUND_FETCHES.keys()].filter((file) => !exemptionsStillNeeded.has(file)),
    [],
    'a reviewed exemption no longer matches any call; remove it',
  );
});

test('the unguarded-fetch scan flags a deliberately unguarded fixture', () => {
  const unguardedFixture = [
    "import axios from 'axios';",
    'export async function probe(url: string) {',
    "  const response = await fetch(url, { redirect: 'follow' });",
    '  const page = await axios.get(row.websiteUrl, { maxRedirects: 5 });',
    '  http.get(target, (res) => res.resume());',
    '  return response.status + page.status;',
    '}',
  ].join('\n');

  assert.deepEqual(
    findUnguardedOutboundFetches(unguardedFixture).map(({ kind, line }) => `${kind}@${line}`),
    ['global fetch@3', 'axios@4', 'node http@5'],
  );
});

test('the unguarded-fetch scan passes constant hosts, guarded agents, comments and shadowed fetch', () => {
  const guardedFixture = [
    "const INDEX_URL = 'https://example.edu/index';",
    '// fetch(url) inside a comment is not a call',
    "const note = 'fetch(url) inside a string is not a call';",
    'await fetch(INDEX_URL);',
    "await fetch('https://api.example.com/search', { method: 'POST' });",
    'await fetch(`https://api.example.com/v1/${id}`);',
    'const agents = ssrfSafeAgents();',
    'await axios.get(url, { httpAgent: agents.httpAgent, httpsAgent: agents.httpsAgent });',
    'http.request(url, { agent: agents.httpAgent });',
  ].join('\n');
  const shadowedFixture = [
    'export async function each(items: string[], fetch: (item: string) => Promise<void>) {',
    '  for (const item of items) await fetch(item);',
    '}',
  ].join('\n');

  assert.deepEqual(findUnguardedOutboundFetches(guardedFixture), []);
  assert.deepEqual(findUnguardedOutboundFetches(shadowedFixture), []);
});

test('the unguarded-fetch scan exempts only the reviewed number of calls in an exempt file', () => {
  const [exemptFile, { calls }] = [...REVIEWED_OUTBOUND_FETCHES][0];
  const reviewedCall = { kind: 'global fetch', line: 3, argument: 'url' };
  const addedCall = { kind: 'global fetch', line: 9, argument: 'row.websiteUrl' };
  const reviewed = Array.from({ length: calls }, () => reviewedCall);

  assert.deepEqual(unreviewedOutboundFetches(exemptFile, reviewed), []);
  assert.deepEqual(unreviewedOutboundFetches(exemptFile, [...reviewed, addedCall]), [
    ...reviewed,
    addedCall,
  ]);
  assert.deepEqual(unreviewedOutboundFetches('server/src/other.ts', [reviewedCall]), [
    reviewedCall,
  ]);
});

test('the unguarded-fetch scan still checks global fetch in a file that passes fetch as an argument', () => {
  const passesGlobalFetchFixture = [
    'export async function probe(url: string) {',
    '  const client = createClient(url, fetch);',
    '  return fetch(url);',
    '}',
  ].join('\n');
  const declaresFetchFixture = [
    'export async function probe(url: string, fetch?: typeof globalThis.fetch) {',
    '  return fetch?.(url);',
    '}',
    'function fetch(url: string) {',
    '  return url;',
    '}',
  ].join('\n');

  assert.deepEqual(
    findUnguardedOutboundFetches(passesGlobalFetchFixture).map(
      ({ kind, line }) => `${kind}@${line}`,
    ),
    ['global fetch@3'],
  );
  assert.deepEqual(findUnguardedOutboundFetches(declaresFetchFixture), []);
});

test('the unguarded-fetch scan counts agents as guarded only when they come from ssrfSafeAgents', () => {
  const plainAgentsFixture = [
    "import http from 'node:http';",
    "import https from 'node:https';",
    'const httpAgent = new http.Agent();',
    'const httpsAgent = new https.Agent();',
    'await axios.get(url, { httpAgent, httpsAgent });',
    'http.request(url, { agent: httpAgent });',
  ].join('\n');

  assert.deepEqual(
    findUnguardedOutboundFetches(plainAgentsFixture).map(({ kind, line }) => `${kind}@${line}`),
    ['axios@5', 'node http@6'],
  );
});

test('official-profile PI backfill fetches through the shared SSRF guard before cache lookup', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/sources/officialProfilePiBackfillScraper.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /import \{ assertPublicHttpUrl, ssrfSafeAgents \} from '\.\.\/\.\.\/utils\/ssrfGuard'/,
  );
  assert.match(source, /const safeUrl = await assertPublicHttpUrl\(url\)/);
  assert.match(source, /const safeUrlText = safeUrl\.toString\(\)/);
  assert.match(source, /const cacheKey = `official-profile-pi-backfill:\$\{safeUrlText\}`/);
  assert.match(source, /const agents = ssrfSafeAgents\(\)/);
  assert.match(source, /axios\.get\(safeUrlText, \{/);
  assert.match(source, /httpAgent: agents\.httpAgent/);
  assert.match(source, /httpsAgent: agents\.httpsAgent/);
  assert.doesNotMatch(source, /axios\.get\(url,\s*\{/);
  assert.doesNotMatch(source, /official-profile-pi-backfill:\$\{url\}/);
  assert.doesNotMatch(source, /rejectUnauthorized:\s*false/);
});

test('official-profile PI backfill source-acquisition ids use safe serialization', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/sources/officialProfilePiBackfillScraper.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /import \{ serializedDocumentId \} from '\.\.\/\.\.\/utils\/idSerialization'/,
  );
  assert.match(
    source,
    /const officialProfileDocumentId = \(value: unknown\): string => serializedDocumentId\(value\) \|\| ''/,
  );
  assert.match(source, /const idValue = \(value: unknown\): string => \{/);
  assert.match(source, /const directId = serializedDocumentId\(value\)/);
  assert.match(source, /officialProfileDocumentId\(entity\._id\)/);
  assert.match(source, /idValue\(entry\.researchEntityId\)/);
  assert.doesNotMatch(source, /String\(entity\._id\)/);
  assert.doesNotMatch(source, /String\(entry\.researchEntityId\)/);
});

test('department undergrad research scraper fetches configured pages through the shared SSRF guard', () => {
  const source = fs.readFileSync(
    new URL(
      '../server/src/scrapers/sources/departmentUndergradResearchScraper.ts',
      import.meta.url,
    ),
    'utf8',
  );

  assert.match(
    source,
    /import \{ assertPublicHttpUrl, ssrfSafeAgents \} from '\.\.\/\.\.\/utils\/ssrfGuard'/,
  );
  assert.match(source, /const safeUrl = await assertPublicHttpUrl\(url\)/);
  assert.match(source, /const safeUrlText = safeUrl\.toString\(\)/);
  assert.match(source, /const cacheKey = `page:\$\{safeUrlText\}`/);
  assert.match(source, /const agents = ssrfSafeAgents\(\)/);
  assert.match(source, /axios\.get\(safeUrlText, \{/);
  assert.match(source, /httpAgent: agents\.httpAgent/);
  assert.match(source, /httpsAgent: agents\.httpsAgent/);
  assert.doesNotMatch(source, /axios\.get\(url,\s*\{/);
  assert.doesNotMatch(source, /const cacheKey = `page:\$\{url\}`/);
  assert.doesNotMatch(source, /rejectUnauthorized:\s*false/);
});

test('Yale College fellowships scraper fetches configurable catalog pages through the shared SSRF guard', () => {
  const source = fs.readFileSync(
    new URL(
      '../server/src/scrapers/sources/yaleCollegeFellowshipsOfficeScraper.ts',
      import.meta.url,
    ),
    'utf8',
  );

  // The live fetch goes through the shared fetch policy, whose SSRF-safe agents are pinned by
  // the shared-fetch-policy test, so a benchmark capture can freeze it (#4132).
  assert.match(source, /import \{ assertPublicHttpUrl \} from '\.\.\/\.\.\/utils\/ssrfGuard'/);
  assert.match(source, /import \{ fetchPageWithPolicy \} from '\.\.\/utils\/httpFetch'/);
  assert.match(source, /const safeUrlText = \(await assertPublicHttpUrl\(url\)\)\.toString\(\)/);
  assert.match(source, /const cacheKey = `page:\$\{safeUrlText\}`/);
  assert.match(source, /await fetchPageWithPolicy\(safeUrlText, \{/);
  assert.match(source, /maxRedirects: 5/);
  assert.doesNotMatch(source, /axios\.get\(/);
  assert.doesNotMatch(source, /fetchPageWithPolicy\(url\b/);
  assert.doesNotMatch(source, /\bassertUrl:/);
  assert.doesNotMatch(source, /\brequest:\s*[a-zA-Z(]/);
  assert.doesNotMatch(source, /const cacheKey = `page:\$\{url\}`/);
  assert.doesNotMatch(source, /rejectUnauthorized:\s*false/);
});

test('Yale Research official directory scraper fetches configured and paginated pages through the shared SSRF guard', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/sources/yaleResearchOfficialScraper.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /import \{ assertPublicHttpUrl, ssrfSafeAgents \} from '\.\.\/\.\.\/utils\/ssrfGuard'/,
  );
  assert.match(source, /const safeUrl = await assertPublicHttpUrl\(url\)/);
  assert.match(source, /const safeUrlText = safeUrl\.toString\(\)/);
  assert.match(source, /const cacheKey = `page:\$\{safeUrlText\}`/);
  assert.match(source, /const agents = ssrfSafeAgents\(\)/);
  assert.match(source, /axios\.get\(safeUrlText, \{/);
  assert.match(source, /maxRedirects: 5/);
  assert.match(source, /httpAgent: agents\.httpAgent/);
  assert.match(source, /httpsAgent: agents\.httpsAgent/);
  assert.doesNotMatch(source, /axios\.get\(url,\s*\{/);
  assert.doesNotMatch(source, /const cacheKey = `page:\$\{url\}`/);
  assert.doesNotMatch(source, /rejectUnauthorized:\s*false/);
});

test('department roster scraper fetches configured HTML and data endpoints through the shared SSRF guard', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/sources/departmentRosterScraper.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /import \{ assertPublicHttpUrl, ssrfSafeAgents \} from '\.\.\/\.\.\/utils\/ssrfGuard'/,
  );
  assert.match(source, /const safeUrl = await assertPublicHttpUrl\(url\)/);
  assert.match(source, /const safeUrlText = safeUrl\.toString\(\)/);
  assert.match(source, /const cacheKey = `page:\$\{safeUrlText\}`/);
  assert.match(source, /axios\.get\(safeUrlText, \{/);
  assert.match(source, /const safeDataUrl = await assertPublicHttpUrl\(dept\.dataUrl\)/);
  assert.match(source, /const safeDataUrlText = safeDataUrl\.toString\(\)/);
  assert.match(
    source,
    /const cacheKey = `data:\$\{safeDataUrlText\}:\$\{JSON\.stringify\(request\)\}`/,
  );
  assert.match(source, /axios\.post\(safeDataUrlText, body, \{/);
  assert.match(source, /httpAgent: agents\.httpAgent/);
  assert.match(source, /httpsAgent: agents\.httpsAgent/);
  assert.doesNotMatch(source, /axios\.get\(url,\s*\{/);
  assert.doesNotMatch(source, /axios\.post\(dept\.dataUrl,/);
  assert.doesNotMatch(source, /const cacheKey = `page:\$\{url\}`/);
  assert.doesNotMatch(source, /data:\$\{dept\.dataUrl\}:/);
  assert.doesNotMatch(source, /rejectUnauthorized:\s*false/);
});

test('centers and institutes scraper fetches configured center pages through the shared SSRF guard', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/sources/centersInstitutesScraper.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /import \{ assertPublicHttpUrl, ssrfSafeAgents \} from '\.\.\/\.\.\/utils\/ssrfGuard'/,
  );
  assert.match(source, /const safeUrl = await assertPublicHttpUrl\(url\)/);
  assert.match(source, /const safeUrlText = safeUrl\.toString\(\)/);
  assert.match(source, /const cacheKey = `page:\$\{safeUrlText\}`/);
  assert.match(source, /const agents = ssrfSafeAgents\(\)/);
  assert.match(source, /axios\.get\(safeUrlText, \{/);
  assert.match(source, /maxRedirects: 5/);
  assert.match(source, /httpAgent: agents\.httpAgent/);
  assert.match(source, /httpsAgent: agents\.httpsAgent/);
  assert.doesNotMatch(source, /axios\.get\(url,\s*\{/);
  assert.doesNotMatch(source, /const cacheKey = `page:\$\{url\}`/);
  assert.doesNotMatch(source, /rejectUnauthorized:\s*false/);
});

test('YSE centers scraper fetches index and access detail pages through the shared SSRF guard', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/sources/yseCentersScraper.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /import \{ assertPublicHttpUrl, ssrfSafeAgents \} from '\.\.\/\.\.\/utils\/ssrfGuard'/,
  );
  assert.match(source, /const safeUrl = await assertPublicHttpUrl\(PAGE_URL\)/);
  assert.match(source, /axios\.get\(safeUrl\.toString\(\), \{/);
  assert.match(source, /const safeUrl = await assertPublicHttpUrl\(url\)/);
  assert.match(source, /const safeUrlText = safeUrl\.toString\(\)/);
  assert.match(source, /const cacheKey = `detail:\$\{safeUrlText\}`/);
  assert.match(source, /axios\.get\(safeUrlText, \{/);
  assert.match(source, /maxRedirects: 5/);
  assert.match(source, /httpAgent: agents\.httpAgent/);
  assert.match(source, /httpsAgent: agents\.httpsAgent/);
  assert.doesNotMatch(source, /axios\.get\(PAGE_URL,\s*\{/);
  assert.doesNotMatch(source, /axios\.get\(url,\s*\{/);
  assert.doesNotMatch(source, /const cacheKey = `detail:\$\{url\}`/);
  assert.doesNotMatch(source, /rejectUnauthorized:\s*false/);
});

test('YSM A-to-Z scraper fetches index and lab homepages through the shared SSRF guard', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/sources/ysmAtoZScraper.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /import \{ assertPublicHttpUrl, ssrfSafeAgents \} from '\.\.\/\.\.\/utils\/ssrfGuard'/,
  );
  assert.match(source, /const safeUrl = await assertPublicHttpUrl\(PAGE_URL\)/);
  assert.match(source, /axios\.get\(safeUrl\.toString\(\), \{/);
  assert.match(source, /const safeUrl = await assertPublicHttpUrl\(url\)/);
  assert.match(source, /const safeUrlText = safeUrl\.toString\(\)/);
  assert.match(source, /const cacheKey = `lab-homepage:\$\{safeUrlText\}`/);
  assert.match(source, /axios\.get\(safeUrlText, \{/);
  assert.match(source, /maxRedirects: 5/);
  assert.match(source, /httpAgent: agents\.httpAgent/);
  assert.match(source, /httpsAgent: agents\.httpsAgent/);
  assert.doesNotMatch(source, /axios\.get\(PAGE_URL,\s*\{/);
  assert.doesNotMatch(source, /axios\.get\(url,\s*\{/);
  assert.doesNotMatch(source, /const cacheKey = `lab-homepage:\$\{url\}`/);
  assert.doesNotMatch(source, /return String\(m\._id\)/);
  assert.doesNotMatch(source, /rejectUnauthorized:\s*false/);
});

test('undergraduate fellowship recipient scraper fetches configured recipient pages through the shared SSRF guard', () => {
  const source = fs.readFileSync(
    new URL(
      '../server/src/scrapers/sources/undergradFellowshipRecipientScraper.ts',
      import.meta.url,
    ),
    'utf8',
  );

  assert.match(
    source,
    /import \{ assertPublicHttpUrl, ssrfSafeAgents \} from '\.\.\/\.\.\/utils\/ssrfGuard'/,
  );
  assert.match(source, /const safeUrl = await assertPublicHttpUrl\(url\)/);
  assert.match(source, /const safeUrlText = safeUrl\.toString\(\)/);
  assert.match(source, /const cacheKey = `page:\$\{safeUrlText\}`/);
  assert.match(source, /const agents = ssrfSafeAgents\(\)/);
  assert.match(source, /axios\.get\(safeUrlText, \{/);
  assert.match(source, /maxRedirects: 5/);
  assert.match(source, /httpAgent: agents\.httpAgent/);
  assert.match(source, /httpsAgent: agents\.httpsAgent/);
  assert.doesNotMatch(source, /axios\.get\(url,\s*\{/);
  assert.doesNotMatch(source, /const cacheKey = `page:\$\{url\}`/);
  assert.doesNotMatch(source, /rejectUnauthorized:\s*false/);
});

test('LLM and profile fetchers use the normalized SSRF-safe URL for axios requests', () => {
  const fetcherFiles = [
    '../server/src/scrapers/sources/centerDirectorLLMExtractor.ts',
    '../server/src/scrapers/sources/centerAffiliationLLMExtractor.ts',
  ];

  for (const file of fetcherFiles) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');

    assert.match(source, /assertPublicHttpUrl/);
    assert.match(source, /ssrfSafeAgents/);
    assert.match(source, /const safeUrl = await assertPublicHttpUrl\(url\)/);
    assert.match(source, /const safeUrlText = safeUrl\.toString\(\)/);
    assert.match(source, /axios\.get\(safeUrlText, \{/);
    assert.match(source, /maxRedirects: 5/);
    assert.match(source, /httpAgent: agents\.httpAgent/);
    assert.match(source, /httpsAgent: agents\.httpsAgent/);
    assert.doesNotMatch(source, /axios\.get\(url,\s*\{/);
    assert.doesNotMatch(source, /rejectUnauthorized:\s*false/);
  }
});

test('shared microsite fetch policy enforces the SSRF guard before requesting untrusted URLs', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/utils/httpFetch.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /import \{ assertPublicHttpUrl, ssrfSafeAgents \} from '\.\.\/\.\.\/utils\/ssrfGuard'/,
  );
  assert.match(source, /const assertUrl = options\.assertUrl \?\? assertPublicHttpUrl/);
  assert.match(source, /const safeUrl = \(await assertUrl\(url\)\)\.toString\(\)/);
  assert.match(source, /const agents = ssrfSafeAgents\(\)/);
  assert.match(source, /httpAgent: agents\.httpAgent/);
  assert.match(source, /httpsAgent: agents\.httpsAgent/);
  assert.match(source, /request\(safeUrl, config\)/);
  assert.doesNotMatch(source, /rejectUnauthorized:\s*false/);
});

test('shared form post goes through the same SSRF guard, agents, and host limiter as the page fetch', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/utils/httpFetch.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /export async function postFormWithPolicy\([\s\S]*?\n\): Promise<FetchedHttpPage> \{\n {2}if \(isBenchmarkReplayActive\(\)\) refuseBenchmarkReplayNetwork\(\);\n {2}return fetchPageLive\(url, options, \{ method: 'POST', body: form\.toString\(\) \}\);\n\}/,
  );
  assert.match(
    source,
    /await axios\.request\(\{\n\s+url,\n\s+method: 'POST',[^}]*?httpAgent: agents\.httpAgent,\n\s+httpsAgent: agents\.httpsAgent,/,
  );
  assert.match(source, /result = await limiter\.run\(host, \(\) => request\(safeUrl, config\)\)/);
});

test('student grants fund search enumerates only through the SSRF-guarded shared fetch policy', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/utils/communityForceFundSearch.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /\} from '\.\/httpFetch';/);
  assert.match(source, /fetchPageWithPolicy\(options\.searchUrl, policy\(\)\)/);
  assert.match(source, /postFormWithPolicy\(options\.searchUrl, allFundsForm, policy\(\)\)/);
  assert.match(source, /postFormWithPolicy\(options\.searchUrl, postback, policy\(\)\)/);
  assert.match(source, /fetchPublicHttpUrl\(fund\.shortLink, \{\n\s+maxRedirects: 0,/);
  assert.doesNotMatch(source, /\baxios\b/);
  assert.doesNotMatch(source, /(?<![\w.$])fetch\(/);
  assert.doesNotMatch(source, /rejectUnauthorized:\s*false/);
});

test('lab-microsite fetchers delegate to the SSRF-guarded shared fetch policy', () => {
  const fetcherFiles = [
    '../server/src/scrapers/sources/labMicrositeDescriptionLLMExtractor.ts',
    '../server/src/scrapers/sources/labMicrositeUndergradLLMExtractor.ts',
  ];

  for (const file of fetcherFiles) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');

    assert.match(source, /import \{ fetchPageWithPolicy \} from '\.\.\/utils\/httpFetch'/);
    assert.match(source, /await fetchPageWithPolicy\(url, \{/);
    assert.doesNotMatch(source, /axios\.get\(url,\s*\{/);
    assert.doesNotMatch(source, /axios\.get\(safeUrlText,\s*\{/);
    assert.doesNotMatch(source, /rejectUnauthorized:\s*false/);
  }
});

test('rendered fetch bridge executes the SSRF-normalized URL', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/renderedFetch.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const seedUrl = await assertPublicHttpUrl\(request\.url\)/);
  assert.match(source, /const safeRequestUrl = seedUrl\.toString\(\)/);
  assert.match(source, /method: 'GET'/);
  assert.match(source, /Range: 'bytes=0-0'/);
  assert.match(source, /response\.destroy\(\)/);
  assert.match(source, /'--url',\s*safeRequestUrl/s);
  assert.match(source, /const renderedUrl = parsed\.url \|\| safeRequestUrl/);
  assert.match(source, /error instanceof SsrfBlockedError/);
  assert.match(source, /blockedReason: 'rendered-final-url-blocked'/);
  assert.doesNotMatch(source, /'--url',\s*request\.url/s);
  assert.doesNotMatch(source, /method: 'HEAD'/);
});

test('beta data quality live-link checks use the shared SSRF guard', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/betaDataQuality.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import axios from 'axios'/);
  assert.match(
    source,
    /import \{ assertPublicHttpUrl, ssrfSafeAgents \} from '\.\.\/utils\/ssrfGuard'/,
  );
  assert.match(source, /const safeUrl = await assertPublicHttpUrl\(url\)/);
  assert.match(source, /const agents = ssrfSafeAgents\(\)/);
  assert.match(source, /url: safeUrl\.toString\(\)/);
  assert.match(source, /maxRedirects: 5/);
  assert.match(source, /httpAgent: agents\.httpAgent/);
  assert.match(source, /httpsAgent: agents\.httpsAgent/);
  assert.match(source, /response\.data\.destroy\(\)/);
  assert.match(source, /String\(sanitizeLogValue\(error\)\)/);
  assert.doesNotMatch(source, /fetch\(url/);
  assert.doesNotMatch(source, /error instanceof Error \? error\.message : String\(error\)/);
});

test('shared SSRF guard bounds public URL shape before outbound fetches', () => {
  const source = fs.readFileSync(
    new URL('../server/src/utils/ssrfGuard.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const MAX_SSRF_PUBLIC_HTTP_URL_LENGTH = 2048/);
  assert.match(source, /const hasUnsafePublicHttpUrlCharacter/);
  assert.match(source, /const isAllowedPublicHttpPort = \(url: URL\): boolean =>/);
  assert.match(source, /if \(typeof rawUrl !== 'string'\)/);
  assert.match(source, /const trimmed = rawUrl\.trim\(\)/);
  assert.match(source, /if \(!trimmed \|\| trimmed\.length > MAX_SSRF_PUBLIC_HTTP_URL_LENGTH\)/);
  assert.match(source, /hasUnsafePublicHttpUrlCharacter\(trimmed\)/);
  assert.match(source, /parsed = new URL\(trimmed\)/);
  assert.match(source, /if \(!isAllowedPublicHttpPort\(parsed\)\)/);
  assert.match(source, /throw new SsrfBlockedError\('URL port is not allowed', 'port'\)/);
});

// #2709 gave every refusal a machine-readable reason so a caller can tell a name
// that no longer exists from an address we refuse to reach. That distinction is
// only safe while the security answer stays identical: both still throw, and only
// a genuine NXDOMAIN/NODATA may read as `unresolvable`. A resolver failure or a
// private resolution reported as `unresolvable` would let a DNS blip or a blocked
// internal host retire a live citation.
test('SSRF refusal reasons never soften the refusal itself', () => {
  const source = fs.readFileSync(
    new URL('../server/src/utils/ssrfGuard.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /const NAME_DOES_NOT_EXIST_DNS_CODES = new Set\(\['ENOTFOUND', 'ENODATA'\]\)/,
  );
  assert.match(
    source,
    /const nameDoesNotExist = \(error: unknown\): boolean => \{[\s\S]*?NAME_DOES_NOT_EXIST_DNS_CODES\.has\(code\)/,
  );
  assert.match(source, /if \(records\.length === 0\) return \{ kind: 'unresolvable' \};/);

  // #2725: `unresolvable` is the only verdict a caller acts on destructively, and
  // Node reports ENOTFOUND for live names under resolver stress, so the first
  // lookup may never produce it on its own. Both the early return for an
  // inconclusive failure and the confirming second lookup are load-bearing.
  assert.match(
    source,
    /return nameDoesNotExist\(error\)\s*\?\s*\{ kind: 'unresolvable' \}\s*:\s*\{ kind: 'resolver-failure' \};/,
  );

  // #2782: one 250ms re-ask proved too short to confirm anything - a resolver
  // outage lasting seconds recorded 134 live hosts as dead. The negative must be
  // re-asked with growing delays, and total patience must exceed a short outage.
  const delays = source.match(/const NAME_LOOKUP_RETRY_DELAYS_MS = \[([^\]]*)\]/s)?.[1];
  assert.ok(delays, 'NAME_LOOKUP_RETRY_DELAYS_MS declaration not found');
  const parsed = delays
    .split(',')
    .map((part) => Number(part.replace(/_/g, '').trim()))
    .filter((n) => Number.isFinite(n));
  assert.ok(parsed.length >= 3, 'a claimed negative must be re-asked at least three times');
  for (let i = 1; i < parsed.length; i += 1) {
    assert.ok(parsed[i] > parsed[i - 1], 'each re-ask must wait longer than the last');
  }
  assert.ok(
    parsed.reduce((a, b) => a + b, 0) >= 10_000,
    'total patience before recording a death must exceed a short resolver outage',
  );
  assert.match(source, /if \(verdict\.kind !== 'unresolvable'\) return verdict;/);
  assert.match(source, /await sleep\(delayMs\);/);
  assert.match(
    source,
    /records\.every\(\(r\) => !isPrivateAddress\(r\.address\)\)\s*\?\s*\{ kind: 'public' \}\s*:\s*\{ kind: 'private-address' \}/,
  );
  assert.match(
    source,
    /isPrivateAddress\(clean\) \? \{ kind: 'private-address' \} : \{ kind: 'public' \}/,
  );
  assert.match(source, /if \(resolution\.kind !== 'public'\) \{\s*throw new SsrfBlockedError\(/);
  assert.match(
    source,
    /export const isPublicHostname = async \(hostname: string\): Promise<boolean> =>\s*\(await classifyHostnameResolution\(hostname\)\)\.kind === 'public';/,
  );
});

// The health classifier is the one caller that turns a refusal into a durable
// verdict, so it is where a mistake becomes stored data. Only `unresolvable` may
// become ENOTFOUND (and therefore UNAVAILABLE); every other refusal must stay
// ERR_SSRF_BLOCKED and therefore UNKNOWN.
// #2782: the guard that catches what no single retry can. A pass probing thousands
// of unrelated hosts can tell a dead host from a broken resolver, and must halt
// rather than keep recording deaths. Both properties are one edit from breaking.
test('the resolver circuit breaker counts distinct hosts and trips open', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/utils/resolverCircuitBreaker.ts', import.meta.url),
    'utf8',
  );

  // Keyed by host, so one genuinely dead host retried in a loop cannot trip it.
  assert.match(source, /private readonly failuresByHost = new Map<string, number>\(\);/);
  assert.match(source, /this\.failuresByHost\.set\(host, this\.now\(\)\);/);
  assert.match(source, /if \(this\.failuresByHost\.size < this\.threshold\) return;/);
  assert.ok(
    Number(source.match(/DEFAULT_RESOLVER_BREAKER_THRESHOLD = (\d+)/)?.[1]) > 1,
    'a threshold of one would halt every pass on a single dead host',
  );
  // Trips open and stays open.
  assert.match(source, /this\.tripped = true;/);
  assert.match(
    source,
    /assertHealthy\(\): void \{\s*if \(!this\.tripped\) return;\s*throw new ResolverUnhealthyError/,
  );
  // A host that resolves stops counting against the resolver.
  assert.match(
    source,
    /recordSuccess\(host: string\): void \{\s*this\.failuresByHost\.delete\(host\);/,
  );

  const wiring = fs.readFileSync(
    new URL('../server/src/scripts/backfillSourceLinkHealth.ts', import.meta.url),
    'utf8',
  );
  // Checked BEFORE the next probe, so a tripped breaker records nothing further.
  assert.match(wiring, /deps\.resolverBreaker\?\.assertHealthy\(\);/);
  assert.match(wiring, /if \(error instanceof ResolverUnhealthyError\) throw error;/);
  assert.match(wiring, /deps\.resolverBreaker\?\.recordFailure\(hostOf\(url\)\);/);
  assert.match(wiring, /deps\.resolverBreaker\?\.recordSuccess\(hostOf\(url\)\);/);
});

test('link-health maps only a non-resolving host to a dead-link error code', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/sourceLinkHealth.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /error instanceof SsrfBlockedError && error\.reason === 'unresolvable'\s*\?\s*'ENOTFOUND'\s*:\s*'ERR_SSRF_BLOCKED'/,
  );
  assert.match(source, /DEAD_LINK_ERROR_CODES = new Set\(\[\s*'ENOTFOUND',/);
  assert.match(source, /RESOURCE_GONE_HTTP_STATUS_CODES = new Set\(\[404, 410\]\)/);

  // #2766: a throttled answer arrives as a status, so it must be re-asked with
  // backoff, and a status that asserts the page is gone must never be re-asked.
  // The retryable list is reused from the scraper fetch so the two cannot drift.
  assert.match(
    source,
    /import \{ DEFAULT_RETRYABLE_STATUSES \} from '\.\.\/scrapers\/utils\/httpFetch';/,
  );
  assert.match(source, /!DEFAULT_RETRYABLE_STATUSES\.has\(result\.status\)\) break;/);
  assert.match(
    source,
    /await delay\(probeStatusBackoffMs\(attemptIndex, result\.retryAfterMs\)\);/,
  );
  assert.ok(
    !/DEFAULT_RETRYABLE_STATUSES[\s\S]{0,200}404/.test(source),
    'a gone status must never be treated as retryable (#2766)',
  );

  // #2751: a certificate that does not cover the hostname is a fact about the
  // server's TLS configuration, never about whether the page exists, and no retry
  // changes that. Listing it retired six live Yale vanity hosts, three of them on
  // student_ready rows, so it must never rejoin the dead set.
  const deadSet = source.match(/const DEAD_LINK_ERROR_CODES = new Set\(\[[^\]]*\]\)/s)?.[0] ?? '';
  assert.ok(deadSet, 'DEAD_LINK_ERROR_CODES declaration not found');
  assert.ok(
    !deadSet.includes('ERR_TLS_CERT_ALTNAME_INVALID'),
    'a certificate name mismatch must not retire a link (#2751)',
  );

  // The reachability codes may retire a link, but only on a confirmed second
  // attempt, so each must also be retryable. An entry in the dead set that is not
  // retryable records a destructive verdict on one observation.
  const retrySet = source.match(/const RETRYABLE_ERROR_CODES = new Set\(\[[^\]]*\]\)/s)?.[0] ?? '';
  assert.ok(retrySet, 'RETRYABLE_ERROR_CODES declaration not found');
  for (const code of ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH']) {
    assert.ok(
      deadSet.includes(code) === retrySet.includes(code),
      `${code} must be confirmed by a retry before it retires a link (#2751)`,
    );
  }
});

// The SSRF policies above each pin one named scraper, which is how ten scrapers
// came to use the guard with nothing requiring them to keep it. Enumerated
// coverage cannot cover a file that does not exist yet, so a new scraper starts
// unpinned by default. This walks the directory instead: every scraper that makes
// an outbound request must route through the guard, or be an explicitly listed
// fixed-endpoint API where there is no attacker-influenced URL to forge.
//
// This is a floor, not a proof. It shows a scraper reaches the guard; only the
// per-scraper policies above show the guarded URL is the one that reaches axios.
// Keep both.
const SCRAPER_SOURCE_DIRECTORY = '../server/src/scrapers/sources';

// Hosts baked into the source as constants. Adding an entry must stay a
// deliberate review decision, so the host is asserted too: an allowlisted
// scraper that grows a dynamic fetch fails here rather than silently opting out.
const FIXED_ENDPOINT_SCRAPER_HOSTS = new Map([
  ['doeOstiGrantScraper', 'https://www.osti.gov'],
  ['federalAwardScraper', 'https://api.usaspending.gov'],
  ['nehGrantScraper', 'https://awardsearch.neh.gov'],
  ['nihReporterScraper', 'https://api.reporter.nih.gov'],
  ['nsfAwardScraper', 'https://api.nsf.gov'],
  ['yaleDirectoryScraper', 'https://api.yalies.io'],
]);

const scraperSourceFiles = () =>
  fs
    .readdirSync(new URL(SCRAPER_SOURCE_DIRECTORY, import.meta.url))
    .filter((name) => name.endsWith('.ts') && !name.includes('.test.'))
    .map((name) => ({
      name: name.replace(/\.ts$/, ''),
      source: fs.readFileSync(
        new URL(`${SCRAPER_SOURCE_DIRECTORY}/${name}`, import.meta.url),
        'utf8',
      ),
    }));

test('every scraper that makes outbound requests is bound by the SSRF guard', () => {
  const scrapers = scraperSourceFiles();

  // A matcher that silently finds nothing would pass this policy while checking
  // nothing, so anchor it: the directory must be non-empty and most of it must
  // make requests. Scraping the public web is what these files are for.
  assert.ok(scrapers.length >= 25, `expected the scraper directory, found ${scrapers.length}`);

  const requesting = scrapers.filter(({ source }) => /\baxios[.(]|\bfetch\(/.test(source));
  assert.ok(
    requesting.length >= 25,
    `expected most scrapers to make requests, matched ${requesting.length}`,
  );

  const unguarded = [];
  for (const { name, source } of requesting) {
    const usesGuardDirectly = /assertPublicHttpUrl|ssrfSafeAgents/.test(source);
    const delegatesToGuardedPolicy =
      /fetchPageWithPolicy|from '\.\.\/utils\/httpFetch'|from '\.\.\/renderedFetch'/.test(source);
    if (usesGuardDirectly || delegatesToGuardedPolicy) continue;

    const fixedHost = FIXED_ENDPOINT_SCRAPER_HOSTS.get(name);
    if (!fixedHost) {
      unguarded.push(name);
      continue;
    }
    assert.ok(
      source.includes(fixedHost),
      `${name} is allowlisted as a fixed-endpoint API but no longer pins ${fixedHost}; it must use the SSRF guard or update the allowlist`,
    );
  }

  assert.deepEqual(
    unguarded,
    [],
    `these scrapers make outbound requests without reaching the SSRF guard: ${unguarded.join(', ')}. Route the URL through assertPublicHttpUrl/ssrfSafeAgents or fetchPageWithPolicy, or add it to FIXED_ENDPOINT_SCRAPER_HOSTS if its endpoint is a source constant.`,
  );
});

test('every scraper source module is registered for dispatch', () => {
  const registry = fs.readFileSync(
    new URL('../server/src/scrapers/registry.ts', import.meta.url),
    'utf8',
  );
  const scrapers = scraperSourceFiles();
  assert.ok(scrapers.length >= 25, `expected the scraper directory, found ${scrapers.length}`);

  // An unregistered scraper does not throw; the sweep just never dispatches it, so
  // its whole source silently stops being collected with no failing signal
  // anywhere. That has bitten before, which is why it is pinned structurally.
  const unregistered = scrapers
    .map(({ name }) => name)
    .filter((name) => !registry.includes(`./sources/${name}'`));

  assert.deepEqual(
    unregistered,
    [],
    `these scraper modules are not imported by registry.ts, so the orchestrator can never dispatch them and their source is silently never scraped: ${unregistered.join(', ')}`,
  );
});

// Public read paths that use a state-changing verb. POST /search is a
// Meilisearch query with a request body, not a mutation, so it is deliberately
// anonymous: logged-out browsing is the product. Every other entry would be a
// write reachable without a session.
const ANONYMOUS_STATE_CHANGING_ROUTES = new Set(['researchGroups.ts POST /search']);

test('no state-changing route is reachable without authentication', () => {
  const routesDirectory = '../server/src/routes';
  const routeFiles = fs
    .readdirSync(new URL(routesDirectory, import.meta.url))
    .filter((name) => name.endsWith('.ts') && name !== 'index.ts');
  const mountIndex = fs.readFileSync(
    new URL(`${routesDirectory}/index.ts`, import.meta.url),
    'utf8',
  );

  assert.ok(routeFiles.length >= 7, `expected the routes directory, found ${routeFiles.length}`);

  // Balanced-paren extraction, not a regex over the whole call. A lazy
  // `[\s\S]*?` up to `\n);` runs past the end of a one-line route into the next
  // one, so a route with no guard inherits the following route's isAuthenticated
  // and reads as protected. That false pass is the whole risk this policy exists
  // to remove, so the parse has to be exact.
  const routeHandlerCalls = (source) => {
    const calls = [];
    const pattern = /router\.(get|post|put|patch|delete)\(/g;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      let depth = 0;
      let index = match.index + match[0].length - 1;
      for (; index < source.length; index += 1) {
        if (source[index] === '(') depth += 1;
        else if (source[index] === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const body = source.slice(match.index, index + 1);
      calls.push({ verb: match[1], path: body.match(/['"]([^'"]*)['"]/)?.[1] ?? '?', body });
    }
    return calls;
  };

  const anonymous = [];
  let stateChangingRoutes = 0;

  for (const file of routeFiles) {
    const source = fs.readFileSync(new URL(`${routesDirectory}/${file}`, import.meta.url), 'utf8');

    assert.ok(
      mountIndex.includes(file.replace(/\.ts$/, '')),
      `${file} is not mounted in routes/index.ts; an unmounted router is either dead code or a route served outside the reviewed mount table`,
    );

    // Guards apply router-wide via router.use as well as per route, so both count.
    const routerWideAuth = /router\.use\([^;]*?(isAuthenticated|isAdmin|requireActiveAdmin)/s.test(
      source,
    );

    for (const { verb, path, body } of routeHandlerCalls(source)) {
      if (verb === 'get') continue;
      stateChangingRoutes += 1;
      const authenticated =
        routerWideAuth || /isAuthenticated|isAdmin|requireActiveAdmin/.test(body);
      const label = `${file} ${verb.toUpperCase()} ${path}`;
      if (!authenticated && !ANONYMOUS_STATE_CHANGING_ROUTES.has(label)) anonymous.push(label);
    }
  }

  assert.ok(
    stateChangingRoutes >= 15,
    `expected to find the state-changing routes, matched ${stateChangingRoutes}`,
  );
  assert.deepEqual(
    anonymous,
    [],
    `these state-changing routes are reachable without a session: ${anonymous.join(', ')}. Add isAuthenticated, or add the route to ANONYMOUS_STATE_CHANGING_ROUTES if it is a read that merely uses a request body.`,
  );
});

test('gate refresh scheduler bounds operator-controlled spawn cadence', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/gateRefreshScheduler.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const MIN_GATE_REFRESH_INTERVAL_MINUTES = 5/);
  assert.match(source, /const MAX_GATE_REFRESH_INTERVAL_MINUTES = 24 \* 60/);
  assert.match(source, /if \(!Number\.isFinite\(minutes\) \|\| minutes <= 0\) return 0/);
  assert.match(source, /const boundedMinutes = Math\.min\(/);
  assert.match(source, /Math\.max\(minutes, MIN_GATE_REFRESH_INTERVAL_MINUTES\)/);
  assert.match(source, /MAX_GATE_REFRESH_INTERVAL_MINUTES/);
  assert.match(source, /return boundedMinutes \* 60_000/);
  assert.doesNotMatch(
    source,
    /return Number\.isFinite\(minutes\) && minutes > 0 \? minutes \* 60_000 : 0/,
  );
});

test('research detail professor audit constrains env-driven URLs and output paths', () => {
  const source = fs.readFileSync(
    new URL('../scripts/research-detail-professor-audit.mjs', import.meta.url),
    'utf8',
  );

  assert.match(source, /const LOCAL_AUDIT_HOSTS = new Set/);
  assert.match(source, /const DEPLOYED_AUDIT_HOSTS = new Set/);
  assert.match(source, /const safeAuditBaseUrl = \(raw, name\) =>/);
  assert.match(source, /parsed\.username \|\| parsed\.password/);
  assert.match(source, /\$\{name\} deployed origins must use HTTPS/);
  assert.match(source, /const safeAuditOutputDir = \(raw\) =>/);
  assert.match(source, /OUT_DIR must stay under repo tmp\/ or \/tmp/);
  assert.match(source, /const parsePositiveIntegerEnv = \(raw, name, fallback, max\) =>/);
  assert.match(source, /const clientBase = safeAuditBaseUrl/);
  assert.match(source, /const serverBase = safeAuditBaseUrl/);
  assert.match(source, /const outDir = safeAuditOutputDir/);
  assert.doesNotMatch(source, /const clientBase = process\.env\.CLIENT_BASE/);
  assert.doesNotMatch(source, /const serverBase = process\.env\.SERVER_BASE/);
  assert.doesNotMatch(source, /const outDir = process\.env\.OUT_DIR/);
  assert.doesNotMatch(source, /Number\.parseInt\(process\.env\.AUDIT_LIMIT/);
});

test('unified research search audit constrains env-driven URLs and output paths', () => {
  const source = fs.readFileSync(
    new URL('../scripts/unified-research-search-audit.mjs', import.meta.url),
    'utf8',
  );

  assert.match(source, /const LOCAL_AUDIT_HOSTS = new Set/);
  assert.match(source, /const DEPLOYED_AUDIT_HOSTS = new Set/);
  assert.match(source, /const safeAuditBaseUrl = \(raw, name\) =>/);
  assert.match(source, /parsed\.username \|\| parsed\.password/);
  assert.match(source, /\$\{name\} deployed origins must use HTTPS/);
  assert.match(source, /const safeAuditOutputDir = \(raw\) =>/);
  assert.match(source, /OUT_DIR must stay under repo tmp\/ or \/tmp/);
  assert.match(source, /const clientBase = safeAuditBaseUrl/);
  assert.match(source, /const serverBase = safeAuditBaseUrl/);
  assert.match(source, /const outDir = safeAuditOutputDir/);
  assert.doesNotMatch(source, /const clientBase = process\.env\.CLIENT_BASE/);
  assert.doesNotMatch(source, /const serverBase = process\.env\.SERVER_BASE/);
  assert.doesNotMatch(source, /const outDir = process\.env\.OUT_DIR/);
});

test('public pathway search omits persistence timestamp metadata', () => {
  const clientTypeSource = fs.readFileSync(
    new URL('../client/src/types/pathway.ts', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(clientTypeSource, /\| 'createdAt'/);
  assert.doesNotMatch(clientTypeSource, /createdAt\?: string/);
});

test('public pathway search hides research entity workflow metadata', () => {
  const clientTypeSource = fs.readFileSync(
    new URL('../client/src/types/pathway.ts', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(clientTypeSource, /studentVisibilityTier/);
});

test('public research Meilisearch service bounds direct search inputs', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/researchGroupService.ts', import.meta.url),
    'utf8',
  );
  const controllerSource = fs.readFileSync(
    new URL('../server/src/controllers/researchGroupController.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /MAX_SEARCH_QUERY_LENGTH = 512/);
  assert.match(source, /MAX_FILTER_VALUES = 50/);
  assert.match(source, /MAX_FILTER_VALUE_LENGTH = 120/);
  assert.match(controllerSource, /MAX_SEARCH_PAGINATION_PARAM_LENGTH = 16/);
  assert.match(controllerSource, /const POSITIVE_INTEGER_PARAM_RE = \/\^\[1-9\]\\d\*\$\/;/);
  assert.match(source, /const RESEARCH_GROUP_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(
    source,
    /export const normalizeResearchGroupObjectId = \(value: unknown\): string \| undefined =>/,
  );
  assert.match(source, /typeof value === 'string'/);
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(source, /return RESEARCH_GROUP_OBJECT_ID_RE\.test\(id\) \? id : undefined/);
  assert.match(source, /const sanitizeResearchGroupSearchFilters = \(/);
  assert.match(source, /if \(typeof value !== 'string'\) continue/);
  assert.match(source, /const sanitizeResearchGroupSearchOptions = \(/);
  assert.match(controllerSource, /\.filter\(\(v\): v is string => typeof v === 'string'\)/);
  assert.match(
    controllerSource,
    /typeof item !== 'string' \|\| item\.trim\(\)\.length > MAX_FILTER_VALUE_LENGTH/,
  );
  assert.match(
    controllerSource,
    /const parsePositiveIntegerParam = \(value: unknown, fallback: number\): number =>/,
  );
  assert.match(controllerSource, /Number\.isSafeInteger\(value\) && value > 0/);
  assert.match(controllerSource, /!POSITIVE_INTEGER_PARAM_RE\.test\(raw\)/);
  assert.match(controllerSource, /Number\.isSafeInteger\(parsed\) \? parsed : fallback/);
  assert.match(
    controllerSource,
    /const requestedPage = parsePositiveIntegerParam\(body\.page, 1\)/,
  );
  assert.match(
    controllerSource,
    /const requestedPageSize = parsePositiveIntegerParam\(body\.pageSize, DEFAULT_PAGE_SIZE\)/,
  );
  assert.doesNotMatch(controllerSource, /String\(item\)/);
  assert.doesNotMatch(controllerSource, /Number\.isFinite\(Number\(body\.page\)\)/);
  assert.match(
    source,
    /const safeFilters = sanitizeResearchGroupSearchFilters\(filters \|\| \{\}\)/,
  );
  assert.match(source, /const safeOptions = sanitizeResearchGroupSearchOptions\(options\)/);
  assert.match(source, /const trimmedQuery = boundedResearchSearchQuery\(query\)/);
  assert.match(
    source,
    /const visibilityScopedFilters = applyVisibilityScopeToFilters\(\s*safeFilters,\s*safeOptions\.includeNonPublic,?\s*\)/,
  );
  assert.match(source, /buildResearchGroupFilterString\(visibilityScopedFilters\)/);
  assert.match(source, /\.map\(normalizeResearchGroupObjectId\)/);
  assert.match(source, /const safeEntityId = normalizeResearchGroupObjectId\(entityId\)/);
  assert.match(source, /await getResearchEntityRoster\(\(group as any\)\._id\)/);
  assert.doesNotMatch(source, /mongoose\.Types\.ObjectId\.isValid\(id\)/);
  assert.doesNotMatch(source, /mongoose\.Types\.ObjectId\.isValid\(String\(entityId/);
});

test('legacy research group public DTO ids use safe serialization', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/researchGroupService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(
    source,
    /const researchGroupDocumentId = \(value: unknown\): string => serializedDocumentId\(value\) \|\| ''/,
  );
  assert.match(source, /_id: researchGroupDocumentId\(entity\._id\)/);
  assert.match(source, /leadMembersByEntityId\.get\(researchGroupDocumentId\(entity\._id\)\)/);
  assert.match(source, /\[researchGroupDocumentId\(entity\._id\), entity\]/);
  assert.match(source, /visibleEntitiesById\.has\(researchGroupDocumentId\(id\)\)/);
  assert.match(source, /identityKey: researchGroupDocumentId\(entry\.personId\)/);
  assert.doesNotMatch(source, /_id: String\(entity\._id\)/);
  assert.doesNotMatch(source, /String\(entity\._id\)/);
  assert.doesNotMatch(source, /String\(member\.researchEntityId/);
  assert.doesNotMatch(source, /(?:^|[^A-Za-z])String\(route\?\._id/);
  assert.doesNotMatch(source, /(?:^|[^A-Za-z])String\(lead\.user\?\._id/);
  assert.doesNotMatch(source, /(?:^|[^A-Za-z])String\(userKey\)/);
  assert.doesNotMatch(source, /(?:^|[^A-Za-z])String\(candidateUserKey\)/);
});

test('public research detail bounds slug input before service and Mongo work', () => {
  const controller = fs.readFileSync(
    new URL('../server/src/controllers/researchGroupController.ts', import.meta.url),
    'utf8',
  );
  const service = fs.readFileSync(
    new URL('../server/src/services/researchGroupService.ts', import.meta.url),
    'utf8',
  );

  assert.match(controller, /normalizeResearchDetailSlug/);
  assert.match(controller, /return response\.status\(400\)\.json\(\{ error: 'Invalid slug' \}\)/);
  assert.match(controller, /const detail = await getResearchGroupDetail\(slug\)/);
  assert.match(service, /MAX_RESEARCH_DETAIL_SLUG_LENGTH = 160/);
  assert.match(service, /RESEARCH_DETAIL_SLUG_PATTERN = \/\^\[a-z0-9\]\[a-z0-9_-\]\{0,159\}\$\/i/);
  assert.match(
    service,
    /export const normalizeResearchDetailSlug = \(value: unknown\): string \| undefined =>/,
  );
  assert.match(service, /trimmed\.length > MAX_RESEARCH_DETAIL_SLUG_LENGTH/);
  assert.match(service, /RESEARCH_DETAIL_SLUG_PATTERN\.test\(trimmed\)/);
  assert.match(service, /const normalizedSlug = normalizeResearchDetailSlug\(slug\)/);
  assert.match(service, /slug: normalizedSlug/);
});

test('research detail faculty fallback identities omit direct email fields', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/researchGroupService.ts', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(source, /import \{ publicContactEmail \} from '\.\.\/utils\/contactEmail'/);
  assert.doesNotMatch(source, /email:\s*publicContactEmail\(faculty\.email\) \|\| undefined/);
  assert.doesNotMatch(source, /email:\s*faculty\.email/);
});

test('analytics user drilldown sanitizes legacy event fields before response', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/analyticsService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const publicAnalyticsUserEvent = \(event: any\): AnalyticsUserEvent => \{/);
  assert.match(
    source,
    /const eventType = sanitizeAnalyticsEventType\(event\?\.eventType\) \|\| AnalyticsEventType\.VISITOR/,
  );
  assert.match(
    source,
    /const fellowshipId = normalizeAnalyticsStoredObjectIdString\(event\?\.fellowshipId\)/,
  );
  assert.doesNotMatch(source, /event\?\.listingId/);
  assert.match(source, /const searchQuery = sanitizeAnalyticsText\(event\?\.searchQuery\)/);
  assert.match(
    source,
    /const searchDepartments = sanitizeAnalyticsStringArray\(event\?\.searchDepartments\)/,
  );
  assert.match(source, /const metadata = sanitizeAnalyticsMetadata\(event\?\.metadata\)/);
  assert.match(source, /const publicEvents = events\.map\(publicAnalyticsUserEvent\)/);
  assert.match(source, /const enrichedEvents = publicEvents\.map\(/);
  assert.match(source, /events: enrichedEvents/);
  assert.doesNotMatch(source, /searchQuery: event\.searchQuery/);
  assert.doesNotMatch(source, /searchDepartments: event\.searchDepartments/);
  assert.doesNotMatch(source, /metadata: event\.metadata/);
  assert.doesNotMatch(source, /listingId: event\.listingId \? String\(event\.listingId\)/);
});

test('analytics search-query report uses the validated date-range helper', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/analyticsService.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /export const getSearchQueryAnalytics[\s\S]*eventType: AnalyticsEventType\.SEARCH,[\s\S]*\.\.\.\(await buildUsageMatch\(range\)\)/,
  );
  assert.match(
    source,
    /const buildUsageMatch = async \(range[^)]*\)[^=]*=> \(\{\s*\.\.\.buildRangeTimestampMatch\(range\),/,
  );
  assert.doesNotMatch(
    source,
    /export const getSearchQueryAnalytics[\s\S]*if \(range\.start \|\| range\.end\)[\s\S]*match\.timestamp = \{\}/,
  );
});

test('analytics entity enrichment normalizes ObjectIds before lookup comparison', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/analyticsService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ Types, type PipelineStage \} from 'mongoose'/);
  assert.match(
    source,
    /const normalizeAnalyticsObjectIdString = \(value: unknown\): string \| undefined =>/,
  );
  assert.match(
    source,
    /const normalizeAnalyticsStoredObjectIdString = \(value: unknown\): string \| undefined =>/,
  );
  assert.match(source, /value instanceof Types\.ObjectId/);
  assert.match(source, /const toAnalyticsObjectIds = /);
  assert.doesNotMatch(source, /engagement\.trendingListings/);
  assert.doesNotMatch(source, /l\._id\.toString\(\) === t\.listingId\.toString\(\)/);
});

test('analytics event storage redacts user-entered contact details', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/analyticsService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /redactDirectContactInfo/);
  assert.match(source, /MAX_ANALYTICS_TEXT_LENGTH/);
  assert.match(source, /MAX_ANALYTICS_ARRAY_ITEMS/);
  assert.match(source, /MAX_ANALYTICS_OBJECT_KEYS/);
  assert.match(source, /MAX_ANALYTICS_USER_TYPE_LENGTH = 40/);
  assert.match(source, /ANALYTICS_METADATA_KEY_RE = \/\^\[A-Za-z0-9_-\]\{1,80\}\$\//);
  assert.match(source, /ANALYTICS_OBJECT_ID_RE = \/\^\[a-fA-F0-9\]\{24\}\$\//);
  assert.match(
    source,
    /ANALYTICS_EVENT_TYPES = new Set<AnalyticsEventType>\(Object\.values\(AnalyticsEventType\)\)/,
  );
  assert.match(
    source,
    /const sanitizeAnalyticsEventType = \(value: unknown\): AnalyticsEventType \| undefined =>/,
  );
  assert.match(source, /const eventType = sanitizeAnalyticsEventType\(params\.eventType\)/);
  assert.match(source, /if \(!eventType\) \{\s*return 'invalid';\s*\}/);
  assert.match(source, /ANALYTICS_NETID_RE = \/\^\[A-Za-z0-9\]\{2,12\}\$\//);
  assert.match(source, /ANALYTICS_NON_USER_NETIDS = new Set\(\['anonymous', 'unknown'\]\)/);
  assert.match(source, /const netid = normalizeAnalyticsEventNetid\(params\.netid\)/);
  assert.match(source, /const userType = sanitizeAnalyticsUserType\(params\.userType\)/);
  assert.match(
    source,
    /const sanitizeAnalyticsObjectId = \(value: unknown\): string \| undefined =>/,
  );
  assert.match(source, /sanitizeAnalyticsMetadataKey/);
  assert.match(
    source,
    /trimmed === '__proto__'\s*\|\|\s*trimmed === 'constructor'\s*\|\|\s*trimmed === 'prototype'/,
  );
  assert.match(source, /trimmed\.length > MAX_ANALYTICS_METADATA_KEY_LENGTH/);
  assert.match(source, /!ANALYTICS_METADATA_KEY_RE\.test\(trimmed\)/);
  assert.doesNotMatch(source, /replace\(\/\^\\\$\+\/, '_'\)\.replace\(\/\\\.\/g, '_'\)/);
  assert.match(source, /sanitizeAnalyticsMetadata/);
  assert.match(source, /searchQuery:\s*sanitizeAnalyticsText\(params\.searchQuery\)/);
  assert.match(
    source,
    /searchDepartments:\s*sanitizeAnalyticsStringArray\(params\.searchDepartments\)/,
  );
  assert.match(source, /metadata:\s*sanitizeAnalyticsMetadata\(params\.metadata\)/);
  assert.match(source, /const fellowshipId = sanitizeAnalyticsObjectId\(params\.fellowshipId\)/);
  assert.doesNotMatch(source, /eventType:\s*normalizedParams\.eventType/);
  assert.match(source, /if \(fellowshipId\) eventPayload\.fellowshipId = fellowshipId/);
  assert.doesNotMatch(source, /params\.listingId/);
  assert.doesNotMatch(source, /eventPayload\.listingId/);
});

test('public ResearchEntity DTO recursively redacts direct-contact text', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/researchEntityDto.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /function publicTextValue\(value: unknown\): unknown/);
  assert.match(source, /function publicTextString\(value: unknown\): string/);
  assert.match(source, /MAX_PUBLIC_RESEARCH_ENTITY_ARRAY_ITEMS/);
  assert.match(source, /MAX_PUBLIC_RESEARCH_ENTITY_URLS/);
  assert.match(source, /MAX_PUBLIC_RESEARCH_ENTITY_OBJECT_KEYS/);
  assert.match(source, /MAX_PUBLIC_RESEARCH_ENTITY_TEXT_LENGTH/);
  assert.match(source, /redactDirectContactInfo\(/);
  assert.match(
    source,
    /function publicResearchEntityName\(value: unknown\): string \{\s*return collapseDuplicateResearchHomeSuffix\(publicTextString\(value\)\);/,
  );
  assert.match(
    source,
    /function servedPersonScopedDisplayName\(group: Record<string, any>, value: unknown\): string \{\s*const displayName = publicResearchEntityName\(value\);/,
  );
  assert.match(
    source,
    /name:\s*publicResearchEntityName\(served\.name\) \|\|\s*servedPersonScopedDisplayName\(group, served\.displayName\)/,
  );
  assert.match(
    source,
    /displayName:\s*group\.displayName === undefined\s*\?\s*undefined\s*:\s*servedPersonScopedDisplayName\(group, served\.displayName\)/,
  );
  assert.match(source, /researchAreas:\s*publicResearchAreaArray\(served\.researchAreas\)/);
  assert.match(source, /const cleaned = publicTextString\(sanitizeResearchAreaLabel\(raw\)\)/);
  assert.match(
    source,
    /value\s*\.slice\(0, MAX_PUBLIC_RESEARCH_ENTITY_ARRAY_ITEMS\)\s*\.map\(publicTextValue\)/,
  );
  assert.match(
    source,
    /Object\.keys\(source\)\s*\.slice\(0, MAX_PUBLIC_RESEARCH_ENTITY_OBJECT_KEYS\)/,
  );
  assert.match(source, /value\s*\.slice\(0, MAX_PUBLIC_RESEARCH_ENTITY_URLS\)\s*\.flatMap/);
  assert.match(source, /dto\[field\] = publicTextValue\(group\[field\]\)/);
  assert.doesNotMatch(source, /dto\[field\] = group\[field\]/);
});

test('public research detail subdocuments omit persistence metadata', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/researchGroupService.ts', import.meta.url),
    'utf8',
  );

  for (const serializerName of ['publicAccessSignalForResearchDetail']) {
    const serializerMatch = source.match(
      new RegExp(`const ${serializerName} = [\\s\\S]*?\\n\\}\\);`),
    );
    assert.ok(serializerMatch, `${serializerName} serializer should exist`);
    assert.doesNotMatch(serializerMatch[0], /createdAt:/);
    assert.doesNotMatch(serializerMatch[0], /updatedAt:/);
    assert.doesNotMatch(serializerMatch[0], /researchEntityId:/);
    assert.doesNotMatch(serializerMatch[0], /researchGroupId:/);
    assert.doesNotMatch(serializerMatch[0], /entryPathwayId:/);
    assert.doesNotMatch(serializerMatch[0], /listingId:/);
  }
});

test('auth error logs pass through the shared sanitizer', () => {
  const passportSource = fs.readFileSync(
    new URL('../server/src/passport.ts', import.meta.url),
    'utf8',
  );
  const sanitizerSource = fs.readFileSync(
    new URL('../server/src/utils/logSanitizer.ts', import.meta.url),
    'utf8',
  );

  assert.match(passportSource, /import \{ sanitizeLogValue \} from '\.\/utils\/logSanitizer'/);
  assert.match(passportSource, /Authentication error details:', sanitizeLogValue\(err\)/);
  assert.match(
    passportSource,
    /return res\.status\(401\)\.json\(\{ error: 'CAS auth but no user' \}\)/,
  );
  assert.doesNotMatch(passportSource, /json\(\{ error: info\.message/);
  assert.doesNotMatch(passportSource, /fullError:\s*JSON\.stringify/);
  assert.doesNotMatch(passportSource, /stack:\s*err\.stack/);
  assert.match(sanitizerSource, /cas\[_-\]\?ticket\|casTicket\|ticket/);
});

test('Yalies API client uses bounded requests and credential-free errors', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/yaliesService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ sanitizeLogValue \} from '\.\.\/utils\/logSanitizer'/);
  assert.match(source, /const YALIES_API_TIMEOUT_MS = 10_000/);
  assert.match(source, /const YALIES_NETID_RE = \/\^\[A-Za-z0-9\]\{2,12\}\$\/;/);
  assert.match(source, /const yaliesRequestError = \(error: unknown\): Error =>/);
  assert.match(source, /const normalizeYaliesNetid = \(value: unknown\): string \| undefined =>/);
  assert.match(source, /const normalizedNetid = normalizeYaliesNetid\(netid\);/);
  assert.match(source, /if \(!normalizedNetid\) return NOT_FOUND;/);
  assert.match(source, /axios\.isAxiosError\(error\)/);
  assert.match(source, /new Error\(`Yalies API request failed\$\{suffix\}`\)/);
  assert.match(source, /timeout: YALIES_API_TIMEOUT_MS/);
  assert.match(source, /throw yaliesRequestError\(error\)/);
  assert.match(source, /filters: \{ netid: \[normalizedNetid\] \}/);
  assert.match(source, /sanitizeLogValue\(yaliesRequestError\(error\)\)/);
  assert.match(source, /console\.error\('Error fetching user:', sanitizeLogValue\(error\)\)/);
  assert.doesNotMatch(source, /filters: \{ netid: \[netid\] \}/);
  assert.doesNotMatch(
    source,
    /console\.error\('Error fetching from Yalies API:', \(error as Error\)\.message\)/,
  );
  assert.doesNotMatch(
    source,
    /console\.error\('Error fetching user:', \(error as Error\)\.message\)/,
  );
  assert.doesNotMatch(source, /throw error/);
});

test('public config omits source revision fingerprints', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/configService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /provider: 'render' \| 'unknown'/);
  assert.doesNotMatch(source, /gitCommit/);
  assert.doesNotMatch(source, /gitBranch/);
  assert.doesNotMatch(source, /RENDER_GIT_COMMIT/);
  assert.doesNotMatch(source, /RENDER_GIT_BRANCH/);
  assert.doesNotMatch(source, /VERCEL_GIT_COMMIT/);
});

test('public config serializes taxonomy through bounded contact-redacted fields', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/configService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ redactDirectContactInfo \} from '\.\.\/utils\/contactRedaction'/);
  assert.match(source, /const MAX_PUBLIC_CONFIG_TEXT_LENGTH = 160/);
  assert.match(source, /const publicConfigText = \(/);
  assert.match(source, /redactDirectContactInfo\(text\)/);
  assert.match(source, /const publicConfigTextArray = \(/);
  assert.match(source, /values\s*\.slice\(0, maxItems\)/);
  assert.match(source, /const publicDepartmentCategories = \(values: unknown\): string\[\] =>/);
  assert.match(source, /const publicDepartmentColorKey = \(value: unknown\): number =>/);
  assert.match(
    source,
    /const publicResearchAreaColorKey = \(value: unknown, fallback: unknown\): string =>/,
  );
  assert.match(source, /name: publicConfigText\(area\.name\)/);
  assert.match(
    source,
    /colorKey: publicResearchAreaColorKey\(\s*area\.colorKey,\s*fieldColorKeys\[area\.field as ResearchField\],?\s*\)/,
  );
  assert.match(source, /aliases: publicConfigTextArray\(/);
  assert.match(source, /categories: publicDepartmentCategories\(dept\.categories\)/);
  assert.match(
    source,
    /primaryCategory:\s*publicDepartmentCategories\(\[dept\.primaryCategory\]\)\[0\]/,
  );
  assert.doesNotMatch(source, /aliases: dept\.aliases \|\| \[\]/);
  assert.doesNotMatch(source, /categories: dept\.categories/);
});

test('OpenAI-backed operator scripts sanitize top-level errors', () => {
  const files = [
    '../server/src/scripts/backfillResearchDescriptions.ts',
    '../server/src/scripts/backfillCenterDirectors.ts',
  ];

  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');

    assert.match(source, /sanitizeLogValue/);
    assert.match(source, /main\(\)\.catch\(\(error\) => \{/);
    assert.match(source, /console\.error\(sanitizeLogValue\(error\)\)/);
    assert.doesNotMatch(source, /console\.error\(error\)/);
  }
});

test('Mongo-connected gate and import scripts sanitize fatal errors', () => {
  const files = [
    '../server/src/scripts/scraperIntegrityGate.ts',
    '../server/src/scripts/claimGate.ts',
    '../server/src/scripts/migrateMongoNaming.ts',
    '../server/src/scripts/betaSeedEnvironment.ts',
    '../server/src/scripts/backfillBrowseRank.ts',
    '../server/src/scripts/auditProgramResearchRelevance.ts',
    '../server/src/scripts/launchTrustContract.ts',
    '../server/src/scripts/repairArchivedEntityArtifacts.ts',
    '../server/src/scripts/acceptFormalizationReviewExceptions.ts',
    '../server/src/scripts/betaRepairQueue.ts',
    '../server/src/scripts/dedupeResearchEntitiesByPi.ts',
    '../server/src/scripts/launchAcquisitionReport.ts',
    '../server/src/scripts/launchReviewExceptions.ts',
    '../server/src/scripts/migrateResearchEntities.ts',
    '../server/src/scripts/migrateResearchEntityCollections.ts',
    '../server/src/scripts/scraperIntegrityDuplicateReview.ts',
    '../server/src/scripts/rebuildResearchEntitySearchIndex.ts',
    '../server/src/scripts/researchQualitySearchReview.ts',
    '../server/src/scripts/disambiguateSurnameLabNames.ts',
    '../server/src/scripts/studentVisibilityGate.ts',
    '../server/src/scripts/cleanupLegacyMongoCollections.ts',
    '../server/src/scripts/backfillProgramOfficialSources.ts',
    '../server/src/scripts/gateRefreshScheduler.ts',
    '../server/src/scripts/refreshGateScorecards.ts',
  ];

  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');

    assert.match(source, /sanitizeLogValue/);
    assert.doesNotMatch(source, /console\.error\(error\)/);
    assert.doesNotMatch(source, /console\.error\(err\)/);
    assert.doesNotMatch(source, /console\.error\('Fatal error:', err\)/);
    assert.doesNotMatch(source, /console\.error\([^;\n]*,\s*error\)/);
    assert.doesNotMatch(source, /console\.error\([^;\n]*,\s*err\)/);
  }
});

test('auth callback, check, and logout responses are private no-store', () => {
  const passportSource = fs.readFileSync(
    new URL('../server/src/passport.ts', import.meta.url),
    'utf8',
  );
  const adminRouteSource = fs.readFileSync(
    new URL('../client/src/components/AdminRoute.tsx', import.meta.url),
    'utf8',
  );

  assert.match(
    passportSource,
    /const setPrivateAuthResponseHeaders = \(res: express\.Response\): void => \{/,
  );
  assert.match(passportSource, /Cache-Control', 'no-store, private, max-age=0'/);
  assert.match(passportSource, /Surrogate-Control', 'no-store'/);
  assert.match(passportSource, /Expires', '0'/);
  assert.match(passportSource, /X-Content-Type-Options', 'nosniff'/);
  assert.match(
    passportSource,
    /function publicAuthSessionUser\(user: unknown\): AuthenticatedSessionUser \| null/,
  );
  assert.match(passportSource, /const netId = normalizeAuthNetId\(source\.netId\)/);
  assert.match(passportSource, /if \(!netId\) return null/);
  assert.match(passportSource, /netId,/);
  assert.match(passportSource, /userType: normalizeSessionUserType\(source\.userType\)/);
  assert.match(passportSource, /const casLogin[\s\S]*setPrivateAuthResponseHeaders\(res\)/);
  assert.match(
    passportSource,
    /router\.get\('\/check'[\s\S]*const user = publicAuthSessionUser\(req\.user\)[\s\S]*return res\.json\(\{ auth: true, user \}\)/,
  );
  assert.match(
    passportSource,
    /router\.get\('\/check'[\s\S]*return res\.json\(\{ auth: false \}\)/,
  );
  assert.doesNotMatch(passportSource, /res\.json\(\{ auth: true, user: req\.user \}\)/);
  assert.doesNotMatch(passportSource, /netId: normalizeAuthNetId\(source\.netId\) \|\| 'unknown'/);
  assert.match(
    passportSource,
    /const logoutRouteHandler[\s\S]*setPrivateAuthResponseHeaders\(res\)/,
  );
  assert.match(
    passportSource,
    /const logoutRouteHandler[\s\S]*if \(req\.method !== 'GET'\) \{[\s\S]*res\.setHeader\('Allow', 'GET'\)[\s\S]*return res\.status\(405\)\.json\(\{ error: 'Method not allowed' \}\)/,
  );
  assert.match(
    passportSource,
    /const logoutRouteHandler[\s\S]*if \(req\.method !== 'GET'\)[\s\S]*if \(!isTrustedLogoutRequest\(req\)\)/,
  );
  assert.match(passportSource, /if \(req\.get\('origin'\) !== undefined\) \{/);
  assert.match(passportSource, /return Boolean\(origin && origin === allowedOrigin\)/);
  assert.match(
    passportSource,
    /router\.get\('\/dev-login'[\s\S]*setPrivateAuthResponseHeaders\(res\)/,
  );
  assert.match(passportSource, /function normalizeDevUserType\(value: unknown\): string \{/);
  assert.match(
    passportSource,
    /const normalized = typeof value === 'string' \? value\.trim\(\)\.toLowerCase\(\) : ''/,
  );
  assert.match(passportSource, /const normalizedUserType = normalizeDevUserType\(userType\)/);
  assert.match(
    passportSource,
    /const testUser = await ensureDevLoginUser\(req\.query\?\.userType\)/,
  );
  assert.doesNotMatch(passportSource, /ensureDevLoginUser\(String\(req\.query\?\.userType/);
  assert.doesNotMatch(
    passportSource,
    /return res\.status\(500\)\.json\(\{ error: err\.message \}\)/,
  );
  assert.match(adminRouteSource, /MAX_LOCAL_ADMIN_REDIRECT_URL_LENGTH = 2048/);
  assert.match(
    adminRouteSource,
    /window\.location\.href\.length > MAX_LOCAL_ADMIN_REDIRECT_URL_LENGTH/,
  );
  assert.match(
    adminRouteSource,
    /parsed\.origin === window\.location\.origin \? parsed\.toString\(\) : fallback/,
  );
  assert.match(
    adminRouteSource,
    /encodeURIComponent\(\s*getSafeLocalAdminRedirectTarget\(\),?\s*\)/,
  );
});

test('auth redirect targets are same-origin and bounded before parsing', () => {
  const passportSource = fs.readFileSync(
    new URL('../server/src/passport.ts', import.meta.url),
    'utf8',
  );

  assert.match(passportSource, /const MAX_AUTH_REDIRECT_LENGTH = 2048/);
  assert.match(passportSource, /const RELATIVE_REDIRECT_BASE = 'https:\/\/redirect\.local'/);
  assert.match(passportSource, /function safeRedirectTarget\(raw: unknown\): string \| null \{/);
  assert.match(passportSource, /raw\.length > MAX_AUTH_REDIRECT_LENGTH/);
  assert.match(passportSource, /const target = new URL\(raw, RELATIVE_REDIRECT_BASE\)/);
  assert.match(passportSource, /target\.origin !== RELATIVE_REDIRECT_BASE/);
  assert.match(
    passportSource,
    /const path = `\$\{target\.pathname\}\$\{target\.search\}\$\{target\.hash\}`/,
  );
  assert.match(passportSource, /\/\^\\\/%/);
  assert.match(passportSource, /2f\|5c/);
  assert.match(passportSource, /0a\|0d/);
  assert.match(passportSource, /if \(target\.username \|\| target\.password\) return null/);
  assert.match(passportSource, /const baseOrigin = new URL\(base\)\.origin/);
  assert.match(passportSource, /if \(target\.origin === baseOrigin\) return target\.toString\(\)/);
  assert.doesNotMatch(passportSource, /res\.redirect\(req\.query/);
});

test('client CAS return state is path-only before redirect query construction', () => {
  const signInButtonSource = fs.readFileSync(
    new URL('../client/src/components/SignInButton.tsx', import.meta.url),
    'utf8',
  );
  const userButtonSource = fs.readFileSync(
    new URL('../client/src/components/UserButton.tsx', import.meta.url),
    'utf8',
  );
  const signOutButtonSource = fs.readFileSync(
    new URL('../client/src/components/SignOutButton.tsx', import.meta.url),
    'utf8',
  );

  const returnPathSource = fs.readFileSync(
    new URL('../client/src/utils/returnPath.ts', import.meta.url),
    'utf8',
  );
  const loginSource = fs.readFileSync(
    new URL('../client/src/pages/login.tsx', import.meta.url),
    'utf8',
  );

  for (const source of [signInButtonSource, loginSource]) {
    assert.match(source, /import \{ normalizeReturnPath \} from '\.\.\/utils\/returnPath'/);
  }
  assert.match(loginSource, /const returnPath = normalizeReturnPath\(locationState\?\.from\)/);
  assert.match(returnPathSource, /const MAX_RETURN_PATH_LENGTH = 2048/);
  assert.match(
    returnPathSource,
    /export const normalizeReturnPath = \(value: unknown\): string => \{/,
  );
  assert.match(returnPathSource, /if \(typeof value !== 'string'\) return ''/);
  assert.match(returnPathSource, /if \(url\.origin !== window\.location\.origin\) return ''/);
  assert.match(
    returnPathSource,
    /const path = `\$\{url\.pathname\}\$\{url\.search\}\$\{url\.hash\}`/,
  );
  assert.match(returnPathSource, /path\.startsWith\('\/\/'\)/);
  assert.match(
    signInButtonSource,
    /setRedirectParam\(returnPath \? `\?redirect=\$\{encodeURIComponent\(returnPath\)\}` : ''\)/,
  );
  assert.match(
    signInButtonSource,
    /const savedPath = sessionStorage\.getItem\('logoutReturnPath'\)/,
  );
  assert.match(
    signInButtonSource,
    /if \(savedPath\) sessionStorage\.removeItem\('logoutReturnPath'\)/,
  );
  assert.match(signInButtonSource, /localStorage\.removeItem\('logoutReturnPath'\)/);
  assert.doesNotMatch(signInButtonSource, /localStorage\.getItem\('logoutReturnPath'\)/);
  assert.doesNotMatch(signInButtonSource, /return window\.location\.origin/);
  assert.doesNotMatch(signInButtonSource, /window\.location\.origin\)\.toString\(\)/);

  for (const source of [userButtonSource, signOutButtonSource]) {
    assert.match(
      source,
      /const returnPath = `\$\{window\.location\.pathname\}\$\{window\.location\.search\}\$\{window\.location\.hash\}`/,
    );
    assert.match(source, /localStorage\.removeItem\('logoutReturnPath'\)/);
    assert.match(source, /sessionStorage\.setItem\('logoutReturnPath', returnPath\)/);
    assert.doesNotMatch(source, /window\.location\.origin \+ currentPath/);
    assert.doesNotMatch(source, /localStorage\.setItem\('logoutReturnPath', returnUrl\)/);
    assert.doesNotMatch(source, /localStorage\.setItem\('logoutReturnPath', returnPath\)/);
  }
});

test('deployed auth base URLs reject private hosts and URL smuggling fields', () => {
  const passportSource = fs.readFileSync(
    new URL('../server/src/passport.ts', import.meta.url),
    'utf8',
  );

  assert.match(passportSource, /import \{ isPrivateOrLocalHostname \} from '\.\/utils\/urlSafety'/);
  assert.match(passportSource, /function requireProductionHttpsUrl\(/);
  assert.match(passportSource, /if \(parsed\.username \|\| parsed\.password\) \{/);
  assert.match(passportSource, /must not include credentials in deployed runtimes/);
  assert.match(passportSource, /if \(parsed\.search \|\| parsed\.hash\) \{/);
  assert.match(passportSource, /must not include query strings or fragments in deployed runtimes/);
  assert.match(passportSource, /if \(isPrivateOrLocalHostname\(parsed\.hostname\)\) \{/);
  assert.match(passportSource, /must not point to a private or local host in deployed runtimes/);
  assert.doesNotMatch(
    passportSource,
    /name === 'SERVER_BASE_URL' && isLocalDevelopmentEnvironment/,
  );
});

test('auth principals are normalized before user lookup and session hydration', () => {
  const passportSource = fs.readFileSync(
    new URL('../server/src/passport.ts', import.meta.url),
    'utf8',
  );

  assert.match(passportSource, /const AUTH_NETID_RE = \/\^\[A-Za-z0-9\]\{2,12\}\$\/;/);
  assert.match(
    passportSource,
    /function normalizeAuthNetId\(value: unknown\): string \| undefined \{/,
  );
  assert.match(
    passportSource,
    /const normalized = typeof value === 'string' \? value\.trim\(\) : ''/,
  );
  assert.match(passportSource, /function normalizeSessionUserType\(value: unknown\): string \{/);
  assert.match(
    passportSource,
    /const normalized = typeof value === 'string' \? value\.trim\(\)\.toLowerCase\(\) : ''/,
  );
  assert.match(passportSource, /const netid = normalizeAuthNetId\(rawNetid\)/);
  assert.match(passportSource, /throw new Error\('Invalid authentication principal'\)/);
  assert.match(passportSource, /await recordAccountLogin\(\{ netid/);
  assert.match(passportSource, /passport\.serializeUser\(function \(user: any, done\) \{/);
  assert.match(passportSource, /const principal = publicAuthSessionUser\(user\)/);
  assert.match(passportSource, /const netId = normalizeAuthNetId\(source\.netId\)/);
  assert.match(passportSource, /done\(new Error\('Invalid authentication principal'\)\)/);
  assert.match(passportSource, /done\(null, principal\)/);
  assert.match(passportSource, /function coerceStoredSessionPrincipal\(stored: unknown\)/);
  assert.match(passportSource, /const netId = normalizeAuthNetId\(stored\)/);
  assert.match(
    passportSource,
    /const account = await withMongoReconnect\(\(\) => validateAccount\(principal\.netId\)\)/,
  );
  assert.match(passportSource, /if \(!account \|\| account\.archived\)/);
  assert.match(passportSource, /done\(null, null\)/);
  assert.doesNotMatch(passportSource, /done\(null, user\.netId\)/);
  assert.doesNotMatch(
    passportSource,
    /function normalizeAuthNetId\(value: unknown\): string \| undefined \{\s*const normalized = String\(value \|\| ''\)\.trim\(\)/,
  );
  assert.doesNotMatch(
    passportSource,
    /function normalizeSessionUserType\(value: unknown\): string \{\s*const normalized = String\(value \|\| ''\)\.trim\(\)\.toLowerCase\(\)/,
  );
  assert.doesNotMatch(passportSource, /const DEV_NETID_RE/);
  assert.doesNotMatch(passportSource, /function normalizeDevNetId/);
});

test('unsafe request origin headers are bounded before parsing', () => {
  const passportSource = fs.readFileSync(
    new URL('../server/src/passport.ts', import.meta.url),
    'utf8',
  );
  const csrfSource = fs.readFileSync(
    new URL('../server/src/middleware/csrfOriginGuard.ts', import.meta.url),
    'utf8',
  );

  assert.match(passportSource, /const MAX_AUTH_ORIGIN_HEADER_LENGTH = 2048/);
  assert.match(passportSource, /function originFromUrl\(value: string \| undefined\): string \{/);
  assert.match(passportSource, /value\.length > MAX_AUTH_ORIGIN_HEADER_LENGTH/);
  assert.match(
    passportSource,
    /isAsciiControlCode\(code\) \|\| code === 0x20 \|\| character === '\\\\'/,
  );
  assert.match(passportSource, /if \(parsed\.username \|\| parsed\.password\) return ''/);
  assert.match(csrfSource, /const MAX_CSRF_ORIGIN_HEADER_LENGTH = 2048/);
  assert.match(csrfSource, /const originFromUrl = \(value: string \| undefined\): string => \{/);
  assert.match(csrfSource, /writeLikeSafeMethodPaths\?: ReadonlySet<string>/);
  assert.match(csrfSource, /const isWriteLikeSafeMethodPath =/);
  assert.match(csrfSource, /args\.writeLikeSafeMethodPaths\?\.has\(args\.path\)/);
  assert.match(
    csrfSource,
    /if \(SAFE_METHODS\.has\(method\) && !isWriteLikeSafeMethodPath\) return true/,
  );
  assert.match(csrfSource, /value\.length > MAX_CSRF_ORIGIN_HEADER_LENGTH/);
  assert.match(
    csrfSource,
    /isAsciiControlCode\(code\) \|\| code === 0x20 \|\| character === '\\\\'/,
  );
  assert.match(csrfSource, /if \(parsed\.username \|\| parsed\.password\) return ''/);
  assert.match(csrfSource, /if \(args\.origin !== undefined\) \{/);
  assert.match(csrfSource, /return Boolean\(origin && args\.allowedOrigins\.has\(origin\)\)/);
  assert.match(csrfSource, /origin: req\.get\('origin'\)/);
  assert.match(csrfSource, /referer: req\.get\('referer'\)/);

  const appSource = fs.readFileSync(new URL('../server/src/app.ts', import.meta.url), 'utf8');
  assert.match(appSource, /const WRITE_LIKE_SAFE_METHOD_API_PATHS = new Set<string>\(\)/);
  assert.match(
    appSource,
    /csrfOriginGuard\(allowList, \{\s*writeLikeSafeMethodPaths: WRITE_LIKE_SAFE_METHOD_API_PATHS,\s*\}\)/,
  );
});

test('CORS origin headers are bounded before allowlist comparison', () => {
  const source = fs.readFileSync(
    new URL('../server/src/middleware/corsOrigin.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const MAX_CORS_ORIGIN_LENGTH = 2048/);
  assert.match(source, /const hasUnsafeCorsOriginCharacter/);
  assert.match(source, /const normalizeCorsOrigin = \(origin: string \| undefined\): string => \{/);
  assert.match(source, /origin\.length > MAX_CORS_ORIGIN_LENGTH/);
  assert.match(source, /hasUnsafeCorsOriginCharacter\(origin\)/);
  assert.match(source, /parsed\.username \|\| parsed\.password/);
  assert.match(source, /parsed\.origin !== origin/);
  assert.match(source, /const normalizedOrigin = normalizeCorsOrigin\(origin\)/);
  assert.doesNotMatch(source, /allowedOrigins\.has\(origin\)/);
});

test('auth debug logs do not interpolate user identifiers', () => {
  const passportSource = fs.readFileSync(
    new URL('../server/src/passport.ts', import.meta.url),
    'utf8',
  );

  assert.match(passportSource, /const authDebug = \(\.\.\.args: unknown\[\]\) =>/);
  assert.match(
    passportSource,
    /console\.log\(\.\.\.args\.map\(\(arg\) => sanitizeLogValue\(arg\)\)\)/,
  );
  assert.doesNotMatch(passportSource, /console\.log\(\.\.\.args\)/);
  assert.doesNotMatch(passportSource, /authDebug\([^)]*\$\{netid\}/i);
  assert.doesNotMatch(passportSource, /authDebug\([^)]*\$\{profile\.user\}/i);
  assert.doesNotMatch(passportSource, /console\.(?:log|error|warn)\([^)]*\$\{netid\}/i);
});

test('local auth bypass defaults malformed user types to undergraduate, not admin', () => {
  const passportSource = fs.readFileSync(
    new URL('../server/src/passport.ts', import.meta.url),
    'utf8',
  );

  assert.match(passportSource, /function normalizeDevUserType\(value: unknown\): string/);
  assert.match(passportSource, /: 'undergraduate';/);
  assert.doesNotMatch(passportSource, /: 'admin';\n\}/);
});

test('deployed session cookie uses secure host-only settings', () => {
  const appSource = fs.readFileSync(new URL('../server/src/app.ts', import.meta.url), 'utf8');
  const sessionCookieSource = fs.readFileSync(
    new URL('../server/src/utils/sessionCookie.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    sessionCookieSource,
    /requiresDeployedRuntimeSecurity\(env\) \? '__Host-session' : 'session'/,
  );
  assert.match(appSource, /name: sessionCookieName\(\)/);
  assert.match(appSource, /httpOnly: true/);
  assert.match(appSource, /secure: requiresSecureSessionCookie\(\)/);
  assert.match(appSource, /path: '\/'/);
  assert.match(appSource, /sameSite: 'lax'/);
  assert.doesNotMatch(appSource, /domain:/);
});

test('local auth bypass bounds netid session identities', () => {
  const passportSource = fs.readFileSync(
    new URL('../server/src/passport.ts', import.meta.url),
    'utf8',
  );

  assert.match(passportSource, /const AUTH_NETID_RE = \/\^\[A-Za-z0-9\]\{2,12\}\$\//);
  assert.match(
    passportSource,
    /function normalizeAuthNetId\(value: unknown\): string \| undefined/,
  );
  assert.match(passportSource, /AUTH_NETID_RE\.test\(normalized\) \? normalized : undefined/);
  assert.match(passportSource, /function normalizeDevUserType\(value: unknown\): string \{/);
  assert.doesNotMatch(
    passportSource,
    /function normalizeDevUserType\(value: string \| undefined\): string \{[\s\S]*String\(value \|\| ''\)/,
  );
  assert.match(
    passportSource,
    /normalizeAuthNetId\(normalizedHeaderValue\(headers\['x-dev-netid'\]\)\)/,
  );
  assert.match(
    passportSource,
    /normalizeAuthNetId\(unquoteEnvValue\(env\.LOCAL_AUTH_BYPASS_NETID\)\)/,
  );
});

test('admin authority requires an active admin grant and never consults userType', () => {
  const source = fs.readFileSync(
    new URL('../server/src/middleware/auth.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const AUTH_NETID_RE = \/\^\[A-Za-z0-9\]\{2,12\}\$\/;/);
  assert.match(source, /const normalizeAuthNetid = \(value: unknown\): string =>/);
  assert.match(
    source,
    /const requestNetid = \(user: AuthenticatedUser \| null \| undefined\): string =>/,
  );
  assert.match(
    source,
    /const hasAuthenticatedPrincipal = \(user: unknown\): user is AuthenticatedUser =>/,
  );
  assert.match(source, /export const isAuthenticated[\s\S]*hasAuthenticatedPrincipal\(req\.user\)/);
  assert.match(
    source,
    /export const isAdmin[\s\S]*hasActiveAdminGrant\(requestNetid\(currentUser\)\)/,
  );
  assert.doesNotMatch(source, /allowsLegacyAdminUserType/);
  assert.doesNotMatch(source, /userType/);
  assert.doesNotMatch(source, /hasAdminAuthority/);
  assert.doesNotMatch(source, /export const isProfessor/);
  assert.doesNotMatch(source, /export const isTrustworthy/);
  assert.doesNotMatch(
    source,
    /const requestNetid = \(user: \{ netId\?: string; netid\?: string \}\) => user\.netId \|\| user\.netid \|\| ''/,
  );
});

test('admin grant notes are bounded before persistence', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/adminGrantService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const normalizeNetid = \(netid: unknown\) =>\s*typeof netid === 'string'/);
  assert.doesNotMatch(
    source,
    /const normalizeNetid = \(netid: unknown\) => String\(netid \|\| ''\)/,
  );
  assert.match(source, /MAX_ADMIN_GRANT_NOTE_LENGTH = 512/);
  assert.match(source, /const normalizeAdminGrantNote = \(note: unknown\): string =>/);
  assert.match(source, /const normalized = note\.trim\(\)/);
  assert.match(source, /!normalized \|\| normalized\.length > MAX_ADMIN_GRANT_NOTE_LENGTH/);
  assert.match(source, /note: normalizeAdminGrantNote\(note\)/);
  assert.match(source, /revokeNote: normalizeAdminGrantNote\(note\)/);
  assert.doesNotMatch(source, /note: typeof note === 'string' \? note\.trim\(\) : ''/);
  assert.doesNotMatch(source, /revokeNote: typeof note === 'string' \? note\.trim\(\) : ''/);
});

test('admin fellowship management responses use an allowlist serializer', () => {
  const source = fs.readFileSync(new URL('../server/src/routes/admin.ts', import.meta.url), 'utf8');

  const serializer = source.match(
    /export const adminFellowshipDto = \(fellowship: any\) => \{[\s\S]*?\n\};/,
  );
  assert.ok(serializer, 'admin fellowship serializer should exist');
  assert.match(source, /const MAX_ADMIN_FELLOWSHIP_TEXT_LENGTH = 5000/);
  assert.match(source, /const MAX_ADMIN_FELLOWSHIP_ARRAY_ITEMS = 100/);
  assert.match(source, /const adminFellowshipText = \(/);
  assert.match(source, /const adminFellowshipStringArray = \(value: unknown\): string\[\] =>/);
  assert.match(
    source,
    /const adminFellowshipLinks = \(value: unknown\): Array<\{ label: string; url: string \}> =>/,
  );
  assert.match(source, /publicHttpUrl\(record\.url\)/);
  assert.match(source, /fellowships: fellowships\.map\(adminFellowshipDto\)/);
  assert.match(source, /res\.json\(\{ fellowship: adminFellowshipDto\(fellowship\) \}\)/);
  assert.doesNotMatch(source, /\{ fellowships,\s*total \}/);
  assert.doesNotMatch(source, /res\.json\(\{ fellowship \}\)/);
  assert.match(serializer[0], /contactEmail:\s*adminFellowshipText\(fellowship\?\.contactEmail/);
  assert.match(serializer[0], /links: adminFellowshipLinks\(fellowship\?\.links\)/);
  assert.doesNotMatch(serializer[0], /sourceKey/);
  assert.doesNotMatch(serializer[0], /sourceFingerprint/);
  assert.doesNotMatch(serializer[0], /sourceLastVerifiedAt/);
  assert.doesNotMatch(serializer[0], /studentVisibility/);
  assert.doesNotMatch(serializer[0], /__v/);
});

test('public API DTO ids avoid arbitrary object stringification', () => {
  const idSerializationSource = fs.readFileSync(
    new URL('../server/src/utils/idSerialization.ts', import.meta.url),
    'utf8',
  );
  const programPayloadSource = fs.readFileSync(
    new URL('../server/src/controllers/programPayload.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    idSerializationSource,
    /export const serializedDocumentId = \(value: unknown\): string \| undefined => \{/,
  );
  assert.match(idSerializationSource, /if \(typeof value === 'string'\)/);
  assert.match(
    idSerializationSource,
    /if \(typeof value === 'number' && Number\.isFinite\(value\)\)/,
  );
  assert.match(idSerializationSource, /if \(value instanceof mongoose\.Types\.ObjectId\)/);
  assert.doesNotMatch(idSerializationSource, /\.toString\(\)/);
  assert.doesNotMatch(idSerializationSource, /toHexString' in value/);
  assert.doesNotMatch(idSerializationSource, /typeof \(value as any\)\.toHexString === 'function'/);

  assert.match(
    programPayloadSource,
    /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/,
  );
  assert.match(
    programPayloadSource,
    /const id = serializedDocumentId\(program\._id\) \|\| serializedDocumentId\(program\.id\) \|\| ''/,
  );
  for (const source of [programPayloadSource]) {
    assert.doesNotMatch(source, /_id\?\.toString\?\.\(\)/);
  }
});

test('profile surfaces render only safe HTTP(S) profile URLs and images', () => {
  const labMembersSource = fs.readFileSync(
    new URL('../client/src/components/labs/LabMembersList.tsx', import.meta.url),
    'utf8',
  );
  const developerCardSource = fs.readFileSync(
    new URL('../client/src/components/DeveloperCard.tsx', import.meta.url),
    'utf8',
  );
  const urlSource = fs.readFileSync(new URL('../client/src/utils/url.ts', import.meta.url), 'utf8');

  assert.match(urlSource, /export const safeImageSrc = \(raw: unknown\): string =>/);
  assert.match(urlSource, /const isPrivateOrLocalHostname = \(hostname: string\): boolean => \{/);
  assert.match(
    urlSource,
    /PRIVATE_HOSTNAME_SUFFIXES = \['\.local', '\.internal', '\.lan', '\.home\.arpa', '\.localdomain'\]/,
  );
  assert.match(urlSource, /clean === 'localhost' \|\| clean\.endsWith\('\.localhost'\)/);
  assert.match(
    urlSource,
    /PRIVATE_HOSTNAME_SUFFIXES\.some\(\(suffix\) => clean\.endsWith\(suffix\)\)/,
  );
  assert.match(urlSource, /!clean\.includes\('\.'\) && !clean\.includes\(':'\)/);
  assert.match(
    urlSource,
    /PRIVATE_IPV4_CIDRS\.some\(\(\[base, prefix\]\) => isIpv4InCidr\(clean, base, prefix\)\)/,
  );
  assert.match(urlSource, /const isAllowedPublicHttpPort = \(url: URL\): boolean =>/);
  assert.match(urlSource, /url\.protocol === 'https:' && url\.port === '443'/);
  assert.match(urlSource, /if \(isPrivateOrLocalHostname\(parsed\.hostname\)\) return ''/);
  assert.match(urlSource, /if \(!isAllowedPublicHttpPort\(parsed\)\) return ''/);
  assert.match(urlSource, /trimmed\.startsWith\('\/'\) && !trimmed\.startsWith\('\/\/'\)/);
  assert.match(urlSource, /return safeHttpUrl\(trimmed\)/);

  assert.match(labMembersSource, /import \{[^}]*safeHttpUrl[^}]*\} from '\.\.\/\.\.\/utils\/url'/);
  assert.match(labMembersSource, /const profileImageHref = safeHttpUrl\(user\.image_url\)/);
  assert.match(labMembersSource, /src=\{profileImageHref\}/);
  assert.doesNotMatch(labMembersSource, /src=\{user\.image_url\}/);

  assert.match(
    developerCardSource,
    /import \{ EXTERNAL_IMAGE_REFERRER_POLICY, safeHttpUrl, safeImageSrc \} from '\.\.\/utils\/url'/,
  );
  assert.match(developerCardSource, /const websiteHref = safeHttpUrl\(developer\.website\)/);
  assert.match(developerCardSource, /const linkedinHref = safeHttpUrl\(developer\.linkedin\)/);
  assert.match(developerCardSource, /const githubHref = safeHttpUrl\(developer\.github\)/);
  assert.match(
    developerCardSource,
    /const imageSrc = safeImageSrc\(developer\.image\) \|\| '\/assets\/developers\/no-user\.png'/,
  );
  assert.match(developerCardSource, /src=\{imageSrc\}/);
  assert.doesNotMatch(developerCardSource, /src=\{developer\.image/);
  assert.doesNotMatch(developerCardSource, /safeUrl\(/);
});

test('programmatic new-tab opener only opens safe HTTP(S) URLs', () => {
  const source = fs.readFileSync(new URL('../client/src/utils/url.ts', import.meta.url), 'utf8');

  assert.match(source, /export const NEW_TAB_WINDOW_FEATURES = 'noopener,noreferrer'/);
  assert.match(
    source,
    /export const openSafeUrlInNewTab = \(raw: unknown\): Window \| null => \{[\s\S]*const href = safeHttpUrl\(raw\)/,
  );
  assert.match(source, /window\.open\(href, '_blank', NEW_TAB_WINDOW_FEATURES\)/);
  assert.match(source, /if \(opened\) opened\.opener = null/);
  assert.doesNotMatch(
    source,
    /export const openSafeUrlInNewTab = \(raw: unknown\): Window \| null => \{[\s\S]*const href = safeUrl\(raw\)/,
  );
});

test('client UI does not surface raw Axios error payload text', () => {
  const helperSource = fs.readFileSync(
    new URL('../client/src/utils/clientErrorMessage.ts', import.meta.url),
    'utf8',
  );
  const clientFiles = [
    '../client/src/components/admin/AdminDepartments.tsx',
    '../client/src/components/admin/AdminResearchAreas.tsx',
    '../client/src/components/admin/AdminFellowshipEditModal.tsx',
    '../client/src/pages/analytics.tsx',
  ];

  assert.match(helperSource, /MAX_CLIENT_ERROR_MESSAGE_LENGTH = 160/);
  assert.match(helperSource, /SENSITIVE_CLIENT_ERROR_RE/);
  assert.match(helperSource, /https\?:\\\/\\\//);
  assert.match(helperSource, /mongodb/);
  assert.match(helperSource, /bearer\\s\+/);
  assert.match(helperSource, /token\|secret\|password\|authorization\|cookie\|set-cookie/);
  assert.match(helperSource, /safeClientErrorText\(responseData\?\.error\)/);
  assert.match(helperSource, /safeClientErrorText\(responseData\?\.message\)/);

  for (const file of clientFiles) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /clientErrorMessage/);
    assert.doesNotMatch(source, /response\?\.data\?\.(error|message)\s*\|\|/);
    assert.doesNotMatch(source, /responseError\.response\?\.data\?\.error/);
    assert.doesNotMatch(source, /responseError\.message/);
  }
});

test('the public faculty profile shaper stays retired rather than re-exposing contact fields', () => {
  // This replaced a 20-assertion pin on `normalizePublicProfile`'s field allowlist and
  // truncation limits. That shaper, and every helper only it reached, was deleted once
  // the `/profile/:netid` route it fed was confirmed gone (retired in #2091, #3238).
  //
  // Asserting the ABSENCE of the shaper is strictly stronger than asserting its
  // allowlist was clean: an allowlist can be widened by a later edit and still satisfy
  // a pin on its shape, whereas nothing can leak from a surface that does not exist.
  // If a public profile surface is ever reintroduced this test fails, and the full
  // field-allowlist pin has to come back with it rather than being quietly reinvented.
  const profileServiceSource = fs.readFileSync(
    new URL('../server/src/services/profileService.ts', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(profileServiceSource, /export const normalizePublicProfile/);
  assert.doesNotMatch(profileServiceSource, /PUBLIC_PROFILE_BASE_FIELDS/);
  assert.doesNotMatch(profileServiceSource, /physical_location:/);
  assert.doesNotMatch(profileServiceSource, /building_desk:/);
  assert.doesNotMatch(profileServiceSource, /'physicalLocation'/);
  assert.doesNotMatch(profileServiceSource, /'buildingDesk'/);

  const routesDir = new URL('../server/src/routes/', import.meta.url);
  const routeSources = fs
    .readdirSync(routesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => fs.readFileSync(new URL(entry.name, routesDir), 'utf8'))
    .join('\n');
  assert.doesNotMatch(routeSources, /normalizePublicProfile/);
});

test('the retired scholarly-link serializer stays absent from the profile service', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/profileService.ts', import.meta.url),
    'utf8',
  );

  // The scholarly-link mirror was retired in #2451 and its serve path in #2457.
  // These stay negative assertions rather than being deleted: reintroducing any
  // of them means reintroducing a serializer for untrusted external records, and
  // that must come back with its redaction and id-omission pins, not without them.
  for (const retired of [
    'scholarlyLinkToPublicLink',
    'isPublicResearchPaperLink',
    'isDatasetLikeScholarlyLink',
    'publicScholarlyLinkId',
    'publicScholarlyExternalIds',
    'publicScholarlyLinkText',
    'publicScholarlyLinkYear',
    'publicScholarlyLinkConfidence',
    'publicScholarlyDestinationKind',
    'publicOpenAccessStatus',
    'cleanPublicSourceLabel',
    'PUBLIC_SCHOLARLY_DESTINATION_KINDS',
    'PUBLIC_OPEN_ACCESS_STATUSES',
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(`\\b${retired}\\b`),
      `${retired} was retired with the scholarly-link mirror; restore its redaction pins if it returns`,
    );
  }
});

test('public URL normalization rejects local and private-network browser targets', () => {
  const serverUrlSource = fs.readFileSync(
    new URL('../server/src/utils/urlSafety.ts', import.meta.url),
    'utf8',
  );
  const clientUrlSource = fs.readFileSync(
    new URL('../client/src/utils/url.ts', import.meta.url),
    'utf8',
  );

  for (const source of [serverUrlSource, clientUrlSource]) {
    assert.match(source, /PRIVATE_IPV4_CIDRS/);
    assert.match(source, /'127\.0\.0\.0', 8/);
    assert.match(source, /'169\.254\.0\.0', 16/);
    assert.match(source, /'192\.168\.0\.0', 16/);
    assert.match(
      source,
      /PRIVATE_HOSTNAME_SUFFIXES = \['\.local', '\.internal', '\.lan', '\.home\.arpa', '\.localdomain'\]/,
    );
    assert.match(source, /clean === 'localhost' \|\| clean\.endsWith\('\.localhost'\)/);
    assert.match(
      source,
      /PRIVATE_HOSTNAME_SUFFIXES\.some\(\(suffix\) => clean\.endsWith\(suffix\)\)/,
    );
    assert.match(source, /!clean\.includes\('\.'\) && !clean\.includes\(':'\)/);
    assert.match(source, /if \(clean\.includes\(':'\)\) return true/);
    assert.match(source, /isIpv4InCidr\(clean, base, prefix\)/);
    assert.match(source, /isAllowedPublicHttpPort/);
    assert.match(source, /url\.protocol === 'http:' && url\.port === '80'/);
    assert.match(source, /url\.protocol === 'https:' && url\.port === '443'/);
  }

  assert.match(serverUrlSource, /if \(isPrivateOrLocalHostname\(url\.hostname\)\) return false/);
  assert.match(serverUrlSource, /if \(!isAllowedPublicHttpPort\(url\)\) return false/);
  assert.match(clientUrlSource, /if \(isPrivateOrLocalHostname\(parsed\.hostname\)\) return ''/);
  assert.match(clientUrlSource, /if \(!isAllowedPublicHttpPort\(parsed\)\) return ''/);
});

test('public PI official profile routes reject credential-bearing URLs', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/leadProfileIdentity.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /const isLikelyOfficialPersonProfileUrl = \(value: unknown\): boolean => \{/,
  );
  assert.match(source, /if \(!isPublicHttpUrl\(trimmed\)\) return false/);
  assert.match(
    source,
    /Object\.entries\(value as Record<string, unknown>\)\.filter\(\s*\(\[, url\]\) => isPublicHttpUrl\(url\)\s*,?\s*\)/,
  );
});

test('research discovery source trust labels use safe HTTP URLs', () => {
  const source = fs.readFileSync(
    new URL('../client/src/utils/researchDiscoveryAdapters.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ safeHttpUrl \} from '\.\/url'/);
  assert.match(source, /const safe = safeHttpUrl\(url\)/);
  assert.match(source, /new URL\(safe\)\.hostname/);
  assert.doesNotMatch(source, /hostname\.endsWith\('yale\.edu'\)/);
  assert.doesNotMatch(source, /\(\^\|\\\.\)yale\\\.edu\\\//);
});

test('shared URL sanitizers bound values before parsing', () => {
  const clientUrlSource = fs.readFileSync(
    new URL('../client/src/utils/url.ts', import.meta.url),
    'utf8',
  );
  const serverUrlSource = fs.readFileSync(
    new URL('../server/src/utils/urlSafety.ts', import.meta.url),
    'utf8',
  );

  assert.match(clientUrlSource, /MAX_SAFE_URL_LENGTH = 2048/);
  assert.match(clientUrlSource, /MAX_SAFE_URL_LIST_ITEMS = 50/);
  assert.match(clientUrlSource, /MAX_SAFE_EMAIL_LENGTH = 254/);
  assert.match(clientUrlSource, /MAX_SAFE_DOI_LENGTH = 512/);
  assert.match(clientUrlSource, /MAX_SAFE_MAILTO_SUBJECT_LENGTH = 200/);
  assert.match(clientUrlSource, /MAX_SAFE_MAILTO_BODY_LENGTH = 2000/);
  assert.match(clientUrlSource, /trimmed\.length > MAX_SAFE_URL_LENGTH/);
  assert.match(
    clientUrlSource,
    /Array\.isArray\(values\) \? values\.slice\(0, MAX_SAFE_URL_LIST_ITEMS\) : \[\]/,
  );
  assert.match(clientUrlSource, /trimmed\.length > MAX_SAFE_EMAIL_LENGTH/);
  assert.match(clientUrlSource, /withoutMailto\.length > MAX_SAFE_EMAIL_LENGTH/);
  assert.match(
    clientUrlSource,
    /typeof params\.subject === 'string' &&\s*params\.subject\.length <= MAX_SAFE_MAILTO_SUBJECT_LENGTH/,
  );
  assert.match(
    clientUrlSource,
    /typeof params\.body === 'string' && params\.body\.length <= MAX_SAFE_MAILTO_BODY_LENGTH/,
  );
  assert.match(clientUrlSource, /rawDoi\.trim\(\)\.length > MAX_SAFE_DOI_LENGTH/);
  assert.match(serverUrlSource, /MAX_PUBLIC_HTTP_URL_LENGTH = 2048/);
  assert.match(serverUrlSource, /trimmed\.length > MAX_PUBLIC_HTTP_URL_LENGTH/);
});

test('publication DOI links use the shared DOI sanitizer', () => {
  const urlSource = fs.readFileSync(new URL('../client/src/utils/url.ts', import.meta.url), 'utf8');

  assert.match(urlSource, /export const safeDoiUrl = \(rawDoi: unknown\): string => \{/);
  assert.match(urlSource, /DOI_PATTERN/);
});

test('global security headers do not leak referrers cross-origin', () => {
  const source = fs.readFileSync(
    new URL('../server/src/middleware/securityHeaders.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /res\.setHeader\('Referrer-Policy', 'no-referrer'\)/);
  assert.doesNotMatch(source, /strict-origin-when-cross-origin/);
});

test('stored profile images do not leak page referrers to external image hosts', () => {
  const urlSource = fs.readFileSync(new URL('../client/src/utils/url.ts', import.meta.url), 'utf8');
  assert.match(urlSource, /export const EXTERNAL_IMAGE_REFERRER_POLICY = 'no-referrer'/);

  const imageRenderers = [
    '../client/src/components/labs/LabMembersList.tsx',
    '../client/src/components/DeveloperCard.tsx',
  ];

  for (const file of imageRenderers) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /EXTERNAL_IMAGE_REFERRER_POLICY/);
    assert.match(source, /referrerPolicy=\{EXTERNAL_IMAGE_REFERRER_POLICY\}/);
  }
});

test('scraper materializer logs sanitize untrusted exception values', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/entityMaterializer.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ sanitizeLogValue \} from '\.\.\/utils\/logSanitizer'/);
  assert.match(source, /sanitizeLogValue\(\{ entityId: entityIdString, error \}\)/);
  assert.doesNotMatch(
    source,
    /console\.error\('Failed to recompute browseRankScore for', entityIdString, error\)/,
  );
  assert.doesNotMatch(source, /\(err as Error\)\?\.message \|\| err/);
});

// The heartbeat lives in scrapeJobLock.ts, which every writer shares, rather than
// in cronRunner.ts where it used to be duplicated (#2498). Both files are still
// pinned, because cronRunner keeps its own sanitized logging for the lead reclaim.
test('scrape job lock heartbeat logs sanitize lock exceptions', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/scrapeJobLock.ts', import.meta.url),
    'utf8',
  );
  const cronSource = fs.readFileSync(
    new URL('../server/src/scrapers/cronRunner.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ sanitizeLogValue \} from '\.\.\/utils\/logSanitizer'/);
  assert.match(
    source,
    /Failed to heartbeat \$\{input\.label \?\? 'scrape'\} job lock for \$\{input\.sourceName\}:/,
  );
  assert.match(source, /sanitizeLogValue\(error\)/);
  assert.doesNotMatch(source, /error instanceof Error \? error\.message : error/);
  assert.doesNotMatch(source, /console\.error\([^;]*error\.message[^;]*\)/);

  // cronRunner must not log a raw lock exception either; where its heartbeat
  // comes from is a structural question the unit suite owns behaviorally.
  assert.match(cronSource, /import \{ sanitizeLogValue \} from '\.\.\/utils\/logSanitizer'/);
  assert.doesNotMatch(cronSource, /error instanceof Error \? error\.message : error/);
  assert.doesNotMatch(cronSource, /console\.error\([^;]*error\.message[^;]*\)/);
});

test('scraper run failure records and reports sanitize persisted errors', () => {
  const orchestratorSource = fs.readFileSync(
    new URL('../server/src/scrapers/orchestrator.ts', import.meta.url),
    'utf8',
  );
  const reportSource = fs.readFileSync(
    new URL('../server/src/scrapers/runReport.ts', import.meta.url),
    'utf8',
  );

  // Matched by what is imported from the module rather than by the whole import
  // statement, so adding a sibling import cannot fail this for a reason that has
  // nothing to do with sanitization (#3891).
  assert.match(
    orchestratorSource,
    /import \{[^}]*\bsanitizeLogValue\b[^}]*\} from '\.\.\/utils\/logSanitizer'/,
  );
  assert.match(
    orchestratorSource,
    /import \{[^}]*\bsanitizeErrorForLog\b[^}]*\} from '\.\.\/utils\/logSanitizer'/,
  );
  // A thrown Error goes through the sanitizer that redacts BOTH its message and its
  // stack; a thrown non-Error is sanitized as a value and carries no stack.
  assert.match(orchestratorSource, /\? sanitizeErrorForLog\(err\)/);
  assert.match(orchestratorSource, /: \{ message: sanitizeLogValue\(err\), stack: undefined \}/);
  assert.match(orchestratorSource, /const errorMessage = sanitized\.message/);
  assert.match(orchestratorSource, /message: errorMessage \|\| 'Unknown scrape error'/);
  assert.match(
    orchestratorSource,
    /\.\.\.\(sanitized\.stack \? \{ stack: sanitized\.stack \} : \{\}\)/,
  );
  assert.doesNotMatch(orchestratorSource, /message: err\?\.message/);
  assert.doesNotMatch(orchestratorSource, /stack: err\?\.stack/);
  // The persisted stack is the sanitized one. Storing the raw stack would leak every
  // credential, token and address the sanitizer exists to remove.
  assert.doesNotMatch(orchestratorSource, /stack: err\.stack/);
  assert.doesNotMatch(orchestratorSource, /stack: \(err as Error\)\.stack/);

  assert.match(reportSource, /import \{ sanitizeLogValue \} from '\.\.\/utils\/logSanitizer'/);
  assert.match(reportSource, /const reportErrorMessage = \(message: unknown\): string =>/);
  assert.match(
    reportSource,
    /const reportErrorContext = \(context: unknown\): string \| undefined =>/,
  );
  assert.match(reportSource, /message: reportErrorMessage\(err\.message\)/);
  assert.match(reportSource, /context: reportErrorContext\(err\.context\)/);
  assert.doesNotMatch(reportSource, /message: err\.message \|\| 'Unknown scrape error'/);
  assert.doesNotMatch(reportSource, /context: err\.context/);
});

test('scraper context logs sanitize messages and metadata', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/orchestrator.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const safeMessage = sanitizeLogValue\(msg\)/);
  assert.match(source, /console\.log\(prefix, safeMessage, sanitizeLogValue\(meta\)\)/);
  assert.match(source, /console\.log\(prefix, safeMessage\)/);
  assert.doesNotMatch(source, /console\.log\(prefix, msg, JSON\.stringify\(meta\)\)/);
  assert.doesNotMatch(source, /console\.log\(prefix, msg\)/);
});

test('scraper entrypoint fatal logs sanitize caught exceptions', () => {
  const scraperEntrypoints = [
    '../server/src/scrapers/cli.ts',
    '../server/src/scrapers/seedSources.ts',
  ];

  for (const file of scraperEntrypoints) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /import \{ sanitizeLogValue \} from '\.\.\/utils\/logSanitizer'/);
    assert.match(source, /console\.error\(sanitizeLogValue\(err\)\)/);
    assert.doesNotMatch(source, /console\.error\(err\)/);
  }
});

test('user account routes set full private no-store response headers', () => {
  const routeSource = fs.readFileSync(
    new URL('../server/src/routes/users.ts', import.meta.url),
    'utf8',
  );
  const controllerSource = fs.readFileSync(
    new URL('../server/src/controllers/userController.ts', import.meta.url),
    'utf8',
  );

  for (const source of [routeSource, controllerSource]) {
    assert.match(source, /Cache-Control', 'no-store, private, max-age=0'/);
    assert.match(source, /Pragma', 'no-cache'/);
    assert.match(source, /Surrogate-Control', 'no-store'/);
    assert.match(source, /Expires', '0'/);
    assert.match(source, /X-Content-Type-Options', 'nosniff'/);
  }
});

test('authenticated research-area routes set full private no-store response headers', () => {
  const routeFiles = ['../server/src/routes/admin.ts'];

  for (const file of routeFiles) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /Cache-Control', 'no-store, private, max-age=0'/);
    assert.match(source, /Pragma', 'no-cache'/);
    assert.match(source, /Surrogate-Control', 'no-store'/);
    assert.match(source, /Expires', '0'/);
    assert.match(source, /X-Content-Type-Options', 'nosniff'/);
  }
});

test('program maintenance artifacts use safe JSON paths and safe review inputs', () => {
  const programResearchRelevance = fs.readFileSync(
    new URL('../server/src/scripts/auditProgramResearchRelevance.ts', import.meta.url),
    'utf8',
  );
  const programOfficialSources = fs.readFileSync(
    new URL('../server/src/scripts/backfillProgramOfficialSources.ts', import.meta.url),
    'utf8',
  );

  for (const [name, source] of [
    ['program research relevance audit', programResearchRelevance],
    ['program official source backfill', programOfficialSources],
  ]) {
    assert.match(
      source,
      /resolveSafeJsonReportOutputPath/,
      `${name} must use the shared safe JSON report path resolver`,
    );
    assert.match(
      source,
      /const safeOutput = resolveSafeJsonReportOutputPath\(options\.output\)|const safeOutput = resolveSafeJsonReportOutputPath\(output\)/,
      `${name} writer must revalidate output paths before file I/O`,
    );
    assert.doesNotMatch(
      source,
      /fs\.writeFileSync\(options\.output,|fs\.writeFileSync\(output,/,
      `${name} must not write raw output paths`,
    );
    assert.doesNotMatch(
      source,
      /fs\.mkdirSync\(path\.dirname\(options\.output\)|fs\.mkdirSync\(path\.dirname\(output\)/,
      `${name} must not create raw output directories`,
    );
  }

  assert.match(programOfficialSources, /function resolveProgramOfficialSourceInputPath/);
  assert.match(
    programOfficialSources,
    /return resolveSafeJsonReportOutputPath\(input, '--input'\)/,
  );
  assert.match(
    programOfficialSources,
    /const safeInput = resolveProgramOfficialSourceInputPath\(input\)/,
  );
  assert.doesNotMatch(programOfficialSources, /fs\.readFileSync\(input,/);
  assert.match(
    programResearchRelevance,
    /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/,
  );
  assert.match(programResearchRelevance, /recordId: serializedDocumentId\(program\._id\) \|\| ''/);
  assert.doesNotMatch(programResearchRelevance, /recordId: String\(program\._id\)/);
  assert.doesNotMatch(programResearchRelevance, /String\(program\._id\)/);
});

test('Meilisearch rebuild artifacts use safe JSON output paths', () => {
  const researchEntityRebuild = fs.readFileSync(
    new URL('../server/src/scripts/rebuildResearchEntitySearchIndex.ts', import.meta.url),
    'utf8',
  );

  for (const [name, source] of [['research entity search index rebuild', researchEntityRebuild]]) {
    assert.match(
      source,
      /resolveSafeJsonReportOutputPath/,
      `${name} must use the shared safe JSON report path resolver`,
    );
    assert.match(
      source,
      /return resolveSafeJsonReportOutputPath\(value\)/,
      `${name} must validate --output while parsing CLI flags`,
    );
    assert.match(
      source,
      /const safeOutput = resolveSafeJsonReportOutputPath\(output\)/,
      `${name} writer must revalidate output paths before file I/O`,
    );
    assert.doesNotMatch(
      source,
      /fs\.writeFileSync\(output,/,
      `${name} must not write raw output paths`,
    );
    assert.doesNotMatch(
      source,
      /fs\.mkdirSync\(path\.dirname\(output\)/,
      `${name} must not create raw output directories`,
    );
  }
});

test('quality and coverage audit artifacts use safe JSON output paths', () => {
  const files = [
    ['research entity coverage audit', '../server/src/scripts/researchEntityCoverageAudit.ts'],
    ['research quality search review', '../server/src/scripts/researchQualitySearchReview.ts'],
  ];

  for (const [name, file] of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(
      source,
      /resolveSafeJsonReportOutputPath/,
      `${name} must use the shared safe JSON report path resolver`,
    );
    assert.match(
      source,
      /return resolveSafeJsonReportOutputPath\(value\)/,
      `${name} must validate --output while parsing CLI flags`,
    );
    assert.match(
      source,
      /const safeOutput = resolveSafeJsonReportOutputPath\(output\)/,
      `${name} writer must revalidate output paths before file I/O`,
    );
    assert.doesNotMatch(
      source,
      /fs\.writeFileSync\(output,/,
      `${name} must not write raw output paths`,
    );
    assert.doesNotMatch(
      source,
      /fs\.mkdirSync\(path\.dirname\(output\)/,
      `${name} must not create raw output directories`,
    );
  }
});

test('migration and cleanup artifacts use safe JSON output paths', () => {
  const files = [
    ['Mongo naming migration', '../server/src/scripts/migrateMongoNaming.ts'],
    ['research entity migration', '../server/src/scripts/migrateResearchEntities.ts'],
    [
      'research entity collection migration',
      '../server/src/scripts/migrateResearchEntityCollections.ts',
    ],
    ['legacy Mongo cleanup', '../server/src/scripts/cleanupLegacyMongoCollections.ts'],
  ];

  for (const [name, file] of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(
      source,
      /resolveSafeJsonReportOutputPath/,
      `${name} must use the shared safe JSON report path resolver`,
    );
    assert.match(
      source,
      /return resolveSafeJsonReportOutputPath\(value\)/,
      `${name} must validate --output while parsing CLI flags`,
    );
    assert.match(
      source,
      /const safeOutput = resolveSafeJsonReportOutputPath\(output\)/,
      `${name} writer must revalidate output paths before file I/O`,
    );
    assert.doesNotMatch(
      source,
      /fs\.writeFileSync\(output,/,
      `${name} must not write raw output paths`,
    );
    assert.doesNotMatch(
      source,
      /fs\.mkdirSync\(path\.dirname\(output\)/,
      `${name} must not create raw output directories`,
    );
  }
});

test('research and profile backfill artifacts use safe JSON output paths', () => {
  const files = [
    ['research description backfill', '../server/src/scripts/backfillResearchDescriptions.ts'],
    ['center directors backfill', '../server/src/scripts/backfillCenterDirectors.ts'],
    ['browse rank backfill', '../server/src/scripts/backfillBrowseRank.ts'],
  ];

  for (const [name, file] of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(
      source,
      /resolveSafeJsonReportOutputPath/,
      `${name} must use the shared safe JSON report path resolver`,
    );
    assert.match(
      source,
      /options\.output = resolveSafeJsonReportOutputPath\(/,
      `${name} must validate --output while parsing CLI flags`,
    );
    assert.match(
      source,
      /const safeOutput = resolveSafeJsonReportOutputPath\(options\.output\)/,
      `${name} writer must revalidate output paths before file I/O`,
    );
    assert.doesNotMatch(
      source,
      /fs\.writeFileSync\(options\.output,/,
      `${name} must not write raw output paths`,
    );
  }
});

test('repair and dedupe artifacts use safe JSON output paths', () => {
  const files = [
    ['archived entity artifact repair', '../server/src/scripts/repairArchivedEntityArtifacts.ts'],
    ['duplicate access signal repair', '../server/src/scripts/repairDuplicateAccessSignals.ts'],
  ];

  for (const [name, file] of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(
      source,
      /resolveSafeJsonReportOutputPath/,
      `${name} must use the shared safe JSON report path resolver`,
    );
    assert.match(
      source,
      /options\.output = resolveSafeJsonReportOutputPath\(|args\.output = consumePath\(|return resolveSafeJsonReportOutputPath\(value, flag\)/,
      `${name} must validate --output while parsing CLI flags`,
    );
    assert.match(
      source,
      /const safeOutput = resolveSafeJsonReportOutputPath\(output\)/,
      `${name} writer must revalidate output paths before file I/O`,
    );
    assert.doesNotMatch(
      source,
      /fs\.writeFileSync\(output,/,
      `${name} must not write raw output paths`,
    );
    assert.doesNotMatch(
      source,
      /fs\.mkdirSync\(path\.dirname\(output\)/,
      `${name} must not create raw output directories`,
    );
  }
});
test('public research detail does not expose direct faculty contact emails or contact-route ids', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/researchGroupService.ts', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(source, /\.\.\.route,[\s\S]*label: publicString\(route\.label\)/);
  assert.doesNotMatch(source, /email: publicContactEmail\(faculty\.email\)/);
  assert.doesNotMatch(source, /netid: faculty\.netid/);
  assert.doesNotMatch(source, /addPublicMemberField\(publicUser, 'netid'/);
  assert.match(source, /const publicResearchDetailGroup = \(group: any\) => \{/);
  assert.match(source, /contactEmail: _contactEmail/);
  assert.match(source, /contactName: _contactName/);
  assert.match(source, /contactRole: _contactRole/);
  assert.match(source, /\.\.\.publicGroupForResponse,/);
  assert.doesNotMatch(source, /const groupHasContactEmail = Boolean/);
  assert.doesNotMatch(source, /const email = groupHasContactEmail/);
  assert.doesNotMatch(source, /route\.email = email/);
  assert.doesNotMatch(source, /Derived from the attached lead PI profile email/);
});

test('public research detail omits internal entity, relationship, and member ids', () => {
  const serviceSource = fs.readFileSync(
    new URL('../server/src/services/researchGroupService.ts', import.meta.url),
    'utf8',
  );
  const dtoSource = fs.readFileSync(
    new URL('../server/src/services/researchEntityDto.ts', import.meta.url),
    'utf8',
  );
  const clientTypeSource = fs.readFileSync(
    new URL('../client/src/types/labDetail.ts', import.meta.url),
    'utf8',
  );

  const relationshipSerializer = serviceSource.match(
    /const publicRelationshipForResearchDetail = \([\s\S]*?\n\}\);/,
  );
  assert.ok(relationshipSerializer, 'public relationship serializer should exist');
  assert.doesNotMatch(relationshipSerializer[0], /_id:/);
  assert.doesNotMatch(relationshipSerializer[0], /sourceResearchEntityId:/);
  assert.doesNotMatch(relationshipSerializer[0], /targetResearchEntityId:/);
  assert.match(relationshipSerializer[0], /relatedResearchEntitySlug/);

  const memberSerializer = serviceSource.match(
    /function publicMemberUserForResearchDetail\(user: any\): any \{[\s\S]*?\n\}/,
  );
  assert.ok(memberSerializer, 'public member serializer should exist');
  assert.doesNotMatch(memberSerializer[0], /addPublicMemberField\(publicUser, '_id'/);
  assert.match(
    serviceSource,
    /publicKey: publicMemberKeyForResearchDetail\(member\.user, member\.role, row\?\.identityKey\)/,
  );
  // The scholarly payload builder that emitted `memberKey: pair.memberDisplayId`
  // is retired; the negative guards below still bar raw member ids.
  assert.doesNotMatch(serviceSource, /userId: pair\.memberDisplayId/);
  assert.doesNotMatch(serviceSource, /researchEntityId: String\(researchEntityId \|\| ''\)/);

  const accessSignalSerializer = serviceSource.match(
    /const publicAccessSignalForResearchDetail = \([^)]*\) => \(\{[\s\S]*?\n\}\);/,
  );
  assert.ok(accessSignalSerializer, 'public access-signal serializer should exist');
  assert.doesNotMatch(accessSignalSerializer[0], /_id:/);
  assert.doesNotMatch(accessSignalSerializer[0], /sourceEvidenceId/);
  assert.doesNotMatch(accessSignalSerializer[0], /observationId/);

  const dtoSerializer = dtoSource.match(
    /export function toPublicResearchEntityDto\([\s\S]*?\): PublicResearchEntityDto \{[\s\S]*?\n\}/,
  );
  assert.ok(dtoSerializer, 'public ResearchEntity DTO serializer should exist');
  assert.match(dtoSource, /function publicResearchEntityId\(group: Record<string, any>\): string/);
  assert.doesNotMatch(dtoSerializer[0], /stringId\(group\._id \|\| group\.id\)/);

  assert.doesNotMatch(clientTypeSource, /sourceResearchEntityId: string/);
  assert.doesNotMatch(clientTypeSource, /targetResearchEntityId: string/);
  assert.doesNotMatch(clientTypeSource, /userId\?: string/);
  assert.doesNotMatch(clientTypeSource, /export interface LabAccessSignal \{\s*_id:/);
  // memberKey lived only on the retired scholarly-link type; publicKey remains the
  // opaque member handle, and the negative guards above still bar raw ids.
  assert.match(clientTypeSource, /publicKey\?: string/);
});

test('public research entity DTO does not expose direct contact fields', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/researchEntityDto.ts', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(source, /publicContactEmail/);
  assert.doesNotMatch(source, /'contactEmail'/);
  assert.doesNotMatch(source, /'contactName'/);
  assert.doesNotMatch(source, /'contactRole'/);
  assert.doesNotMatch(source, /field === 'contactEmail'/);
});

test('anonymous public research entity DTO omits workflow metadata', () => {
  const dtoSource = fs.readFileSync(
    new URL('../server/src/services/researchEntityDto.ts', import.meta.url),
    'utf8',
  );
  const controllerSource = fs.readFileSync(
    new URL('../server/src/controllers/researchGroupController.ts', import.meta.url),
    'utf8',
  );

  const publicFields = dtoSource.match(
    /const OPTIONAL_PUBLIC_RESEARCH_ENTITY_FIELDS = \[[\s\S]*?\] as const;/,
  );
  assert.ok(publicFields, 'public ResearchEntity DTO field allowlist should exist');
  assert.doesNotMatch(publicFields[0], /'createdAt'/);
  assert.doesNotMatch(publicFields[0], /'updatedAt'/);
  assert.doesNotMatch(publicFields[0], /'qualitySummary'/);
  assert.doesNotMatch(publicFields[0], /'studentVisibilityTier'/);

  assert.match(dtoSource, /const OPERATOR_PUBLIC_RESEARCH_ENTITY_FIELDS = \[/);
  assert.match(dtoSource, /includeOperatorFields\?: boolean/);
  assert.match(dtoSource, /if \(options\.includeOperatorFields\) \{/);

  const publicSortFields = controllerSource.match(
    /const PUBLIC_ALLOWED_SORT_FIELDS: ResearchGroupSearchSort\['sortBy'\]\[\] = \[[\s\S]*?\];/,
  );
  assert.ok(publicSortFields, 'public research sort allowlist should exist');
  assert.doesNotMatch(publicSortFields[0], /'createdAt'/);
  assert.doesNotMatch(publicSortFields[0], /'updatedAt'/);
  assert.match(controllerSource, /const OPERATOR_ALLOWED_SORT_FIELDS/);
  assert.match(controllerSource, /const allowedSortFields = hasAdminAuthority/);
});

test('public program and fellowship payloads omit direct email and phone fields', () => {
  const programPayloadSource = fs.readFileSync(
    new URL('../server/src/controllers/programPayload.ts', import.meta.url),
    'utf8',
  );
  const fellowshipServiceSource = fs.readFileSync(
    new URL('../server/src/services/fellowshipService.ts', import.meta.url),
    'utf8',
  );
  const programControllerSource = fs.readFileSync(
    new URL('../server/src/controllers/programController.ts', import.meta.url),
    'utf8',
  );
  const fellowshipControllerSource = fs.readFileSync(
    new URL('../server/src/controllers/fellowshipController.ts', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(programPayloadSource, /publicContactEmail/);
  assert.doesNotMatch(programPayloadSource, /contactName:/);
  assert.doesNotMatch(programPayloadSource, /contactEmail:/);
  assert.doesNotMatch(programPayloadSource, /contactPhone:/);
  assert.doesNotMatch(programPayloadSource, /studentVisibilityComputedTier:/);
  assert.doesNotMatch(programPayloadSource, /studentVisibilityReasons:/);
  assert.doesNotMatch(programPayloadSource, /studentVisibilityTier:/);
  assert.doesNotMatch(programPayloadSource, /createdAt: program\.createdAt/);
  assert.doesNotMatch(programPayloadSource, /updatedAt: program\.updatedAt/);
  assert.match(programPayloadSource, /sourceName: publicProgramText\(program\.sourceName\)/);
  assert.doesNotMatch(fellowshipServiceSource, /publicContactEmail/);
  assert.match(
    fellowshipServiceSource,
    /const PUBLIC_FELLOWSHIP_TEXT_FIELDS = new Set\(\[[\s\S]*?'sourceName'[\s\S]*?\]\);/,
  );
  assert.doesNotMatch(
    fellowshipServiceSource,
    /const PUBLIC_FELLOWSHIP_FIELDS = \[[^\]]*?'contactName'[^\]]*?\] as const;/,
  );
  assert.doesNotMatch(
    fellowshipServiceSource,
    /const PUBLIC_FELLOWSHIP_TEXT_FIELDS = new Set\(\[[^\]]*?'contactName'[^\]]*?\]\);/,
  );
  assert.doesNotMatch(
    fellowshipServiceSource,
    /const PUBLIC_FELLOWSHIP_FIELDS = \[[^\]]*?'contactEmail'[^\]]*?\] as const;/,
  );
  assert.doesNotMatch(
    fellowshipServiceSource,
    /const PUBLIC_FELLOWSHIP_FIELDS = \[[^\]]*?'contactPhone'[^\]]*?\] as const;/,
  );
  assert.doesNotMatch(
    fellowshipServiceSource,
    /const PUBLIC_FELLOWSHIP_FIELDS = \[[^\]]*?'createdAt'[^\]]*?\] as const;/,
  );
  assert.doesNotMatch(
    fellowshipServiceSource,
    /const PUBLIC_FELLOWSHIP_FIELDS = \[[^\]]*?'updatedAt'[^\]]*?\] as const;/,
  );
  assert.doesNotMatch(
    fellowshipServiceSource,
    /const PUBLIC_FELLOWSHIP_FIELDS = \[[^\]]*?'score'[^\]]*?\] as const;/,
  );
  assert.doesNotMatch(
    fellowshipServiceSource,
    /const PUBLIC_FELLOWSHIP_PRIMITIVE_FIELDS = new Set\(\[[^\]]*?'createdAt'[^\]]*?\]\);/,
  );
  assert.doesNotMatch(
    fellowshipServiceSource,
    /const PUBLIC_FELLOWSHIP_PRIMITIVE_FIELDS = new Set\(\[[^\]]*?'updatedAt'[^\]]*?\]\);/,
  );
  assert.doesNotMatch(
    fellowshipServiceSource,
    /const PUBLIC_FELLOWSHIP_PRIMITIVE_FIELDS = new Set\(\[[^\]]*?'score'[^\]]*?\]\);/,
  );
  assert.doesNotMatch(
    fellowshipServiceSource,
    /const PUBLIC_FELLOWSHIP_PRIMITIVE_FIELDS = new Set\(\[[^\]]*?'sourceName'[^\]]*?\]\);/,
  );
  assert.doesNotMatch(
    fellowshipServiceSource,
    /const PUBLIC_FELLOWSHIP_TEXT_FIELDS = new Set\(\[[^\]]*?'contactPhone'[^\]]*?\]\)/,
  );
  assert.doesNotMatch(fellowshipServiceSource, /field === 'contactEmail'/);

  const publicProgramSortFields = programControllerSource.match(
    /const PUBLIC_PROGRAM_SORT_FIELDS = new Set\(\[[\s\S]*?\]\);/,
  );
  const publicFellowshipServiceSortFields = fellowshipServiceSource.match(
    /const PUBLIC_FELLOWSHIP_SORT_FIELDS = new Set\(\[[\s\S]*?\]\);/,
  );

  assert.ok(publicProgramSortFields, 'public program sort allowlist should exist');
  assert.ok(
    publicFellowshipServiceSortFields,
    'public fellowship service sort allowlist should exist',
  );
  for (const sortFields of [publicProgramSortFields[0], publicFellowshipServiceSortFields[0]]) {
    assert.doesNotMatch(sortFields, /'createdAt'/);
    assert.doesNotMatch(sortFields, /'updatedAt'/);
  }
  assert.doesNotMatch(programControllerSource, /sortBy = 'updatedAt'/);
  assert.doesNotMatch(fellowshipControllerSource, /sortBy = 'updatedAt'/);
  assert.match(programControllerSource, /const OPERATOR_PROGRAM_SORT_FIELDS = new Set/);
  assert.match(fellowshipServiceSource, /const OPERATOR_FELLOWSHIP_SORT_FIELDS = new Set/);
});

test('research entity search index documents omit direct contact fields', () => {
  const searchIndexSource = fs.readFileSync(
    new URL('../server/src/services/researchEntitySearchIndexService.ts', import.meta.url),
    'utf8',
  );
  const syncSource = fs.readFileSync(
    new URL('../server/src/services/meiliSyncService.ts', import.meta.url),
    'utf8',
  );

  assert.match(searchIndexSource, /const SEARCH_INDEX_DIRECT_CONTACT_FIELDS = \[/);
  assert.match(
    searchIndexSource,
    /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/,
  );
  assert.match(searchIndexSource, /const id = serializedDocumentId\(rawId\)/);
  assert.doesNotMatch(searchIndexSource, /id: String\(rawId\)/);
  assert.match(searchIndexSource, /'contactEmail'/);
  assert.match(searchIndexSource, /'contactName'/);
  assert.match(searchIndexSource, /'contactRole'/);
  assert.match(
    searchIndexSource,
    /for \(const field of SEARCH_INDEX_DIRECT_CONTACT_FIELDS\) \{\s*delete out\[field\];\s*\}/,
  );
  assert.doesNotMatch(syncSource, /String\(doc\._id\)/);
  assert.match(
    syncSource,
    /import \{[^}]*buildResearchEntitySearchIndexDocumentsWithMemberNames[^}]*\} from '\.\/researchEntitySearchIndexService'/,
  );
  assert.match(
    syncSource,
    /transform: async \(doc: any\) =>\s*\(await buildResearchEntitySearchIndexDocumentsWithMemberNames\(\[doc\]\)\)/,
  );
  assert.match(syncSource, /if \(!meiliDoc\) return/);
});

test('fellowship and item not-found errors do not echo queried identifiers', () => {
  const fellowshipSource = fs.readFileSync(
    new URL('../server/src/services/fellowshipService.ts', import.meta.url),
    'utf8',
  );
  const itemOpsSource = fs.readFileSync(
    new URL('../server/src/services/itemOperations.ts', import.meta.url),
    'utf8',
  );

  for (const source of [fellowshipSource, itemOpsSource]) {
    assert.doesNotMatch(source, /not found with ObjectId/);
    assert.doesNotMatch(source, /ObjectId: \$\{safeId\}/);
  }
  assert.match(fellowshipSource, /throw new NotFoundError\('Fellowship not found'\)/);
  assert.match(itemOpsSource, /throw new NotFoundError\('Item not found'\)/);
});

test('public item view and favorite mutations require visibility filters', () => {
  const fellowshipSource = fs.readFileSync(
    new URL('../server/src/services/fellowshipService.ts', import.meta.url),
    'utf8',
  );
  const itemOpsSource = fs.readFileSync(
    new URL('../server/src/services/itemOperations.ts', import.meta.url),
    'utf8',
  );

  assert.match(itemOpsSource, /type ItemMutationFilter = Record<string, unknown>/);
  assert.match(itemOpsSource, /findOneAndUpdate\(\s*\{ _id: safeId, \.\.\.filter \}/);
  assert.match(itemOpsSource, /findOne\(\{ _id: safeId, \.\.\.filter \}\)/);
  assert.doesNotMatch(itemOpsSource, /findByIdAndUpdate\(/);
  assert.match(
    fellowshipSource,
    /itemOps\.addView\(Fellowship, id, \{[\s\S]*?archived: false,[\s\S]*?\.\.\.publicFellowshipFilter\(\),[\s\S]*?\}\)/,
  );
});

test('scraper tests do not contain known real profile fixture identifiers', () => {
  const files = [
    '../server/src/scrapers/__tests__/officialProfilePiBackfillScraper.test.ts',
    '../server/src/scrapers/__tests__/departmentRosterScraper.test.ts',
    '../server/src/scrapers/__tests__/centersInstitutesScraper.test.ts',
    '../server/src/scrapers/__tests__/labMicrositeDescriptionLLMExtractor.test.ts',
    '../server/src/scrapers/__tests__/nsfAwardScraper.test.ts',
  ];
  const source = files
    .map((file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8'))
    .join('\n');
  const realFixtureIdentifiers = [
    'joseph-santos-sacchi',
    'drew-small',
    'jacob-hacker',
    'paul-freedman',
    'allen-bale',
    'sara-sanchez-alonso',
    'rajiv-radhakrishnan',
    'michael-cappello',
    'kei-cheung',
    'daniel-wiznia',
    'annie-harper',
    'berna-sozen',
    'elizabeth-connors',
    'dana-peters',
    'deb-vargas',
    'fatima-el-tayeb',
    'robert-kerns',
    'ania-jastreboff',
    'catherine-buck',
    'rohan-khera',
    'leonard-kaczmarek',
    'morgan-lemma',
    'mika-hampson',
    'ari-escamilla',
    'abhishek-bhattacharjee',
    'gerald-shulman',
    'julia-adams',
    'abraham-silberschatz',
    'richard-bribiescas',
    'david-cameron',
    'joanne-brown',
    'Abhishek Bhattacharjee',
    'Jacob Hacker',
    'Paul Freedman',
    'Allen Bale',
    'Sara Sanchez Alonso',
    'Rajiv Radhakrishnan',
    'Michael Cappello',
    'Kei Cheung',
    'Daniel Wiznia',
    'Annie Harper',
    'Berna Sozen',
    'Elizabeth Connors',
    'Dana Peters',
    'Deb Vargas',
    'Fatima El-Tayeb',
    'Robert Kerns',
    'Ania Jastreboff',
    'Catherine Buck',
    'Rohan Khera',
    'Leonard Kaczmarek',
    'Morgan Lemma',
    'Mika Hampson',
    'Ari Escamilla',
    'Drew Small',
    'Gerald Shulman',
    'Julia Adams',
  ];

  for (const identifier of realFixtureIdentifiers) {
    assert.doesNotMatch(source, new RegExp(identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('source-acquisition report errors sanitize raw exception messages', () => {
  const files = [
    '../server/src/scrapers/sources/officialProfilePiBackfillScraper.ts',
    '../server/src/scrapers/sources/yaleDirectoryScraper.ts',
    '../server/src/scrapers/sources/nsfAwardScraper.ts',
    '../server/src/scrapers/renderedFetch.ts',
    '../server/src/scrapers/sources/yaleCollegeFellowshipsOfficeScraper.ts',
    '../server/src/scrapers/sources/labMicrositeDescriptionLLMExtractor.ts',
    '../server/src/scripts/researchQualitySearchReview.ts',
  ];
  const source = files
    .map((file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8'))
    .join('\n');

  assert.doesNotMatch(source, /err\?\.message \|\| String\(err\)/);
  assert.doesNotMatch(source, /errAny\?\.message \?\? String\(err\)/);
  assert.doesNotMatch(source, /err instanceof Error \? err\.message : String\(err\);/);
  assert.doesNotMatch(source, /error instanceof Error \? error\.message : String\(error\)(?!\))/);
  assert.doesNotMatch(source, /Description extraction source failed for \$\{lab\.name\}/);
  assert.doesNotMatch(source, /Skipping description extraction for \$\{lab\.name\}/);
  assert.match(source, /sanitizeLogValue\(err\)/);
  assert.match(source, /sanitizeLogValue\(error\)/);
});
