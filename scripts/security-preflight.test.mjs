import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const ciWorkflow = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const keepAliveWorkflow = fs.readFileSync(
  new URL('../.github/workflows/keep-alive.yml', import.meta.url),
  'utf8',
);
const renderBlueprint = fs.readFileSync(new URL('../render.yaml', import.meta.url), 'utf8');
const productionSecuritySmokeWorkflow = fs.readFileSync(
  new URL('../.github/workflows/production-security-smoke.yml', import.meta.url),
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
  assert.match(yarnrc, /approvedGitRepositories:\s*\n\s*- "https:\/\/github\.com\/coursetable\/passport-cas"/);
  assert.match(yarnrc, /npmMinimalAgeGate: 1d/);
  assert.doesNotMatch(yarnrc, /approvedGitRepositories:\s*\n\s*- "\*\*"/);
  assert.doesNotMatch(yarnrc, /\n\s*- "\*"/);
  assert.doesNotMatch(yarnrc, /npmMinimalAgeGate: 0/);
});


test('test fixtures do not contain known real Yale identifiers', () => {
  const denied = [
    "Toma_Tebaldi",
    "Toma Tebaldi",
    "0000-0002-0625-1631",
    "0000-0002-5529-3248",
    "0000-0002-1825-0097",
    "0000-0001-5109-3700",
    "yongli-zhang",
    "anna-arnal-estape",
    "james-e-hansen",
    "eric-winer",
    "Eric P. Winer",
    "christopher-whitlow",
    "paul-bloom",
    "alison-galvani",
    "lucila-ohno-machado",
    "john-tsang",
    "Mehran M. Sadeghi",
    "Cardiovascular Molecular Imaging Laboratory",
    "Nadya Dimitrova",
    "nadya-dimitrova",
    "Sofia, Bulgaria",
    "a-higginschen",
    "lawrence-guan",
    "br574",
    "dglahn",
    "jp2492",
    "jdp52",
    "dtm27",
    "t-zhu",
    "Deb Vargas",
    "deb-vargas",
    "deb.vargas",
    "Fatima El-Tayeb",
    "fatima-el-tayeb",
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
      assert.equal(source.includes(value), false, `${file} contains real Yale identifier fixture: ${value}`);
    }
  }
});


test('operator scripts sanitize raw caught error messages before logging', () => {
  const files = [
    '../server/src/scripts/pathwayQualityAudit.ts',
    '../server/src/scripts/crossSourceObservationConflictReview.ts',
    '../server/src/scripts/researchEntityMemberReferenceAudit.ts',
    '../server/src/scripts/dedupeUsersByIdentity.ts',
    '../server/src/scripts/backfillPostedOpportunitiesFromListings.ts',
    '../server/src/scripts/repairDuplicateAccessSignals.ts',
    '../server/src/scripts/betaDataQuality.ts',
    '../server/src/scripts/betaReadinessGate.ts',
    '../server/src/scripts/sourceHealth.ts',
    '../server/src/scripts/userEmailHygiene.ts',
    '../server/src/scripts/acceptedInputs.ts',
    '../server/src/scripts/researchEntityCoverageAudit.ts',
    '../server/src/scripts/clearBetaStudentAnalytics.ts',
    '../server/src/scripts/paperAuthorshipAudit.ts',
    '../server/src/scripts/repairMismatchedPersonEmails.ts',
    '../server/src/scripts/promoteAcceptedBetaCopy.ts',
    '../server/src/scripts/backfillApplicationRoutePathways.ts',
    '../server/src/scripts/staleObservationConflictReview.ts',
    '../server/src/scripts/reapPostedOpportunityStatuses.ts',
    '../server/src/scripts/duplicateEntityNameReview.ts',
    '../server/src/scripts/importFaculty.ts',
    '../server/src/scripts/backfillProfileBiosFromOfficialUrls.ts',
  ];

  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /sanitizeLogValue/);
    assert.doesNotMatch(source, /console\.error\(error instanceof Error \? error\.message : error\)/);
    assert.doesNotMatch(source, /console\.error\([^;\n]*err\.message\)/);
    assert.doesNotMatch(source, /console\.error\([^;\n]*\(error as Error\)\.message\)/);
    assert.doesNotMatch(source, /candidate\.netid[^;\n]*error/);
  }
});


test('admin access-review validation responses use fixed public copy', () => {
  const source = fs.readFileSync(new URL('../server/src/routes/admin.ts', import.meta.url), 'utf8');

  assert.match(source, /res\.status\(400\)\.json\(\{ error: 'Search query is too long' \}\)/);
  assert.doesNotMatch(source, /res\.status\(400\)\.json\(\{ error: error\.message \}\)/);
});

test('analytics query controls are parsed through allowlisted route guards', () => {
  const source = fs.readFileSync(new URL('../server/src/routes/analytics.ts', import.meta.url), 'utf8');

  assert.match(source, /const ANALYTICS_USER_SORTS: readonly AnalyticsUserSort\[\]/);
  assert.match(source, /const ANALYTICS_SORT_DIRECTIONS: readonly AnalyticsSortDirection\[\]/);
  assert.match(source, /const parseAnalyticsLimit = \(limit: unknown, max: number\): number \| undefined =>/);
  assert.match(source, /const parseAnalyticsUserSort = \(sort: unknown\): AnalyticsUserSort \| undefined =>/);
  assert.match(source, /const parseAnalyticsSortDirection = \(direction: unknown\): AnalyticsSortDirection \| undefined =>/);
  assert.match(source, /const parseAnalyticsActiveSince = \(activeSince: unknown\): string \| undefined =>/);
  assert.match(source, /userType: parseAnalyticsUserType\(userType\)/);
  assert.match(source, /activeSince: parseAnalyticsActiveSince\(activeSince\)/);
  assert.match(source, /sort: parseAnalyticsUserSort\(sort\)/);
  assert.match(source, /direction: parseAnalyticsSortDirection\(direction\)/);
  assert.match(source, /limit: parseAnalyticsLimit\(limit, 200\)/);
  assert.match(source, /limit: parseAnalyticsLimit\(request\.query\.limit, 100\)/);
  assert.match(source, /const limit = parseAnalyticsLimit\(request\.query\.limit, 300\)/);
  assert.doesNotMatch(source, /sort: typeof sort === 'string' \? \(sort as AnalyticsUserSort\) : undefined/);
  assert.doesNotMatch(source, /direction: typeof direction === 'string' \? \(direction as AnalyticsSortDirection\) : undefined/);
  assert.doesNotMatch(source, /limit: typeof limit === 'string' \? Number\(limit\) : undefined/);
  assert.doesNotMatch(source, /typeof request\.query\.limit === 'string' \? Number\(request\.query\.limit\) : undefined/);
}
);

test('research description LLM backfill redacts prompt contact data before provider calls', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/backfillResearchDescriptions.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ redactDirectContactInfo \} from '\.\.\/utils\/contactRedaction'/);
  assert.match(source, /const MAX_REWRITE_PROMPT_SOURCE_CHARS = 12000/);
  assert.match(source, /const MAX_REWRITE_PROMPT_NAME_CHARS = 240/);
  assert.match(source, /const safeName = redactDirectContactInfo\(name\)\.slice\(0, MAX_REWRITE_PROMPT_NAME_CHARS\)/);
  assert.match(source, /const safeSourceText = redactDirectContactInfo\(sourceText\)\.slice\(0, MAX_REWRITE_PROMPT_SOURCE_CHARS\)/);
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

test('profile bio LLM backfill redacts prompt contact data before provider calls', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/backfillProfileBiosFromOfficialUrls.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ redactDirectContactInfo \} from '\.\.\/utils\/contactRedaction'/);
  assert.match(source, /const MAX_PROMPT_CHARS = 40_000/);
  assert.match(source, /const MAX_PROMPT_NAME_CHARS = 240/);
  assert.match(source, /const MAX_PROMPT_TITLE_CHARS = 500/);
  assert.match(source, /const MAX_PROMPT_SOURCE_URL_CHARS = 2048/);
  assert.match(source, /const safeName = redactDirectContactInfo\(name\)\.slice\(0, MAX_PROMPT_NAME_CHARS\)/);
  assert.match(source, /const safeTitle = redactDirectContactInfo\(title\)\.slice\(0, MAX_PROMPT_TITLE_CHARS\)/);
  assert.match(source, /const safeSourceUrl = redactDirectContactInfo\(sourceUrl\)\.slice\(0, MAX_PROMPT_SOURCE_URL_CHARS\)/);
  assert.match(source, /const safePageText = redactDirectContactInfo\(pageText\)\.slice\(0, MAX_PROMPT_CHARS\)/);
  assert.match(source, /`Faculty member: \$\{safeName\}`/);
  assert.match(source, /`Known title \(authoritative\): \$\{safeTitle \|\| '\(unknown\)'\}`/);
  assert.match(source, /`Source URL: \$\{safeSourceUrl\}`/);
  assert.match(source, /safePageText/);
  assert.doesNotMatch(source, /`Faculty member: \$\{name\}`/);
  assert.doesNotMatch(source, /`Known title \(authoritative\): \$\{title \|\| '\(unknown\)'\}`/);
  assert.doesNotMatch(source, /`Source URL: \$\{sourceUrl\}`/);
  assert.doesNotMatch(source, /pageText\.slice\(0, MAX_PROMPT_CHARS\)/);
});

test('scraper LLM extractors redact prompt page text before provider calls', () => {
  const rawPageTextExtractors = [
    '../server/src/scrapers/sources/labMicrositeDescriptionLLMExtractor.ts',
    '../server/src/scrapers/sources/centerDirectorLLMExtractor.ts',
    '../server/src/scrapers/sources/centerAffiliationLLMExtractor.ts',
  ];

  for (const file of rawPageTextExtractors) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /import \{ redactDirectContactInfo \} from '\.\.\/\.\.\/utils\/contactRedaction'/);
    assert.match(source, /const safeSourceUrl = redactDirectContactInfo\(input\.sourceUrl\)\.slice\(0, 2048\)/);
    assert.match(source, /const safePageText = redactDirectContactInfo\(input\.pageText\)\.slice\(0, MAX_PROMPT_CHARS\)/);
    assert.match(source, /`Source URL: \$\{safeSourceUrl\}`/);
    assert.match(source, /safePageText/);
    assert.doesNotMatch(source, /`Source URL: \$\{input\.sourceUrl\}`/);
    assert.doesNotMatch(source, /\binput\.pageText,\n\s*\]\.join/);
  }

  const undergradSource = fs.readFileSync(
    new URL('../server/src/scrapers/sources/labMicrositeUndergradLLMExtractor.ts', import.meta.url),
    'utf8',
  );
  assert.match(undergradSource, /import \{ redactDirectContactInfo \} from '\.\.\/\.\.\/utils\/contactRedaction'/);
  assert.match(undergradSource, /const safeGroupName = redactDirectContactInfo\(groupName\)\.slice\(0, 240\)/);
  assert.match(undergradSource, /const safeHomeUrl = redactDirectContactInfo\(homeUrl\)\.slice\(0, 2048\)/);
  assert.match(undergradSource, /redactDirectContactInfo\(homeText\) \|\| '\(empty\)'/);
  assert.match(undergradSource, /const safeSubPageUrl = redactDirectContactInfo\(subPageUrl\)\.slice\(0, 2048\)/);
  assert.match(undergradSource, /redactDirectContactInfo\(subPageText\)/);
  assert.match(undergradSource, /const safePageUrl = redactDirectContactInfo\(page\.url\)\.slice\(0, 2048\)/);
  assert.match(undergradSource, /redactDirectContactInfo\(page\.text\)/);
  assert.doesNotMatch(undergradSource, /parts\.push\(homeText \|\| '\(empty\)'\)/);
  assert.doesNotMatch(undergradSource, /parts\.push\(subPageText\)/);
  assert.doesNotMatch(undergradSource, /parts\.push\(page\.text\)/);
});

test('student decision LLM prompt redacts materialized evidence before provider calls', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/sources/studentDecisionLLMExtractor.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ redactDirectContactInfo \} from '\.\.\/\.\.\/utils\/contactRedaction'/);
  assert.match(source, /const MAX_PROMPT_TEXT_FIELD_LENGTH = 2000/);
  assert.match(source, /const MAX_PROMPT_URL_FIELD_LENGTH = 2048/);
  assert.match(source, /const safePromptText = \(value: unknown, maxLength = MAX_PROMPT_TEXT_FIELD_LENGTH\): string =>/);
  assert.match(source, /redactDirectContactInfo\(String\(value \|\| ''\)\)\.slice\(0, maxLength\)/);
  assert.match(source, /const safePromptUrl = \(value: unknown\): string =>/);
  assert.match(source, /compactSourceUrls\(candidate\)\.map\(\(url\) => safePromptUrl\(url\)\)/);
  assert.match(source, /safePromptText\(signal\.excerpt\)/);
  assert.match(source, /safePromptUrl\(signal\.sourceUrl\)/);
  assert.match(source, /safePromptText\(pathway\.studentFacingLabel\)/);
  assert.match(source, /safePromptUrl\(route\.url \|\| route\.sourceUrl\)/);
  assert.match(source, /safePromptUrl\(opportunity\.applicationUrl\)/);
  assert.match(source, /`Research entity: \$\{safePromptText\(candidate\.name, 240\)\}`/);
  assert.match(source, /`Description: \$\{safePromptText\(candidate\.description\)\}`/);
  assert.doesNotMatch(source, /`Research entity: \$\{candidate\.name\}`/);
  assert.doesNotMatch(source, /`Description: \$\{candidate\.description \|\| ''\}`/);
  assert.doesNotMatch(source, /signal\.excerpt \|\| ''/);
  assert.doesNotMatch(source, /route\.url \|\| route\.sourceUrl \|\| ''/);
});

test('rendered fetch process boundary constrains env-selected command and bridge inputs', () => {
  const source = fs.readFileSync(new URL('../server/src/scrapers/renderedFetch.ts', import.meta.url), 'utf8');

  assert.match(source, /const PYTHON_COMMAND_RE = \/\^python/);
  assert.match(source, /const RENDERED_FETCH_MODES = new Set\(\['dynamic', 'stealthy'\]\)/);
  assert.match(source, /const MAX_RENDERED_FETCH_SELECTOR_LENGTH = 256/);
  assert.match(source, /const normalizeRenderedPythonCommand = \(value: string\): string =>/);
  assert.match(source, /command\.includes\('\/'\) \|\| command\.includes\('\\\\'\)/);
  assert.match(source, /!PYTHON_COMMAND_RE\.test\(command\)/);
  assert.match(source, /return basename\(command\)/);
  assert.match(source, /const normalizeRenderedFetchBridgePath = \(value: string\): string =>/);
  assert.match(source, /basename\(bridgePath\) !== 'scraplingBridge\.py'/);
  assert.match(source, /const normalizeRenderedFetchMode = \(value: unknown\): 'dynamic' \| 'stealthy' =>/);
  assert.match(source, /const normalizeRenderedFetchSelector = \(value: unknown\): string \| undefined =>/);
  assert.match(source, /const pythonCommand = normalizeRenderedPythonCommand\(/);
  assert.match(source, /const bridgePath = normalizeRenderedFetchBridgePath\(/);
  assert.match(source, /normalizeRenderedFetchMode\(request\.mode \|\| defaultMode\)/);
  assert.match(source, /const waitSelector = normalizeRenderedFetchSelector\(request\.waitSelector\)/);
  assert.doesNotMatch(source, /const pythonCommand =\s*\n\s*options\.pythonCommand \|\| process\.env\.SCRAPLING_PYTHON_COMMAND \|\| 'python3'/);
  assert.doesNotMatch(source, /const bridgePath =\s*\n\s*options\.bridgePath \|\| process\.env\.SCRAPLING_BRIDGE_PATH \|\| DEFAULT_BRIDGE_PATH/);
});


test('service-layer search and materialization sync logs sanitize caught errors', () => {
  const files = [
    '../server/src/services/listingService.ts',
    '../server/src/services/entryPathwayService.ts',
    '../server/src/services/accessSignalService.ts',
    '../server/src/services/postedOpportunityService.ts',
    '../server/src/services/meiliSyncService.ts',
    '../server/src/services/contactRouteService.ts',
  ];

  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /import \{ sanitizeLogValue \} from '\.\.\/utils\/logSanitizer'/);
    assert.doesNotMatch(source, /console\.error\([^;\n]*,\s*error\)/);
    assert.doesNotMatch(source, /console\.error\([^;\n]*,\s*err\)/);
    assert.doesNotMatch(source, /console\.error\(error\)/);
    assert.doesNotMatch(source, /console\.error\(err\)/);
  }
});

test('external directory and course integrations sanitize fetch errors before logging', () => {
  const directorySource = fs.readFileSync(
    new URL('../server/src/services/directoryService.ts', import.meta.url),
    'utf8',
  );
  const courseTableSource = fs.readFileSync(
    new URL('../server/src/services/courseTableService.ts', import.meta.url),
    'utf8',
  );

  assert.match(directorySource, /import \{ sanitizeLogValue \} from '\.\.\/utils\/logSanitizer'/);
  assert.match(directorySource, /const MAX_DIRECTORY_QUERY_LENGTH = 120/);
  assert.match(directorySource, /const DIRECTORY_SEARCH_TYPES = new Set\(\['netid', 'name'\]\)/);
  assert.match(directorySource, /query\.trim\(\)\.replace\(\s*\/\\s\+\/g, ' '\)\.slice\(0, MAX_DIRECTORY_QUERY_LENGTH\)/);
  assert.match(directorySource, /const safeSearchType = DIRECTORY_SEARCH_TYPES\.has\(searchType\) \? searchType : 'netid'/);
  assert.match(directorySource, /params: \{ search: safeQuery, searchType: safeSearchType \}/);
  assert.match(directorySource, /params: \{ search: safeName \}/);
  assert.match(directorySource, /console\.error\('Directory lookup failed:', sanitizeLogValue\(error\)\)/);
  assert.doesNotMatch(directorySource, /Directory lookup for/);
  assert.doesNotMatch(directorySource, /error\.message/);

  assert.match(courseTableSource, /import \{ sanitizeLogValue \} from '\.\.\/utils\/logSanitizer'/);
  assert.ok(courseTableSource.includes('const COURSETABLE_SEASON_RE = /^\\d{4}(?:01|03)$/;'));
  assert.match(courseTableSource, /const MAX_COURSETABLE_PROFESSOR_NAME_LENGTH = 120/);
  assert.match(courseTableSource, /const normalizeCourseTableSeason = \(value: unknown\): string \| undefined =>/);
  assert.match(courseTableSource, /COURSETABLE_SEASON_RE\.test\(season\) \? season : undefined/);
  assert.match(courseTableSource, /const normalizeCourseTableProfessorName = \(value: unknown\): string \| undefined =>/);
  assert.match(courseTableSource, /slice\(0, MAX_COURSETABLE_PROFESSOR_NAME_LENGTH\)/);
  assert.match(courseTableSource, /const safeSeason = normalizeCourseTableSeason\(season\)/);
  assert.match(courseTableSource, /const safeProfessorName = normalizeCourseTableProfessorName\(professorName\)/);
  assert.match(courseTableSource, /`\$\{COURSETABLE_API\}\/\$\{safeSeason\}`/);
  assert.doesNotMatch(courseTableSource, /`\$\{COURSETABLE_API\}\/\$\{season\}`/);
  assert.match(courseTableSource, /console\.error\('CourseTable: Failed to fetch season:', sanitizeLogValue\(err\)\)/);
  assert.doesNotMatch(courseTableSource, /err\.message/);
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
  assert.match(source, /const parsedPageSize = pageSize === undefined \? undefined : compactPositiveInteger\(pageSize\)/);
  assert.match(source, /parsedPageSize === undefined \|\| parsedPageSize > MAX_VALIDATED_PAGE_SIZE/);
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

  assert.match(source, /import \{ requiresDeployedRuntimeSecurity \} from '\.\.\/utils\/environment'/);
  assert.match(source, /if \(!requiresDeployedRuntimeSecurity\(\) && sanitizedError\.stack\) \{/);
  assert.match(source, /console\.error\('Stack:', sanitizedError\.stack\)/);
  assert.match(source, /if \(res\.headersSent\) \{\s*return next\(error\);\s*\}/);
  assert.doesNotMatch(source, /console\.error\('Stack:', sanitizedError\.stack\);\n\n\s*if \(error instanceof NotFoundError\)/);
});

test('public research detail active listings redact direct contact text', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/researchGroupService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const publicString = \(value: unknown\): string \| undefined =>[\s\S]*redactDirectContactInfo/);
  assert.match(source, /const publicStringArray = \(values: unknown\): string\[\] =>[\s\S]*publicString\(value\)/);
  assert.match(source, /title: publicString\(listing\.title\)/);
  assert.match(source, /description: publicString\(listing\.description\)/);
  assert.match(source, /applicantDescription: publicString\(listing\.applicantDescription\)/);
  assert.match(source, /departments: publicStringArray\(listing\.departments\)/);
  assert.match(source, /researchAreas: publicStringArray\(listing\.researchAreas\)/);
  assert.match(source, /keywords: publicStringArray\(listing\.keywords\)/);
  assert.doesNotMatch(source, /description: listing\.description/);
  assert.doesNotMatch(source, /applicantDescription: listing\.applicantDescription/);
});

test('pathway application CTA only renders HTTP(S) URLs', () => {
  const source = fs.readFileSync(
    new URL('../client/src/components/research/PathwayActionCard.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ EXTERNAL_LINK_REL, safeHttpUrl, safeRouteSegment \} from '\.\.\/\.\.\/utils\/url'/);
  assert.match(source, /const applicationUrl = safeHttpUrl\(pathway\.activePostedOpportunity\?\.applicationUrl\)/);
  assert.match(source, /safeRouteSegment\(researchEntity\.slug\)/);
  assert.doesNotMatch(source, /safeUrl\(pathway\.activePostedOpportunity\?\.applicationUrl\)/);
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
  assert.match(urlSource, /const UNSAFE_RAW_URL_CHAR_RE = \/\[\\u0000-\\u0020\\u007f\\\\\]\//);
  assert.match(urlSource, /if \(UNSAFE_RAW_URL_CHAR_RE\.test\(trimmed\)\) return ''/);
  assert.match(serverUrlSafetySource, /const UNSAFE_RAW_PUBLIC_URL_CHAR_RE = \/\[\\u0000-\\u0020\\u007f\\\\\]\//);
  assert.match(serverUrlSafetySource, /if \(UNSAFE_RAW_PUBLIC_URL_CHAR_RE\.test\(trimmed\)\) return false/);
  assert.match(urlSource, /export const safeRouteSegment = \(raw: unknown\): string => \{/);
  assert.match(urlSource, /if \(trimmed === '\.' \|\| trimmed === '\.\.'\) return ''/);
  assert.match(urlSource, /\^%\(\?:2e\)\(\?:%\(\?:2e\)\)\?\$/i);
  assert.match(urlSource, /return encodeURIComponent\(trimmed\)/);
  assert.match(
    researchHomeCardSource,
    /const primaryProfileUrl = primaryLinkedEntity \? `\/research\/\$\{safeRouteSegment\(primaryLinkedEntity\.slug\)\}` : ''/,
  );
  assert.doesNotMatch(researchHomeCardSource, /`\/research\/\$\{primaryLinkedEntity\.slug\}`/);

  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, dynamicInternalRoutePattern, `${file} has raw dynamic route segment`);
  }
});

test('application and official-route CTAs use HTTP(S)-only URL helpers', () => {
  const opportunityDetail = fs.readFileSync(
    new URL('../client/src/pages/opportunityDetail.tsx', import.meta.url),
    'utf8',
  );
  const adminAccessReview = fs.readFileSync(
    new URL('../client/src/components/admin/AdminAccessReview.tsx', import.meta.url),
    'utf8',
  );
  const labDetail = fs.readFileSync(
    new URL('../client/src/pages/labDetail.tsx', import.meta.url),
    'utf8',
  );
  const fellowshipModal = fs.readFileSync(
    new URL('../client/src/components/fellowship/FellowshipModal.tsx', import.meta.url),
    'utf8',
  );

  assert.match(opportunityDetail, /const applicationUrl = safeHttpUrl\(opportunity\.applicationUrl\)/);
  assert.doesNotMatch(opportunityDetail, /safeUrl\(opportunity\.applicationUrl\)/);

  assert.match(adminAccessReview, /const applicationUrl = safeHttpUrl\(opportunity\.applicationUrl\)/);
  assert.doesNotMatch(adminAccessReview, /safeUrl\(opportunity\.applicationUrl\)/);

  assert.match(labDetail, /const officialRouteUrl = safeHttpUrl\(officialRoute\?\.url\)/);
  assert.doesNotMatch(labDetail, /const officialRouteUrl = safeUrl\(officialRoute\?\.url\)/);

  assert.match(fellowshipModal, /const applicationHref = safeHttpUrl\(fellowship\.applicationLink\)/);
  assert.doesNotMatch(fellowshipModal, /safeUrl\(fellowship\.applicationLink\)/);
  assert.match(fellowshipModal, /const linkHref = safeHttpUrl\(match\[2\]\)/);
  assert.match(fellowshipModal, /href: safeHttpUrl\(link\.url\)/);
  assert.doesNotMatch(fellowshipModal, /const linkHref = safeUrl\(match\[2\]\)/);
  assert.doesNotMatch(fellowshipModal, /href: safeUrl\(link\.url\)/);
  assert.match(fellowshipModal, /safeMailtoHref\(fellowship\.contactEmail\)/);
});

test('public research detail queries cap unauthenticated fan-out before serialization', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/researchGroupService.ts', import.meta.url),
    'utf8',
  );

  for (const constant of [
    'MAX_PUBLIC_DETAIL_MEMBERS',
    'MAX_PUBLIC_DETAIL_LISTINGS',
    'MAX_PUBLIC_DETAIL_ENTRY_PATHWAYS',
    'MAX_PUBLIC_DETAIL_ACCESS_SIGNALS',
    'MAX_PUBLIC_DETAIL_CONTACT_ROUTES',
    'MAX_PUBLIC_DETAIL_POSTED_OPPORTUNITIES',
    'MAX_PUBLIC_DETAIL_RELATIONSHIPS',
  ]) {
    assert.match(source, new RegExp(`const ${constant} = \\d+`));
    assert.match(source, new RegExp(`\\.limit\\(${constant}\\)`));
  }

  assert.doesNotMatch(
    source,
    /ResearchEntityRelationship\.find\(\{[^;]*?\}\)\.lean\(\)/,
  );
  assert.doesNotMatch(
    source,
    /Listing\.find\(\{ researchEntityId: \(group as any\)\._id, archived: false \}\)\.lean\(\)/,
  );
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
  assert.equal(packageJson.scripts['security:policy'], 'node --test scripts/security-preflight.test.mjs');
  assert.equal(
    packageJson.scripts['security:preflight'],
    'yarn security:policy && yarn security:secrets && yarn security:audit:production',
  );
  assert.equal(
    packageJson.scripts['install:all:immutable'],
    'yarn install --immutable && cd server && yarn install --immutable && cd ../client && yarn install --immutable',
  );
});

test('root package exposes the production security smoke used by deploy gates', () => {
  assert.equal(
    packageJson.scripts['security:smoke:production'],
    'node client/scripts/productionPromotionSmoke.mjs --api-base ${SMOKE_API_BASE:-https://yalelabs.io/api} --app-base ${SMOKE_APP_BASE:-https://yalelabs.io} --ui=false',
  );
});

test('production dependency audit covers root, server, and client workspaces', () => {
  assert.equal(
    packageJson.scripts['security:audit:production'],
    [
      'yarn npm audit --severity moderate --environment production',
      'yarn --cwd server npm audit --severity moderate --environment production',
      'yarn --cwd client npm audit --severity moderate --environment production',
    ].join(' && '),
  );
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

test('GitHub workflows run with read-only repository token permissions', () => {
  for (const [name, workflow] of [
    ['ci', ciWorkflow],
    ['keep-alive', keepAliveWorkflow],
    ['production-security-smoke', productionSecuritySmokeWorkflow],
  ]) {
    assert.match(
      workflow,
      /permissions:\s*\n\s*contents:\s*read/,
      `${name} workflow must pin GITHUB_TOKEN to read-only repository contents`,
    );
    assert.doesNotMatch(
      workflow,
      /contents:\s*write|pull-requests:\s*write|actions:\s*write|checks:\s*write|deployments:\s*write|id-token:\s*write/,
      `${name} workflow should not request write-capable token permissions`,
    );
  }
});

test('GitHub checkout steps do not persist repository credentials', () => {
  for (const [name, workflow] of [
    ['ci', ciWorkflow],
    ['production-security-smoke', productionSecuritySmokeWorkflow],
  ]) {
    const checkoutStep = /uses:\s*actions\/checkout@[^\n]+[\s\S]{0,160}?persist-credentials:\s*false/;
    assert.match(
      workflow,
      checkoutStep,
      `${name} workflow must disable checkout credential persistence`,
    );
    assert.doesNotMatch(
      workflow,
      /uses:\s*actions\/checkout@[^\n]+(?![\s\S]{0,160}?persist-credentials:\s*false)/,
      `${name} checkout must not leave GITHUB_TOKEN in local git config`,
    );
  }
});

test('Render production cron builds install dependencies from lockfiles', () => {
  assert.match(renderBlueprint, /buildCommand:\s*corepack enable && yarn install:all:immutable/);
  assert.doesNotMatch(renderBlueprint, /buildCommand:\s*corepack enable && yarn install:all(?:\s|$)/);
});

test('production security smoke workflow checks live hardening headers and current API routes', () => {
  assert.match(productionSecuritySmokeWorkflow, /name:\s*Production Security Smoke/);
  assert.match(productionSecuritySmokeWorkflow, /schedule:/);
  assert.match(productionSecuritySmokeWorkflow, /yarn security:smoke:production/);
  assert.match(productionSecuritySmokeWorkflow, /SMOKE_API_BASE:/);
  assert.match(productionSecuritySmokeWorkflow, /SMOKE_APP_BASE:/);
  assert.match(productionSecuritySmokeWorkflow, /SMOKE_EXPECT_COMMIT:\s*\$\{\{\s*inputs\.expect_commit \|\| github\.sha\s*\}\}/);
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
  assert.match(source, /"form-action 'self' https:\/\/secure\.its\.yale\.edu https:\/\/secure\.its\.yale\.edu\/cas"/);
  assert.doesNotMatch(source, /form-action[^"]*accounts\.google\.com/);
  assert.match(source, /"script-src-attr 'none'"/);
  assert.match(source, /X-XSS-Protection', '0'/);
  assert.match(source, /X-Download-Options', 'noopen'/);
  assert.match(source, /X-Permitted-Cross-Domain-Policies', 'none'/);
  assert.match(
    source,
    /requiresDeployedRuntimeSecurity\(\)[\s\S]*req\.secure[\s\S]*x-forwarded-proto/,
  );
  assert.match(
    source,
    /Strict-Transport-Security', 'max-age=31536000; includeSubDomains'/,
  );
});

test('served browser assets do not expose source maps or hidden static files', () => {
  const appSource = fs.readFileSync(new URL('../server/src/app.ts', import.meta.url), 'utf8');
  const tsupSource = fs.readFileSync(new URL('../server/tsup.config.ts', import.meta.url), 'utf8');

  assert.match(appSource, /function blockSourceMapAssetRequests\(req: express\.Request, res: express\.Response, next: express\.NextFunction\)/);
  assert.match(appSource, /req\.path\.endsWith\('\.map'\)/);
  assert.match(appSource, /res\.setHeader\('Cache-Control', 'no-store, private, max-age=0'\)/);
  assert.match(appSource, /res\.status\(404\)\.type\('text\/plain'\)\.send\('Not found'\)/);
  assert.match(appSource, /app\.use\(blockSourceMapAssetRequests\);[\s\S]*express\.static/);
  assert.match(appSource, /express\.static\(path\.join\(__dirname, '\.\.\/\.\.\/client\/dist'\), \{/);
  assert.match(appSource, /dotfiles: 'ignore'/);
  assert.match(appSource, /index: false/);
  assert.match(appSource, /function shouldServeSpaFallback\(req: express\.Request\): boolean/);
  assert.match(appSource, /segments\.some\(\(segment\) => segment\.startsWith\('\.'\)\)/);
  assert.match(appSource, /path\.extname\(lastSegment\)/);
  assert.match(appSource, /function sendStaticNotFound\(res: express\.Response\)/);
  assert.match(appSource, /return sendStaticNotFound\(res\)/);
  assert.doesNotMatch(appSource, /app\.use\(express\.static\(path\.join\(__dirname, '\.\.\/\.\.\/client\/dist'\)\)\)/);
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
  assert.match(guardSource, /const buildEntrypoint = path\.join\(serverRoot, 'build', 'index\.js'\)/);
  assert.match(guardSource, /const forbiddenBuildArtifacts = \[path\.join\(buildDir, 'index\.js\.map'\)\]/);
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

  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/\.\.\/utils\/idSerialization'/);
  assert.match(source, /_id: serializedDocumentId\(candidate\._id\) \|\| ''/);
  assert.doesNotMatch(source, /_id: String\(candidate\._id\)/);
  assert.doesNotMatch(source, /String\(candidate\._id\)/);
});

test('credentialed scraper backfills do not log raw caught error messages', () => {
  const files = [
    '../server/src/scripts/backfillResearchHomeOfficialUrls.ts',
    '../server/src/scripts/backfillResearchDescriptions.ts',
    '../server/src/scripts/backfillProfileBiosFromOfficialUrls.ts',
    '../server/src/scrapers/entityMaterializer.ts',
    '../server/src/scrapers/sources/arxivPreprintScraper.ts',
    '../server/src/scrapers/sources/europePmcPaperScraper.ts',
    '../server/src/scrapers/sources/crossrefPaperScraper.ts',
    '../server/src/scrapers/sources/orcidWorksScraper.ts',
    '../server/src/scrapers/sources/openAlexPaperScraper.ts',
    '../server/src/scrapers/sources/nihReporterScraper.ts',
    '../server/src/scrapers/sources/undergradFellowshipRecipientScraper.ts',
    '../server/src/scrapers/sources/centersInstitutesScraper.ts',
    '../server/src/scrapers/sources/departmentRosterScraper.ts',
    '../server/src/scrapers/sources/centerDirectorLLMExtractor.ts',
    '../server/src/scrapers/sources/centerAffiliationLLMExtractor.ts',
    '../server/src/scrapers/sources/studentDecisionLLMExtractor.ts',
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
    '../server/src/services/pathwaySearchIndexService.ts',
    '../server/src/scripts/staleObservationConflictReview.ts',
    '../server/src/scripts/betaDataQuality.ts',
    '../server/src/scripts/duplicateEntityNameReview.ts',
    '../server/src/scripts/acceptedInputsCore.ts',
  ];

  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /typeof value === 'object' && 'toString' in value/);
    assert.doesNotMatch(source, /\(value as \{ toString\(\): string \}\)\.toString\(\)/);
    assert.doesNotMatch(source, /value\.toString\(\)/);
  }
});

test('saved pathway account console logs avoid raw caught errors', () => {
  const source = fs.readFileSync(
    new URL('../client/src/components/accounts/SavedPathwaysSection.tsx', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(source, /console\.error\('Error reading saved research plans:',\s*err\)/);
  assert.doesNotMatch(source, /console\.error\('Error loading saved research plans:',\s*err\)/);
  assert.doesNotMatch(source, /console\.error\('Error loading saved research plans:',\s*planErr\)/);
  assert.doesNotMatch(source, /console\.error\('Error loading saved research-plan funding matches:',\s*matchErr\)/);
  assert.doesNotMatch(source, /console\.error\('Error saving research plan:',\s*err\)/);
  assert.doesNotMatch(source, /console\.error\('Error removing saved research plan:',\s*err\)/);
  assert.doesNotMatch(source, /console\.error\('Error exporting saved research plans:',\s*err\)/);
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
    '../client/src/pages/home.tsx',
    '../client/src/pages/fellowships.tsx',
    '../client/src/components/accounts/FavoritesManager.tsx',
  ];

  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /console\.error\([^;\n]*,\s*error\)/);
    assert.doesNotMatch(source, /console\.error\([^;\n]*,\s*err\)/);
  }
});

test('public search loaders avoid raw Axios console errors', () => {
  const files = [
    '../client/src/providers/SearchContextProvider.tsx',
    '../client/src/providers/FellowshipSearchContextProvider.tsx',
    '../client/src/hooks/useSearchCore.ts',
  ];

  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /console\.error\([^;\n]*,\s*error\)/);
    assert.doesNotMatch(source, /console\.error\([^;\n]*,\s*err\)/);
  }
});

test('account and profile client surfaces avoid raw caught console errors', () => {
  const files = [
    '../client/src/components/profile/PublicationsTable.tsx',
    '../client/src/components/accounts/ProfileEditor.tsx',
    '../client/src/pages/unknown.tsx',
    '../client/src/components/accounts/ListingForm/FormFields/ResearchAreaInput.tsx',
  ];

  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /console\.error\(err\)/);
    assert.doesNotMatch(source, /console\.error\([^;\n]*,\s*error\)/);
    assert.doesNotMatch(source, /console\.error\([^;\n]*,\s*err\)/);
  }
});

test('admin client surfaces avoid raw caught console errors', () => {
  const files = [
    '../client/src/pages/analytics.tsx',
    '../client/src/components/admin/AdminProfileEditModal.tsx',
    '../client/src/components/admin/AdminOperatorBoard.tsx',
    '../client/src/components/admin/AdminAccessReview.tsx',
    '../client/src/components/admin/AdminResearchAreas.tsx',
    '../client/src/components/admin/AdminListingEditModal.tsx',
    '../client/src/components/admin/AdminFellowshipsTable.tsx',
    '../client/src/components/admin/AdminFacultyProfilesTable.tsx',
    '../client/src/components/admin/AdminListingsTable.tsx',
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
  const source = fs.readFileSync(new URL('../server/src/routes/analytics.ts', import.meta.url), 'utf8');

  assert.match(source, /class AnalyticsRequestError extends Error/);
  assert.match(source, /error instanceof AnalyticsRequestError/);
  assert.match(source, /throw new AnalyticsRequestError\('Invalid analytics request'\)/);
  assert.doesNotMatch(source, /error instanceof Error \? error\.message/);
  assert.doesNotMatch(source, /message\.startsWith\('Invalid'\)/);
  assert.doesNotMatch(source, /json\(\{ error: error\.message \}\)/);
});

test('admin grant route error responses do not trust thrown message prefixes', () => {
  const routeSource = fs.readFileSync(new URL('../server/src/routes/admin.ts', import.meta.url), 'utf8');
  const serviceSource = fs.readFileSync(
    new URL('../server/src/services/adminGrantService.ts', import.meta.url),
    'utf8',
  );

  assert.match(serviceSource, /export class AdminGrantValidationError extends Error/);
  assert.match(serviceSource, /throw new AdminGrantValidationError\('Invalid admin grant request'\)/);
  assert.match(routeSource, /AdminGrantValidationError/);
  assert.match(routeSource, /error instanceof AdminGrantValidationError/);
  assert.doesNotMatch(routeSource, /message\.startsWith\('Invalid'\)/);
  assert.doesNotMatch(routeSource, /error instanceof Error \? error\.message/);
});

test('admin access-review route error responses do not trust thrown messages', () => {
  const routeSource = fs.readFileSync(new URL('../server/src/routes/admin.ts', import.meta.url), 'utf8');
  const serviceSource = fs.readFileSync(
    new URL('../server/src/services/adminAccessReviewService.ts', import.meta.url),
    'utf8',
  );

  assert.match(serviceSource, /export class AccessReviewRequestError extends Error/);
  assert.match(serviceSource, /throw new AccessReviewRequestError\('Search query is too long'\)/);
  assert.match(routeSource, /AccessReviewRequestError/);
  assert.match(routeSource, /error instanceof AccessReviewRequestError/);
  assert.doesNotMatch(routeSource, /error instanceof Error && error\.message === 'Search query is too long'/);
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
  assert.match(source, /express\.urlencoded\(\{\s*extended: false,\s*limit: API_BODY_LIMIT,\s*parameterLimit: API_URLENCODED_PARAMETER_LIMIT,/);
  assert.doesNotMatch(source, /\.set\('query parser', 'extended'\)/);
  assert.doesNotMatch(source, /express\.json\(\)/);
  assert.doesNotMatch(source, /express\.urlencoded\(\{ extended: false \}\)/);
});

test('public discovery endpoints have a narrower read limiter than general API traffic', () => {
  const source = fs.readFileSync(new URL('../server/src/app.ts', import.meta.url), 'utf8');

  assert.match(source, /const SAFE_RATE_LIMIT_METHODS = new Set\(\['GET', 'HEAD', 'OPTIONS'\]\)/);
  assert.match(source, /const WRITE_LIKE_SAFE_METHOD_API_PATHS = new Set<string>\(\)/);
  assert.match(source, /const shouldApplyWriteLimiter = \(req: express\.Request\): boolean =>/);
  assert.match(source, /WRITE_LIKE_SAFE_METHOD_API_PATHS\.has\(req\.path\) \|\| !SAFE_RATE_LIMIT_METHODS\.has\(req\.method\)/);
  assert.match(source, /const RATE_LIMIT_NETID_RE = \/\^\[A-Za-z0-9\]\{2,12\}\$\/;/);
  assert.match(source, /const normalizedRateLimitNetId = \(value: unknown\): string \| undefined =>/);
  assert.match(source, /if \(typeof value !== 'string'\) return undefined/);
  assert.match(source, /RATE_LIMIT_NETID_RE\.test\(normalized\) \? normalized : undefined/);
  assert.match(source, /normalizedRateLimitNetId\(user\?\.netId \?\? user\?\.netid\)/);
  assert.doesNotMatch(source, /return `user:\$\{user\.netId\}`/);
  assert.match(source, /const publicDiscoveryLimiter = rateLimit\(\{/);
  assert.match(source, /max: 300/);
  assert.match(source, /message: \{ error: 'Too many discovery requests, please try again later\.' \}/);
  assert.match(source, /\.use\('\/api', apiLimiter\)\s*\.use\('\/api\/research', publicDiscoveryLimiter\)\s*\.use\('\/api\/opportunities', publicDiscoveryLimiter\)/);
  assert.doesNotMatch(source, /req\.method === 'GET' \|\| req\.method === 'HEAD' \|\| req\.method === 'OPTIONS'/);
});

test('API responses default to private no-store cache headers', () => {
  const source = fs.readFileSync(new URL('../server/src/app.ts', import.meta.url), 'utf8');

  assert.match(source, /function setPrivateApiCacheHeaders\(_req: express\.Request, res: express\.Response, next: express\.NextFunction\)/);
  assert.match(source, /res\.setHeader\('Cache-Control', 'no-store, private, max-age=0'\)/);
  assert.match(source, /res\.setHeader\('Pragma', 'no-cache'\)/);
  assert.match(source, /res\.setHeader\('Surrogate-Control', 'no-store'\)/);
  assert.match(source, /res\.setHeader\('Expires', '0'\)/);
  assert.match(source, /res\.setHeader\('X-Content-Type-Options', 'nosniff'\)/);
  assert.match(source, /\.use\('\/api', setPrivateApiCacheHeaders\)\s*\.use\('\/api', csrfOriginGuard\(allowList/);
});

test('OAuth callback assets are served with no-store cache headers', () => {
  const source = fs.readFileSync(new URL('../server/src/app.ts', import.meta.url), 'utf8');
  const callbackHtmlSource = fs.readFileSync(
    new URL('../client/public/oauth-callback.html', import.meta.url),
    'utf8',
  );
  const callbackHtmlDistUrl = new URL('../client/dist/oauth-callback.html', import.meta.url);
  // dist/ is a build output; enforce the dist copy only when a build exists.
  const callbackHtmlDistSource = fs.existsSync(callbackHtmlDistUrl)
    ? fs.readFileSync(callbackHtmlDistUrl, 'utf8')
    : null;

  assert.match(source, /function setOAuthCallbackAssetCacheHeaders\(/);
  assert.match(source, /req\.path === '\/oauth-callback\.html' \|\| req\.path === '\/oauth-callback\.js'/);
  assert.match(source, /res\.setHeader\('Cache-Control', 'no-store, private, max-age=0'\)/);
  assert.match(source, /res\.setHeader\('Pragma', 'no-cache'\)/);
  assert.match(source, /res\.setHeader\('Surrogate-Control', 'no-store'\)/);
  assert.match(source, /res\.setHeader\('Expires', '0'\)/);
  assert.match(source, /res\.setHeader\('X-Content-Type-Options', 'nosniff'\)/);
  assert.match(source, /app\.use\(blockSourceMapAssetRequests\);\s*app\.use\(setOAuthCallbackAssetCacheHeaders\);\s*app\.use\(\s*express\.static/);
  for (const html of [callbackHtmlSource, callbackHtmlDistSource].filter(Boolean)) {
    assert.match(html, /<meta name="referrer" content="no-referrer">/);
    assert.match(html, /http-equiv="Content-Security-Policy"/);
    assert.match(html, /default-src 'none'/);
    assert.match(html, /script-src 'self'/);
    assert.match(html, /connect-src 'none'/);
    assert.match(html, /form-action 'none'/);
    assert.match(html, /<script src="\/oauth-callback\.js"><\/script>/);
    assert.doesNotMatch(html, /<script>[\s\S]*access_token/);
  }
});

test('seed route token gate rejects malformed and oversized tokens cheaply', () => {
  const source = fs.readFileSync(
    new URL('../server/src/routes/seed.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ validateNetid, validateObjectId \} from '\.\.\/middleware\/validation'/);
  assert.match(source, /import \{ isLocalDevelopmentRuntime \} from '\.\.\/utils\/environment'/);
  assert.match(source, /function requireLocalSeedRuntime/);
  assert.match(source, /if \(!isLocalDevelopmentRuntime\(\)\)/);
  assert.match(source, /return res\.status\(404\)\.json\(\{ error: 'Not found' \}\)/);
  assert.match(source, /router\.use\(setPrivateSeedCacheHeaders, requireLocalSeedRuntime, requireSeedToken\)/);
  assert.match(source, /res\.setHeader\('Surrogate-Control', 'no-store'\)/);
  assert.match(source, /res\.setHeader\('Expires', '0'\)/);
  assert.match(source, /res\.setHeader\('X-Content-Type-Options', 'nosniff'\)/);
  assert.match(source, /MIN_SEED_TOKEN_LENGTH = 16/);
  assert.match(source, /MAX_SEED_TOKEN_LENGTH = 256/);
  assert.match(source, /expected\.length < MIN_SEED_TOKEN_LENGTH/);
  assert.match(source, /expected\.length > MAX_SEED_TOKEN_LENGTH/);
  assert.match(source, /provided\.length < MIN_SEED_TOKEN_LENGTH/);
  assert.match(source, /provided\.length > MAX_SEED_TOKEN_LENGTH/);
  assert.match(source, /!tokensMatch\(provided, expected\)/);
  assert.match(source, /router\.put\('\/listings\/:id', validateObjectId\('id'\), async/);
  assert.match(source, /const SEED_NETID_RE = \/\^\[A-Za-z0-9\]\{2,12\}\$\//);
  assert.match(source, /const SEED_USER_FIELDS = \[/);
  assert.match(source, /const seedUserSummary = \(user: any\) => \(\{/);
  assert.match(source, /const seedListingSummary = \(listing: any\) => \(\{/);
  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /_id: serializedDocumentId\(user\?\._id\) \|\| ''/);
  assert.match(source, /_id: serializedDocumentId\(listing\?\._id\) \|\| ''/);
  assert.match(source, /const seedUserPayload = \(/);
  assert.match(source, /if \(!value \|\| typeof value !== 'object' \|\| Array\.isArray\(value\)\) return undefined/);
  assert.match(source, /if \(field === 'netid' && !options\.includeNetid\) continue/);
  assert.match(source, /const safeData = seedUserPayload\(req\.body, \{ includeNetid: true \}\)/);
  assert.match(source, /const safeData = seedUserPayload\(req\.body, \{ includeNetid: false \}\)/);
  assert.match(source, /createUser\(safeData\)/);
  assert.match(source, /user: seedUserSummary\(updated\)/);
  assert.match(source, /user: seedUserSummary\(user\)/);
  assert.match(source, /results: listings\.map\(seedListingSummary\)/);
  assert.match(source, /listing: seedListingSummary\(listing\)/);
  assert.doesNotMatch(source, /user\?\._id\?\.toString\?\.\(\)/);
  assert.doesNotMatch(source, /listing\?\._id\?\.toString\?\.\(\)/);
  assert.doesNotMatch(source, /createUser\(req\.body\)/);
  assert.doesNotMatch(source, /const \{ \.\.\.safeData \} = req\.body/);
  assert.doesNotMatch(source, /user: updated/);
  assert.doesNotMatch(source, /user \}/);
  assert.doesNotMatch(source, /results: listings \}/);
  assert.doesNotMatch(source, /listing \}/);
});

test('mounted API routes sanitize caught errors before logging', () => {
  const routeFiles = [
    '../server/src/routes/admin.ts',
    '../server/src/routes/analytics.ts',
    '../server/src/routes/config.ts',
    '../server/src/routes/fellowships.ts',
    '../server/src/routes/listings.ts',
    '../server/src/routes/programs.ts',
    '../server/src/routes/researchAreas.ts',
    '../server/src/routes/seed.ts',
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

test('account mutation analytics logs bounded normalized request fields', () => {
  const source = fs.readFileSync(new URL('../server/src/routes/users.ts', import.meta.url), 'utf8');

  assert.match(source, /const FAVORITE_ANALYTICS_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(source, /const MAX_FAVORITE_ANALYTICS_IDS = 100/);
  assert.match(source, /rawIds\.slice\(0, MAX_FAVORITE_ANALYTICS_IDS\)/);
  assert.match(source, /!FAVORITE_ANALYTICS_OBJECT_ID_RE\.test\(id\) \|\| seen\.has\(id\)/);
  assert.match(
    source,
    new RegExp(String.raw`const PROFILE_UPDATE_ANALYTICS_FIELD_RE = /\^\[A-Za-z0-9_-\]\{1,80\}\$/`),
  );
  assert.match(source, /const MAX_PROFILE_UPDATE_ANALYTICS_FIELDS = 50/);
  assert.match(source, /profileUpdateAnalyticsFields\(req\.body\)/);
  assert.match(source, /Object\.prototype\.hasOwnProperty\.call\(source, key\)/);
  assert.doesNotMatch(source, /return Array\.isArray\(value\) \? value : \[value\]/);
  assert.doesNotMatch(source, /fields: Object\.keys\(req\.body\)/);
});

test('admin access-review record updates allowlist record types at the route boundary', () => {
  const source = fs.readFileSync(new URL('../server/src/routes/admin.ts', import.meta.url), 'utf8');

  assert.match(source, /const ACCESS_REVIEW_RECORD_TYPES = new Set\(\[/);
  assert.match(source, /'entryPathway'/);
  assert.match(source, /'accessSignal'/);
  assert.match(source, /'contactRoute'/);
  assert.match(source, /'postedOpportunity'/);
  assert.match(source, /if \(!ACCESS_REVIEW_RECORD_TYPES\.has\(type\)\)/);
  assert.match(source, /return res\.status\(400\)\.json\(\{ error: 'Invalid review record type' \}\)/);
  assert.match(source, /type: type as any/);
});

test('admin access-review record update responses are minimized', () => {
  const source = fs.readFileSync(new URL('../server/src/routes/admin.ts', import.meta.url), 'utf8');

  const serializer = source.match(
    /export const adminAccessReviewRecordUpdateDto = \(record: any\) => \{[\s\S]*?\n\};/,
  );
  assert.ok(serializer, 'admin access-review record update serializer should exist');
  assert.match(source, /const MAX_ADMIN_ACCESS_REVIEW_NOTE_LENGTH = 2000/);
  assert.match(source, /const adminAccessReviewLockedFields = \(value: unknown\): string\[\] =>/);
  assert.match(source, /res\.json\(\{ record: adminAccessReviewRecordUpdateDto\(record\) \}\)/);
  assert.doesNotMatch(source, /res\.json\(\{ record \}\)/);
  assert.match(serializer[0], /_id: id/);
  assert.match(serializer[0], /archived: record\?\.archived === true/);
  assert.match(serializer[0], /status: typeof review\.status === 'string' \? review\.status : 'unreviewed'/);
  assert.match(serializer[0], /lockedFields: adminAccessReviewLockedFields\(review\.lockedFields\)/);
  assert.doesNotMatch(serializer[0], /reviewedByUserId/);
  assert.doesNotMatch(serializer[0], /sourceEvidence/);
  assert.doesNotMatch(serializer[0], /observationId/);
  assert.doesNotMatch(serializer[0], /evidenceItems/);
  assert.doesNotMatch(serializer[0], /sourceUrl/);
  assert.doesNotMatch(serializer[0], /email/);
  assert.doesNotMatch(serializer[0], /personName/);
});

test('admin access-review lock fields are bounded before persistence', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/adminAccessReviewService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /MAX_ACCESS_REVIEW_LOCKED_FIELDS = 100/);
  assert.match(source, /MAX_ACCESS_REVIEW_LOCK_FIELD_LENGTH = 120/);
  assert.match(source, /MAX_ACCESS_REVIEW_EVIDENCE_IDS = 100/);
  assert.ok(source.includes('const ACCESS_REVIEW_LOCK_FIELD_PATTERN = /^[A-Za-z0-9_.:-]+$/;'));
  assert.match(source, /export function normalizeAccessReviewObjectId\(id: unknown\): mongoose\.Types\.ObjectId \| null/);
  assert.match(source, /import \{ serializedDocumentId \} from '..\/utils\/idSerialization'/);
  assert.match(source, /const accessReviewDocumentId = \(value: unknown\): string => serializedDocumentId\(value\) \|\| ''/);
  assert.match(source, /typeof id === 'string'/);
  assert.match(source, /id instanceof mongoose\.Types\.ObjectId/);
  assert.match(source, /id\.toHexString\(\)/);
  assert.match(source, /if \(!\/\^\[a-f0-9\]\{24\}\$\/i\.test\(value\)\) return null/);
  assert.match(source, /accessReviewDocumentId\(row\._id\)/);
  assert.match(source, /records\.map\(\(record\) => accessReviewDocumentId\(record\._id\)\)/);
  assert.match(source, /accessReviewDocumentId\(obs\._id\)/);
  assert.match(source, /scrapeRunId: accessReviewDocumentId\(obs\.scrapeRunId\) \|\| undefined/);
  assert.match(source, /evidenceByRecordId\.get\(accessReviewDocumentId\(record\._id\)\)/);
  assert.match(source, /const id = accessReviewDocumentId\(group\._id\)/);
  assert.match(source, /export function normalizeAccessReviewLockedFields\(input: unknown\): string\[\] \| null/);
  assert.match(source, /field\.length > MAX_ACCESS_REVIEW_LOCK_FIELD_LENGTH/);
  assert.match(source, /!ACCESS_REVIEW_LOCK_FIELD_PATTERN\.test\(field\)/);
  assert.match(source, /normalized\.length >= MAX_ACCESS_REVIEW_LOCKED_FIELDS/);
  assert.match(source, /for \(const rawId of rawIds\.slice\(0, MAX_ACCESS_REVIEW_EVIDENCE_IDS\)\)/);
  assert.match(source, /const objectId = normalizeAccessReviewObjectId\(rawId\)/);
  assert.match(source, /const reviewerId = normalizeAccessReviewObjectId\(input\.reviewerId\)/);
  assert.match(source, /update\['review\.reviewedByUserId'\] = reviewerId/);
  assert.match(source, /const manuallyLockedFields = normalizeAccessReviewLockedFields\(fields\)/);
  assert.match(source, /update\['review\.lockedFields'\] = normalizeAccessReviewLockedFields\(input\.lockedFields\) \|\| \[\]/);
  assert.doesNotMatch(source, /mongoose\.Types\.ObjectId\.isValid\(String\(id\)\)/);
  assert.doesNotMatch(source, /new mongoose\.Types\.ObjectId\(String\(id\)\)/);
  assert.doesNotMatch(source, /mongoose\.Types\.ObjectId\.isValid\(String\(input\.reviewerId\)\)/);
  assert.doesNotMatch(source, /String\(row\._id\)/);
  assert.doesNotMatch(source, /String\(record\._id\)/);
  assert.doesNotMatch(source, /String\(obs\._id\)/);
  assert.doesNotMatch(source, /String\(obs\.scrapeRunId\)/);
  assert.doesNotMatch(source, /const id = String\(group\._id\)/);
});

test('research discovery write services reject object-shaped ids before Mongo upserts', () => {
  for (const [name, file, requiredGuard] of [
    ['entry pathway', '../server/src/services/entryPathwayService.ts', /if \(!researchEntityId\) return \{\}/],
    ['access signal', '../server/src/services/accessSignalService.ts', /if \(!researchEntityId\) return \{\}/],
    ['contact route', '../server/src/services/contactRouteService.ts', /if \(!researchEntityId\) return \{\}/],
    ['posted opportunity', '../server/src/services/postedOpportunityService.ts', /if \(!entryPathwayId\) return \{\}/],
  ]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /const STORED_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/, `${name} must use strict 24-hex id checks`);
    assert.match(source, /function toStoredId\(value\??: unknown\): unknown/, `${name} must normalize stored ids from unknown input`);
    assert.match(source, /value instanceof mongoose\.Types\.ObjectId/, `${name} must preserve real ObjectIds`);
    assert.match(source, /typeof value !== 'string'/, `${name} must reject object-shaped ids`);
    assert.match(source, /const id = value\.trim\(\)/, `${name} must trim string ids only`);
    assert.match(source, requiredGuard, `${name} must stop before upsert when required ids are invalid`);
    assert.doesNotMatch(source, /ObjectId\.isValid\(value\)/, `${name} must not pass arbitrary values to Mongoose id validation`);
    assert.doesNotMatch(source, /new mongoose\.Types\.ObjectId\(value\)/, `${name} must not construct ObjectIds from arbitrary values`);
  }
});

test('research discovery write service return ids use safe serialization', () => {
  for (const [name, file, returnPattern] of [
    ['entry pathway', '../server/src/services/entryPathwayService.ts', /pathwayId,\n\s*doc,/],
    ['access signal', '../server/src/services/accessSignalService.ts', /signalId: serializedDocumentId\(doc\?\._id\)/],
    ['contact route', '../server/src/services/contactRouteService.ts', /contactRouteId: serializedDocumentId\(doc\?\._id\)/],
  ]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/, `${name} must import the safe serializer`);
    assert.match(source, returnPattern, `${name} must serialize returned ids safely`);
    assert.doesNotMatch(source, /String\(doc\._id\)/, `${name} must not stringify returned document ids`);
    assert.doesNotMatch(source, /doc\?\._id \? String\(doc\._id\) : undefined/, `${name} must not conditionally stringify returned ids`);
  }
}
);

test('posted opportunity upsert and backfill ids use safe serialization', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/postedOpportunityService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /const entryPathwayId = serializedDocumentId\(doc\.entryPathwayId\)/);
  assert.match(source, /postedOpportunityId: serializedDocumentId\(doc\?\._id\)/);
  assert.match(source, /function idToString\(value\?: unknown\): string \| undefined \{\n\s*return serializedDocumentId\(value\);\n\}/);
  assert.match(source, /const pathwayId = idToString\(opportunity\.entryPathwayId\)/);
  assert.doesNotMatch(source, /(?:^|[^A-Za-z])String\(listing\._id/);
  assert.doesNotMatch(source, /(?:^|[^A-Za-z])String\(opportunity\.entryPathwayId/);
  assert.doesNotMatch(source, /(?:^|[^A-Za-z])String\(doc\._id/);
  assert.doesNotMatch(source, /(?:^|[^A-Za-z])String\(doc\.entryPathwayId/);
  assert.doesNotMatch(source, /typeof \(value as \{ toString\?: unknown \}\)\.toString/);
});

test('faculty ways-in backfill candidate ids use safe serialization', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/backfillFacultyWaysIn.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /researchEntityId: serializedDocumentId\(entity\._id\) \|\| ''/);
  assert.doesNotMatch(source, /researchEntityId: String\(entity\._id\)/);
  assert.doesNotMatch(source, /String\(entity\._id\)/);
});

test('posted opportunity upserts only persist public bounded URLs', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/postedOpportunityService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ publicHttpUrl \} from '\.\.\/utils\/urlSafety'/);
  assert.match(source, /const MAX_POSTED_OPPORTUNITY_SOURCE_URLS = 50/);
  assert.match(source, /function publicPostedOpportunityUrls\(values\??: unknown\): string\[\]/);
  assert.match(source, /values\.slice\(0, MAX_POSTED_OPPORTUNITY_SOURCE_URLS\)/);
  assert.match(source, /const applicationUrl = publicHttpUrl\(input\.applicationUrl\)/);
  assert.match(source, /const sourceUrls = publicPostedOpportunityUrls\(input\.sourceUrls\)/);
  assert.match(source, /applicationUrl,/);
  assert.match(source, /sourceUrls: \{ \$each: sourceUrls \}/);
  assert.doesNotMatch(source, /applicationUrl: input\.applicationUrl/);
  assert.doesNotMatch(source, /sourceUrls: \{ \$each: input\.sourceUrls \|\| \[\] \}/);
});

test('listing research entity profile sync bounds public URLs before persistence', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/listingResearchEntityProfile.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /MAX_LISTING_RESEARCH_ENTITY_PROFILE_URLS = 50/);
  assert.match(source, /const publicListingProfileUrls = \(values: unknown\[\]\): string\[\] =>/);
  assert.match(source, /uniqueStrings\(values\)\.filter\(isHttpUrl\)\.slice\(0, MAX_LISTING_RESEARCH_ENTITY_PROFILE_URLS\)/);
  assert.match(source, /const urls = publicListingProfileUrls\(\[/);
  assert.doesNotMatch(source, /const urls = uniqueStrings\(\[[\s\S]*\]\)\.filter\(isHttpUrl\)/);
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
  assert.match(source, /researchEntityId: serializedDocumentId\(row\._id\.researchEntityId\) \|\| ''/);
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

test('user identity dedupe apply IDs reject object-shaped values', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/dedupeUsersByIdentity.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const USER_IDENTITY_DEDUPE_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(source, /export function normalizeUserIdentityDedupeObjectId/);
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(source, /typeof value !== 'string'/);
  assert.match(source, /const trimmed = value\.trim\(\)/);
  assert.match(source, /const objectId = normalizeUserIdentityDedupeObjectId\(value\)/);
  assert.match(source, /serializedDocumentId\(member\._id\) \|\| ''/);
  assert.match(source, /serializedDocumentId\(row\._id\) \|\| ''/);
  assert.doesNotMatch(source, /ObjectId\.isValid/);
  assert.doesNotMatch(source, /new mongoose\.Types\.ObjectId\(value\)/);
  assert.doesNotMatch(source, /String\(member\._id\)/);
  assert.doesNotMatch(source, /String\(row\._id\)/);
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

test('paper authorship audit IDs reject object-shaped values', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/paperAuthorshipAudit.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const PAPER_AUTHORSHIP_AUDIT_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(source, /export function normalizePaperAuthorshipAuditObjectId/);
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(source, /typeof value !== 'string'/);
  assert.match(source, /const trimmed = value\.trim\(\)/);
  assert.match(source, /normalizePaperAuthorshipAuditObjectIdString\(rawUserId\)/);
  assert.match(source, /serializedDocumentId\(user\._id\)/);
  assert.doesNotMatch(source, /ObjectId\.isValid/);
  assert.doesNotMatch(source, /\bString\(rawUserId\)/);
  assert.doesNotMatch(source, /String\(user\._id\)/);
  assert.doesNotMatch(source, /new mongoose\.Types\.ObjectId\(userId\)/);
  assert.doesNotMatch(source, /new mongoose\.Types\.ObjectId\(id\)/);
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
  assert.match(source, /researchEntityId: serializedDocumentId\(member\.researchEntityId\) \|\| ''/);
  assert.match(source, /userId: serializedDocumentId\(member\.userId\)/);
  assert.match(source, /id: serializedDocumentId\(user\._id\) \|\| ''/);
  assert.doesNotMatch(source, /new mongoose\.Types\.ObjectId\(plan\.entityId\)/);
  assert.doesNotMatch(source, /String\(entity\._id\)/);
  assert.doesNotMatch(source, /String\(member\.researchEntityId\)/);
  assert.doesNotMatch(source, /String\(user\._id\)/);
});

test('listing profile repair IDs reject object-shaped values', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/repairListingResearchEntityProfiles.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const LISTING_PROFILE_REPAIR_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(source, /export function normalizeListingProfileRepairObjectId/);
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(source, /typeof value !== 'string'/);
  assert.match(source, /const trimmed = value\.trim\(\)/);
  assert.match(source, /normalizeListingProfileRepairObjectIdString/);
  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /\[serializedDocumentId\(entity\._id\) \|\| '', entity\]/);
  assert.match(source, /listingId: serializedDocumentId\(listing\._id\) \|\| ''/);
  assert.doesNotMatch(source, /ObjectId\.isValid/);
  assert.doesNotMatch(source, /String\(listing\.researchEntityId/);
  assert.doesNotMatch(source, /String\(entity\._id\)/);
  assert.doesNotMatch(source, /String\(listing\._id\)/);
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
  assert.match(source, /const withLeadSet = new Set\(withLead\.map\(\(id: any\) => serializedDocumentId\(id\) \|\| ''\)\)/);
  assert.match(source, /const centerId = serializedDocumentId\(doc\._id\) \|\| ''/);
  assert.match(source, /_id: centerId/);
  assert.match(source, /materializeInferredDirectorMembership\(\n\s*serializedDocumentId\(candidate\._id\) \|\| '',/);
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

  assert.match(source, /const DUPLICATE_ENTITY_NAME_REVIEW_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
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

test('pathway quality audit entity fan-out rejects object-shaped IDs', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/pathwayQualityAudit.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const PATHWAY_QUALITY_AUDIT_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(source, /export function normalizePathwayQualityAuditObjectId/);
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(source, /typeof value !== 'string'/);
  assert.match(source, /const trimmed = value\.trim\(\)/);
  assert.match(source, /normalizePathwayQualityAuditObjectId\(id\)/);
  assert.doesNotMatch(source, /ObjectId\.isValid/);
  assert.doesNotMatch(source, /new mongoose\.Types\.ObjectId\(id\)/);
});

test('research quality search review entity fan-out rejects object-shaped IDs', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/researchQualitySearchReview.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const RESEARCH_QUALITY_SEARCH_REVIEW_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
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

test('paper quality duplicate samples use safe id serialization', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/paperQualityService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /const paperQualityDocumentId = \(value: unknown\): string => serializedDocumentId\(value\) \|\| ''/);
  assert.match(source, /ownerId: paperQualityDocumentId\(group\._id\?\.owner\)/);
  assert.match(source, /id: paperQualityDocumentId\(link\._id\)/);
  assert.doesNotMatch(source, /ownerId: String\(group\._id\?\.owner \|\| ''\)/);
  assert.doesNotMatch(source, /id: String\(link\._id \|\| ''\)/);
});

test('profile scholarly-link synthetic ids avoid generic object coercion', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/profileService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /const scholarlyLinkIdSource =\s*serializedDocumentId\(doiUrl\) \|\|[\s\S]*?serializedDocumentId\(paper\.title\) \|\|[\s\S]*?'research-activity'/);
  assert.match(source, /_id: scholarlyLinkIdSource\s*\.toLowerCase\(\)/);
  assert.doesNotMatch(source, /_id: String\(\s*doiUrl \|\|/);
});

test('student visibility repair-target artifact ids use safe serialization', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/studentVisibilityRepairTargets.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /const recordId = serializedDocumentId\(doc\._id\) \|\| ''/);
  assert.match(source, /label: doc\.displayName \|\| doc\.name \|\| doc\.slug \|\| recordId/);
  assert.doesNotMatch(source, /recordId: String\(doc\._id\)/);
  assert.doesNotMatch(source, /String\(doc\._id\)/);
});

test('admin URL reachability helpers bound inputs before parsing or DNS work', () => {
  const source = fs.readFileSync(new URL('../server/src/routes/admin.ts', import.meta.url), 'utf8');

  assert.match(source, /export const MAX_ADMIN_URL_CHECK_URL_LENGTH = 2048/);
  assert.match(source, /const ADMIN_URL_CHECK_DISPLAY_CONTROL_RE = \/\[\\u0000-\\u001f\\u007f\]\/g/);
  assert.match(source, /const ADMIN_URL_CHECK_UNSAFE_INPUT_RE = \/\[\\u0000-\\u001f\\u007f\\s\\\\\]\/;/);
  assert.match(source, /const adminUrlCheckDisplayText = \(value: string\): string =>/);
  assert.match(source, /\.replace\(ADMIN_URL_CHECK_DISPLAY_CONTROL_RE, ''\)/);
  assert.match(source, /\.slice\(0, MAX_ADMIN_URL_CHECK_URL_LENGTH\)/);
  assert.match(source, /trimmed\.length === 0 \|\| trimmed\.length > MAX_ADMIN_URL_CHECK_URL_LENGTH/);
  assert.match(source, /const trimmedUrl = url\.trim\(\)/);
  assert.match(source, /trimmedUrl\.length === 0 \|\| url\.length > MAX_ADMIN_URL_CHECK_URL_LENGTH/);
  assert.match(source, /ADMIN_URL_CHECK_UNSAFE_INPUT_RE\.test\(trimmedUrl\)/);
  assert.match(source, /ADMIN_URL_CHECK_UNSAFE_INPUT_RE\.test\(trimmed\)/);
  assert.match(source, /Each URL must be a canonical HTTP\(S\) URL/);
  assert.match(source, /return \{ url: displayUrl, status: 0, reachable: false, error: 'URL too long' \}/);
  assert.doesNotMatch(source, /return url;\n\s*\}/);
});

test('admin routes use full private no-store response headers', () => {
  const source = fs.readFileSync(new URL('../server/src/routes/admin.ts', import.meta.url), 'utf8');

  assert.match(source, /function setPrivateAdminCacheHeaders\(_req: Request, res: Response, next: \(\) => void\)/);
  assert.match(source, /res\.setHeader\('Cache-Control', 'no-store, private, max-age=0'\)/);
  assert.match(source, /res\.setHeader\('Pragma', 'no-cache'\)/);
  assert.match(source, /res\.setHeader\('Surrogate-Control', 'no-store'\)/);
  assert.match(source, /res\.setHeader\('Expires', '0'\)/);
  assert.match(source, /res\.setHeader\('X-Content-Type-Options', 'nosniff'\)/);
  assert.match(source, /router\.use\(setPrivateAdminCacheHeaders, isAuthenticated, isAdmin\)/);
});

test('admin profile management payloads do not expose raw account state', () => {
  const routeSource = fs.readFileSync(new URL('../server/src/routes/admin.ts', import.meta.url), 'utf8');
  const tableSource = fs.readFileSync(
    new URL('../client/src/components/admin/AdminFacultyProfilesTable.tsx', import.meta.url),
    'utf8',
  );

  assert.match(routeSource, /export const adminProfileDto = \(user: any, includePublications = false\) => \{/);
  assert.match(routeSource, /const ADMIN_PROFILE_PUBLICATION_LIMIT = 500/);
  assert.match(routeSource, /profile\.publications = adminProfilePublications\(user\?\.publications\)/);
  assert.match(routeSource, /ownListingCount: ownListings\.length/);
  assert.match(routeSource, /profiles: profiles\.map\(\(profile\) => adminProfileDto\(profile\)\)/);
  assert.match(routeSource, /res\.json\(\{ profile: adminProfileDto\(user, true\) \}\)/);
  assert.match(routeSource, /res\.json\(\{ profile: adminProfileDto\(profile\) \}\)/);
  assert.doesNotMatch(routeSource, /User\.find\(filter\)[\s\S]*?\.select\('-publications'\)[\s\S]*?res\.json\(\{\s*profiles,/);
  assert.doesNotMatch(routeSource, /res\.json\(\{ profile \}\)/);
  assert.doesNotMatch(routeSource, /res\.json\(\{ profile: user \}\)/);
  assert.doesNotMatch(routeSource, /favListings:/);
  assert.doesNotMatch(routeSource, /favFellowships:/);
  assert.doesNotMatch(routeSource, /favPathways:/);
  assert.doesNotMatch(routeSource, /savedPathwayPlans:/);
  assert.doesNotMatch(routeSource, /confidenceByField:/);
  assert.doesNotMatch(routeSource, /manuallyLockedFields:/);
  assert.match(tableSource, /ownListingCount\?: number/);
  assert.match(tableSource, /\{p\.ownListingCount \|\| 0\}/);
  assert.doesNotMatch(tableSource, /ownListings\?: string\[\]/);
  assert.doesNotMatch(tableSource, /p\.ownListings\?\.length/);
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
  assert.match(source, /const normalized = typeof value === 'string' \? value\.trim\(\)\.toLowerCase\(\) : ''/);
  assert.match(source, /return ADMIN_ACTOR_NETID_RE\.test\(normalized\) \? normalized : ''/);
  assert.match(source, /adminActorNetid\(\(req\.user as any\)\?\.netId\) \|\| adminActorNetid\(\(req\.user as any\)\?\.netid\)/);
  assert.doesNotMatch(source, /String\(\(req\.user as any\)\?\.netId \|\| \(req\.user as any\)\?\.netid/);
  assert.match(source, /const ADMIN_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(source, /const adminPayloadId = \(value: unknown\): string => \{/);
  assert.match(source, /if \(typeof value === 'string'\) return value\.trim\(\)/);
  assert.match(source, /if \(typeof value === 'number' && Number\.isFinite\(value\)\) return String\(value\)/);
  assert.match(source, /if \(value instanceof mongoose\.Types\.ObjectId\) return value\.toHexString\(\)/);
  assert.doesNotMatch(source, /const adminPayloadId = \(value: any\): string => value\?\.toString\?\.\(\)/);
  assert.match(source, /export const normalizeAdminObjectId = \(value: unknown\): string \| undefined =>/);
  assert.match(source, /typeof value === 'string'/);
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(source, /return ADMIN_OBJECT_ID_RE\.test\(id\) \? id : undefined/);
  assert.match(source, /const safeId = normalizeAdminObjectId\(req\.params\.id\)/);
  assert.match(source, /updateListing\(safeId,/);
  assert.match(source, /deleteListing\(safeId\)/);
  assert.match(source, /new mongoose\.Types\.ObjectId\(safeId\)/);
  assert.match(source, /findById\(safeId\)/);
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
  assert.match(source, /rawValues\.length === 0 \|\| rawValues\.length > MAX_ADMIN_DEPARTMENT_CATEGORIES/);
  assert.match(source, /update\.name = normalizeAdminTaxonomyLabel\(name, 'research area name', MAX_RESEARCH_AREA_NAME_LENGTH\)/);
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

test('admin access-review evidence completeness only trusts safe source URLs', () => {
  const source = fs.readFileSync(
    new URL('../client/src/components/admin/AdminAccessReview.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /const hasSafeSourceUrl = \(value: unknown\): boolean => Boolean\(safeHttpUrl\(value\)\)/);
  assert.match(source, /const sourceUrls = Array\.isArray\(record\.sourceUrls\) \? record\.sourceUrls : \[\]/);
  assert.match(source, /sourceUrls\.some\(hasSafeSourceUrl\)/);
  assert.match(source, /hasSafeSourceUrl\(record\.sourceUrl\)/);
  assert.doesNotMatch(source, /\(record\.sourceUrls \|\| \[\]\)\.filter\(Boolean\)\.length > 0/);
  assert.doesNotMatch(source, /Boolean\(record\.sourceUrl\)/);
});

test('visibility release queue bounds admin query filters before Mongo work', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/studentVisibilityGateService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /MAX_RELEASE_QUEUE_FILTER_LENGTH = 120/);
  assert.match(source, /const normalizeReleaseQueueFilterValue = \(value: unknown\): string \| undefined =>/);
  assert.match(source, /trimmed\.length > MAX_RELEASE_QUEUE_FILTER_LENGTH/);
  assert.match(source, /const normalizeReleaseQueueStatus = \(value: unknown\): VisibilityReleaseQueueStatus =>/);
  assert.match(source, /visibilityReleaseQueueStatuses as readonly string\[\]/);
  assert.match(source, /filter\.status = normalizeReleaseQueueStatus\(input\.status\)/);
  assert.match(source, /const reason = normalizeReleaseQueueFilterValue\(input\.reason\)/);
  assert.match(source, /const sourceName = normalizeReleaseQueueFilterValue\(input\.sourceName\)/);
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
  const studentVisibilityBackfill = fs.readFileSync(
    new URL('../server/src/scripts/backfillStudentVisibilityTiers.ts', import.meta.url),
    'utf8',
  );
  const listingProfileRepair = fs.readFileSync(
    new URL('../server/src/scripts/repairListingResearchEntityProfiles.ts', import.meta.url),
    'utf8',
  );
  const publicationPointerRepair = fs.readFileSync(
    new URL('../server/src/scripts/repairOfficialProfilePublicationPointers.ts', import.meta.url),
    'utf8',
  );

  assert.match(guards, /export function resolveSafeJsonReportOutputPath/);
  assert.match(guards, /path\.extname\(resolved\)\.toLowerCase\(\) !== '\.json'/);
  assert.match(guards, /const tmpRoot = path\.resolve\(os\.tmpdir\(\)\)/);
  assert.match(guards, /const projectTmpRoot = path\.resolve\(process\.cwd\(\), 'tmp'\)/);
  assert.match(scraperCliOutput, /import \{ resolveSafeJsonReportOutputPath \} from '\.\.\/scripts\/scriptWriteGuards'/);
  assert.match(scraperCliOutput, /const resolvedPath = resolveSafeJsonReportOutputPath\(outputPath\)/);
  assert.match(integrityGate, /resolveSafeJsonReportOutputPath\(outputValue\)/);
  assert.match(integrityGate, /resolveSafeJsonReportOutputPath\(output\)/);
  assert.match(duplicateReview, /resolveSafeJsonReportOutputPath\(outputValue\)/);
  assert.match(duplicateReview, /resolveSafeJsonReportOutputPath\(output\)/);
  for (const source of [
    studentVisibilityBackfill,
    listingProfileRepair,
    publicationPointerRepair,
  ]) {
    assert.match(source, /resolveSafeJsonReportOutputPath/);
    assert.match(source, /const safeOutput = resolveSafeJsonReportOutputPath\(output\)/);
  }
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
  assert.match(source, /filter\.requestKey = \{ \$regex: `\^\$\{escapeRegex\(requestKeyPrefix\)\}` \}/);
  assert.doesNotMatch(source, /\$regex: `\^\$\{requestKeyPrefix\}`/);
});

test('shared search regex helper bounds terms and allowlists Mongo regex options', () => {
  const source = fs.readFileSync(
    new URL('../server/src/utils/regex.ts', import.meta.url),
    'utf8',
  );
  const opportunitiesRouteSource = fs.readFileSync(
    new URL('../server/src/routes/opportunities.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const SAFE_REGEX_OPTIONS = new Set\(\['i', 'm', 's', 'x'\]\)/);
  assert.match(source, /const normalizeRegexOptions = \(options: string\): string => \{/);
  assert.match(source, /SAFE_REGEX_OPTIONS\.has\(option\)/);
  assert.match(source, /return normalized \|\| 'i'/);
  assert.match(source, /escapeRegex\(input\.trim\(\)\.slice\(0, MAX_SEARCH_LEN\)\)/);
  assert.match(opportunitiesRouteSource, /import \{ asyncHandler, validateObjectId \} from '\.\.\/middleware\/index'/);
  assert.match(opportunitiesRouteSource, /router\.get\(\s*'\/:id',\s*setPublicDetailCacheHeaders,\s*validateObjectId\('id'\),\s*asyncHandler\(opportunityController\.getOpportunityById\),\s*\)/);
});

test('operator board gate artifact reads are constrained to safe JSON artifact paths', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/adminOperatorBoardService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ resolveSafeJsonReportOutputPath \} from '\.\.\/scripts\/scriptWriteGuards'/);
  assert.match(source, /const UNSAFE_ARTIFACT_PATH = '\[unsafe artifact path\]'/);
  assert.match(source, /const MAX_GATE_ARTIFACT_BYTES = 2 \* 1024 \* 1024/);
  assert.match(source, /function resolveGateArtifactReadPath\(artifactPath: string\): string \| undefined/);
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
  assert.match(source, /function operatorBoardDocumentId\(value: unknown\): string \{\s*return serializedDocumentId\(value\) \|\| '';\s*\}/);
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
    ['formalization review exceptions', '../server/src/scripts/acceptFormalizationReviewExceptions.ts'],
    ['accepted beta copy promotion', '../server/src/scripts/promoteAcceptedBetaCopy.ts'],
    ['student visibility gate', '../server/src/scripts/studentVisibilityGate.ts'],
    ['student visibility repair targets', '../server/src/scripts/studentVisibilityRepairTargets.ts'],
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
  assert.match(source, /const browseRankDocumentId = \(value: unknown\): string => serializedDocumentId\(value\) \|\| ''/);
  assert.match(source, /browseRankDocumentId\(member\.researchEntityId\) \|\| browseRankDocumentId\(member\.researchGroupId\)/);
  assert.match(source, /const key = browseRankDocumentId\(signal\.researchEntityId\)/);
  assert.match(source, /const id = browseRankDocumentId\(entity\._id\)/);
  assert.doesNotMatch(source, /String\(member\.researchEntityId \|\| member\.researchGroupId/);
  assert.doesNotMatch(source, /String\(signal\.researchEntityId/);
  assert.doesNotMatch(source, /String\(entity\._id\)/);
});

test('student visibility gate ObjectId model work is primitive-normalized', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/studentVisibilityGateService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /const studentVisibilityGateDocumentId = \(value: unknown\): string => serializedDocumentId\(value\) \|\| ''/);
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
  assert.match(source, /function normalizeLaunchAcquisitionObjectId\(value: unknown\): string \| undefined/);
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
  assert.match(source, /const evidenceCoverageDocumentId = \(value: unknown\): string => serializedDocumentId\(value\) \|\| ''/);
  assert.match(source, /const entityId = evidenceCoverageDocumentId\(observation\.entityId\)/);
  assert.match(source, /const id = evidenceCoverageDocumentId\(\(entity as any\)\._id\)/);
  assert.match(source, /const entityId = evidenceCoverageDocumentId\(first\.entityId\) \|\| undefined/);
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
  assert.match(source, /const materializerDocumentId = \(value: unknown\): string => serializedDocumentId\(value\) \|\| ''/);
  assert.match(source, /export function normalizeMaterializerObjectId\(value: unknown\): string \| undefined/);
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(source, /function toMaterializerObjectId\(value: unknown\): mongoose\.Types\.ObjectId \| undefined/);
  assert.match(source, /const userObjectId = toMaterializerObjectId\(userId\)/);
  assert.match(source, /const runObjectId = toMaterializerObjectId\(scrapeRunId\)/);
  assert.match(source, /const entityId = normalizeMaterializerObjectId\(identifier\.entityId\)/);
  assert.match(source, /const researchEntityId = normalizeMaterializerObjectId\(entity\._id\) \|\| ''/);
  assert.match(source, /entityId: materializerDocumentId\(entity\._id\)/);
  assert.match(source, /return user\?\._id \? materializerDocumentId\(user\._id\) \|\| null : null/);
  assert.match(source, /normalizeMaterializerObjectId\(member\.researchEntityId\)/);
  assert.match(source, /const userId = normalizeMaterializerObjectId\(user\._id\) \|\| ''/);
  assert.match(source, /entityId: materializerDocumentId\(source\._id\)/);
  assert.match(source, /const sourceResearchEntityId = normalizeMaterializerObjectId\(source\._id\) \|\| ''/);
  assert.match(source, /const targetResearchEntityId = normalizeMaterializerObjectId\(resolvedTarget\._id\) \|\| ''/);
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
  assert.match(source, /export function normalizeAccessMaterializerObjectId\(value: unknown\): string \| undefined/);
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(source, /const researchEntityObjectId = toAccessMaterializerObjectId\(researchEntityId\)/);
  assert.match(source, /ResearchEntity\.findById\(researchEntityObjectId/);
  assert.match(source, /researchEntityId: researchEntityObjectId/);
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

test('student-decision LLM candidate ids use safe serialization before provider egress', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/sources/studentDecisionLLMExtractor.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/\.\.\/utils\/idSerialization'/);
  assert.match(source, /const studentDecisionDocumentId = \(value: unknown\): string => serializedDocumentId\(value\) \|\| ''/);
  assert.match(source, /const key = studentDecisionDocumentId\(\(item as any\)\.researchEntityId\)/);
  assert.match(source, /_id: studentDecisionDocumentId\(row\._id\)/);
  assert.match(source, /signalsByEntity\.get\(studentDecisionDocumentId\(row\._id\)\)/);
  assert.doesNotMatch(source, /_id: String\(row\._id\)/);
  assert.doesNotMatch(source, /String\(row\._id\)/);
  assert.doesNotMatch(source, /String\(\(item as any\)\.researchEntityId \|\| ''\)/);
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
    assert.match(source, new RegExp(`export function ${helper}\\(value: unknown\\): string \\| undefined`), `${name} must expose a strict ObjectId normalizer`);
    assert.match(source, /value instanceof mongoose\.Types\.ObjectId/, `${name} must accept real ObjectIds`);
    assert.match(source, new RegExp(`\\.map\\(\\(value\\) => ${helper}\\(value\\)\\)`), `${name} must route only filters through the helper`);
    assert.doesNotMatch(source, /ObjectId\.isValid/, `${name} must not use permissive Mongoose ObjectId validation`);
    if (name === 'center director LLM' || name === 'center affiliation LLM') {
      assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/\.\.\/utils\/idSerialization'/, `${name} must import safe serializer`);
      assert.match(source, /_id: serializedDocumentId\(doc\._id\)/, `${name} must serialize candidate ids safely`);
      assert.doesNotMatch(source, /_id: doc\._id \? String\(doc\._id\) : undefined/, `${name} must not stringify candidate ids`);
    }
  }
}
);

test('exploratory pathway dedupe reviewed plan ids are primitive-normalized', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/dedupeExploratoryContactPathways.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /DEDUPE_EXPLORATORY_PATHWAY_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(
    source,
    /export function normalizeDedupeExploratoryContactPathwayObjectId\(value: unknown\): string \| undefined/,
  );
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(
    source,
    /const canonicalPathwayId = normalizeDedupeExploratoryContactPathwayObjectId\(plan\.canonicalPathwayId\)/,
  );
  assert.match(source, /\.map\(\(id\) => normalizeDedupeExploratoryContactPathwayObjectId\(id\)\)/);
  assert.doesNotMatch(source, /plan\.duplicatePathwayIds\.map\(\(id\) => new mongoose\.Types\.ObjectId\(id\)\)/);
  assert.doesNotMatch(source, /new mongoose\.Types\.ObjectId\(plan\.canonicalPathwayId\)/);
});

test('profile description conflict repair plan ids are primitive-normalized', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/repairProfileDescriptionBackfillConflicts.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /PROFILE_DESCRIPTION_CONFLICT_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(
    source,
    /export function normalizeProfileDescriptionConflictObjectId\(value: unknown\): string \| undefined/,
  );
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(
    source,
    /const keepObservationId = normalizeProfileDescriptionConflictObjectId\(plan\.keepObservationId\)/,
  );
  assert.match(source, /\.map\(\(id\) => normalizeProfileDescriptionConflictObjectId\(id\)\)/);
  assert.doesNotMatch(source, /plan\.supersedeObservationIds\.map\(\(id\) => new mongoose\.Types\.ObjectId\(id\)\)/);
  assert.doesNotMatch(source, /new mongoose\.Types\.ObjectId\(plan\.keepObservationId\)/);
});

test('archived artifact repair plan ids are primitive-normalized', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/repairArchivedEntityArtifacts.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /ARCHIVED_ARTIFACT_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(source, /export function normalizeArchivedArtifactObjectId\(value: unknown\): string \| undefined/);
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(source, /function objectId\(value: unknown\): mongoose\.Types\.ObjectId \| undefined/);
  assert.match(source, /const itemObjectId = objectId\(item\.id\)/);
  assert.match(source, /const canonicalObjectId = objectId\(item\.canonicalResearchEntityId\)/);
  assert.match(source, /const duplicateObjectId = objectId\(item\.duplicateId\)/);
  assert.match(source, /function stringId\(value: unknown\): string \{\s*return serializedDocumentId\(value\) \|\| '';\s*\}/);
  assert.doesNotMatch(source, /ObjectId\.isValid/);
  assert.doesNotMatch(source, /new mongoose\.Types\.ObjectId\(value\)/);
  assert.doesNotMatch(source, /typeof \(value as \{ toHexString\?: \(\) => string \}\)\.toHexString === 'function'/);
  assert.doesNotMatch(source, /\(value as \{ toHexString: \(\) => string \}\)\.toHexString\(\)/);
  assert.doesNotMatch(source, /return String\(value\)/);
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
  assert.match(source, /function objectId\(value: unknown\): mongoose\.Types\.ObjectId \| undefined/);
  assert.match(source, /\.map\(\(id\) => normalizeDuplicateAccessSignalObjectId\(id\)\)/);
  assert.match(source, /\.map\(\(id\) => objectId\(id\)\)/);
  assert.match(source, /function stringId\(value: unknown\): string \{\s*return serializedDocumentId\(value\) \|\| '';\s*\}/);
  assert.doesNotMatch(source, /ObjectId\.isValid/);
  assert.doesNotMatch(source, /typeof \(value as \{ toHexString\?: \(\) => string \}\)\.toHexString === 'function'/);
  assert.doesNotMatch(source, /\(value as \{ toHexString: \(\) => string \}\)\.toHexString\(\)/);
  assert.doesNotMatch(source, /return String\(value\)/);
});

test('maintenance and scraper id helpers do not execute duck-typed toHexString hooks', () => {
  const files = [
    '../server/src/scrapers/sources/labMicrositeDescriptionLLMExtractor.ts',
    '../server/src/scrapers/sources/officialProfilePiBackfillScraper.ts',
    '../server/src/scripts/backfillProfileBiosFromOfficialUrls.ts',
    '../server/src/scripts/profileBioCoverageAudit.ts',
    '../server/src/scripts/dedupeExploratoryContactPathways.ts',
    '../server/src/scripts/repairProfileDescriptionBackfillConflicts.ts',
    '../server/src/scripts/acceptedInputsCore.ts',
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
    assert.doesNotMatch(source, /typeof value === 'object' && typeof \(value as any\)\.toHexString === 'function'/);
    assert.doesNotMatch(source, /typeof value === 'object' && value !== null && 'toString' in value/);
    assert.doesNotMatch(source, /return \(value as any\)\.toHexString\(\)/);
    assert.doesNotMatch(source, /return String\(value\)/);
    assert.doesNotMatch(source, /return String\(value\)\.trim\(\)/);
  }
});

test('research entity member reference repair ids are primitive-normalized', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/researchEntityMemberReferenceAudit.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /MEMBER_REFERENCE_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(source, /export function normalizeMemberReferenceObjectId\(value: unknown\): string \| undefined/);
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(source, /\.map\(\(id\) => normalizeMemberReferenceObjectId\(id\)\)/);
  assert.match(source, /const replacementUserId = normalizeMemberReferenceObjectId\(item\.replacementUserId\)/);
  assert.match(source, /const replacementResearchEntityIdValue = normalizeMemberReferenceObjectId\(/);
  assert.match(source, /serializedDocumentId\(row\._id\) \|\| ''/);
  assert.match(source, /serializedDocumentId\(row\.userId\) \|\| ''/);
  assert.doesNotMatch(source, /ObjectId\.isValid/);
  assert.doesNotMatch(source, /String\(row\._id \|\| ''\)/);
  assert.doesNotMatch(source, /String\(row\.userId \|\| ''\)/);
});

test('student visibility backfill report and grouping ids use safe serialization', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/backfillStudentVisibilityTiers.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /serializedDocumentId\(row\._id\)/);
  assert.match(source, /serializedDocumentId\(entity\._id\)/);
  assert.match(source, /serializedDocumentId\(row\.userId\)/);
  assert.match(source, /serializedDocumentId\(row\.researchEntityId\)/);
  assert.match(source, /serializedDocumentId\(program\._id\)/);
  assert.doesNotMatch(source, /String\(row\._id\)/);
  assert.doesNotMatch(source, /String\(entity\._id\)/);
  assert.doesNotMatch(source, /String\(program\._id\)/);
  assert.doesNotMatch(source, /String\(row\.userId \|\| ''\)/);
  assert.doesNotMatch(source, /String\(row\.researchEntityId\)/);
});

test('audit planning and source seed artifacts are constrained to safe JSON roots', () => {
  for (const [name, file] of [
    ['research entity rename audit', '../server/src/scripts/auditResearchEntityRename.ts'],
    ['accepted inputs JSON report', '../server/src/scripts/acceptedInputs.ts'],
    ['department lead repair plan', '../server/src/scripts/departmentLeadRepairPlan.ts'],
    ['source registry seed', '../server/src/scrapers/seedSources.ts'],
    ['surname lab disambiguation', '../server/src/scripts/disambiguateSurnameLabNames.ts'],
    ['profile data quality audit', '../server/src/scripts/profileDataQualityAudit.ts'],
    ['member reference audit', '../server/src/scripts/researchEntityMemberReferenceAudit.ts'],
    ['member reference audit core', '../server/src/scripts/researchEntityMemberReferenceAuditCore.ts'],
  ]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /resolveSafeJsonReportOutputPath/, `${name} must use safe JSON paths`);
  }

  const departmentLeadRepairPlan = fs.readFileSync(
    new URL('../server/src/scripts/departmentLeadRepairPlan.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    departmentLeadRepairPlan,
    /resolveSafeJsonReportOutputPath\(expectPlanValue, '--expect-plan'\)/,
  );
  assert.match(
    departmentLeadRepairPlan,
    /const expectedPlanPath = resolveSafeJsonReportOutputPath\(options\.expectPlan, '--expect-plan'\)/,
  );
  assert.match(departmentLeadRepairPlan, /readFile\(expectedPlanPath, 'utf8'\)/);
  assert.doesNotMatch(departmentLeadRepairPlan, /readFile\(options\.expectPlan, 'utf8'\)/);
  assert.match(departmentLeadRepairPlan, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(departmentLeadRepairPlan, /id: serializedDocumentId\(entity\._id\) \|\| ''/);
  assert.match(departmentLeadRepairPlan, /entityId: serializedDocumentId\(observation\.entityId\)/);
  assert.match(departmentLeadRepairPlan, /id: serializedDocumentId\(user\._id\) \|\| ''/);
  assert.match(departmentLeadRepairPlan, /researchEntityId: serializedDocumentId\(member\.researchEntityId\) \|\| ''/);
  assert.match(departmentLeadRepairPlan, /userId: serializedDocumentId\(member\.userId\)/);
  assert.doesNotMatch(departmentLeadRepairPlan, /String\(entity\._id\)/);
  assert.doesNotMatch(departmentLeadRepairPlan, /String\(observation\.entityId\)/);
  assert.doesNotMatch(departmentLeadRepairPlan, /String\(user\._id\)/);
  assert.doesNotMatch(departmentLeadRepairPlan, /String\(member\.researchEntityId\)/);
});

test('faculty import input JSON is constrained before database import reads', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/importFaculty.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import os from 'os'/);
  assert.match(source, /MAX_FACULTY_IMPORT_JSON_BYTES = 25 \* 1024 \* 1024/);
  assert.match(source, /function resolveSafeFacultyImportJsonPath\(value: string\): string/);
  assert.match(source, /path\.extname\(resolved\)\.toLowerCase\(\) !== '\.json'/);
  assert.match(source, /const repoRoot = path\.resolve\(__dirname, '\.\.\/\.\.\/\.\.'\)/);
  assert.match(source, /const tmpRoot = path\.resolve\(os\.tmpdir\(\)\)/);
  assert.match(source, /const projectTmpRoot = path\.resolve\(repoRoot, 'tmp'\)/);
  assert.match(source, /fs\.existsSync\(resolved\)/);
  assert.match(source, /stat\.size > MAX_FACULTY_IMPORT_JSON_BYTES/);
  assert.match(source, /const jsonPath = resolveSafeFacultyImportJsonPath\(rawJsonPath\)/);
  assert.match(source, /fs\.readFileSync\(jsonPath, 'utf-8'\)/);
  assert.doesNotMatch(source, /JSON\.parse\(fs\.readFileSync\(process\.argv\[2\]/);
});

test('accepted-input CSV and TXT command artifacts stay under safe roots', () => {
  const cliSource = fs.readFileSync(
    new URL('../server/src/scripts/acceptedInputs.ts', import.meta.url),
    'utf8',
  );
  const fellowshipSource = fs.readFileSync(
    new URL('../server/src/acceptedInputs/fellowshipInputs.ts', import.meta.url),
    'utf8',
  );

  assert.match(fellowshipSource, /SAFE_ACCEPTED_INPUT_SEGMENT_RE/);
  assert.match(fellowshipSource, /export function resolveSafeAcceptedInputRoot/);
  assert.match(fellowshipSource, /export function resolveSafeAcceptedInputPath/);
  assert.match(fellowshipSource, /ACCEPTED_INPUT_FILE_EXTENSIONS = new Set\(\['\.csv', '\.txt'\]\)/);
  assert.match(fellowshipSource, /safeAcceptedInputSegment\(programKey, 'programKey'\)/);
  assert.match(fellowshipSource, /fs\.readFile\(resolveSafeAcceptedInputPath\(filePath\), 'utf8'\)/);
  assert.match(fellowshipSource, /const safePath = resolveSafeAcceptedInputPath\(filePath\)/);

  assert.match(cliSource, /resolveSafeAcceptedInputPath/);
  assert.match(cliSource, /resolveSafeAcceptedInputRoot/);
  assert.match(cliSource, /options\.root = resolveSafeAcceptedInputRoot\(options\.root\)/);
  assert.match(cliSource, /const safePath = resolveSafeAcceptedInputPath\(filePath, flag\)/);
  assert.match(cliSource, /await fs\.readFile\(safePath, 'utf8'\)/);
  assert.match(cliSource, /const safePath = resolveSafeAcceptedInputPath\(filePath, '--output'\)/);
  assert.match(cliSource, /await fs\.writeFile\(safePath, text, 'utf8'\)/);
});

test('manual fellowship recipient scraper inputs stay under safe local roots', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/sources/undergradFellowshipRecipientScraper.ts', import.meta.url),
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
  assert.match(source, /resolveSafeManualRecipientInputPath\(\s*manualRecipientCsvDir,\s*config\.programKey,\s*'\.csv'/);
  assert.match(source, /resolveSafeManualRecipientInputPath\(\s*manualRecipientPdfDir,\s*config\.programKey,\s*'\.pdf'/);
  assert.doesNotMatch(source, /path\.resolve\(\s*manualRecipientCsvDir,\s*`\$\{config\.programKey\}\.csv`/);
  assert.doesNotMatch(source, /path\.resolve\(\s*manualRecipientPdfDir,\s*`\$\{config\.programKey\}\.pdf`/);
});

test('duplicate review decision artifacts are constrained to safe JSON roots', () => {
  for (const [name, file] of [
    ['same PI dedupe', '../server/src/scripts/dedupeResearchEntitiesByPi.ts'],
    ['duplicate entity name review', '../server/src/scripts/duplicateEntityNameReview.ts'],
  ]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /resolveSafeJsonReportOutputPath/, `${name} must use the safe path resolver`);
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
    new URL('../server/src/scrapers/sources/labMicrositeDescriptionLLMExtractor.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/\.\.\/utils\/idSerialization'/);
  assert.match(source, /entityId: serializedDocumentId\(lab\._id\)/);
  assert.doesNotMatch(source, /entityId: lab\._id \? String\(lab\._id\) : undefined/);
  assert.doesNotMatch(source, /String\(lab\._id\)/);
});

test('observation conflict decision artifacts are constrained to safe JSON roots', () => {
  for (const [name, file] of [
    ['stale observation conflict review', '../server/src/scripts/staleObservationConflictReview.ts'],
    ['cross-source observation conflict review', '../server/src/scripts/crossSourceObservationConflictReview.ts'],
  ]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /resolveSafeJsonReportOutputPath/, `${name} must use the safe path resolver`);
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

  assert.match(source, /import \{ assertScriptApplyAllowed, resolveSafeJsonReportOutputPath \} from '\.\/scriptWriteGuards'/);
  assert.match(source, /const parseRequiredOutputPath = \(value: string \| undefined\): string =>\s*resolveSafeJsonReportOutputPath\(value\)/);
  assert.match(source, /const safeOutput = resolveSafeJsonReportOutputPath\(output\)/);
  assert.match(source, /function readJsonIfExists\(reportPath: string\): unknown \| undefined/);
  assert.match(source, /safeReportPath = resolveSafeJsonReportOutputPath\(reportPath, 'report path'\)/);
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
  assert.match(source, /SAFE_BARE_COMMAND_ARG = \/\^\[A-Za-z0-9_\.\:-\]\+\$\//);
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
    ['user identity dedupe core', '../server/src/scripts/dedupeUsersByIdentityCore.ts'],
    ['user identity dedupe wrapper', '../server/src/scripts/dedupeUsersByIdentity.ts'],
    ['mismatched email repair core', '../server/src/scripts/repairMismatchedPersonEmailsCore.ts'],
    ['mismatched email repair wrapper', '../server/src/scripts/repairMismatchedPersonEmails.ts'],
    ['user email hygiene core', '../server/src/scripts/userEmailHygieneCore.ts'],
    ['user email hygiene wrapper', '../server/src/scripts/userEmailHygiene.ts'],
    ['beta student analytics core', '../server/src/scripts/clearBetaStudentAnalyticsCore.ts'],
    ['beta student analytics wrapper', '../server/src/scripts/clearBetaStudentAnalytics.ts'],
  ]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /resolveSafeJsonReportOutputPath/, `${name} must use safe JSON paths`);
  }

  for (const file of [
    '../server/src/scripts/dedupeUsersByIdentity.ts',
    '../server/src/scripts/repairMismatchedPersonEmails.ts',
    '../server/src/scripts/userEmailHygiene.ts',
    '../server/src/scripts/clearBetaStudentAnalytics.ts',
  ]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /const safeOutput = resolveSafeJsonReportOutputPath\(output\)/);
    assert.match(source, /fs\.writeFileSync\(safeOutput,/);
  }
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
  assert.match(source, /if \(hasUnsafeMongoShape\(req\.body\) \|\| hasUnsafeMongoShape\(req\.query\)\)/);
  assert.match(source, /return res\.status\(400\)\.json\(\{ error: 'Invalid request payload' \}\)/);
  assert.match(source, /const cleaned = scrub\(val, depth \+ 1\)/);
  assert.match(source, /if \(cleaned !== undefined\) out\[key\] = cleaned/);
});

test('required body field validation ignores inherited prototype properties', () => {
  const source = fs.readFileSync(
    new URL('../server/src/middleware/validation.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const body = req\.body && typeof req\.body === 'object' \? req\.body : \{\}/);
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

test('user update service rejects unsafe Mongo update documents', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/userService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const USER_UPDATE_OPERATORS = new Set\(\['\$set', '\$unset', '\$addToSet'\]\)/);
  assert.match(source, /const USER_UPDATE_PATH_SEGMENT_RE = \/\^\[A-Za-z0-9_-\]\+\$\/;/);
  assert.match(source, /const assertSafeUserUpdateDocument = \(data: unknown\): Record<string, unknown> => \{/);
  assert.match(source, /if \(operatorKeys\.length !== keys\.length\)/);
  assert.match(source, /if \(!USER_UPDATE_OPERATORS\.has\(operator\)\)/);
  assert.match(source, /!isSafeUserUpdatePath\(path\) \|\| isUnsafeNestedUserUpdateValue\(value\)/);
  assert.match(source, /key\.startsWith\('\$'\) \|\|/);
  assert.match(source, /key\.includes\('\.'\) \|\|/);
  assert.match(source, /isPrototypePollutionKey\(key\)/);
  assert.match(source, /const safeData = assertSafeUserUpdateDocument\(data\)/);
  assert.match(source, /findByIdAndUpdate\(objectId, safeData/);
  assert.match(source, /findOneAndUpdate\(netidFilter, safeData/);
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
  assert.match(source, /const UNSAFE_BACKEND_ORIGIN_CHAR_RE = \/\[\\u0000-\\u0020\\u007f\\\\\]\//);
  assert.match(source, /trimmed\.length > MAX_BACKEND_ORIGIN_LENGTH/);
  assert.match(source, /UNSAFE_BACKEND_ORIGIN_CHAR_RE\.test\(trimmed\)/);
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
  assert.match(signInButton, /const MAX_CAS_RETURN_PATH_LENGTH = 2048/);
  assert.match(signInButton, /trimmed\.length > MAX_CAS_RETURN_PATH_LENGTH/);
  assert.match(signInButton, /const url = new URL\(trimmed, window\.location\.origin\)/);
  assert.match(signInButton, /url\.origin !== window\.location\.origin/);
  assert.match(signInButton, /buildApiUrl\(`\/cas\$\{redirectParam\}`\)/);
});

test('profile read routes validate netid path params before controller work', () => {
  const routeSource = fs.readFileSync(
    new URL('../server/src/routes/profiles.ts', import.meta.url),
    'utf8',
  );
  const controllerSource = fs.readFileSync(
    new URL('../server/src/controllers/profileController.ts', import.meta.url),
    'utf8',
  );

  assert.match(routeSource, /import \{ isAuthenticated, isProfessor, validateNetid \} from '\.\.\/middleware\/index'/);
  assert.match(
    routeSource,
    /router\.get\(\s*'\/:netid',\s*isAuthenticated,\s*validateNetid\('netid'\),[\s\S]*?getProfile,\s*\)/,
  );
  assert.match(routeSource, /router\.get\('\/:netid\/publications', isAuthenticated, validateNetid\('netid'\), getPublications\)/);
  assert.match(routeSource, /router\.get\('\/:netid\/listings', isAuthenticated, validateNetid\('netid'\), getProfileListings\)/);
  assert.match(routeSource, /router\.get\('\/:netid\/courses', isAuthenticated, validateNetid\('netid'\), getProfileCourses\)/);
  assert.match(controllerSource, /MAX_PUBLICATION_QUERY_PARAM_LENGTH = 16/);
  assert.match(controllerSource, /const POSITIVE_INTEGER_PARAM_RE = \/\^\[1-9\]\\d\*\$\/;/);
  assert.match(controllerSource, /typeof value !== 'string' && typeof value !== 'number'/);
  assert.match(controllerSource, /raw\.length > MAX_PUBLICATION_QUERY_PARAM_LENGTH/);
  assert.match(controllerSource, /Number\.isSafeInteger\(value\) && value > 0/);
  assert.match(controllerSource, /!POSITIVE_INTEGER_PARAM_RE\.test\(raw\)/);
  assert.match(controllerSource, /Number\.isSafeInteger\(parsed\) \? parsed : fallback/);
  assert.doesNotMatch(controllerSource, /parseInt\(raw, 10\)/);
  assert.doesNotMatch(controllerSource, /Number\.isFinite\(parsed\) && parsed > 0/);
  assert.match(controllerSource, /MAX_PUBLIC_PROFILE_URLS = 20/);
  assert.match(controllerSource, /values\.slice\(0, MAX_PUBLIC_PROFILE_URLS\)\.map\(publicHttpUrl\)/);
});

test('user service validates netids before building regex lookup filters', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/userService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const NETID_LOOKUP_RE = \/\^\[A-Za-z0-9\]\{2,12\}\$\//);
  assert.match(source, /const normalizeUserLookupNetid = \(id: unknown\): string =>/);
  assert.match(source, /if \(!NETID_LOOKUP_RE\.test\(netid\)\)/);
  assert.match(source, /throw badRequestError\('Invalid netid'\)/);
  assert.match(source, /escapeRegex\(normalizeUserLookupNetid\(id\)\)/);
  assert.doesNotMatch(source, /escapeRegex\(String\(id \?\? ''\)\)/);
});

test('saved pathway-plan routes validate pathway ids before controller work', () => {
  const source = fs.readFileSync(
    new URL('../server/src/routes/users.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ isAuthenticated, validateObjectId \} from '\.\.\/middleware\/index'/);
  assert.match(source, /'\/savedResearchPlanDetails\/:pathwayId'[\s\S]*isAuthenticated,[\s\S]*validateObjectId\('pathwayId'\),[\s\S]*userController\.updateSavedResearchPlanDetail/);
  assert.match(source, /'\/savedResearchPlanDetails\/:pathwayId'[\s\S]*isAuthenticated,[\s\S]*validateObjectId\('pathwayId'\),[\s\S]*userController\.deleteSavedResearchPlanDetail/);
  assert.match(source, /'\/favPathwayPlans\/:pathwayId'[\s\S]*isAuthenticated,[\s\S]*validateObjectId\('pathwayId'\),[\s\S]*userController\.updateSavedPathwayPlan/);
  assert.match(source, /'\/favPathwayPlans\/:pathwayId'[\s\S]*isAuthenticated,[\s\S]*validateObjectId\('pathwayId'\),[\s\S]*userController\.deleteSavedPathwayPlan/);
});

test('saved pathway-plan private-note export requires POST body opt-in', () => {
  const routeSource = fs.readFileSync(
    new URL('../server/src/routes/users.ts', import.meta.url),
    'utf8',
  );
  const controllerSource = fs.readFileSync(
    new URL('../server/src/controllers/userController.ts', import.meta.url),
    'utf8',
  );
  const clientSource = fs.readFileSync(
    new URL('../client/src/components/accounts/SavedPathwaysSection.tsx', import.meta.url),
    'utf8',
  );

  assert.match(routeSource, /router\.get\(\s*'\/savedResearchPlanDetails\/export'[\s\S]*?userController\.exportSavedResearchPlanDetails/);
  assert.match(routeSource, /router\.post\(\s*'\/savedResearchPlanDetails\/export'[\s\S]*?userController\.exportSavedResearchPlanDetails/);
  assert.match(routeSource, /router\.post\(\s*'\/favPathwayPlans\/export'[\s\S]*?userController\.exportSavedPathwayPlans/);
  assert.match(controllerSource, /request\.method === 'POST'[\s\S]*request\.body\.includePrivateNotes === true/);
  assert.doesNotMatch(controllerSource, /request\.query\.includePrivateNotes/);
  assert.match(clientSource, /axios\.post\(\s*'\/users\/savedResearchPlanDetails\/export',\s*\{ includePrivateNotes: true \}/);
  assert.doesNotMatch(clientSource, /params: includePrivateNotesInExport \? \{ includePrivateNotes: 'true' \}/);
});

test('public opportunity detail rejects malformed path ids before service work', () => {
  const source = fs.readFileSync(
    new URL('../server/src/controllers/opportunityController.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /MAX_OPPORTUNITY_ID_LENGTH = 24/);
  assert.match(source, /OPPORTUNITY_ID_PATTERN = \/\^\[a-fA-F0-9\]\{24\}\$\//);
  assert.match(source, /const normalizeOpportunityIdParam = \(value: unknown\): string \| undefined =>/);
  assert.match(source, /trimmed\.length !== MAX_OPPORTUNITY_ID_LENGTH/);
  assert.match(source, /OPPORTUNITY_ID_PATTERN\.test\(trimmed\)/);
  assert.match(source, /return response\.status\(400\)\.json\(\{ error: 'Invalid opportunity id' \}\)/);
  assert.match(source, /const detail = await getOpportunityDetail\(id\)/);
});

test('self-service listing writes sanitize public URLs and bound stored payloads', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/listingService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ publicHttpUrl \} from '\.\.\/utils\/urlSafety'/);
  assert.match(source, /const LISTING_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(source, /const MAX_LISTING_ID_READS = 100/);
  assert.match(source, /export function normalizeListingObjectId\(value: unknown\): string \| undefined/);
  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /const id = serializedDocumentId\(doc\._id\) \|\| serializedDocumentId\(doc\.id\)/);
  assert.match(source, /typeof value === 'string'/);
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(source, /return LISTING_OBJECT_ID_RE\.test\(id\) \? id : undefined/);
  assert.match(source, /const safeResearchEntityId = normalizeListingObjectId\(researchEntityId\)/);
  assert.match(source, /const ownerUserId = normalizeListingObjectId\(owner\?\._id\)/);
  assert.match(source, /const suppliedResearchEntityId = normalizeListingObjectId\(data\?\.researchEntityId \|\| data\?\.researchGroupId\)/);
  assert.doesNotMatch(source, /const suppliedResearchEntityId = data\?\.researchEntityId \|\| data\?\.researchGroupId/);
  assert.match(source, /const safeId = normalizeListingObjectId\(id\)/);
  assert.match(source, /const requestedIds = Array\.isArray\(ids\) \? ids : \[\]/);
  assert.match(source, /requestedIds\.slice\(0, MAX_LISTING_ID_READS\)/);
  assert.match(source, /getListingModel\(\)\.findById\(safeId\)/);
  assert.match(source, /getListingModel\(\)\.findByIdAndUpdate\(safeId, safeData/);
  assert.match(source, /getListingModel\(\)\.findByIdAndDelete\(safeId\)/);
  assert.match(source, /index\.deleteDocument\(safeId\)/);
  assert.match(source, /MAX_SELF_SERVICE_LISTING_DESCRIPTION_LENGTH/);
  assert.match(source, /MAX_SELF_SERVICE_LISTING_ARRAY_ITEMS/);
  assert.match(source, /MAX_SELF_SERVICE_LISTING_WEBSITES/);
  assert.match(source, /const sanitizeSelfServiceListingPayload = \(safeData: Record<string, any>\) => \{/);
  assert.match(source, /boundedListingWebsiteArray/);
  assert.match(source, /for \(const field of \['hiringStatus', 'commitment', 'type', 'compensationType'\]\)/);
  assert.match(source, /const established = boundedListingNumber\(safeData\.established\)/);
  assert.match(source, /const expiresAt = boundedListingDate\(safeData\.expiresAt\)/);
  assert.match(source, /value\s*\.slice\(0, MAX_SELF_SERVICE_LISTING_ARRAY_ITEMS\)\s*\.flatMap/);
  assert.match(source, /value\s*\.slice\(0, MAX_SELF_SERVICE_LISTING_WEBSITES\)\s*\.flatMap/);
  assert.match(source, /sanitizeSelfServiceListingPayload\(safeData\)/);
  assert.match(source, /url\.length <= MAX_SELF_SERVICE_LISTING_URL_LENGTH/);
  assert.doesNotMatch(source, /mongoose\.Types\.ObjectId\.isValid\(id\)/);
  assert.doesNotMatch(source, /doc\._id\.toString\(\)/);
  assert.doesNotMatch(source, /String\(doc\._id\)/);
  assert.doesNotMatch(source, /findById\(id\)/);
  assert.doesNotMatch(source, /findByIdAndUpdate\(id, safeData/);
  assert.doesNotMatch(source, /findByIdAndDelete\(id\)/);
});

test('self-editable profile writes cap arrays and URL maps before per-item normalization', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/profileService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /MAX_SELF_PROFILE_ARRAY_ITEMS/);
  assert.match(source, /MAX_SELF_PROFILE_URLS/);
  assert.match(source, /const SAFE_PROFILE_URL_KEY_RE = \/\^\[A-Za-z0-9 _-\]\{1,80\}\$\//);
  assert.match(source, /const isProfileUpdatePayload = \(value: unknown\): value is Record<string, unknown> =>/);
  assert.match(source, /if \(!isProfileUpdatePayload\(data\)\) \{/);
  assert.match(source, /throw selfProfileValidationError\('Invalid profile update payload'\)/);
  assert.match(source, /SAFE_PROFILE_URL_KEY_RE\.test\(normalized\)/);
  assert.match(source, /value\s*\.slice\(0, MAX_SELF_PROFILE_ARRAY_ITEMS\)\s*\.flatMap/);
  assert.match(source, /Object\.keys\(profileUrlsSource\)\s*\.slice\(0, MAX_SELF_PROFILE_URLS\)\s*\.flatMap/);
});

test('listing search bounds query and filter inputs before search work', () => {
  const source = fs.readFileSync(
    new URL('../server/src/controllers/listingController.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /MAX_LISTING_SEARCH_QUERY_LENGTH = 512/);
  assert.match(source, /MAX_LISTING_SEARCH_FILTER_VALUES = 50/);
  assert.match(source, /MAX_LISTING_SEARCH_FILTER_VALUE_LENGTH = 120/);
  assert.match(source, /MAX_LISTING_SEARCH_PAGINATION_PARAM_LENGTH = 16/);
  assert.match(source, /const POSITIVE_INTEGER_PARAM_RE = \/\^\[1-9\]\\d\*\$\/;/);
  assert.match(source, /typeof value !== 'string' && typeof value !== 'number'/);
  assert.match(source, /raw\.length > MAX_LISTING_SEARCH_PAGINATION_PARAM_LENGTH/);
  assert.match(source, /Number\.isSafeInteger\(value\) && value > 0/);
  assert.match(source, /!POSITIVE_INTEGER_PARAM_RE\.test\(raw\)/);
  assert.match(source, /Number\.isSafeInteger\(parsed\) \? parsed : undefined/);
  assert.doesNotMatch(source, /Number\.isFinite\(parsed\) \? parsed : undefined/);
  assert.match(source, /const boundedListingSearchQuery = \(value: unknown\): string =>/);
  assert.match(source, /const splitBoundedListingSearchParam = \(value: unknown, separator = ','\): string\[\] =>/);
  assert.match(source, /const trimmedQuery = boundedListingSearchQuery\(query\)/);
  assert.match(source, /index\.search\(trimmedQuery, searchParams\)/);
  assert.match(source, /splitBoundedListingSearchParam\(departments, '\|\|'\)/);
  assert.match(source, /splitBoundedListingSearchParam\(researchAreas\)/);
});

test('program and fellowship search bound query and filter inputs before search work', () => {
  const programController = fs.readFileSync(
    new URL('../server/src/controllers/programController.ts', import.meta.url),
    'utf8',
  );
  const fellowshipController = fs.readFileSync(
    new URL('../server/src/controllers/fellowshipController.ts', import.meta.url),
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

  assert.match(fellowshipController, /MAX_FELLOWSHIP_SEARCH_QUERY_LENGTH = 512/);
  assert.match(fellowshipController, /MAX_FELLOWSHIP_SEARCH_FILTER_VALUES = 50/);
  assert.match(fellowshipController, /MAX_FELLOWSHIP_SEARCH_FILTER_VALUE_LENGTH = 120/);
  assert.match(fellowshipController, /MAX_FELLOWSHIP_SEARCH_PAGINATION_PARAM_LENGTH = 16/);
  assert.match(fellowshipController, /const POSITIVE_INTEGER_PARAM_RE = \/\^\[1-9\]\\d\*\$\/;/);
  assert.match(fellowshipController, /typeof value !== 'string' && typeof value !== 'number'/);
  assert.match(fellowshipController, /raw\.length > MAX_FELLOWSHIP_SEARCH_PAGINATION_PARAM_LENGTH/);
  assert.match(fellowshipController, /Number\.isSafeInteger\(value\) && value > 0/);
  assert.match(fellowshipController, /!POSITIVE_INTEGER_PARAM_RE\.test\(raw\)/);
  assert.match(fellowshipController, /Number\.isSafeInteger\(parsed\) \? parsed : undefined/);
  assert.doesNotMatch(fellowshipController, /Number\.isFinite\(parsed\) \? parsed : undefined/);
  assert.match(fellowshipController, /query:\s*boundedSearchQuery\(query\)/);
  assert.match(fellowshipController, /yearOfStudy:\s*parseFilter\(yearOfStudy\)/);

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
  assert.match(fellowshipService, /const normalizeFellowshipObjectId = \(id: unknown\): string \| undefined =>/);
  assert.match(fellowshipService, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
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
  assert.match(fellowshipService, /const safeYearOfStudy = boundedSearchFilterValues\(yearOfStudy\)/);
  assert.match(fellowshipService, /filter\.\$text = \{ \$search: safeQuery \}/);
  assert.match(fellowshipService, /const adminFellowshipText = \(value: unknown\): string \| undefined =>/);
  assert.match(fellowshipService, /const adminFellowshipStringArray = \(value: unknown\): string\[\] \| undefined => \{/);
  assert.match(fellowshipService, /const adminFellowshipLinks = \(value: unknown\): Array<\{ label\?: string; url: string \}> \| undefined =>/);
  assert.match(fellowshipService, /if \('links' in update\) \{/);
  assert.match(fellowshipService, /if \('hoursPerWeek' in update\) \{/);
  assert.match(fellowshipService, /!isStudentVisibilityTier\(update\[field\]\)/);
  assert.match(fellowshipService, /!PROGRAM_CATEGORIES\.has\(update\.programCategory\)/);
  assert.match(fellowshipService, /normalizeFellowshipObjectId\(update\.studentVisibilityReviewedByUserId\)/);
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

test('fellowship application-cycle and matching evidence bound polluted record values', () => {
  const cycleService = fs.readFileSync(
    new URL('../server/src/services/fellowshipApplicationCycleEvidenceService.ts', import.meta.url),
    'utf8',
  );
  const matchingService = fs.readFileSync(
    new URL('../server/src/services/fellowshipMatchingService.ts', import.meta.url),
    'utf8',
  );

  assert.match(cycleService, /MAX_FELLOWSHIP_EVIDENCE_TEXT_LENGTH = 5000/);
  assert.match(cycleService, /MAX_FELLOWSHIP_EVIDENCE_ARRAY_ITEMS = 50/);
  assert.match(cycleService, /MAX_FELLOWSHIP_EVIDENCE_URLS = 50/);
  assert.match(cycleService, /typeof value !== 'string'/);
  assert.match(cycleService, /value\.slice\(0, MAX_FELLOWSHIP_EVIDENCE_ARRAY_ITEMS\)\.flatMap\(textPart\)/);
  assert.match(cycleService, /fellowship\.links\.slice\(0, MAX_FELLOWSHIP_EVIDENCE_URLS\)/);
  assert.match(cycleService, /if \(!value\) return undefined/);
  assert.match(cycleService, /if \(!\(value instanceof Date\) && typeof value !== 'string'\) return undefined/);

  assert.match(matchingService, /MAX_FELLOWSHIP_MATCH_TEXT_LENGTH = 5000/);
  assert.match(matchingService, /MAX_FELLOWSHIP_MATCH_ARRAY_ITEMS = 50/);
  assert.match(matchingService, /value\s*\.slice\(0, MAX_FELLOWSHIP_MATCH_ARRAY_ITEMS\)/);
  assert.match(matchingService, /values\.slice\(0, MAX_FELLOWSHIP_MATCH_ARRAY_ITEMS\)/);
  assert.match(matchingService, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(matchingService, /const fellowshipId = serializedDocumentId\(rawFellowshipId\) \|\| ''/);
  assert.doesNotMatch(matchingService, /typeof rawFellowshipId\?\.toHexString === 'function'/);
  assert.doesNotMatch(matchingService, /rawFellowshipId\.toHexString\(\)/);
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
  assert.match(researchGroupController, /import \{ hasAdminAuthorityForUser \} from '\.\.\/services\/adminGrantService'/);
  assert.match(researchGroupController, /const hasAdminAuthority = await hasAdminAuthorityForUser\(currentUser\)/);
  assert.match(researchGroupController, /includeNonPublic: hasAdminAuthority/);
  assert.match(researchGroupController, /lowQualityFirst: hasAdminAuthority && body\.browseQuality === 'low-first'/);
  assert.match(programController, /import \{ hasAdminAuthorityForUser \} from '\.\.\/services\/adminGrantService'/);
  assert.match(programController, /const hasAdminAuthority = await hasAdminAuthorityForUser\(currentUser\)/);
  assert.match(programController, /includeNonPublic: hasAdminAuthority/);
  assert.match(fellowshipController, /import \{ hasAdminAuthorityForUser \} from '\.\.\/services\/adminGrantService'/);
  assert.match(fellowshipController, /const hasAdminAuthority = await hasAdminAuthorityForUser\(currentUser\)/);
  assert.match(fellowshipController, /includeNonPublic: hasAdminAuthority/);
  assert.doesNotMatch(researchGroupController, /currentUser\?\.userType === 'admin'/);
  assert.doesNotMatch(programController, /currentUser\?\.userType === 'admin'/);
  assert.doesNotMatch(fellowshipController, /currentUser\?\.userType === 'admin'/);
});

test('rendered scraper fetch blocks cross-origin redirect content', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/renderedFetch.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ assertPublicHttpUrl, SsrfBlockedError, ssrfSafeAgents \} from '\.\/\.\.\/utils\/ssrfGuard'/);
  assert.match(source, /const defaultRenderedSeedRedirectCheck = \(/);
  assert.match(source, /method: 'GET'/);
  assert.match(source, /agent: url\.protocol === 'https:' \? agents\.httpsAgent : agents\.httpAgent/);
  assert.match(source, /if \(await seedRedirectCheck\(seedUrl, timeoutMs\)\)/);
  assert.match(source, /blockedReason: 'redirected-before-render'/);
  assert.match(source, /blockedReason: 'rendered-seed-preflight-failed'/);
  assert.match(source, /const seedUrl = await assertPublicHttpUrl\(request\.url\)/);
  assert.match(source, /finalUrl = await assertPublicHttpUrl\(renderedUrl\)/);
  assert.match(source, /if \(finalUrl\.origin !== seedUrl\.origin\)/);
  assert.match(source, /blockedReason: 'redirected-cross-origin'/);
  assert.match(source, /MAX_RENDERED_FETCH_TIMEOUT_MS = 30_000/);
  assert.match(source, /function boundedRenderedFetchTimeout/);
  assert.match(source, /const timeoutMs = boundedRenderedFetchTimeout\(request\.timeoutMs, defaultTimeoutMs\)/);
  assert.doesNotMatch(
    source,
    /url:\s*parsed\.url \|\| request\.url,\s*html:\s*parsed\.html \|\| ''/,
  );
});

test('official-profile publication pointer repair fetches through the shared SSRF guard', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/repairOfficialProfilePublicationPointers.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ assertPublicHttpUrl, ssrfSafeAgents \} from '\.\.\/utils\/ssrfGuard'/);
  assert.match(source, /const safeUrl = await assertPublicHttpUrl\(url\)/);
  assert.match(source, /const agents = ssrfSafeAgents\(\)/);
  assert.match(source, /axios\.get\(safeUrl\.toString\(\), \{/);
  assert.match(source, /httpAgent: agents\.httpAgent/);
  assert.match(source, /httpsAgent: agents\.httpsAgent/);
  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /id: serializedDocumentId\(row\._id\) \|\| ''/);
  assert.doesNotMatch(source, /axios\.get\(url,\s*\{/);
  assert.doesNotMatch(source, /rejectUnauthorized:\s*false/);
  assert.doesNotMatch(source, /id: String\(row\._id\)/);
});

test('official-profile PI backfill fetches through the shared SSRF guard before cache lookup', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/sources/officialProfilePiBackfillScraper.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ assertPublicHttpUrl, ssrfSafeAgents \} from '\.\.\/\.\.\/utils\/ssrfGuard'/);
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

  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/\.\.\/utils\/idSerialization'/);
  assert.match(source, /const officialProfileDocumentId = \(value: unknown\): string => serializedDocumentId\(value\) \|\| ''/);
  assert.match(source, /officialProfileDocumentId\(entity\._id\)/);
  assert.match(source, /officialProfileDocumentId\(member\.researchEntityId\)/);
  assert.doesNotMatch(source, /String\(entity\._id\)/);
  assert.doesNotMatch(source, /String\(member\.researchEntityId\)/);
});

test('department undergrad research scraper fetches configured pages through the shared SSRF guard', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/sources/departmentUndergradResearchScraper.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ assertPublicHttpUrl, ssrfSafeAgents \} from '\.\.\/\.\.\/utils\/ssrfGuard'/);
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
    new URL('../server/src/scrapers/sources/yaleCollegeFellowshipsOfficeScraper.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ assertPublicHttpUrl, ssrfSafeAgents \} from '\.\.\/\.\.\/utils\/ssrfGuard'/);
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

test('Yale Research official directory scraper fetches configured and paginated pages through the shared SSRF guard', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/sources/yaleResearchOfficialScraper.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ assertPublicHttpUrl, ssrfSafeAgents \} from '\.\.\/\.\.\/utils\/ssrfGuard'/);
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

  assert.match(source, /import \{ assertPublicHttpUrl, ssrfSafeAgents \} from '\.\.\/\.\.\/utils\/ssrfGuard'/);
  assert.match(source, /const safeUrl = await assertPublicHttpUrl\(url\)/);
  assert.match(source, /const safeUrlText = safeUrl\.toString\(\)/);
  assert.match(source, /const cacheKey = `page:\$\{safeUrlText\}`/);
  assert.match(source, /axios\.get\(safeUrlText, \{/);
  assert.match(source, /const safeDataUrl = await assertPublicHttpUrl\(dept\.dataUrl\)/);
  assert.match(source, /const safeDataUrlText = safeDataUrl\.toString\(\)/);
  assert.match(source, /const cacheKey = `data:\$\{safeDataUrlText\}:\$\{JSON\.stringify\(request\)\}`/);
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

  assert.match(source, /import \{ assertPublicHttpUrl, ssrfSafeAgents \} from '\.\.\/\.\.\/utils\/ssrfGuard'/);
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

  assert.match(source, /import \{ assertPublicHttpUrl, ssrfSafeAgents \} from '\.\.\/\.\.\/utils\/ssrfGuard'/);
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

  assert.match(source, /import \{ assertPublicHttpUrl, ssrfSafeAgents \} from '\.\.\/\.\.\/utils\/ssrfGuard'/);
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
    new URL('../server/src/scrapers/sources/undergradFellowshipRecipientScraper.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ assertPublicHttpUrl, ssrfSafeAgents \} from '\.\.\/\.\.\/utils\/ssrfGuard'/);
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

test('accepted-input source fetches are SSRF-guarded and response-size bounded', () => {
  const source = fs.readFileSync(
    new URL('../server/src/acceptedInputs/fellowshipInputs.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ assertPublicHttpUrl, ssrfSafeAgents \} from '\.\.\/utils\/ssrfGuard'/);
  assert.match(source, /const MAX_ACCEPTED_INPUT_FETCH_BYTES = 20_000_000/);
  assert.match(source, /const parsedUrl = await assertPublicHttpUrl\(url\)/);
  assert.match(source, /const \{ httpAgent, httpsAgent \} = ssrfSafeAgents\(\)/);
  assert.match(source, /axios\.get<ArrayBuffer>\(parsedUrl\.toString\(\), \{/);
  assert.match(source, /responseType: 'arraybuffer'/);
  assert.match(source, /maxRedirects: 5/);
  assert.match(source, /maxContentLength: MAX_ACCEPTED_INPUT_FETCH_BYTES/);
  assert.match(source, /maxBodyLength: MAX_ACCEPTED_INPUT_FETCH_BYTES/);
  assert.match(source, /httpAgent,/);
  assert.match(source, /httpsAgent,/);
  assert.match(source, /const MAX_ACCEPTED_INPUT_PDF_PAGES = 200/);
  assert.match(source, /const MAX_ACCEPTED_INPUT_PDF_TEXT_CHARS = 1_000_000/);
  assert.match(source, /if \(document\.numPages > MAX_ACCEPTED_INPUT_PDF_PAGES\)/);
  assert.match(source, /throw new Error\('Accepted-input PDF exceeds page limit'\)/);
  assert.match(source, /extractedChars \+= pageText\.length/);
  assert.match(source, /if \(extractedChars > MAX_ACCEPTED_INPUT_PDF_TEXT_CHARS\)/);
  assert.match(source, /throw new Error\('Accepted-input PDF exceeds text extraction limit'\)/);
  assert.doesNotMatch(source, /axios\.get<ArrayBuffer>\(url,\s*\{/);
});

test('LLM and profile fetchers use the normalized SSRF-safe URL for axios requests', () => {
  const fetcherFiles = [
    '../server/src/scrapers/sources/labMicrositeDescriptionLLMExtractor.ts',
    '../server/src/scrapers/sources/centerDirectorLLMExtractor.ts',
    '../server/src/scrapers/sources/centerAffiliationLLMExtractor.ts',
    '../server/src/scrapers/sources/labMicrositeUndergradLLMExtractor.ts',
    '../server/src/scripts/backfillProfileBiosFromOfficialUrls.ts',
    '../server/src/scripts/profileDataQualityAudit.ts',
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

test('profile data-quality audit ids use safe serialization for report grouping', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scripts/profileDataQualityAudit.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /\[serializedDocumentId\(entity\._id\) \|\| '', entity\]/);
  assert.match(source, /entityById\.get\(serializedDocumentId\(membership\.researchEntityId\) \|\| ''\)/);
  assert.match(source, /const key = serializedDocumentId\(membership\.userId\) \|\| ''/);
  assert.match(source, /_id: serializedDocumentId\(entity\._id\) \|\| ''/);
  assert.match(source, /homesByUserId\.get\(serializedDocumentId\(user\._id\) \|\| ''\)/);
  assert.doesNotMatch(source, /String\(entity\._id\)/);
  assert.doesNotMatch(source, /String\(membership\.researchEntityId\)/);
  assert.doesNotMatch(source, /String\(membership\.userId\)/);
  assert.doesNotMatch(source, /String\(user\._id\)/);
});

test('OpenAlex paper scraper fetches the public API through the shared SSRF guard', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/sources/openAlexPaperScraper.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ assertPublicHttpUrl, ssrfSafeAgents \} from '\.\.\/\.\.\/utils\/ssrfGuard'/);
  assert.match(source, /const safeUrl = await assertPublicHttpUrl\(url\)/);
  assert.match(source, /const safeUrlText = safeUrl\.toString\(\)/);
  assert.match(source, /const agents = ssrfSafeAgents\(\)/);
  assert.match(source, /axios\.get\(safeUrlText, \{/);
  assert.match(source, /maxRedirects: 5/);
  assert.match(source, /httpAgent: agents\.httpAgent/);
  assert.match(source, /httpsAgent: agents\.httpsAgent/);
  assert.doesNotMatch(source, /axios\.get\(url,\s*\{/);
  assert.doesNotMatch(source, /rejectUnauthorized:\s*false/);
});

test('publication scrapers serialize authorship user ids safely before observation emission', () => {
  for (const [name, file, pattern] of [
    [
      'Europe PMC',
      '../server/src/scrapers/sources/europePmcPaperScraper.ts',
      /userId: serializedDocumentId\(user\._id\) \|\| ''/,
    ],
    [
      'ORCID works',
      '../server/src/scrapers/sources/orcidWorksScraper.ts',
      /userId: serializedDocumentId\(user\._id\) \|\| ''/,
    ],
    [
      'OpenAlex',
      '../server/src/scrapers/sources/openAlexPaperScraper.ts',
      /userId: serializedDocumentId\(fac\._id\) \|\| ''/,
    ],
  ]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/\.\.\/utils\/idSerialization'/, `${name} must import safe serializer`);
    assert.match(source, pattern, `${name} must serialize authorship user id safely`);
    assert.doesNotMatch(source, /userId: String\((user|fac)\._id\)/, `${name} must not stringify user ids`);
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
  assert.match(source, /import \{ assertPublicHttpUrl, ssrfSafeAgents \} from '\.\.\/utils\/ssrfGuard'/);
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
  assert.match(source, /const UNSAFE_SSRF_PUBLIC_HTTP_URL_RE = \/\[\\u0000-\\u001f\\u007f\\s\\\\\]\/;/);
  assert.match(source, /const isAllowedPublicHttpPort = \(url: URL\): boolean =>/);
  assert.match(source, /if \(typeof rawUrl !== 'string'\)/);
  assert.match(source, /const trimmed = rawUrl\.trim\(\)/);
  assert.match(source, /if \(!trimmed \|\| trimmed\.length > MAX_SSRF_PUBLIC_HTTP_URL_LENGTH\)/);
  assert.match(source, /UNSAFE_SSRF_PUBLIC_HTTP_URL_RE\.test\(trimmed\)/);
  assert.match(source, /parsed = new URL\(trimmed\)/);
  assert.match(source, /if \(!isAllowedPublicHttpPort\(parsed\)\)/);
  assert.match(source, /throw new SsrfBlockedError\('URL port is not allowed'\)/);
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
  assert.doesNotMatch(source, /return Number\.isFinite\(minutes\) && minutes > 0 \? minutes \* 60_000 : 0/);
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

test('shared research-area creation normalizes labels and rejects direct contact info', () => {
  const source = fs.readFileSync(
    new URL('../server/src/routes/researchAreas.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ redactDirectContactInfo \} from '\.\.\/utils\/contactRedaction'/);
  assert.match(source, /const normalizeResearchAreaLabel = \(value: string\): string =>/);
  assert.match(source, /replace\(\/\[\\u0000-\\u001f\\u007f\]\/g, ' '\)/);
  assert.match(source, /const hasDirectContactInfo = \(value: string\): boolean => redactDirectContactInfo\(value\) !== value/);
  assert.match(source, /const trimmedName = normalizeResearchAreaLabel\(name\)/);
  assert.match(source, /Research area name cannot include contact information/);
});

test('pathway search service bounds direct Mongo search inputs', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/pathwaySearchService.ts', import.meta.url),
    'utf8',
  );
  const controllerSource = fs.readFileSync(
    new URL('../server/src/controllers/pathwayController.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /MAX_SEARCH_QUERY_LENGTH = 512/);
  assert.match(source, /MAX_FILTER_VALUES = 50/);
  assert.match(source, /MAX_FILTER_VALUE_LENGTH = 120/);
  assert.match(source, /const PATHWAY_SEARCH_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(source, /const sanitizePathwaySearchFilters = \(/);
  assert.match(source, /\.filter\(\(value\): value is string => typeof value === 'string'\)/);
  assert.match(source, /\.filter\(\(id\) => PATHWAY_SEARCH_OBJECT_ID_RE\.test\(id\)\)/);
  assert.match(source, /const filters = sanitizePathwaySearchFilters\(input\.filters \|\| \{\}\)/);
  assert.match(source, /const query = boundedSearchQuery\(input\.q\)/);
  assert.doesNotMatch(source, /Types\.ObjectId\.isValid\(id\)/);
  assert.match(controllerSource, /MAX_SEARCH_PAGINATION_PARAM_LENGTH = 16/);
  assert.match(controllerSource, /const POSITIVE_INTEGER_PARAM_RE = \/\^\[1-9\]\\d\*\$\/;/);
  assert.match(controllerSource, /\.filter\(\(item\): item is string => typeof item === 'string'\)/);
  assert.match(controllerSource, /typeof item !== 'string' \|\| item\.trim\(\)\.length > MAX_FILTER_VALUE_LENGTH/);
  assert.match(controllerSource, /typeof value !== 'string' && typeof value !== 'number'/);
  assert.match(controllerSource, /Number\.isSafeInteger\(value\) && value > 0/);
  assert.match(controllerSource, /!POSITIVE_INTEGER_PARAM_RE\.test\(rawValue\)/);
  assert.match(controllerSource, /Number\.isSafeInteger\(parsed\) \? parsed : fallback/);
  assert.doesNotMatch(controllerSource, /String\(item\)/);
  assert.doesNotMatch(controllerSource, /Number\.isFinite\(parsed\) && parsed > 0/);
});

test('public pathway search omits persistence timestamp metadata', () => {
  const controllerSource = fs.readFileSync(
    new URL('../server/src/controllers/pathwayController.ts', import.meta.url),
    'utf8',
  );
  const serviceSource = fs.readFileSync(
    new URL('../server/src/services/pathwaySearchService.ts', import.meta.url),
    'utf8',
  );
  const indexSource = fs.readFileSync(
    new URL('../server/src/services/pathwaySearchIndexService.ts', import.meta.url),
    'utf8',
  );
  const clientTypeSource = fs.readFileSync(
    new URL('../client/src/types/pathway.ts', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(controllerSource, /record\.sortBy === 'createdAt'/);
  assert.doesNotMatch(
    serviceSource,
    /sortBy\?: 'relevance' \| 'confidence' \| 'lastObservedAt' \| 'deadline' \| 'createdAt'/,
  );
  assert.doesNotMatch(serviceSource, /case 'createdAt':/);
  assert.doesNotMatch(serviceSource, /createdAt: raw\.createdAt/);
  assert.doesNotMatch(serviceSource, /return \{[^}]*createdAt: -1/s);
  assert.doesNotMatch(indexSource, /'createdAtTimestamp'/);
  assert.doesNotMatch(indexSource, /case 'createdAt':/);
  assert.doesNotMatch(indexSource, /createdAt: doc\.createdAt/);
  assert.doesNotMatch(indexSource, /createdAt: toIsoString\(record\.createdAt\)/);
  assert.doesNotMatch(clientTypeSource, /\| 'createdAt'/);
  assert.doesNotMatch(clientTypeSource, /createdAt\?: string/);
});

test('public pathway search does not expose research entity database ids', () => {
  const serviceSource = fs.readFileSync(
    new URL('../server/src/services/pathwaySearchService.ts', import.meta.url),
    'utf8',
  );
  const indexSource = fs.readFileSync(
    new URL('../server/src/services/pathwaySearchIndexService.ts', import.meta.url),
    'utf8',
  );

  assert.match(serviceSource, /const publicResearchEntityKey = \(entity: Record<string, any> \| undefined\): string =>/);
  assert.match(indexSource, /const publicResearchEntityKey =\s*doc\.entitySlug \|\| doc\.entityDisplayName \|\| doc\.entityName \|\| ''/);
  assert.doesNotMatch(serviceSource, /_id: String\(raw\.researchEntity\?\._id \|\| ''\)/);
  assert.doesNotMatch(indexSource, /_id: doc\.entityId \|\| ''/);
});

test('pathway search index ids use safe serialization', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/pathwaySearchIndexService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /const stringifyId = \(value: unknown\): string \| undefined => \{\n\s*return serializedDocumentId\(value\);\n\}/);
  assert.doesNotMatch(source, /typeof \(value as any\)\.toHexString === 'function'/);
  assert.doesNotMatch(source, /return \(value as any\)\.toHexString\(\)/);
});

test('Mongo pathway search result ids use safe serialization', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/pathwaySearchService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /const pathwaySearchDocumentId = \(value: unknown\): string => serializedDocumentId\(value\) \|\| ''/);
  assert.match(source, /_id: pathwaySearchDocumentId\(raw\._id\)/);
  assert.match(source, /_id: pathwaySearchDocumentId\(raw\.activePostedOpportunity\._id\)/);
  assert.doesNotMatch(source, /_id: String\(raw\._id\)/);
  assert.doesNotMatch(source, /_id: String\(raw\.activePostedOpportunity\._id\)/);
});

test('public pathway search hides research entity workflow metadata', () => {
  const controllerSource = fs.readFileSync(
    new URL('../server/src/controllers/pathwayController.ts', import.meta.url),
    'utf8',
  );
  const serviceSource = fs.readFileSync(
    new URL('../server/src/services/pathwaySearchService.ts', import.meta.url),
    'utf8',
  );
  const indexSource = fs.readFileSync(
    new URL('../server/src/services/pathwaySearchIndexService.ts', import.meta.url),
    'utf8',
  );
  const clientTypeSource = fs.readFileSync(
    new URL('../client/src/types/pathway.ts', import.meta.url),
    'utf8',
  );
  const serviceResearchEntityInterface = serviceSource.match(
    /export interface PathwaySearchResearchEntityHit \{[\s\S]*?\n\}/,
  );
  const mongoResearchEntitySerializer = serviceSource.match(
    /researchEntity: \{\s*_id: publicResearchEntityKey\(raw\.researchEntity\),[\s\S]*?websiteUrl: publicHttpUrl\(raw\.researchEntity\?\.websiteUrl \|\| raw\.researchEntity\?\.website\),\s*\}/,
  );
  const meiliResearchEntitySerializer = indexSource.match(
    /researchEntity: \{\s*_id: publicResearchEntityKey,[\s\S]*?websiteUrl: doc\.entityWebsiteUrl,\s*\}/,
  );

  assert.match(controllerSource, /const publicPathwayResearchEntity = \(/);
  assert.match(controllerSource, /delete \(publicEntity as \{ studentVisibilityTier\?: string \}\)\.studentVisibilityTier/);
  assert.match(controllerSource, /json\(publicPathwaySearchResult\(result\)\)/);
  assert.ok(serviceResearchEntityInterface, 'pathway research entity response interface should exist');
  assert.ok(mongoResearchEntitySerializer, 'Mongo pathway research entity serializer should exist');
  assert.ok(meiliResearchEntitySerializer, 'Meili pathway research entity serializer should exist');
  assert.doesNotMatch(serviceResearchEntityInterface[0], /studentVisibilityTier/);
  assert.doesNotMatch(mongoResearchEntitySerializer[0], /studentVisibilityTier/);
  assert.doesNotMatch(meiliResearchEntitySerializer[0], /studentVisibilityTier/);
  assert.match(indexSource, /entityStudentVisibilityTier: toStringValue\(researchEntity\.studentVisibilityTier\)/);
  assert.match(indexSource, /anyFilter\('entityStudentVisibilityTier', publicStudentVisibilityTiers\)/);
  assert.doesNotMatch(clientTypeSource, /studentVisibilityTier/);
});

test('public listing search omits persistence timestamp metadata', () => {
  const controllerSource = fs.readFileSync(
    new URL('../server/src/controllers/listingController.ts', import.meta.url),
    'utf8',
  );
  const searchProviderSource = fs.readFileSync(
    new URL('../client/src/providers/SearchContextProvider.tsx', import.meta.url),
    'utf8',
  );
  const sortDropdownSource = fs.readFileSync(
    new URL('../client/src/components/navbar/NavbarSortDropdown.tsx', import.meta.url),
    'utf8',
  );
  const homePageSource = fs.readFileSync(
    new URL('../client/src/pages/home.tsx', import.meta.url),
    'utf8',
  );
  const navbarSource = fs.readFileSync(
    new URL('../client/src/components/Navbar.tsx', import.meta.url),
    'utf8',
  );

  const publicSortFields = controllerSource.match(
    /const LISTING_SEARCH_SORT_FIELDS = new Set\(\[[\s\S]*?\]\);/,
  );
  assert.ok(publicSortFields, 'public listing sort allowlist should exist');
  assert.doesNotMatch(publicSortFields[0], /'createdAt'/);
  assert.doesNotMatch(publicSortFields[0], /'updatedAt'/);
  assert.doesNotMatch(controllerSource, /createdAt: listing\.createdAt/);
  assert.doesNotMatch(controllerSource, /updatedAt: listing\.updatedAt/);
  assert.doesNotMatch(controllerSource, /researchEntityId: listing\.researchEntityId/);
  assert.doesNotMatch(controllerSource, /researchGroupId: listing\.researchGroupId/);
  assert.doesNotMatch(controllerSource, /sortConfig\.push\(`createdAt:desc`\)/);
  assert.doesNotMatch(controllerSource, /new Date\(b\.createdAt \|\| 0\)/);
  assert.doesNotMatch(searchProviderSource, /'createdAt'/);
  assert.doesNotMatch(sortDropdownSource, /Date Added/);
  assert.doesNotMatch(sortDropdownSource, /ownerLastName/);
  assert.doesNotMatch(sortDropdownSource, /ownerFirstName/);
  assert.doesNotMatch(homePageSource, /quickFilter === 'recent'/);
  assert.doesNotMatch(homePageSource, /new Date\(l\.createdAt\)/);
  assert.doesNotMatch(navbarSource, /Recently Added/);
  assert.doesNotMatch(navbarSource, /value: 'recent'/);
});

test('pathway Meilisearch service bounds direct search inputs', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/pathwaySearchIndexService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /MAX_SEARCH_QUERY_LENGTH = 512/);
  assert.match(source, /MAX_FILTER_VALUES = 50/);
  assert.match(source, /MAX_FILTER_VALUE_LENGTH = 120/);
  assert.match(source, /const sanitizePathwayMeiliFilters = \(/);
  assert.match(source, /if \(typeof value !== 'string'\) continue/);
  assert.match(source, /const sanitizePathwayMeiliSearchInput = \(/);
  assert.match(source, /const safeInput = sanitizePathwayMeiliSearchInput\(input\)/);
  assert.match(source, /const filter = buildPathwayMeiliFilter\(safeInput\.filters\)/);
  assert.match(source, /const result = await index\.search\(safeInput\.q \|\| '', params\)/);
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
  assert.match(source, /export const normalizeResearchGroupObjectId = \(value: unknown\): string \| undefined =>/);
  assert.match(source, /typeof value === 'string'/);
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(source, /return RESEARCH_GROUP_OBJECT_ID_RE\.test\(id\) \? id : undefined/);
  assert.match(source, /const sanitizeResearchGroupSearchFilters = \(/);
  assert.match(source, /if \(typeof value !== 'string'\) continue/);
  assert.match(source, /const sanitizeResearchGroupSearchOptions = \(/);
  assert.match(controllerSource, /\.filter\(\(v\): v is string => typeof v === 'string'\)/);
  assert.match(controllerSource, /typeof item !== 'string' \|\| item\.trim\(\)\.length > MAX_FILTER_VALUE_LENGTH/);
  assert.match(controllerSource, /const parsePositiveIntegerParam = \(value: unknown, fallback: number\): number =>/);
  assert.match(controllerSource, /Number\.isSafeInteger\(value\) && value > 0/);
  assert.match(controllerSource, /!POSITIVE_INTEGER_PARAM_RE\.test\(raw\)/);
  assert.match(controllerSource, /Number\.isSafeInteger\(parsed\) \? parsed : fallback/);
  assert.match(controllerSource, /const requestedPage = parsePositiveIntegerParam\(body\.page, 1\)/);
  assert.match(controllerSource, /const requestedPageSize = parsePositiveIntegerParam\(body\.pageSize, DEFAULT_PAGE_SIZE\)/);
  assert.doesNotMatch(controllerSource, /String\(item\)/);
  assert.doesNotMatch(controllerSource, /Number\.isFinite\(Number\(body\.page\)\)/);
  assert.match(source, /const safeFilters = sanitizeResearchGroupSearchFilters\(filters \|\| \{\}\)/);
  assert.match(source, /const safeOptions = sanitizeResearchGroupSearchOptions\(options\)/);
  assert.match(source, /const trimmedQuery = boundedResearchSearchQuery\(query\)/);
  assert.match(source, /buildResearchGroupFilterString\(safeFilters\)/);
  assert.match(source, /\.map\(normalizeResearchGroupObjectId\)/);
  assert.match(source, /const safeEntityId = normalizeResearchGroupObjectId\(entityId\)/);
  assert.match(source, /const idEquals = \(left: unknown, right: unknown\): boolean => \{/);
  assert.doesNotMatch(source, /mongoose\.Types\.ObjectId\.isValid\(id\)/);
  assert.doesNotMatch(source, /mongoose\.Types\.ObjectId\.isValid\(String\(entityId/);
});

test('legacy research group public DTO ids use safe serialization', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/researchGroupService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /const researchGroupDocumentId = \(value: unknown\): string => serializedDocumentId\(value\) \|\| ''/);
  assert.match(source, /_id: researchGroupDocumentId\(entity\._id\)/);
  assert.match(source, /hasActiveListing: activeListingGroupIdSet\.has\(researchGroupDocumentId\(entity\._id\)\)/);
  assert.match(source, /accessSummary: accessSummaries\.get\(researchGroupDocumentId\(entity\._id\)\)/);
  assert.match(source, /_id: researchGroupDocumentId\(listing\._id\)/);
  assert.match(source, /id: researchGroupDocumentId\(listing\._id\)/);
  assert.match(source, /const key = researchGroupDocumentId\(member\.researchEntityId \|\| member\.researchGroupId\)/);
  assert.match(source, /leadMembersByEntityId\.get\(researchGroupDocumentId\(entity\._id\)\)/);
  assert.match(source, /\[researchGroupDocumentId\(entity\._id\), entity\]/);
  assert.match(source, /visibleEntitiesById\.has\(researchGroupDocumentId\(id\)\)/);
  assert.match(source, /researchGroupDocumentId\(route\?\._id\)\.startsWith\('derived-pi-outreach-'\)/);
  assert.match(source, /const fallbackKey = researchGroupDocumentId\(route\?\._id\) \|\| `route-\$\{index\}`/);
  assert.match(source, /researchGroupDocumentId\(a\?\._id\)\.localeCompare\(researchGroupDocumentId\(b\?\._id\)\)/);
  assert.match(source, /const key = \(researchGroupDocumentId\(lead\.user\?\._id\) \|\| name \|\| officialProfileUrl\)/);
  assert.match(source, /researchGroupDocumentId\(member\.user\._id\) \|\|/);
  assert.match(source, /researchGroupDocumentId\(candidate\.user\._id\) \|\|/);
  assert.doesNotMatch(source, /_id: String\(entity\._id\)/);
  assert.doesNotMatch(source, /id: String\(listing\._id\)/);
  assert.doesNotMatch(source, /String\(entity\._id\)/);
  assert.doesNotMatch(source, /String\(member\.researchEntityId/);
  assert.doesNotMatch(source, /(?:^|[^A-Za-z])String\(route\?\._id/);
  assert.doesNotMatch(source, /(?:^|[^A-Za-z])String\(lead\.user\?\._id/);
  assert.doesNotMatch(source, /(?:^|[^A-Za-z])String\(userKey\)/);
  assert.doesNotMatch(source, /(?:^|[^A-Za-z])String\(candidateUserKey\)/);
  assert.doesNotMatch(source, /activeListingGroupIds\.map\(\(id: any\) => String\(id\)\)/);
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
  assert.match(service, /export const normalizeResearchDetailSlug = \(value: unknown\): string \| undefined =>/);
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

test('config refresh is an admin-only no-store mutation while public config stays cacheable', () => {
  const source = fs.readFileSync(new URL('../server/src/routes/config.ts', import.meta.url), 'utf8');

  assert.match(source, /res\.set\('Cache-Control', 'public, max-age=300'\)/);
  assert.match(source, /res\.removeHeader\('Pragma'\)/);
  assert.match(source, /res\.removeHeader\('Surrogate-Control'\)/);
  assert.match(source, /res\.vary\('Origin'\)/);
  assert.match(source, /function setPrivateConfigRefreshCacheHeaders/);
  assert.match(source, /res\.setHeader\('Cache-Control', 'no-store, private, max-age=0'\)/);
  assert.match(source, /res\.setHeader\('Pragma', 'no-cache'\)/);
  assert.match(source, /res\.setHeader\('Surrogate-Control', 'no-store'\)/);
  assert.match(source, /res\.setHeader\('Expires', '0'\)/);
  assert.match(source, /res\.setHeader\('X-Content-Type-Options', 'nosniff'\)/);
  assert.match(
    source,
    /router\.post\(\s*'\/refresh',\s*setPrivateConfigRefreshCacheHeaders,\s*isAuthenticated,\s*isAdmin,/,
  );
});

test('authenticated research-area reads do not expose internal ids', () => {
  const source = fs.readFileSync(new URL('../server/src/routes/researchAreas.ts', import.meta.url), 'utf8');

  assert.match(source, /\.select\('name field -_id'\)/);
  assert.match(source, /res\.status\(200\)\.json\(\{ researchAreas: customAreas \}\)/);
  assert.doesNotMatch(source, /\.select\('name field'\)/);
});

test('analytics debug route does not expose raw analytics event documents', () => {
  const source = fs.readFileSync(
    new URL('../server/src/routes/analytics.ts', import.meta.url),
    'utf8',
  );
  const analyticsServiceSource = fs.readFileSync(
    new URL('../server/src/services/analyticsService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /\.select\('eventType userType timestamp'\)/);
  assert.match(source, /publicAnalyticsDebugEvent/);
  assert.match(source, /validateNetid\('netid'\)/);
  assert.doesNotMatch(source, /response\.json\(events\)/);
  assert.match(analyticsServiceSource, /ANALYTICS_NETID_RE = \/\^\[A-Za-z0-9\]\{2,12\}\$\//);
  assert.match(analyticsServiceSource, /const normalizedNetid = normalizeAnalyticsNetid\(netid\)/);
  assert.match(analyticsServiceSource, /userSummaryPipeline\(normalizedNetid/);
  assert.match(analyticsServiceSource, /escapeRegex\(normalizedNetid\)/);
});

test('analytics user drilldown sanitizes legacy event fields before response', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/analyticsService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const publicAnalyticsUserEvent = \(event: any\): AnalyticsUserEvent => \{/);
  assert.match(source, /const eventType = sanitizeAnalyticsEventType\(event\?\.eventType\) \|\| AnalyticsEventType\.VISITOR/);
  assert.match(source, /const listingId = normalizeAnalyticsStoredObjectIdString\(event\?\.listingId\)/);
  assert.match(source, /const fellowshipId = normalizeAnalyticsStoredObjectIdString\(event\?\.fellowshipId\)/);
  assert.match(source, /const searchQuery = sanitizeAnalyticsText\(event\?\.searchQuery\)/);
  assert.match(source, /const searchDepartments = sanitizeAnalyticsStringArray\(event\?\.searchDepartments\)/);
  assert.match(source, /const metadata = sanitizeAnalyticsMetadata\(event\?\.metadata\)/);
  assert.match(source, /events: events\.map\(publicAnalyticsUserEvent\)/);
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
    /export const getSearchQueryAnalytics[\s\S]*eventType: AnalyticsEventType\.SEARCH,[\s\S]*\.\.\.buildRangeTimestampMatch\(range\)/,
  );
  assert.doesNotMatch(
    source,
    /export const getSearchQueryAnalytics[\s\S]*if \(range\.start \|\| range\.end\)[\s\S]*match\.timestamp = \{\}/,
  );
});

test('analytics listing enrichment normalizes ObjectIds before lookup comparison', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/analyticsService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ Types, type PipelineStage \} from 'mongoose'/);
  assert.match(source, /const normalizeAnalyticsObjectIdString = \(value: unknown\): string \| undefined =>/);
  assert.match(source, /const normalizeAnalyticsStoredObjectIdString = \(value: unknown\): string \| undefined =>/);
  assert.match(source, /value instanceof Types\.ObjectId/);
  assert.match(
    source,
    /const trendingListingIds = engagement\.trendingListings[\s\S]*normalizeAnalyticsStoredObjectIdString\(t\.listingId\)[\s\S]*new Types\.ObjectId\(id\)/,
  );
  assert.match(source, /const trendingListingsById = new Map/);
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
  assert.match(source, /ANALYTICS_EVENT_TYPES = new Set<AnalyticsEventType>\(Object\.values\(AnalyticsEventType\)\)/);
  assert.match(source, /const sanitizeAnalyticsEventType = \(value: unknown\): AnalyticsEventType \| undefined =>/);
  assert.match(source, /const eventType = sanitizeAnalyticsEventType\(params\.eventType\)/);
  assert.match(source, /if \(!eventType\) \{\s*return;\s*\}/);
  assert.match(source, /ANALYTICS_NETID_RE = \/\^\[A-Za-z0-9\]\{2,12\}\$\//);
  assert.match(source, /ANALYTICS_NON_USER_NETIDS = new Set\(\['anonymous', 'unknown'\]\)/);
  assert.match(source, /const netid = normalizeAnalyticsEventNetid\(params\.netid\)/);
  assert.match(source, /const userType = sanitizeAnalyticsUserType\(params\.userType\)/);
  assert.match(source, /const sanitizeAnalyticsObjectId = \(value: unknown\): string \| undefined =>/);
  assert.match(source, /sanitizeAnalyticsMetadataKey/);
  assert.match(source, /trimmed === '__proto__'\s*\|\|\s*trimmed === 'constructor'\s*\|\|\s*trimmed === 'prototype'/);
  assert.match(source, /trimmed\.length > MAX_ANALYTICS_METADATA_KEY_LENGTH/);
  assert.match(source, /!ANALYTICS_METADATA_KEY_RE\.test\(trimmed\)/);
  assert.doesNotMatch(source, /replace\(\/\^\\\$\+\/, '_'\)\.replace\(\/\\\.\/g, '_'\)/);
  assert.match(source, /sanitizeAnalyticsMetadata/);
  assert.match(source, /searchQuery:\s*sanitizeAnalyticsText\(params\.searchQuery\)/);
  assert.match(source, /searchDepartments:\s*sanitizeAnalyticsStringArray\(params\.searchDepartments\)/);
  assert.match(source, /metadata:\s*sanitizeAnalyticsMetadata\(params\.metadata\)/);
  assert.match(source, /const listingId = sanitizeAnalyticsObjectId\(params\.listingId\)/);
  assert.match(source, /const fellowshipId = sanitizeAnalyticsObjectId\(params\.fellowshipId\)/);
  assert.doesNotMatch(source, /eventType:\s*normalizedParams\.eventType/);
  assert.match(source, /if \(listingId\) eventPayload\.listingId = listingId/);
  assert.match(source, /if \(fellowshipId\) eventPayload\.fellowshipId = fellowshipId/);
  assert.match(source, /User\.findOneAndUpdate\(\{ netid \}, updateFields\)/);
});

test('saved pathway plan checklist keys are safe before nested Mongo storage', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/userService.ts', import.meta.url),
    'utf8',
  );
  const controller = fs.readFileSync(
    new URL('../server/src/controllers/userController.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const sanitizeSavedPathwayChecklistKey = \(key: unknown\): string \| undefined => \{/);
  assert.match(source, /trimmed === '__proto__' \|\|/);
  assert.match(source, /trimmed === 'constructor' \|\|/);
  assert.match(source, /trimmed === 'prototype'/);
  assert.match(source, /replace\(\/\^\\\$\+\/, '_'\)\.replace\(\/\\\.\/g, '_'\)/);
  assert.match(source, /const normalizedKey = sanitizeSavedPathwayChecklistKey\(key\)/);
  assert.match(source, /MAX_SAVED_PATHWAY_NOTE_LENGTH = 5000/);
  assert.match(source, /!Array\.isArray\(candidate\.checklist\)/);
  assert.match(source, /let checklistCount = 0/);
  assert.match(source, /if \(checklistCount >= MAX_SAVED_PATHWAY_CHECKLIST_ITEMS\) break/);
  assert.match(source, /checklistCount \+= 1/);
  assert.match(source, /candidate\.note\.slice\(0, MAX_SAVED_PATHWAY_NOTE_LENGTH\)/);
  assert.match(source, /const MAX_SAVED_PATHWAY_PLAN_RESPONSE_ITEMS = 100/);
  assert.match(source, /export function sanitizeSavedPathwayPlansForResponse\(/);
  assert.match(source, /if \(count >= MAX_SAVED_PATHWAY_PLAN_RESPONSE_ITEMS\) break/);
  assert.match(source, /pathwayKey = normalizeObjectIdStringForUserMutation\(pathwayId, 'pathway'\)/);
  assert.match(source, /sanitized\[pathwayKey\] = sanitizeSavedPathwayPlanForStorage\(plan\)/);
  assert.match(source, /const savedPathwayPlans = sanitizeSavedPathwayPlansForResponse\(user\.savedPathwayPlans\)/);
  assert.match(source, /const visiblePathways = await getPathwaysByIds\(Object\.keys\(savedPathwayPlans\)\)/);
  assert.match(source, /return pruneSavedPathwayPlansForExistingPathways\(\s*savedPathwayPlans,\s*visiblePathways\.map\(\(pathway\) => pathway\._id\),\s*\)/);
  assert.doesNotMatch(source, /Object\.entries\(candidate\.checklist \|\| \{\}\)[\s\S]*\.slice\(0, MAX_SAVED_PATHWAY_CHECKLIST_ITEMS\)/);
  assert.doesNotMatch(source, /return user\.savedPathwayPlans \|\| \{\}/);
  assert.match(source, /const \[visiblePathway\] = await getPathwaysByIds\(\[pathwayKey\]\)/);
  assert.match(source, /if \(!visiblePathway\) \{\s*throw new NotFoundError\('Pathway not found'\)/);
  assert.match(source, /\[`savedPathwayPlans\.\$\{pathwayKey\}`\]: sanitized/);
  assert.match(source, /export function normalizeObjectIdStringForUserMutation/);
  assert.match(source, /typeof value === 'string'/);
  assert.match(source, /value instanceof mongoose\.Types\.ObjectId/);
  assert.match(source, /value\.toHexString\(\)/);
  assert.match(source, /throw badRequestError\(`Invalid \$\{fieldName\} id`\)/);
  assert.match(source, /if \(!Array\.isArray\(values\)\)/);
  assert.match(source, /const seen = new Set<string>\(\)/);
  assert.match(source, /if \(seen\.has\(id\)\) continue/);
  assert.match(source, /seen\.add\(id\)/);
  assert.match(source, /const normalizeStoredObjectIdsForUserMutation = \(/);
  assert.match(source, /values\.slice\(0, MAX_ACCOUNT_MUTATION_IDS\)/);
  assert.match(source, /const mergeStoredObjectIdsForUserMutation = \(/);
  assert.match(source, /const removeStoredObjectIdsForUserMutation = \(/);
  assert.match(source, /const storedObjectIdStringsForUserMutation = \(values: unknown, fieldName: string\): string\[\] =>/);
  assert.match(source, /import \{ sanitizeLogValue \} from '\.\.\/utils\/logSanitizer'/);
  assert.match(source, /const recordFavoriteCounterSideEffect = async \(/);
  assert.match(source, /console\.error\(`\$\{label\} failed:`, sanitizeLogValue\(error\)\)/);
  assert.match(source, /type FavoriteObjectIdArrayField = 'favListings' \| 'favFellowships' \| 'favPathways'/);
  assert.match(source, /const addFavoriteObjectIdIfMissing = async \(/);
  assert.match(source, /User\.findOneAndUpdate\(\s*\{ \.\.\.baseFilter, \[fieldName\]: \{ \$ne: value \} \},\s*\{ \$addToSet: \{ \[fieldName\]: value \} \}/);
  assert.match(source, /const removeFavoriteObjectIdIfPresent = async \(/);
  assert.match(source, /User\.findOneAndUpdate\(\s*\{ \.\.\.baseFilter, \[fieldName\]: value \},\s*\{ \$pull: \{ \[fieldName\]: value \} \}/);
  assert.match(source, /const removeFavoriteObjectIdsWithoutCounters = async \(/);
  assert.match(source, /\{ \$pull: \{ \[fieldName\]: \{ \$in: values \} \} \}/);
  assert.match(source, /const removeSavedPathwayIdsAndPlans = async \(/);
  assert.match(source, /\$pull: \{ favPathways: \{ \$in: values \} \}/);
  assert.match(source, /\.\.\.\(Object\.keys\(unset\)\.length > 0 \? \{ \$unset: unset \} : \{\}\)/);
  assert.match(source, /storedObjectIdStringsForUserMutation\(user\.favPathways, 'favPathways'\)/);
  assert.match(source, /readPublicListings/);
  assert.match(source, /const visibleListings = await readPublicListings\(listingIds\)/);
  assert.match(source, /const visibleListingIds = normalizeObjectIdsForUserMutation\(\s*visibleListings\.map\(\(listing\) => listing\._id\),\s*'favListings',\s*\)/);
  assert.match(source, /for \(const listingId of visibleListingIds\) \{\s*const result = await addFavoriteObjectIdIfMissing\(id, 'favListings', listingId\);[\s\S]*if \(!result\.added\) continue;[\s\S]*'Listing favorite counter increment'/);
  assert.doesNotMatch(source, /updateUser\(id, \{ favListings: user\.favListings \}\);[\s\S]*for \(const listingId of newVisibleListingIds\)/);
  assert.doesNotMatch(source, /for \(const listingId of newVisibleListingIds\) \{\s*await addFavorite\(listingId\.toHexString\(\), id\);\s*\}/);
  assert.doesNotMatch(source, /for \(const listingId of visibleListingIds\) \{\s*await addFavorite\(listingId\.toHexString\(\), id\);\s*\}/);
  assert.doesNotMatch(source, /mergeStoredObjectIdsForUserMutation\(\s*user\.favListings,\s*visibleListingIds,\s*'favListings',\s*\)/);
  assert.match(source, /for \(const listingId of visibleListingIds\) \{\s*const result = await removeFavoriteObjectIdIfPresent\(id, 'favListings', listingId\);[\s\S]*if \(!result\.removed\) continue;[\s\S]*'Listing favorite counter decrement'/);
  assert.match(source, /removeFavoriteObjectIdsWithoutCounters\(id, 'favListings', listingIds\)/);
  assert.doesNotMatch(source, /const existingListingIds = new Set\(storedObjectIdStringsForUserMutation\(user\.favListings, 'favListings'\)\)/);
  assert.doesNotMatch(source, /const existingVisibleListingIds = visibleListingIds\.filter/);
  assert.doesNotMatch(source, /for \(const listingId of existingVisibleListingIds\) \{\s*await removeFavorite\(listingId\.toHexString\(\), id\);\s*\}/);
  assert.doesNotMatch(source, /for \(const listingId of visibleListingIds\) \{\s*await removeFavorite\(listingId\.toHexString\(\), id\);\s*\}/);
  assert.doesNotMatch(source, /for \(const listingId of listingIds\) \{\s*await removeFavorite\(listingId\.toHexString\(\), id\);\s*\}/);
  assert.doesNotMatch(source, /mergeStoredObjectIdsForUserMutation\(\s*user\.favListings,\s*listingIds,\s*'favListings',\s*\)/);
  assert.match(source, /readFellowships/);
  assert.match(source, /const visibleFellowships = await readFellowships\(fellowshipIds\)/);
  assert.match(source, /const visibleFellowshipIds = normalizeObjectIdsForUserMutation\(\s*visibleFellowships\.map\(\(fellowship\) => fellowship\._id\),\s*'favFellowships',\s*\)/);
  assert.match(source, /for \(const fellowshipId of visibleFellowshipIds\) \{\s*const result = await addFavoriteObjectIdIfMissing\(id, 'favFellowships', fellowshipId\);[\s\S]*if \(!result\.added\) continue;[\s\S]*'Fellowship favorite counter increment'/);
  assert.doesNotMatch(source, /updateUser\(id, \{ favFellowships: user\.favFellowships \}\);[\s\S]*for \(const fellowshipId of newVisibleFellowshipIds\)/);
  assert.doesNotMatch(source, /for \(const fellowshipId of newVisibleFellowshipIds\) \{\s*await addFellowshipFavorite\(fellowshipId\.toHexString\(\)\);\s*\}/);
  assert.doesNotMatch(source, /for \(const fellowshipId of visibleFellowshipIds\) \{\s*await addFellowshipFavorite\(fellowshipId\.toHexString\(\)\);\s*\}/);
  assert.doesNotMatch(source, /mergeStoredObjectIdsForUserMutation\(\s*user\.favFellowships,\s*visibleFellowshipIds,\s*'favFellowships',\s*\)/);
  assert.match(source, /for \(const fellowshipId of visibleFellowshipIds\) \{\s*const result = await removeFavoriteObjectIdIfPresent\(id, 'favFellowships', fellowshipId\);[\s\S]*if \(!result\.removed\) continue;[\s\S]*'Fellowship favorite counter decrement'/);
  assert.match(source, /removeFavoriteObjectIdsWithoutCounters\(id, 'favFellowships', fellowshipIds\)/);
  assert.doesNotMatch(source, /const existingFellowshipIds = new Set\(\s*storedObjectIdStringsForUserMutation\(user\.favFellowships, 'favFellowships'\),\s*\)/);
  assert.doesNotMatch(source, /const existingVisibleFellowshipIds = visibleFellowshipIds\.filter/);
  assert.doesNotMatch(source, /for \(const fellowshipId of existingVisibleFellowshipIds\) \{\s*await removeFellowshipFavorite\(fellowshipId\.toHexString\(\)\);\s*\}/);
  assert.doesNotMatch(source, /for \(const fellowshipId of visibleFellowshipIds\) \{\s*await removeFellowshipFavorite\(fellowshipId\.toHexString\(\)\);\s*\}/);
  assert.doesNotMatch(source, /for \(const fellowshipId of fellowshipIds\) \{\s*await removeFellowshipFavorite\(fellowshipId\.toHexString\(\)\);\s*\}/);
  assert.doesNotMatch(source, /mergeStoredObjectIdsForUserMutation\(\s*user\.favFellowships,\s*fellowshipIds,\s*'favFellowships',\s*\)/);
  assert.match(source, /const visiblePathways = await getPathwaysByIds\(pathwayIds\.map\(\(pathwayId\) => pathwayId\.toHexString\(\)\)\)/);
  assert.match(source, /const visiblePathwayIds = normalizeObjectIdsForUserMutation\(\s*visiblePathways\.map\(\(pathway\) => pathway\._id\),\s*'favPathways',\s*\)/);
  assert.match(source, /for \(const pathwayId of visiblePathwayIds\) \{\s*const result = await addFavoriteObjectIdIfMissing\(id, 'favPathways', pathwayId\);[\s\S]*newUser = result\.user;[\s\S]*\}/);
  assert.match(source, /const newUser = await removeSavedPathwayIdsAndPlans\(id, pathwayIds\)/);
  assert.doesNotMatch(source, /mergeStoredObjectIdsForUserMutation\(\s*user\.favPathways,\s*visiblePathwayIds,\s*'favPathways',\s*\)/);
  assert.doesNotMatch(source, /mergeStoredObjectIdsForUserMutation\(\s*user\.favPathways,\s*pathwayIds,\s*'favPathways',\s*\)/);
  assert.doesNotMatch(source, /\$set: \{ favPathways: user\.favPathways \}/);
  assert.match(source, /const normalizeUserLookupNetid = \(id: unknown\): string => \{/);
  assert.match(source, /const netid = typeof id === 'string' \? id\.trim\(\) : ''/);
  assert.match(source, /export const normalizeUserLookupObjectId = \(id: unknown\): string \| null => \{/);
  assert.match(source, /id instanceof mongoose\.Types\.ObjectId/);
  assert.match(source, /return \/\^\[a-f0-9\]\{24\}\$\/i\.test\(value\) \? value : null/);
  assert.match(source, /const objectId = normalizeUserLookupObjectId\(id\)/);
  assert.match(source, /User\.findById\(objectId\)/);
  assert.match(source, /User\.findByIdAndUpdate\(objectId, safeData/);
  assert.match(source, /User\.findByIdAndDelete\(objectId\)/);
  assert.doesNotMatch(source, /String\(value \|\| ''\)\.trim\(\)/);
  assert.doesNotMatch(source, /String\(id \?\? ''\)\.trim\(\)/);
  assert.doesNotMatch(source, /mongoose\.Types\.ObjectId\.isValid\(id\)/);
  assert.doesNotMatch(source, /user\.favListings\.map\(\(listing: any\) => listing\.toString\(\)\)/);
  assert.doesNotMatch(source, /user\.favFellowships\.map\(\(f: any\) => f\.toString\(\)\)/);
  assert.doesNotMatch(source, /user\.favPathways\.map\(\(p: any\) => p\.toString\(\)\)/);
  assert.match(controller, /normalizeObjectIdsForUserMutation/);
  assert.match(controller, /const normalizeStoredObjectIdsForAccountRead = \(values: unknown, fieldName: string\): string\[\] => \{/);
  assert.match(controller, /normalizeObjectIdsForUserMutation\(ids, fieldName\)/);
  assert.match(controller, /const normalizeStoredPathwayIdsForAccountRead = \(values: unknown\): string\[\] => \{/);
  assert.match(controller, /normalizeStoredObjectIdsForAccountRead\(values, 'favPathways'\)/);
  assert.match(controller, /const favListings = await readPublicListings\(favListingIds\)/);
  assert.match(controller, /favListingsIds: normalizeObjectIdsForUserMutation\(\s*favListings\.map\(\(listing\) => listing\._id\),\s*'favListings',\s*\)/);
  assert.match(controller, /const favFellowships = await readFellowships\(favFellowshipIds\)/);
  assert.match(controller, /favFellowshipIds: normalizeObjectIdsForUserMutation\(\s*favFellowships\.map\(\(fellowship\) => fellowship\._id\),\s*'favFellowships',\s*\)/);
  assert.match(controller, /const savedPrograms = await readPrograms\(savedProgramIds\)/);
  assert.match(controller, /savedProgramIds: normalizeObjectIdsForUserMutation\(\s*savedPrograms\.map\(\(program\) => program\._id\),\s*'favFellowships',\s*\)/);
  assert.match(controller, /const favFellowshipIds = normalizeStoredObjectIdsForAccountRead\(\s*user\.favFellowships,\s*'favFellowships',\s*\)/);
  assert.match(controller, /const savedProgramIds = normalizeStoredObjectIdsForAccountRead\(\s*user\.favFellowships,\s*'favFellowships',\s*\)/);
  assert.match(controller, /const ownListingIds = normalizeStoredObjectIdsForAccountRead\(user\.ownListings, 'ownListings'\)/);
  assert.match(controller, /const favListingIds = normalizeStoredObjectIdsForAccountRead\(user\.favListings, 'favListings'\)/);
  assert.match(controller, /const ownListings = await readListings\(ownListingIds\)/);
  assert.match(controller, /const favListings = await readPublicListings\(favListingIds\)/);
  assert.match(controller, /const favPathwayIds = normalizeStoredPathwayIdsForAccountRead\(user\.favPathways\)/);
  assert.match(controller, /const savedResearchPlanIds = normalizeStoredPathwayIdsForAccountRead\(user\.favPathways\)/);
  assert.match(controller, /favPathwayIds: normalizeObjectIdsForUserMutation\(\s*favPathways\.map\(\(pathway\) => pathway\._id\),\s*'favPathways',\s*\)/);
  assert.match(controller, /savedResearchPlanIds: normalizeObjectIdsForUserMutation\(\s*savedResearchPlans\.map\(\(pathway\) => pathway\._id\),\s*'favPathways',\s*\)/);
  assert.match(
    controller,
    /normalizeObjectIdsForUserMutation\(\s*favPathways\.map\(\(pathway\) => pathway\._id\),\s*'favPathways',\s*\)/,
  );
  assert.match(
    controller,
    /normalizeObjectIdsForUserMutation\(\s*savedResearchPlans\.map\(\(pathway\) => pathway\._id\),\s*'savedResearchPlans',\s*\)/,
  );
  assert.match(controller, /const favPathways = await getPathwaysByIds\(favPathwayIds\)/);
  assert.match(
    controller,
    /const validIds = normalizeObjectIdsForUserMutation\(\s*favPathways\.map\(\(pathway\) => pathway\._id\),\s*'favPathways',\s*\)/,
  );
  assert.match(
    controller,
    /const matchesByPathwayId = await matchFellowshipsForPathways\(\s*validIds\.map\(\(pathwayId\) => pathwayId\.toHexString\(\)\),\s*\)/,
  );
  assert.doesNotMatch(controller, /matchFellowshipsForPathways\(favPathwayIds\)/);
  assert.doesNotMatch(controller, /new mongoose\.Types\.ObjectId\(pathway\._id\)/);
});

test('favorite analytics do not persist hidden ids from mutation requests', () => {
  const source = fs.readFileSync(
    new URL('../server/src/routes/users.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const normalizeFavoriteAnalyticsIds = \(value: unknown\): string\[\] => \{/);
  assert.match(source, /const visibleFavoriteAnalyticsIdsFromResponse = \(/);
  assert.match(
    source,
    /const visibleIds = isFavorite\s*\?\s*visibleFavoriteAnalyticsIdsFromResponse\(data, kind, requestedIds\)\s*:\s*\[\]/,
  );
  assert.match(source, /metadata: \{ entityType: kind, itemIdsRedacted: true \}/);
  assert.match(source, /visibleIds\.forEach\(\(itemId: string\) => \{/);
  assert.doesNotMatch(source, /const ids = getFavoriteIds\(/);
  assert.doesNotMatch(source, /ids\.forEach\(\(itemId: string\) => \{/);
});

test('saved research-plan exports redact system-derived direct contact details', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/userService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ redactDirectContactInfo \} from '\.\.\/utils\/contactRedaction'/);
  assert.match(source, /import \{ safeSpreadsheetCell \} from '\.\.\/utils\/spreadsheetSafety'/);
  assert.match(source, /const exportTextWithoutDirectContact = \(value: unknown\): string =>/);
  assert.match(source, /safeSpreadsheetCell\(redactDirectContactInfo\(String\(value \|\| ''\)\)\)/);
  assert.match(source, /const exportUserTextForSpreadsheet = \(value: unknown\): string =>/);
  assert.match(source, /safeSpreadsheetCell\(String\(value \|\| ''\)\)/);
  assert.match(source, /const exportChecklistForSpreadsheet = \(checklist: Record<string, boolean>\): Record<string, boolean> =>/);
  assert.match(source, /title:\s*exportTextWithoutDirectContact\(pathway\.studentFacingLabel\)/);
  assert.match(source, /name:\s*exportTextWithoutDirectContact\(/);
  assert.match(source, /checklist:\s*exportChecklistForSpreadsheet\(plan\.checklist as Record<string, boolean>\)/);
  assert.match(source, /item\.privateNote = exportUserTextForSpreadsheet\(plan\.note\)/);
  assert.doesNotMatch(source, /title:\s*pathway\.studentFacingLabel/);
  assert.doesNotMatch(source, /name:\s*pathway\.researchEntity\.displayName \|\| pathway\.researchEntity\.name/);
  assert.doesNotMatch(source, /item\.privateNote = plan\.note/);
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
  assert.match(source, /name:\s*publicTextString\(group\.name \|\| group\.displayName \|\| ''\)/);
  assert.match(source, /displayName:\s*group\.displayName === undefined \? undefined : publicTextString\(group\.displayName\)/);
  assert.match(source, /researchAreas:\s*publicTextStringArray\(group\.researchAreas\)/);
  assert.match(source, /value\s*\.slice\(0, MAX_PUBLIC_RESEARCH_ENTITY_ARRAY_ITEMS\)\s*\.map\(publicTextValue\)/);
  assert.match(source, /Object\.keys\(source\)\s*\.slice\(0, MAX_PUBLIC_RESEARCH_ENTITY_OBJECT_KEYS\)/);
  assert.match(source, /value\s*\.slice\(0, MAX_PUBLIC_RESEARCH_ENTITY_URLS\)\s*\.flatMap/);
  assert.match(source, /dto\[field\] = publicTextValue\(group\[field\]\)/);
  assert.doesNotMatch(source, /dto\[field\] = group\[field\]/);
});

test('public access summaries bound evidence text and avoid arbitrary object coercion', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/accessSummaryService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /MAX_ACCESS_SUMMARY_ENTITY_IDS = 100/);
  assert.match(source, /MAX_ACCESS_SUMMARY_TEXT_LENGTH = 2000/);
  assert.match(source, /MAX_ACCESS_SUMMARY_URL_LENGTH = 2048/);
  assert.match(source, /const ACCESS_SUMMARY_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /const id = serializedDocumentId\(value\)/);
  assert.match(source, /typeof value !== 'string'/);
  assert.match(source, /value\.slice\(0, maxLength\)\.trim\(\)/);
  assert.match(source, /researchEntityIds\s*\.slice\(0, MAX_ACCESS_SUMMARY_ENTITY_IDS\)/);
  assert.match(source, /accessSummaryEntityId\(signal\.researchEntityId\)/);
  assert.match(source, /accessSummaryEntityId\(pathway\.researchEntityId\)/);
  assert.match(source, /accessSummaryEntityId\(opportunity\.researchEntityId\)/);
  assert.match(source, /boundedString\(signal\.signalType, MAX_ACCESS_SUMMARY_TYPE_LENGTH\)/);
  assert.match(source, /publicText\(signal\.excerpt\)/);
  assert.match(source, /publicHttpUrl\(signal\.sourceUrl\)/);
  assert.doesNotMatch(source, /mongoose\.Types\.ObjectId\.isValid\(id\)/);
  assert.doesNotMatch(source, /String\(signal\.researchEntityId\)/);
  assert.doesNotMatch(source, /String\(pathway\.researchEntityId\)/);
  assert.doesNotMatch(source, /String\(opportunity\.researchEntityId\)/);
});

test('public opportunity detail redacts research entity taxonomy arrays', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/opportunityDetailService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ redactDirectContactInfo \} from '\.\.\/utils\/contactRedaction'/);
  assert.match(source, /MAX_OPPORTUNITY_DETAIL_ARRAY_ITEMS = 50/);
  assert.match(source, /MAX_OPPORTUNITY_DETAIL_TEXT_LENGTH = 5000/);
  assert.match(source, /MAX_OPPORTUNITY_DETAIL_URL_LENGTH = 2048/);
  assert.match(source, /MAX_OPPORTUNITY_DETAIL_EVIDENCE_DEPTH = 4/);
  assert.match(source, /OPPORTUNITY_DETAIL_OBJECT_ID_RE = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(source, /const publicTextArray = \(values: unknown\): string\[\] =>/);
  assert.match(source, /values\s*\.slice\(0, MAX_OPPORTUNITY_DETAIL_ARRAY_ITEMS\)/);
  assert.match(source, /value\.slice\(0, MAX_OPPORTUNITY_DETAIL_TEXT_LENGTH\)\.trim\(\)/);
  assert.match(source, /value\.slice\(0, MAX_OPPORTUNITY_DETAIL_URL_LENGTH\)\.trim\(\)/);
  assert.match(source, /value instanceof Types\.ObjectId/);
  assert.match(source, /const objectIdString = \(value: unknown\): string =>/);
  assert.match(source, /return OPPORTUNITY_DETAIL_OBJECT_ID_RE\.test\(id\) \? id : ''/);
  assert.match(source, /\.map\(\(value\) => objectIdString\(value\)\)/);
  assert.match(source, /const safeId = objectIdString\(id\)/);
  assert.doesNotMatch(source, /entryPathwayId: idString/);
  assert.doesNotMatch(source, /researchEntityId: idString/);
  assert.doesNotMatch(source, /listingId:/);
  assert.doesNotMatch(source, /_id: documentId\(opportunity\)/);
  assert.doesNotMatch(source, /_id: documentId\(pathway\)/);
  assert.doesNotMatch(source, /_id: documentId\(researchEntity\)/);
  assert.doesNotMatch(source, /_id: documentId\(item\)/);
  assert.doesNotMatch(source, /createdAt\?: Date/);
  assert.doesNotMatch(source, /updatedAt\?: Date/);
  assert.doesNotMatch(source, /'createdAt'/);
  assert.doesNotMatch(source, /'updatedAt'/);
  assert.doesNotMatch(source, /createdAt: opportunity\.createdAt/);
  assert.doesNotMatch(source, /updatedAt: opportunity\.updatedAt/);
  assert.match(source, /depth > MAX_OPPORTUNITY_DETAIL_EVIDENCE_DEPTH/);
  assert.match(source, /departments:\s*publicTextArray\(researchEntity\.departments\)/);
  assert.match(source, /researchAreas:\s*publicTextArray\(researchEntity\.researchAreas\)/);
  assert.match(source, /sourceName:\s*publicText\(item\.sourceName\)/);
  assert.match(source, /field:\s*publicText\(item\.field\)/);
  assert.doesNotMatch(source, /sourceName:\s*item\.sourceName/);
  assert.doesNotMatch(source, /field:\s*item\.field/);
  assert.doesNotMatch(source, /Types\.ObjectId\.isValid/);
  assert.doesNotMatch(source, /typeof \(value as any\)\?\.toHexString === 'function'/);
  assert.doesNotMatch(source, /departments:\s*researchEntity\.departments \|\| \[\]/);
  assert.doesNotMatch(source, /researchAreas:\s*researchEntity\.researchAreas \|\| \[\]/);
});

test('public research detail subdocuments omit persistence metadata', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/researchGroupService.ts', import.meta.url),
    'utf8',
  );

  for (const serializerName of [
    'publicListingForResearchDetail',
    'publicEntryPathwayForResearchDetail',
    'publicAccessSignalForResearchDetail',
    'publicPostedOpportunityForResearchDetail',
  ]) {
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

  const paperSerializerMatch = source.match(
    /const publicPaperForResearchDetail = \(paper: any\) => \{[\s\S]*?\n\};/,
  );
  assert.ok(paperSerializerMatch, 'publicPaperForResearchDetail serializer should exist');
  assert.match(source, /const recentPapers = \(recentPapersRaw as any\[\]\)\.map\(publicPaperForResearchDetail\)/);
  assert.match(source, /const recentArxivPreprints = \(recentArxivPreprintsRaw as any\[\]\)\.map\(publicPaperForResearchDetail\)/);
  assert.match(paperSerializerMatch[0], /_id: publicPaperKeyForResearchDetail\(paper\)/);
  assert.match(paperSerializerMatch[0], /title: publicString\(paper\?\.title\)/);
  assert.match(paperSerializerMatch[0], /publicHttpUrl\(paper\?\.openAccessUrl\)/);
  assert.doesNotMatch(paperSerializerMatch[0], /yaleAuthorIds/);
  assert.doesNotMatch(paperSerializerMatch[0], /yaleAuthorNetIds/);
  assert.doesNotMatch(paperSerializerMatch[0], /facultyMemberIds/);
  assert.doesNotMatch(paperSerializerMatch[0], /researchEntityIds/);
  assert.doesNotMatch(paperSerializerMatch[0], /sourceIds/);
  assert.doesNotMatch(paperSerializerMatch[0], /fieldProvenance/);
  assert.doesNotMatch(paperSerializerMatch[0], /confidenceByField/);
  assert.doesNotMatch(paperSerializerMatch[0], /manuallyLockedFields/);
  assert.doesNotMatch(paperSerializerMatch[0], /externalIds/);
  assert.doesNotMatch(paperSerializerMatch[0], /createdAt:/);
  assert.doesNotMatch(paperSerializerMatch[0], /updatedAt:/);
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
  assert.match(passportSource, /return res\.status\(401\)\.json\(\{ error: 'CAS auth but no user' \}\)/);
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
  assert.match(source, /if \(!normalizedNetid\) return null;/);
  assert.match(source, /axios\.isAxiosError\(error\)/);
  assert.match(source, /new Error\(`Yalies API request failed\$\{suffix\}`\)/);
  assert.match(source, /timeout: YALIES_API_TIMEOUT_MS/);
  assert.match(source, /throw yaliesRequestError\(error\)/);
  assert.match(source, /validateUser\(normalizedNetid\)/);
  assert.match(source, /filters: \{ netid: \[normalizedNetid\] \}/);
  assert.match(source, /sanitizeLogValue\(yaliesRequestError\(error\)\)/);
  assert.match(source, /console\.error\('Error fetching user:', sanitizeLogValue\(error\)\)/);
  assert.doesNotMatch(source, /filters: \{ netid: \[netid\] \}/);
  assert.doesNotMatch(source, /console\.error\('Error fetching from Yalies API:', \(error as Error\)\.message\)/);
  assert.doesNotMatch(source, /console\.error\('Error fetching user:', \(error as Error\)\.message\)/);
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
  assert.match(source, /const publicResearchAreaColorKey = \(value: unknown, fallback: unknown\): string =>/);
  assert.match(source, /name: publicConfigText\(area\.name\)/);
  assert.match(source, /colorKey: publicResearchAreaColorKey\(area\.colorKey, fieldColorKeys\[area\.field as ResearchField\]\)/);
  assert.match(source, /aliases: publicConfigTextArray\(/);
  assert.match(source, /categories: publicDepartmentCategories\(dept\.categories\)/);
  assert.match(source, /primaryCategory: publicDepartmentCategories\(\[dept\.primaryCategory\]\)\[0\]/);
  assert.doesNotMatch(source, /aliases: dept\.aliases \|\| \[\]/);
  assert.doesNotMatch(source, /categories: dept\.categories/);
});

test('OpenAI-backed operator scripts sanitize top-level errors', () => {
  const files = [
    '../server/src/scripts/backfillResearchDescriptions.ts',
    '../server/src/scripts/backfillProfileBiosFromOfficialUrls.ts',
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
    '../server/src/scripts/cleanDepartments.ts',
    '../server/src/scripts/importFaculty.ts',
    '../server/src/scripts/migrateMongoNaming.ts',
    '../server/src/scripts/betaSeedEnvironment.ts',
    '../server/src/scripts/backfillResearchHomeOfficialUrls.ts',
    '../server/src/scripts/profileDataQualityAudit.ts',
    '../server/src/scripts/backfillBrowseRank.ts',
    '../server/src/scripts/auditProgramResearchRelevance.ts',
    '../server/src/scripts/repairOfficialProfilePublicationPointers.ts',
    '../server/src/scripts/scholarlyLinkProvenanceAudit.ts',
    '../server/src/scripts/launchTrustContract.ts',
    '../server/src/scripts/repairArchivedEntityArtifacts.ts',
    '../server/src/scripts/auditResearchEntityRename.ts',
    '../server/src/scripts/acceptFormalizationReviewExceptions.ts',
    '../server/src/scripts/betaRepairQueue.ts',
    '../server/src/scripts/backfillProgramClassifications.ts',
    '../server/src/scripts/scholarlyLinkSuppressionAudit.ts',
    '../server/src/scripts/dedupeExploratoryContactPathways.ts',
    '../server/src/scripts/dedupeResearchEntitiesByPi.ts',
    '../server/src/scripts/normalizeFacultyUserTypes.ts',
    '../server/src/scripts/launchAcquisitionReport.ts',
    '../server/src/scripts/launchReviewExceptions.ts',
    '../server/src/scripts/studentVisibilityRepairTargets.ts',
    '../server/src/scripts/migrateResearchEntities.ts',
    '../server/src/scripts/profileImageQualityAudit.ts',
    '../server/src/scripts/repairProfileDescriptionBackfillConflicts.ts',
    '../server/src/scripts/repairListingResearchEntityProfiles.ts',
    '../server/src/scripts/departmentLeadRepairPlan.ts',
    '../server/src/scripts/migrateResearchEntityCollections.ts',
    '../server/src/scripts/scraperIntegrityDuplicateReview.ts',
    '../server/src/scripts/rebuildResearchEntitySearchIndex.ts',
    '../server/src/scripts/rebuildPathwaySearchIndex.ts',
    '../server/src/scripts/researchQualitySearchReview.ts',
    '../server/src/scripts/profileBioCoverageAudit.ts',
    '../server/src/scripts/paperQualityAudit.ts',
    '../server/src/scripts/backfillStudentVisibilityTiers.ts',
    '../server/src/scripts/repairResearchEntityCanonicalNames.ts',
    '../server/src/scripts/pathwayRelevanceReview.ts',
    '../server/src/scripts/disambiguateSurnameLabNames.ts',
    '../server/src/scripts/studentVisibilityGate.ts',
    '../server/src/scripts/cleanupLegacyMongoCollections.ts',
    '../server/src/scripts/backfillProgramOfficialSources.ts',
    '../server/src/scripts/backfillFacultyWaysIn.ts',
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

  assert.match(passportSource, /const setPrivateAuthResponseHeaders = \(res: express\.Response\): void => \{/);
  assert.match(passportSource, /Cache-Control', 'no-store, private, max-age=0'/);
  assert.match(passportSource, /Surrogate-Control', 'no-store'/);
  assert.match(passportSource, /Expires', '0'/);
  assert.match(passportSource, /X-Content-Type-Options', 'nosniff'/);
  assert.match(passportSource, /function publicAuthSessionUser\(user: unknown\): AuthenticatedSessionUser \| null/);
  assert.match(passportSource, /const netId = normalizeAuthNetId\(source\.netId\)/);
  assert.match(passportSource, /if \(!netId\) return null/);
  assert.match(passportSource, /netId,/);
  assert.match(passportSource, /userType: normalizeSessionUserType\(source\.userType\)/);
  assert.match(passportSource, /const casLogin[\s\S]*setPrivateAuthResponseHeaders\(res\)/);
  assert.match(passportSource, /router\.get\('\/check'[\s\S]*const user = publicAuthSessionUser\(req\.user\)[\s\S]*return res\.json\(\{ auth: true, user \}\)/);
  assert.match(passportSource, /router\.get\('\/check'[\s\S]*return res\.json\(\{ auth: false \}\)/);
  assert.doesNotMatch(passportSource, /res\.json\(\{ auth: true, user: req\.user \}\)/);
  assert.doesNotMatch(passportSource, /netId: normalizeAuthNetId\(source\.netId\) \|\| 'unknown'/);
  assert.match(passportSource, /const logoutRouteHandler[\s\S]*setPrivateAuthResponseHeaders\(res\)/);
  assert.match(passportSource, /const logoutRouteHandler[\s\S]*if \(req\.method !== 'GET'\) \{[\s\S]*res\.setHeader\('Allow', 'GET'\)[\s\S]*return res\.status\(405\)\.json\(\{ error: 'Method not allowed' \}\)/);
  assert.match(passportSource, /const logoutRouteHandler[\s\S]*if \(req\.method !== 'GET'\)[\s\S]*if \(!isTrustedLogoutRequest\(req\)\)/);
  assert.match(passportSource, /if \(req\.get\('origin'\) !== undefined\) \{/);
  assert.match(passportSource, /return Boolean\(origin && origin === allowedOrigin\)/);
  assert.match(passportSource, /router\.get\('\/dev-login'[\s\S]*setPrivateAuthResponseHeaders\(res\)/);
  assert.match(passportSource, /function normalizeDevUserType\(value: unknown\): string \{/);
  assert.match(passportSource, /const normalized = typeof value === 'string' \? value\.trim\(\)\.toLowerCase\(\) : ''/);
  assert.match(passportSource, /const normalizedUserType = normalizeDevUserType\(userType\)/);
  assert.match(passportSource, /const testUser = await ensureDevLoginUser\(req\.query\?\.userType\)/);
  assert.doesNotMatch(passportSource, /ensureDevLoginUser\(String\(req\.query\?\.userType/);
  assert.match(passportSource, /return res\.status\(500\)\.json\(\{ error: 'Dev login failed' \}\)/);
  assert.doesNotMatch(passportSource, /return res\.status\(500\)\.json\(\{ error: err\.message \}\)/);
  assert.match(adminRouteSource, /MAX_LOCAL_ADMIN_REDIRECT_URL_LENGTH = 2048/);
  assert.match(adminRouteSource, /window\.location\.href\.length > MAX_LOCAL_ADMIN_REDIRECT_URL_LENGTH/);
  assert.match(adminRouteSource, /parsed\.origin === window\.location\.origin \? parsed\.toString\(\) : fallback/);
  assert.match(adminRouteSource, /encodeURIComponent\(\s*getSafeLocalAdminRedirectTarget\(\),\s*\)/);
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
  assert.match(passportSource, /const path = `\$\{target\.pathname\}\$\{target\.search\}\$\{target\.hash\}`/);
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

  assert.match(signInButtonSource, /const MAX_CAS_RETURN_PATH_LENGTH = 2048/);
  assert.match(signInButtonSource, /const normalizeReturnPath = \(value\?: string \| null\): string => \{/);
  assert.match(signInButtonSource, /if \(url\.origin !== window\.location\.origin\) return ''/);
  assert.match(signInButtonSource, /const path = `\$\{url\.pathname\}\$\{url\.search\}\$\{url\.hash\}`/);
  assert.match(signInButtonSource, /setRedirectParam\(returnPath \? `\?redirect=\$\{encodeURIComponent\(returnPath\)\}` : ''\)/);
  assert.match(signInButtonSource, /const savedPath = sessionStorage\.getItem\('logoutReturnPath'\)/);
  assert.match(signInButtonSource, /if \(savedPath\) sessionStorage\.removeItem\('logoutReturnPath'\)/);
  assert.match(signInButtonSource, /localStorage\.removeItem\('logoutReturnPath'\)/);
  assert.doesNotMatch(signInButtonSource, /localStorage\.getItem\('logoutReturnPath'\)/);
  assert.doesNotMatch(signInButtonSource, /return window\.location\.origin/);
  assert.doesNotMatch(signInButtonSource, /window\.location\.origin\)\.toString\(\)/);

  for (const source of [userButtonSource, signOutButtonSource]) {
    assert.match(source, /const returnPath = `\$\{window\.location\.pathname\}\$\{window\.location\.search\}\$\{window\.location\.hash\}`/);
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
  assert.doesNotMatch(passportSource, /name === 'SERVER_BASE_URL' && isLocalDevelopmentEnvironment/);
});

test('auth principals are normalized before user lookup and session hydration', () => {
  const passportSource = fs.readFileSync(
    new URL('../server/src/passport.ts', import.meta.url),
    'utf8',
  );

  assert.match(passportSource, /const AUTH_NETID_RE = \/\^\[A-Za-z0-9\]\{2,12\}\$\/;/);
  assert.match(passportSource, /function normalizeAuthNetId\(value: unknown\): string \| undefined \{/);
  assert.match(passportSource, /const normalized = typeof value === 'string' \? value\.trim\(\) : ''/);
  assert.match(passportSource, /function normalizeSessionUserType\(value: unknown\): string \{/);
  assert.match(passportSource, /const normalized = typeof value === 'string' \? value\.trim\(\)\.toLowerCase\(\) : ''/);
  assert.match(passportSource, /const safeNetid = normalizeAuthNetId\(netid\)/);
  assert.match(passportSource, /throw new Error\('Invalid authentication principal'\)/);
  assert.match(passportSource, /passport\.serializeUser\(function \(user: any, done\) \{/);
  assert.match(passportSource, /const safeNetId = normalizeAuthNetId\(user\?\.netId\)/);
  assert.match(passportSource, /done\(new Error\('Invalid authentication principal'\)\)/);
  assert.match(passportSource, /done\(null, safeNetId\)/);
  assert.match(passportSource, /const safeNetId = normalizeAuthNetId\(netId\)/);
  assert.match(passportSource, /done\(null, null\)/);
  assert.doesNotMatch(passportSource, /done\(null, user\.netId\)/);
  assert.doesNotMatch(passportSource, /function normalizeAuthNetId\(value: unknown\): string \| undefined \{\s*const normalized = String\(value \|\| ''\)\.trim\(\)/);
  assert.doesNotMatch(passportSource, /function normalizeSessionUserType\(value: unknown\): string \{\s*const normalized = String\(value \|\| ''\)\.trim\(\)\.toLowerCase\(\)/);
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
  assert.match(passportSource, /if \(\/\[\\u0000-\\u0020\\u007f\\\\\]\/\.test\(value\)\) return ''/);
  assert.match(passportSource, /if \(parsed\.username \|\| parsed\.password\) return ''/);
  assert.match(csrfSource, /const MAX_CSRF_ORIGIN_HEADER_LENGTH = 2048/);
  assert.match(csrfSource, /const originFromUrl = \(value: string \| undefined\): string => \{/);
  assert.match(csrfSource, /writeLikeSafeMethodPaths\?: ReadonlySet<string>/);
  assert.match(csrfSource, /const isWriteLikeSafeMethodPath =/);
  assert.match(csrfSource, /args\.writeLikeSafeMethodPaths\?\.has\(args\.path\)/);
  assert.match(csrfSource, /if \(SAFE_METHODS\.has\(method\) && !isWriteLikeSafeMethodPath\) return true/);
  assert.match(csrfSource, /value\.length > MAX_CSRF_ORIGIN_HEADER_LENGTH/);
  assert.match(csrfSource, /if \(\/\[\\u0000-\\u0020\\u007f\\\\\]\/\.test\(value\)\) return ''/);
  assert.match(csrfSource, /if \(parsed\.username \|\| parsed\.password\) return ''/);
  assert.match(csrfSource, /if \(args\.origin !== undefined\) \{/);
  assert.match(csrfSource, /return Boolean\(origin && args\.allowedOrigins\.has\(origin\)\)/);
  assert.match(csrfSource, /origin: req\.get\('origin'\)/);
  assert.match(csrfSource, /referer: req\.get\('referer'\)/);

  const appSource = fs.readFileSync(new URL('../server/src/app.ts', import.meta.url), 'utf8');
  assert.match(appSource, /const WRITE_LIKE_SAFE_METHOD_API_PATHS = new Set<string>\(\)/);
  assert.match(appSource, /csrfOriginGuard\(allowList, \{\s*writeLikeSafeMethodPaths: WRITE_LIKE_SAFE_METHOD_API_PATHS,\s*\}\)/);
});

test('CORS origin headers are bounded before allowlist comparison', () => {
  const source = fs.readFileSync(
    new URL('../server/src/middleware/corsOrigin.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const MAX_CORS_ORIGIN_LENGTH = 2048/);
  assert.match(source, /const UNSAFE_CORS_ORIGIN_RE = \/\[\\u0000-\\u0020\\u007f\\\\\]\//);
  assert.match(source, /const normalizeCorsOrigin = \(origin: string \| undefined\): string => \{/);
  assert.match(source, /origin\.length > MAX_CORS_ORIGIN_LENGTH/);
  assert.match(source, /UNSAFE_CORS_ORIGIN_RE\.test\(origin\)/);
  assert.match(source, /parsed\.username \|\| parsed\.password/);
  assert.match(source, /parsed\.origin !== origin/);
  assert.match(source, /const normalizedOrigin = normalizeCorsOrigin\(origin\)/);
  assert.match(source, /return bypassCors \|\| allowedOrigins\.has\(normalizedOrigin\)/);
  assert.doesNotMatch(source, /allowedOrigins\.has\(origin\)/);
});

test('auth debug logs do not interpolate user identifiers', () => {
  const passportSource = fs.readFileSync(
    new URL('../server/src/passport.ts', import.meta.url),
    'utf8',
  );

  assert.match(passportSource, /const authDebug = \(\.\.\.args: unknown\[\]\) =>/);
  assert.match(passportSource, /console\.log\(\.\.\.args\.map\(\(arg\) => sanitizeLogValue\(arg\)\)\)/);
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

  assert.match(sessionCookieSource, /requiresDeployedRuntimeSecurity\(env\) \? '__Host-session' : 'session'/);
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
  assert.match(passportSource, /function normalizeAuthNetId\(value: unknown\): string \| undefined/);
  assert.match(passportSource, /AUTH_NETID_RE\.test\(normalized\) \? normalized : undefined/);
  assert.match(passportSource, /function normalizeDevUserType\(value: unknown\): string \{/);
  assert.doesNotMatch(passportSource, /function normalizeDevUserType\(value: string \| undefined\): string \{[\s\S]*String\(value \|\| ''\)/);
  assert.match(passportSource, /normalizeAuthNetId\(normalizedHeaderValue\(headers\['x-dev-netid'\]\)\)/);
  assert.match(passportSource, /normalizeAuthNetId\(unquoteEnvValue\(env\.LOCAL_AUTH_BYPASS_NETID\)\)/);
});

test('legacy admin userType is not production authority outside active admin grants', () => {
  const source = fs.readFileSync(
    new URL('../server/src/middleware/auth.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const hasAdminAuthority = async/);
  assert.match(source, /const AUTH_NETID_RE = \/\^\[A-Za-z0-9\]\{2,12\}\$\/;/);
  assert.match(source, /const normalizeAuthNetid = \(value: unknown\): string =>/);
  assert.match(source, /const requestNetid = \(user: AuthenticatedUser \| null \| undefined\): string =>/);
  assert.match(source, /const hasAuthenticatedPrincipal = \(user: unknown\): user is AuthenticatedUser =>/);
  assert.match(source, /if \(user\.userType !== 'admin' \|\| !netid\) return false/);
  assert.match(source, /hasActiveAdminGrant\(netid\)/);
  assert.match(source, /hasGrant \|\| allowsLegacyAdminUserType\(\)/);
  assert.match(source, /export const isAuthenticated[\s\S]*hasAuthenticatedPrincipal\(req\.user\)/);
  assert.match(source, /currentUser\.userType === 'admin'[\s\S]*hasAdminAuthority\(currentUser\)/);
  assert.doesNotMatch(source, /const allowedTypes = \['admin', 'professor', 'faculty'\]/);
  assert.doesNotMatch(source, /const requestNetid = \(user: \{ netId\?: string; netid\?: string \}\) => user\.netId \|\| user\.netid \|\| ''/);
  assert.match(source, /export const isProfessor[\s\S]*hasAdminAuthority\(currentUser\)/);
  assert.match(source, /export const isTrustworthy[\s\S]*hasAdminAuthority\(user\)/);
});

test('admin grant notes are bounded before persistence', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/adminGrantService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const normalizeNetid = \(netid: unknown\) =>\s*typeof netid === 'string'/);
  assert.doesNotMatch(source, /const normalizeNetid = \(netid: unknown\) => String\(netid \|\| ''\)/);
  assert.match(source, /MAX_ADMIN_GRANT_NOTE_LENGTH = 512/);
  assert.match(source, /const normalizeAdminGrantNote = \(note: unknown\): string =>/);
  assert.match(source, /note\.trim\(\)\.slice\(0, MAX_ADMIN_GRANT_NOTE_LENGTH\)/);
  assert.match(source, /note: normalizeAdminGrantNote\(note\)/);
  assert.match(source, /revokeNote: normalizeAdminGrantNote\(note\)/);
  assert.doesNotMatch(source, /note: typeof note === 'string' \? note\.trim\(\) : ''/);
  assert.doesNotMatch(source, /revokeNote: typeof note === 'string' \? note\.trim\(\) : ''/);
});

test('admin listing updates use a bounded allowlist before persistence', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/listingService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const filterAdminListingUpdateData = \(data: any\): Record<string, any> => \{/);
  assert.match(source, /const LISTING_NETID_RE = \/\^\[A-Za-z0-9\]\{2,12\}\$\//);
  assert.match(source, /const boundedListingNetidArray = \(value: unknown\): string\[\] \| undefined => \{/);
  assert.match(source, /\.slice\(0, MAX_SELF_SERVICE_LISTING_ARRAY_ITEMS\)/);
  assert.match(source, /const id = normalizeListingObjectId\(data\[field\]\)/);
  assert.match(source, /sanitizeSelfServiceListingPayload\(safeData\)/);
  assert.match(source, /noAuth\s*\n\s*\? filterAdminListingUpdateData\(data\)/);
  assert.doesNotMatch(source, /noAuth\s*\n\s*\? \{ \.\.\.data \}/);
});

test('admin listing management responses use an allowlist serializer', () => {
  const source = fs.readFileSync(
    new URL('../server/src/routes/admin.ts', import.meta.url),
    'utf8',
  );

  const serializer = source.match(/export const adminListingDto = \(listing: any\) => \{[\s\S]*?\n\};/);
  assert.ok(serializer, 'admin listing serializer should exist');
  assert.match(source, /import \{ publicHttpUrl \} from '\.\.\/utils\/urlSafety'/);
  assert.match(source, /const MAX_ADMIN_LISTING_TEXT_LENGTH = 5000/);
  assert.match(source, /const MAX_ADMIN_LISTING_ARRAY_ITEMS = 100/);
  assert.match(source, /const adminListingText = \(/);
  assert.match(source, /const adminListingTextArray = \(value: unknown\): string\[\] =>/);
  assert.match(source, /const adminListingUrlArray = \(value: unknown\): string\[\] =>/);
  assert.match(source, /publicHttpUrl\(item\)/);
  assert.match(source, /listings: results\.map\(adminListingDto\)/);
  assert.match(source, /listings: listings\.map\(adminListingDto\)/);
  assert.match(source, /res\.json\(\{ listing: adminListingDto\(listing\) \}\)/);
  assert.doesNotMatch(source, /listings: results,\s*total/);
  assert.doesNotMatch(source, /\{ listings,\s*total \}/);
  assert.doesNotMatch(source, /res\.json\(\{ listing \}\)/);
  assert.match(serializer[0], /ownerEmail: adminListingText\(listing\?\.ownerEmail/);
  assert.match(serializer[0], /emails: adminListingTextArray\(listing\?\.emails\)/);
  assert.match(serializer[0], /websites: adminListingUrlArray\(listing\?\.websites\)/);
  assert.doesNotMatch(serializer[0], /embedding/);
  assert.doesNotMatch(serializer[0], /researchEntityId/);
  assert.doesNotMatch(serializer[0], /researchGroupId/);
  assert.doesNotMatch(serializer[0], /createdByUserId/);
  assert.doesNotMatch(serializer[0], /sourceEvidenceIds/);
  assert.doesNotMatch(serializer[0], /archivedAt/);
  assert.doesNotMatch(serializer[0], /__v/);
});

test('admin fellowship management responses use an allowlist serializer', () => {
  const source = fs.readFileSync(
    new URL('../server/src/routes/admin.ts', import.meta.url),
    'utf8',
  );

  const serializer = source.match(/export const adminFellowshipDto = \(fellowship: any\) => \{[\s\S]*?\n\};/);
  assert.ok(serializer, 'admin fellowship serializer should exist');
  assert.match(source, /const MAX_ADMIN_FELLOWSHIP_TEXT_LENGTH = 5000/);
  assert.match(source, /const MAX_ADMIN_FELLOWSHIP_ARRAY_ITEMS = 100/);
  assert.match(source, /const adminFellowshipText = \(/);
  assert.match(source, /const adminFellowshipStringArray = \(value: unknown\): string\[\] =>/);
  assert.match(source, /const adminFellowshipLinks = \(value: unknown\): Array<\{ label: string; url: string \}> =>/);
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

test('current-user listing mutation responses use the public listing DTO', () => {
  const source = fs.readFileSync(
    new URL('../server/src/controllers/listingController.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const publicListingForAuthenticatedReader = \(listing: any\) => \{/);
  assert.match(source, /const publicListingText = \(value: unknown\): string \| undefined =>/);
  assert.match(source, /const publicListingTextArray = \(values: unknown\): string\[\] =>/);
  assert.match(source, /title: publicListingText\(listing\.title\)/);
  assert.match(source, /hiringStatus: publicListingText\(listing\.hiringStatus\)/);
  assert.match(source, /researchAreas: publicListingTextArray\(listing\.researchAreas\)/);
  assert.match(source, /keywords: publicListingTextArray\(listing\.keywords\)/);
  assert.match(source, /departments: publicListingTextArray\(listing\.departments\)/);
  assert.match(source, /type: publicListingText\(listing\.type\)/);
  assert.match(source, /commitment: publicListingText\(listing\.commitment\)/);
  assert.match(source, /compensationType: publicListingText\(listing\.compensationType\)/);
  assert.match(source, /response\.status\(201\)\.json\(\{ listing: publicListingForAuthenticatedReader\(listing\) \}\)/);
  assert.match(source, /const listing = await getSkeletonListing\(currentUser\.netId!\);\s*response\.status\(201\)\.json\(\{ listing: publicListingForAuthenticatedReader\(listing\) \}\)/);
  assert.match(source, /response\.status\(200\)\.json\(\{ listing: publicListingForAuthenticatedReader\(listing\) \}\)/);
  assert.match(source, /response\.status\(200\)\.json\(\{ deletedListing: publicListingForAuthenticatedReader\(deletedListing\) \}\)/);
  assert.doesNotMatch(source, /response\.status\(201\)\.json\(\{ listing \}\)/);
  assert.doesNotMatch(source, /response\.status\(200\)\.json\(\{ listing \}\)/);
  assert.doesNotMatch(source, /response\.status\(200\)\.json\(\{ deletedListing \}\)/);
  assert.doesNotMatch(source, /title: listing\.title/);
  assert.doesNotMatch(source, /researchAreas: Array\.isArray\(listing\.researchAreas\) \? listing\.researchAreas : \[\]/);
  assert.doesNotMatch(source, /keywords: Array\.isArray\(listing\.keywords\) \? listing\.keywords : \[\]/);
});

test('public listing detail reads require confirmed non-archived listings', () => {
  const controllerSource = fs.readFileSync(
    new URL('../server/src/controllers/listingController.ts', import.meta.url),
    'utf8',
  );
  const serviceSource = fs.readFileSync(
    new URL('../server/src/services/listingService.ts', import.meta.url),
    'utf8',
  );

  assert.match(controllerSource, /readPublicListing/);
  assert.match(controllerSource, /const listing = await readPublicListing\(request\.params\.id\)/);
  assert.match(serviceSource, /export const readPublicListing = async \(id: any\) => \{/);
  assert.match(serviceSource, /getListingModel\(\)\.findOne\(\{\s*_id: safeId,[\s\S]*?\.\.\.PUBLIC_LISTING_MUTATION_FILTER,[\s\S]*?\}\)/);
  assert.doesNotMatch(controllerSource, /const listing = await readListing\(request\.params\.id\)/);
});

test('listing DTO URL arrays are capped before public serialization', () => {
  const listingController = fs.readFileSync(
    new URL('../server/src/controllers/listingController.ts', import.meta.url),
    'utf8',
  );
  const userController = fs.readFileSync(
    new URL('../server/src/controllers/userController.ts', import.meta.url),
    'utf8',
  );

  assert.match(listingController, /const MAX_PUBLIC_LISTING_URLS = 20/);
  assert.match(listingController, /values\.slice\(0, MAX_PUBLIC_LISTING_URLS\)\.flatMap/);
  assert.doesNotMatch(listingController, /values\.flatMap\(\(value\) => publicHttpUrl/);

  assert.match(userController, /const MAX_ACCOUNT_LISTING_URLS = 20/);
  assert.match(userController, /values\.slice\(0, MAX_ACCOUNT_LISTING_URLS\)\.map\(publicHttpUrl\)/);
  assert.doesNotMatch(userController, /values\.map\(publicHttpUrl\)\.filter/);
});

test('account listing payloads redact direct contact text', () => {
  const source = fs.readFileSync(
    new URL('../server/src/controllers/userController.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ redactDirectContactInfo \} from '\.\.\/utils\/contactRedaction'/);
  assert.match(source, /const publicAccountListingText = \(value: unknown\): string \| undefined =>/);
  assert.match(source, /redactDirectContactInfo\(value\)/);
  assert.match(source, /title: publicAccountListingText\(listing\.title\)/);
  assert.match(source, /hiringStatus: publicAccountListingText\(listing\.hiringStatus\)/);
  assert.match(source, /description: publicAccountListingText\(listing\.description\)/);
  assert.match(source, /applicantDescription: publicAccountListingText\(listing\.applicantDescription\)/);
  assert.match(source, /departments: publicAccountListingTextArray\(listing\.departments\)/);
  assert.match(source, /researchAreas: publicAccountListingTextArray\(listing\.researchAreas\)/);
  assert.match(source, /keywords: publicAccountListingTextArray\(listing\.keywords\)/);
  const accountListingSerializer = source.match(/const publicAccountListing = \(listing: any\) => \{[\s\S]*?\n\};/);
  assert.ok(accountListingSerializer);
  assert.doesNotMatch(accountListingSerializer[0], /researchEntityId:/);
  assert.doesNotMatch(accountListingSerializer[0], /researchGroupId:/);
  assert.doesNotMatch(accountListingSerializer[0], /createdAt:/);
  assert.doesNotMatch(accountListingSerializer[0], /updatedAt:/);
  assert.doesNotMatch(source, /title: listing\.title/);
  assert.doesNotMatch(source, /hiringStatus: listing\.hiringStatus/);
  assert.doesNotMatch(source, /description: listing\.description/);
  assert.doesNotMatch(source, /applicantDescription: listing\.applicantDescription/);
});

test('public API DTO ids avoid arbitrary object stringification', () => {
  const idSerializationSource = fs.readFileSync(
    new URL('../server/src/utils/idSerialization.ts', import.meta.url),
    'utf8',
  );
  const listingControllerSource = fs.readFileSync(
    new URL('../server/src/controllers/listingController.ts', import.meta.url),
    'utf8',
  );
  const userControllerSource = fs.readFileSync(
    new URL('../server/src/controllers/userController.ts', import.meta.url),
    'utf8',
  );
  const programPayloadSource = fs.readFileSync(
    new URL('../server/src/controllers/programPayload.ts', import.meta.url),
    'utf8',
  );

  assert.match(idSerializationSource, /export const serializedDocumentId = \(value: unknown\): string \| undefined => \{/);
  assert.match(idSerializationSource, /if \(typeof value === 'string'\)/);
  assert.match(idSerializationSource, /if \(typeof value === 'number' && Number\.isFinite\(value\)\)/);
  assert.match(idSerializationSource, /if \(value instanceof mongoose\.Types\.ObjectId\)/);
  assert.doesNotMatch(idSerializationSource, /\.toString\(\)/);
  assert.doesNotMatch(idSerializationSource, /toHexString' in value/);
  assert.doesNotMatch(idSerializationSource, /typeof \(value as any\)\.toHexString === 'function'/);

  assert.match(listingControllerSource, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(
    listingControllerSource,
    /const id = serializedDocumentId\(listing\._id\) \|\| serializedDocumentId\(listing\.id\) \|\| ''/,
  );
  assert.match(userControllerSource, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(
    userControllerSource,
    /const id = serializedDocumentId\(listing\._id\) \|\| serializedDocumentId\(listing\.id\) \|\| ''/,
  );
  assert.match(programPayloadSource, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(
    programPayloadSource,
    /const id = serializedDocumentId\(program\._id\) \|\| serializedDocumentId\(program\.id\) \|\| ''/,
  );
  for (const source of [listingControllerSource, userControllerSource, programPayloadSource]) {
    assert.doesNotMatch(source, /_id\?\.toString\?\.\(\)/);
  }
});

test('account favorite listing hydration only returns public-visible listings', () => {
  const controllerSource = fs.readFileSync(
    new URL('../server/src/controllers/userController.ts', import.meta.url),
    'utf8',
  );
  const serviceSource = fs.readFileSync(
    new URL('../server/src/services/listingService.ts', import.meta.url),
    'utf8',
  );

  assert.match(controllerSource, /import \{ readListings, readPublicListings \} from '\.\.\/services\/listingService'/);
  assert.match(controllerSource, /const ownListings = await readListings\(ownListingIds\)/);
  assert.match(controllerSource, /const favListings = await readPublicListings\(favListingIds\)/);
  assert.match(serviceSource, /export const readPublicListings = async \(ids: any\[\]\) => \{/);
  assert.match(serviceSource, /getListingModel\(\)\.findOne\(\{\s*_id: safeId,[\s\S]*?\.\.\.PUBLIC_LISTING_MUTATION_FILTER,[\s\S]*?\}\)/);
  assert.doesNotMatch(controllerSource, /const favListings = await readListings\(favListingIds\)/);
});

test('profile surfaces render only safe HTTP(S) profile URLs and images', () => {
  const profileHeaderSource = fs.readFileSync(
    new URL('../client/src/components/profile/ProfileHeader.tsx', import.meta.url),
    'utf8',
  );
  const labMembersSource = fs.readFileSync(
    new URL('../client/src/components/labs/LabMembersList.tsx', import.meta.url),
    'utf8',
  );
  const profileEditorSource = fs.readFileSync(
    new URL('../client/src/components/accounts/ProfileEditor.tsx', import.meta.url),
    'utf8',
  );
  const developerCardSource = fs.readFileSync(
    new URL('../client/src/components/DeveloperCard.tsx', import.meta.url),
    'utf8',
  );
  const publicationsTableSource = fs.readFileSync(
    new URL('../client/src/components/profile/PublicationsTable.tsx', import.meta.url),
    'utf8',
  );
  const urlSource = fs.readFileSync(new URL('../client/src/utils/url.ts', import.meta.url), 'utf8');

  assert.match(urlSource, /export const safeImageSrc = \(raw: unknown\): string =>/);
  assert.match(urlSource, /const isPrivateOrLocalHostname = \(hostname: string\): boolean => \{/);
  assert.match(urlSource, /PRIVATE_HOSTNAME_SUFFIXES = \['\.local', '\.internal', '\.lan', '\.home\.arpa', '\.localdomain'\]/);
  assert.match(urlSource, /clean === 'localhost' \|\| clean\.endsWith\('\.localhost'\)/);
  assert.match(urlSource, /PRIVATE_HOSTNAME_SUFFIXES\.some\(\(suffix\) => clean\.endsWith\(suffix\)\)/);
  assert.match(urlSource, /!clean\.includes\('\.'\) && !clean\.includes\(':'\)/);
  assert.match(urlSource, /PRIVATE_IPV4_CIDRS\.some\(\(\[base, prefix\]\) => isIpv4InCidr\(clean, base, prefix\)\)/);
  assert.match(urlSource, /const isAllowedPublicHttpPort = \(url: URL\): boolean =>/);
  assert.match(urlSource, /url\.protocol === 'https:' && url\.port === '443'/);
  assert.match(urlSource, /if \(isPrivateOrLocalHostname\(parsed\.hostname\)\) return ''/);
  assert.match(urlSource, /if \(!isAllowedPublicHttpPort\(parsed\)\) return ''/);
  assert.match(urlSource, /trimmed\.startsWith\('\/'\) && !trimmed\.startsWith\('\/\/'\)/);
  assert.match(urlSource, /return safeHttpUrl\(trimmed\)/);

  assert.match(profileHeaderSource, /import \{ EXTERNAL_IMAGE_REFERRER_POLICY, safeHttpUrl \}/);
  assert.match(profileHeaderSource, /const href = safeHttpUrl\(url\)/);
  assert.match(profileHeaderSource, /const href = safeHttpUrl\(trimmed\)/);
  assert.match(profileHeaderSource, /const websiteHref = safeHttpUrl\(profile\.website\)/);
  assert.match(profileHeaderSource, /const profileImageHref = safeHttpUrl\(profile\.image_url\)/);
  assert.doesNotMatch(profileHeaderSource, /safeUrl\(/);
  assert.match(profileHeaderSource, /src=\{profileImageHref\}/);
  assert.doesNotMatch(profileHeaderSource, /src=\{profile\.image_url\}/);
  assert.doesNotMatch(profileHeaderSource, /safeMailtoHref\(profile\.email\)/);
  assert.doesNotMatch(profileHeaderSource, /profile\.building_desk/);
  assert.doesNotMatch(profileHeaderSource, /profile\.physical_location/);

  assert.match(labMembersSource, /import \{[^}]*safeHttpUrl[^}]*\} from '\.\.\/\.\.\/utils\/url'/);
  assert.match(labMembersSource, /const profileImageHref = safeHttpUrl\(user\.image_url\)/);
  assert.match(labMembersSource, /src=\{profileImageHref\}/);
  assert.doesNotMatch(labMembersSource, /src=\{user\.image_url\}/);

  assert.match(profileEditorSource, /import \{[^}]*safeHttpUrl[^}]*\} from '\.\.\/\.\.\/utils\/url'/);
  assert.match(profileEditorSource, /const profileImageHref = safeHttpUrl\(profile\.image_url\)/);
  assert.match(profileEditorSource, /src=\{profileImageHref\}/);
  assert.doesNotMatch(profileEditorSource, /src=\{profile\.image_url\}/);

  assert.match(developerCardSource, /import \{ EXTERNAL_IMAGE_REFERRER_POLICY, safeHttpUrl, safeImageSrc \} from '\.\.\/utils\/url'/);
  assert.match(developerCardSource, /const websiteHref = safeHttpUrl\(developer\.website\)/);
  assert.match(developerCardSource, /const linkedinHref = safeHttpUrl\(developer\.linkedin\)/);
  assert.match(developerCardSource, /const githubHref = safeHttpUrl\(developer\.github\)/);
  assert.match(developerCardSource, /const imageSrc = safeImageSrc\(developer\.image\) \|\| '\/assets\/developers\/no-user\.png'/);
  assert.match(developerCardSource, /src=\{imageSrc\}/);
  assert.doesNotMatch(developerCardSource, /src=\{developer\.image/);
  assert.doesNotMatch(developerCardSource, /safeUrl\(/);

  assert.match(publicationsTableSource, /import \{ safeDoiUrl, safeHttpUrl \} from '\.\.\/\.\.\/utils\/url'/);
  assert.match(publicationsTableSource, /safeHttpUrl\(pub\.open_access_url\)/);
  assert.doesNotMatch(publicationsTableSource, /safeUrl\(pub\.open_access_url\)/);
});

test('programmatic new-tab opener only opens safe HTTP(S) URLs', () => {
  const source = fs.readFileSync(new URL('../client/src/utils/url.ts', import.meta.url), 'utf8');

  assert.match(source, /export const NEW_TAB_WINDOW_FEATURES = 'noopener,noreferrer'/);
  assert.match(source, /export const openSafeUrlInNewTab = \(raw: unknown\): Window \| null => \{[\s\S]*const href = safeHttpUrl\(raw\)/);
  assert.match(source, /window\.open\(href, '_blank', NEW_TAB_WINDOW_FEATURES\)/);
  assert.match(source, /if \(opened\) opened\.opener = null/);
  assert.doesNotMatch(source, /export const openSafeUrlInNewTab = \(raw: unknown\): Window \| null => \{[\s\S]*const href = safeUrl\(raw\)/);
});

test('client UI does not surface raw Axios error payload text', () => {
  const helperSource = fs.readFileSync(
    new URL('../client/src/utils/clientErrorMessage.ts', import.meta.url),
    'utf8',
  );
  const clientFiles = [
    '../client/src/components/accounts/ProfileEditor.tsx',
    '../client/src/components/admin/AdminProfileEditModal.tsx',
    '../client/src/components/admin/AdminListingEditModal.tsx',
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

test('public faculty profiles omit direct contact and office-location fields', () => {
  const profileServiceSource = fs.readFileSync(
    new URL('../server/src/services/profileService.ts', import.meta.url),
    'utf8',
  );

  assert.match(profileServiceSource, /Direct contact\/location fields are intentionally excluded/);
  assert.doesNotMatch(profileServiceSource, /'email',\s*\n\s*'userType'/);
  assert.doesNotMatch(profileServiceSource, /'physicalLocation'/);
  assert.doesNotMatch(profileServiceSource, /'buildingDesk'/);
  const responseFieldsMatch = profileServiceSource.match(
    /const PUBLIC_PROFILE_BASE_FIELDS = \[([\s\S]*?)\] as const;/,
  );
  assert.ok(responseFieldsMatch, 'public profile base field allowlist should exist');
  const responseFields = responseFieldsMatch[1];
  assert.doesNotMatch(responseFields, /'_id'/);
  assert.doesNotMatch(responseFields, /'id'/);
  assert.doesNotMatch(responseFields, /'userConfirmed'/);
  assert.doesNotMatch(responseFields, /'createdAt'/);
  assert.doesNotMatch(responseFields, /'updatedAt'/);
  assert.doesNotMatch(responseFields, /'ownListings'/);
  assert.doesNotMatch(responseFields, /'favListings'/);
  assert.doesNotMatch(responseFields, /'favFellowships'/);
  assert.doesNotMatch(responseFields, /'favPathways'/);
  assert.match(profileServiceSource, /const MAX_PUBLIC_PROFILE_BASE_TEXT_LENGTH = 500/);
  assert.match(profileServiceSource, /const MAX_PUBLIC_PROFILE_BASE_ARRAY_ITEMS = 50/);
  assert.match(profileServiceSource, /const PUBLIC_PROFILE_BASE_TEXT_FIELDS = new Set<string>/);
  assert.match(profileServiceSource, /const PUBLIC_PROFILE_BASE_ARRAY_FIELDS = new Set<string>/);
  assert.match(profileServiceSource, /redactDirectContactInfo\(text\)\.slice\(0, MAX_PUBLIC_PROFILE_BASE_TEXT_LENGTH\)/);
  assert.match(profileServiceSource, /\.slice\(0, MAX_PUBLIC_PROFILE_BASE_ARRAY_ITEMS\)[\s\S]*?\.map\(publicProfileText\)/);
  assert.match(profileServiceSource, /if \(PUBLIC_PROFILE_BASE_TEXT_FIELDS\.has\(field\)\)/);
  assert.match(profileServiceSource, /else if \(PUBLIC_PROFILE_BASE_ARRAY_FIELDS\.has\(field\)\)/);
  assert.match(profileServiceSource, /else if \(field === 'profileVerified'\)/);
  assert.match(profileServiceSource, /else if \(field === 'hIndex'\)/);
  assert.match(profileServiceSource, /else if \(field === 'imageUrl'\)/);
  assert.match(profileServiceSource, /const rawResearchInterestSummary =\s*user\.researchInterestSummary \|\|[\s\S]*?researchInterestContextSummary\(researchEntities\);/);
  assert.match(profileServiceSource, /const researchInterestSummary = publicResearchSummaryText\(rawResearchInterestSummary\) \|\| ''/);
  assert.doesNotMatch(profileServiceSource, /research_interest_summary: user\.researchInterestSummary/);
  assert.doesNotMatch(profileServiceSource, /physical_location: user\.physicalLocation/);
  assert.doesNotMatch(profileServiceSource, /building_desk: user\.buildingDesk/);
});

test('public profile research-home loading uses safe document id serialization', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/profileService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(source, /const profileDocumentId = \(value: unknown\): string => serializedDocumentId\(value\) \|\| ''/);
  assert.match(source, /\.map\(\(membership: any\) => profileDocumentId\(membership\.researchEntityId\)\)/);
  assert.match(source, /_id: profileDocumentId\(entity\._id\)/);
  assert.match(source, /role: roleByEntityId\.get\(profileDocumentId\(entity\._id\)\) \|\| ''/);
  assert.doesNotMatch(source, /String\(membership\.researchEntityId\)/);
  assert.doesNotMatch(source, /_id: String\(entity\._id\)/);
  assert.doesNotMatch(source, /roleByEntityId\.get\(String\(entity\._id\)\)/);
});

test('public profile scholarly links omit internal user and entity ids', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/profileService.ts', import.meta.url),
    'utf8',
  );
  const serializer = source.match(
    /export const scholarlyLinkToPublicLink = \([\s\S]*?\n\};/,
  );
  assert.ok(serializer, 'public scholarly-link serializer should exist');
  assert.match(source, /const publicScholarlyLinkId = /);
  assert.match(source, /const publicScholarlyExternalIds = /);
  assert.match(source, /const publicScholarlyLinkText = \(value: unknown\): string \| undefined => \{/);
  assert.match(source, /redactDirectContactInfo\(String\(value \|\| ''\)\.trim\(\)\)\.slice\(0, 500\)/);
  assert.match(source, /const publicScholarlyLinkYear = \(value: unknown\): number \| undefined => \{/);
  assert.match(source, /year < 1800 \|\| year > 2200/);
  assert.match(source, /const publicScholarlyLinkConfidence = \(value: unknown\): number \| undefined => \{/);
  assert.match(source, /confidence < 0 \|\| confidence > 1/);
  assert.match(source, /const PUBLIC_SCHOLARLY_DESTINATION_KINDS = new Set/);
  assert.match(source, /const PUBLIC_OPEN_ACCESS_STATUSES = new Set/);
  assert.match(source, /const publicScholarlyDestinationKind = \(value: unknown\): string => \{/);
  assert.match(source, /PUBLIC_SCHOLARLY_DESTINATION_KINDS\.has\(kind\) \? kind : 'OTHER'/);
  assert.match(source, /const publicOpenAccessStatus = \(link: Record<string, any>\): string \| undefined => \{/);
  assert.match(source, /PUBLIC_OPEN_ACCESS_STATUSES\.has\(status\) \? status : undefined/);
  assert.match(source, /publicEntity\._id = publicId/);
  assert.match(serializer[0], /destinationKind: publicScholarlyDestinationKind\(link\.destinationKind\)/);
  assert.match(serializer[0], /publicScholarlyLinkText\(link\.freeFullTextLabel\) \|\| 'Free full text'/);
  assert.match(serializer[0], /openAccessStatus: publicOpenAccessStatus\(link\)/);
  assert.match(serializer[0], /year: publicScholarlyLinkYear\(link\.year\)/);
  assert.match(serializer[0], /venue: publicScholarlyLinkText\(link\.venue\)/);
  assert.match(serializer[0], /confidence,\s*observedAt/);
  assert.match(serializer[0], /relationshipBasis: publicScholarlyLinkText\(options\.relationshipBasis\)/);
  assert.match(serializer[0], /evidenceLabel: publicScholarlyLinkText\(options\.evidenceLabel\)/);
  assert.doesNotMatch(source, /userId: userId \? String\(userId\) : undefined/);
  assert.doesNotMatch(serializer[0], /userId:/);
  assert.doesNotMatch(serializer[0], /researchEntityId:/);
  assert.doesNotMatch(serializer[0], /String\(link\._id \|\| link\.id/);
  assert.doesNotMatch(serializer[0], /externalIds: link\.externalIds \|\| \{\}/);
  assert.doesNotMatch(serializer[0], /destinationKind: link\.destinationKind \|\| 'OTHER'/);
  assert.doesNotMatch(serializer[0], /openAccessStatus: normalizeOpenAccessStatus\(link\) \|\| undefined/);
  assert.doesNotMatch(serializer[0], /freeFullTextLabel:\s*freeFullTextUrl\s*\?\s*link\.freeFullTextLabel/);
  assert.doesNotMatch(serializer[0], /year: link\.year/);
  assert.doesNotMatch(serializer[0], /venue: link\.venue/);
  assert.doesNotMatch(serializer[0], /relationshipBasis: options\.relationshipBasis/);
  assert.doesNotMatch(serializer[0], /evidenceLabel: options\.evidenceLabel/);
});

test('public profile listing payloads redact direct contact text', () => {
  const source = fs.readFileSync(
    new URL('../server/src/controllers/profileController.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ redactDirectContactInfo \} from '\.\.\/utils\/contactRedaction'/);
  assert.match(source, /const publicProfileListingText = \(value: unknown\): string \| undefined =>/);
  assert.match(source, /redactDirectContactInfo\(value\)/);
  assert.match(source, /title: publicProfileListingText\(listing\.title\)/);
  assert.match(source, /description: publicProfileListingText\(listing\.description\)/);
  assert.match(source, /applicantDescription: publicProfileListingText\(listing\.applicantDescription\)/);
  assert.match(source, /departments: publicProfileListingTextArray\(listing\.departments\)/);
  assert.match(source, /archived: false,[\s\S]*confirmed: true/);
  assert.doesNotMatch(source, /title: listing\.title/);
  assert.doesNotMatch(source, /description: listing\.description/);
  assert.doesNotMatch(source, /applicantDescription: listing\.applicantDescription/);
});

test('public profile publication payloads redact and bound text fields', () => {
  const source = fs.readFileSync(
    new URL('../server/src/controllers/profileController.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /MAX_PUBLIC_PROFILE_PUBLICATION_TEXT_LENGTH = 500/);
  assert.match(source, /const publicProfilePublicationText = \(value: unknown\): string \| undefined => \{/);
  assert.match(source, /redactDirectContactInfo\(value\)\.trim\(\)\.slice\(0, MAX_PUBLIC_PROFILE_PUBLICATION_TEXT_LENGTH\)/);
  assert.match(source, /title', publicProfilePublicationText\(publication\.title\)/);
  assert.match(source, /doi', publicProfilePublicationText\(publication\.doi\)/);
  assert.match(source, /venue', publicProfilePublicationText\(publication\.venue\)/);
  assert.match(source, /source', publicProfilePublicationText\(publication\.source\)/);
  assert.doesNotMatch(source, /title', publication\.title/);
  assert.doesNotMatch(source, /doi', publication\.doi/);
  assert.doesNotMatch(source, /venue', publication\.venue/);
  assert.doesNotMatch(source, /source', publication\.source/);
});

test('profile update persistence sanitizes public URL fields for self and admin edits', () => {
  const profileServiceSource = fs.readFileSync(
    new URL('../server/src/services/profileService.ts', import.meta.url),
    'utf8',
  );
  const userControllerSource = fs.readFileSync(
    new URL('../server/src/controllers/userController.ts', import.meta.url),
    'utf8',
  );

  assert.match(profileServiceSource, /const sanitizeSelfEditableProfileUrlFields = \(update: Record<string, any>\) => \{/);
  assert.match(profileServiceSource, /const website = boundedPublicProfileUrl\(update\.website\)/);
  assert.match(profileServiceSource, /const imageUrl = boundedPublicProfileUrl\(update\.imageUrl\)/);
  assert.match(profileServiceSource, /const normalizedUrl = boundedPublicProfileUrl\(url\)/);
  assert.match(
    profileServiceSource,
    /export const updateOwnProfile[\s\S]*sanitizeSelfEditableProfileUrlFields\(update\)/,
  );
  assert.match(
    profileServiceSource,
    /export const adminUpdateProfile[\s\S]*sanitizeSelfEditableProfileUrlFields\(update\)/,
  );
  assert.match(userControllerSource, /const publicProfileUrlKey = \(key: unknown\): string \| undefined => \{/);
  assert.match(userControllerSource, /MAX_CURRENT_USER_BIO_LENGTH/);
  assert.match(userControllerSource, /MAX_CURRENT_USER_ARRAY_ITEMS/);
  assert.match(userControllerSource, /MAX_CURRENT_USER_ARRAY_VALUE_LENGTH/);
  assert.match(userControllerSource, /const sanitizeSelfEditableTextFields = \(update: Record<string, any>\) => \{/);
  assert.match(userControllerSource, /boundedAccountStringArray/);
  assert.match(userControllerSource, /sanitizeSelfEditableTextFields\(update\)/);
  assert.match(userControllerSource, /sanitizeUnknownBootstrapFields\(update\)/);
  const selfUpdateFields = userControllerSource.match(/const SELF_UPDATABLE_FIELDS = \[[\s\S]*?\] as const;/)?.[0] || '';
  assert.doesNotMatch(selfUpdateFields, /'departments'/);
  assert.match(userControllerSource, /if \(update\.primaryDepartment !== undefined \|\| update\.secondaryDepartments !== undefined\) \{/);
  assert.match(userControllerSource, /const current = await readUser\(currentUser\.netId\)/);
  assert.match(userControllerSource, /update\.departments = \[primary, \.\.\.secondary\]\.filter\(Boolean\)/);
  assert.match(userControllerSource, /const SAFE_CURRENT_USER_PROFILE_URL_KEY_RE = \/\^\[A-Za-z0-9 _-\]\{1,80\}\$\//);
  assert.match(userControllerSource, /!SAFE_CURRENT_USER_PROFILE_URL_KEY_RE\.test\(trimmed\)/);
  assert.match(userControllerSource, /trimmed === '__proto__' \|\|/);
  assert.match(userControllerSource, /trimmed === 'constructor' \|\|/);
  assert.match(userControllerSource, /trimmed === 'prototype'/);
  assert.doesNotMatch(userControllerSource, /replace\(\/\^\\\$\+\/, '_'\)\.replace\(\/\\\.\/g, '_'\)/);
  assert.match(userControllerSource, /const normalizedKey = publicProfileUrlKey\(key\)/);
  assert.match(userControllerSource, /slice\(0, MAX_CURRENT_USER_PROFILE_URLS\)/);
});

test('public URL normalization rejects local and private-network browser targets', () => {
  const serverUrlSource = fs.readFileSync(
    new URL('../server/src/utils/urlSafety.ts', import.meta.url),
    'utf8',
  );
  const clientUrlSource = fs.readFileSync(new URL('../client/src/utils/url.ts', import.meta.url), 'utf8');

  for (const source of [serverUrlSource, clientUrlSource]) {
    assert.match(source, /PRIVATE_IPV4_CIDRS/);
    assert.match(source, /'127\.0\.0\.0', 8/);
    assert.match(source, /'169\.254\.0\.0', 16/);
    assert.match(source, /'192\.168\.0\.0', 16/);
    assert.match(source, /PRIVATE_HOSTNAME_SUFFIXES = \['\.local', '\.internal', '\.lan', '\.home\.arpa', '\.localdomain'\]/);
    assert.match(source, /clean === 'localhost' \|\| clean\.endsWith\('\.localhost'\)/);
    assert.match(source, /PRIVATE_HOSTNAME_SUFFIXES\.some\(\(suffix\) => clean\.endsWith\(suffix\)\)/);
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

test('admin profile publication persistence is bounded and allowlisted', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/profileService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /MAX_ADMIN_PROFILE_PUBLICATIONS = 100/);
  assert.match(source, /MAX_ADMIN_PROFILE_PUBLICATION_TEXT_LENGTH = 500/);
  assert.match(source, /const normalizeAdminProfilePublications = \(value: unknown\): Record<string, any>\[\] => \{/);
  assert.match(source, /value\.slice\(0, MAX_ADMIN_PROFILE_PUBLICATIONS\)\.flatMap/);
  assert.match(source, /const title = boundedPublicationText\(record\.title\)/);
  assert.match(source, /if \(!title\) return \[\]/);
  assert.match(source, /const openAccessUrl = boundedPublicProfileUrl\(record\.openAccessUrl \?\? record\.open_access_url\)/);
  assert.match(source, /update\.publications = normalizeAdminProfilePublications\(source\.publications\)/);
  assert.doesNotMatch(source, /update\.publications = data\.publications/);
});

test('admin profile updates bound allowlisted fields before persistence', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/profileService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const sanitizeAdminProfileTextFields = \(update: Record<string, any>\) =>/);
  assert.match(source, /const sanitizeAdminProfileScalarFields = \(update: Record<string, any>\) =>/);
  assert.match(source, /const ADMIN_PROFILE_USER_TYPES = new Set\(\[\s*'admin',\s*'professor',\s*'faculty',\s*'undergraduate',\s*'graduate',\s*'unknown',\s*\]\)/);
  assert.match(source, /data && typeof data === 'object' && !Array\.isArray\(data\)/);
  assert.match(source, /sanitizeAdminProfileTextFields\(update\)/);
  assert.match(source, /sanitizeSelfEditableProfileUrlFields\(update\)/);
  assert.match(source, /sanitizeAdminProfileScalarFields\(update\)/);
  assert.match(source, /normalizeAdminProfilePublications\(source\.publications\)/);
  assert.doesNotMatch(source, /if \(data\[field\] !== undefined\)/);
  assert.doesNotMatch(source, /update\[field\] = data\[field\]/);
});

test('current-user mutation responses omit internal account join fields', () => {
  const source = fs.readFileSync(
    new URL('../server/src/controllers/userController.ts', import.meta.url),
    'utf8',
  );
  const responseFieldsMatch = source.match(/const CURRENT_USER_RESPONSE_FIELDS = \[([\s\S]*?)\] as const;/);
  assert.ok(responseFieldsMatch);
  const responseFields = responseFieldsMatch[1];

  assert.doesNotMatch(responseFields, /'facultyMemberId'/);
  assert.doesNotMatch(responseFields, /'studentProfileId'/);
  assert.doesNotMatch(responseFields, /'ownListings'/);
  assert.doesNotMatch(responseFields, /'favListings'/);
  assert.doesNotMatch(responseFields, /'favFellowships'/);
  assert.doesNotMatch(responseFields, /'favPathways'/);
  assert.doesNotMatch(responseFields, /'savedPathwayPlans'/);
  assert.doesNotMatch(responseFields, /'createdAt'/);
  assert.doesNotMatch(responseFields, /'updatedAt'/);
});

test('public PI official profile routes reject credential-bearing URLs', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/researchGroupService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const isLikelyOfficialPersonProfileUrl = \(value: unknown\): boolean => \{/);
  assert.match(source, /if \(!isPublicHttpUrl\(trimmed\)\) return false/);
  assert.match(
    source,
    /Object\.entries\(value as Record<string, unknown>\)\.filter\(\s*\(\[, url\]\) => publicHttpUrl\(url\)\s*,?\s*\)/,
  );
  assert.match(
    source,
    /sourceUrl:\s*publicHttpUrl\(officialProfileUrl \|\| lead\.row\?\.sourceUrl \|\| group\?\.websiteUrl\) \|\| ''/,
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
  assert.match(clientUrlSource, /Array\.isArray\(values\) \? values\.slice\(0, MAX_SAFE_URL_LIST_ITEMS\) : \[\]/);
  assert.match(clientUrlSource, /trimmed\.length > MAX_SAFE_EMAIL_LENGTH/);
  assert.match(clientUrlSource, /withoutMailto\.length > MAX_SAFE_EMAIL_LENGTH/);
  assert.match(clientUrlSource, /typeof params\.subject === 'string' && params\.subject\.length <= MAX_SAFE_MAILTO_SUBJECT_LENGTH/);
  assert.match(clientUrlSource, /typeof params\.body === 'string' && params\.body\.length <= MAX_SAFE_MAILTO_BODY_LENGTH/);
  assert.match(clientUrlSource, /rawDoi\.trim\(\)\.length > MAX_SAFE_DOI_LENGTH/);
  assert.match(serverUrlSource, /MAX_PUBLIC_HTTP_URL_LENGTH = 2048/);
  assert.match(serverUrlSource, /trimmed\.length > MAX_PUBLIC_HTTP_URL_LENGTH/);
});

test('publication DOI links use the shared DOI sanitizer', () => {
  const urlSource = fs.readFileSync(new URL('../client/src/utils/url.ts', import.meta.url), 'utf8');
  const doiRenderers = [
    '../client/src/components/labs/LabPapersList.tsx',
    '../client/src/components/profile/PublicationsTable.tsx',
    '../client/src/components/admin/AdminProfileEditModal.tsx',
  ];

  assert.match(urlSource, /export const safeDoiUrl = \(rawDoi: unknown\): string => \{/);
  assert.match(urlSource, /DOI_PATTERN/);
  for (const file of doiRenderers) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /safeDoiUrl/);
    assert.doesNotMatch(source, /https:\/\/doi\.org\/\$\{/);
  }
});

test('research activity title normalization avoids HTML parser sinks', () => {
  const source = fs.readFileSync(
    new URL('../client/src/components/labs/LabPapersList.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /const decodeNumericEntity = \(value: string, radix: number\): string =>/);
  assert.match(source, /codePoint <= 0x10ffff/);
  assert.doesNotMatch(source, /innerHTML|outerHTML|document\.write|dangerouslySetInnerHTML/);
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
    '../client/src/components/accounts/ProfileEditor.tsx',
    '../client/src/components/profile/ProfileHeader.tsx',
    '../client/src/components/DeveloperCard.tsx',
  ];

  for (const file of imageRenderers) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /EXTERNAL_IMAGE_REFERRER_POLICY/);
    assert.match(source, /referrerPolicy=\{EXTERNAL_IMAGE_REFERRER_POLICY\}/);
  }
});

test('account tracking notes redact in memory and are not persisted to localStorage', () => {
  const source = fs.readFileSync(
    new URL('../client/src/reducers/accountTrackingReducer.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const TRACKING_EMAIL_RE = /);
  assert.match(source, /const TRACKING_PHONE_RE = /);
  assert.match(source, /const redactTrackingContactInfo = \(value: string\): string =>/);
  assert.match(source, /redactTrackingContactInfo\(value\)\.slice\(0, MAX_TRACKING_NOTE_LENGTH\)/);
  assert.match(source, /const PRIVATE_TRACKING_STORAGE_KEYS = new Set\(\['lab-notes', 'fellowship-notes'\]\)/);
  assert.match(source, /if \(PRIVATE_TRACKING_STORAGE_KEYS\.has\(key\)\) \{\s*storage\.removeItem\(fullKey\);\s*return;\s*\}/);
  assert.match(source, /storage\.removeItem\(storageKey\('lab-notes', ownerKey\)\)/);
  assert.match(source, /storage\.removeItem\(storageKey\('fellowship-notes', ownerKey\)\)/);
  assert.doesNotMatch(source, /labNotes: normalizeTrackingNotes\(parse\(storageKey\('lab-notes', ownerKey\)\)\)/);
  assert.doesNotMatch(source, /fellowshipNotes: normalizeTrackingNotes\(parse\(storageKey\('fellowship-notes', ownerKey\)\)\)/);
  assert.doesNotMatch(
    source,
    /typeof value === 'string' \? value\.slice\(0, MAX_TRACKING_NOTE_LENGTH\) : ''/,
  );
});

test('scraper materializer logs sanitize untrusted exception values', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/entityMaterializer.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ sanitizeLogValue \} from '\.\.\/utils\/logSanitizer'/);
  assert.match(source, /sanitizeLogValue\(\{ entityId: entityIdString, error \}\)/);
  assert.match(source, /materializePaperObservationsFromRun failed:', sanitizeLogValue\(err\)/);
  assert.doesNotMatch(source, /console\.error\('Failed to recompute browseRankScore for', entityIdString, error\)/);
  assert.doesNotMatch(source, /\(err as Error\)\?\.message \|\| err/);
});

test('scraper cron heartbeat logs sanitize lock exceptions', () => {
  const source = fs.readFileSync(
    new URL('../server/src/scrapers/cronRunner.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ sanitizeLogValue \} from '\.\.\/utils\/logSanitizer'/);
  assert.match(source, /Failed to heartbeat scraper cron lock for \$\{input\.sourceName\}:/);
  assert.match(source, /sanitizeLogValue\(error\)/);
  assert.doesNotMatch(source, /error instanceof Error \? error\.message : error/);
  assert.doesNotMatch(source, /console\.error\([^;]*error\.message[^;]*\)/);
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

  assert.match(orchestratorSource, /import \{ sanitizeLogValue \} from '\.\.\/utils\/logSanitizer'/);
  assert.match(orchestratorSource, /const errorMessage = sanitizeLogValue\(err instanceof Error \? err\.message : err\)/);
  assert.match(orchestratorSource, /\{ message: errorMessage \|\| 'Unknown scrape error', at: new Date\(\) \}/);
  assert.doesNotMatch(orchestratorSource, /message: err\?\.message/);
  assert.doesNotMatch(orchestratorSource, /stack: err\?\.stack/);

  assert.match(reportSource, /import \{ sanitizeLogValue \} from '\.\.\/utils\/logSanitizer'/);
  assert.match(reportSource, /const reportErrorMessage = \(message: unknown\): string =>/);
  assert.match(reportSource, /const reportErrorContext = \(context: unknown\): string \| undefined =>/);
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

test('spreadsheet exports neutralize formula-like cell values', () => {
  const spreadsheetSafetySource = fs.readFileSync(
    new URL('../client/src/utils/spreadsheetSafety.ts', import.meta.url),
    'utf8',
  );
  const googleSheetsSource = fs.readFileSync(
    new URL('../client/src/utils/googleSheets.ts', import.meta.url),
    'utf8',
  );
  const googleOAuthCallbackSource = fs.readFileSync(
    new URL('../client/public/oauth-callback.js', import.meta.url),
    'utf8',
  );
  const googleOAuthCallbackDistUrl = new URL('../client/dist/oauth-callback.js', import.meta.url);
  // dist/ is a build output; enforce the dist copy only when a build exists.
  const googleOAuthCallbackDistSource = fs.existsSync(googleOAuthCallbackDistUrl)
    ? fs.readFileSync(googleOAuthCallbackDistUrl, 'utf8')
    : null;
  const favoritesManagerSource = fs.readFileSync(
    new URL('../client/src/components/accounts/FavoritesManager.tsx', import.meta.url),
    'utf8',
  );
  const acceptedInputsSource = fs.readFileSync(
    new URL('../server/src/acceptedInputs/fellowshipInputs.ts', import.meta.url),
    'utf8',
  );
  const acceptedInputsCoreSource = fs.readFileSync(
    new URL('../server/src/scripts/acceptedInputsCore.ts', import.meta.url),
    'utf8',
  );

  assert.match(spreadsheetSafetySource, /SPREADSHEET_FORMULA_PREFIX/);
  assert.match(spreadsheetSafetySource, /\[\\s\\u0000-\\u001f\]\*\[=\+\\-@\]/);
  assert.match(googleSheetsSource, /safeSheetCell/);
  assert.match(googleSheetsSource, /normalizeOAuthAccessToken/);
  assert.match(googleSheetsSource, /ACCESS_TOKEN_PATTERN/);
  assert.match(googleSheetsSource, /let cachedToken: string \| null = null/);
  assert.match(googleSheetsSource, /oauthChannelNameForState/);
  assert.match(googleSheetsSource, /new BroadcastChannel\(oauthChannelNameForState\(oauthState\)\)/);
  assert.match(googleSheetsSource, /OAUTH_POPUP_NAME_PREFIX = 'google-auth'/);
  assert.match(googleSheetsSource, /OAUTH_POPUP_FEATURES = 'popup,width=500,height=600,noopener,noreferrer'/);
  assert.match(googleSheetsSource, /oauthPopupNameForState/);
  assert.match(googleSheetsSource, /window\.open\('about:blank', oauthPopupNameForState\(state\), OAUTH_POPUP_FEATURES\)/);
  assert.match(googleSheetsSource, /popup\.opener = null/);
  assert.doesNotMatch(googleSheetsSource, /OAUTH_POPUP_FEATURES = 'popup,width=500,height=600'/);
  assert.doesNotMatch(googleSheetsSource, /window\.open\('about:blank', 'google-auth'/);
  assert.ok(
    googleSheetsSource.indexOf('popup.opener = null') >= 0 &&
      googleSheetsSource.indexOf('popup.location.href = authUrl') >
        googleSheetsSource.indexOf('popup.opener = null'),
    'Google OAuth popup must clear opener before navigating to the provider',
  );
  assert.match(googleSheetsSource, /MAX_SHEET_TITLE_LENGTH = 120/);
  assert.match(googleSheetsSource, /MAX_SHEET_HEADERS = 50/);
  assert.match(googleSheetsSource, /MAX_SHEET_ROWS = 1000/);
  assert.match(googleSheetsSource, /MAX_SHEET_CELL_LENGTH = 2000/);
  assert.match(googleSheetsSource, /SHEETS_REQUEST_TIMEOUT_MS = 15000/);
  assert.match(googleSheetsSource, /const token = await getAccessToken\(clientId\);\s*cachedToken = null;/);
  assert.match(googleSheetsSource, /safeSpreadsheetCell\(String\(value \?\? ''\)\.slice\(0, MAX_SHEET_CELL_LENGTH\)\)/);
  assert.match(googleSheetsSource, /headers\.slice\(0, MAX_SHEET_HEADERS\)/);
  assert.match(googleSheetsSource, /rows\.slice\(0, MAX_SHEET_ROWS\)/);
  assert.match(googleSheetsSource, /properties: \{ title: safeSheetTitle\(title\) \}/);
  assert.match(googleSheetsSource, /const abortController = new AbortController\(\)/);
  assert.match(googleSheetsSource, /window\.setTimeout\(\(\) => abortController\.abort\(\), SHEETS_REQUEST_TIMEOUT_MS\)/);
  assert.match(googleSheetsSource, /signal: abortController\.signal/);
  assert.match(googleSheetsSource, /if \(abortController\.signal\.aborted\) \{\s*throw new Error\('Google Sheets request timed out'\)/);
  assert.match(googleSheetsSource, /try \{[\s\S]*Authorization: `Bearer \$\{token\}`[\s\S]*\} finally \{\s*window\.clearTimeout\(timeoutId\);\s*cachedToken = null;\s*\}/);
  assert.match(googleSheetsSource, /safeGoogleSpreadsheetUrl/);
  assert.match(googleSheetsSource, /url\.hostname !== 'docs\.google\.com'/);
  assert.match(googleSheetsSource, /url\.pathname\.startsWith\('\/spreadsheets\/'\)/);
  for (const callbackSource of [googleOAuthCallbackSource, googleOAuthCallbackDistSource].filter(Boolean)) {
    assert.match(callbackSource, /ACCESS_TOKEN_PATTERN/);
    assert.match(callbackSource, /OAUTH_STATE_PATTERN/);
    assert.match(callbackSource, /oauthChannelNameForState/);
    assert.match(callbackSource, /new BroadcastChannel\(oauthChannelNameForState\(state\)\)/);
    assert.match(callbackSource, /MAX_ACCESS_TOKEN_LENGTH = 4096/);
    assert.match(callbackSource, /safeToken\(params\.get\('access_token'\)\)/);
    assert.match(callbackSource, /safeState\(params\.get\('state'\)\)/);
    assert.match(callbackSource, /if \(token && state\)/);
    assert.doesNotMatch(callbackSource, /new BroadcastChannel\('google-oauth-token'\)/);
    assert.doesNotMatch(callbackSource, /token = params\.get\('access_token'\)/);
  }
  assert.match(googleSheetsSource, /safeSheetCell\(cell\)/);
  assert.match(googleSheetsSource, /stringValue:\s*safeSheetCell\(h\)/);
  assert.match(googleSheetsSource, /stringValue:\s*safeSheetCell\(cell\)/);
  assert.match(favoritesManagerSource, /safeSpreadsheetCell\(cell\)/);
  assert.match(acceptedInputsSource, /safeSpreadsheetCell\(value\)/);
  assert.match(acceptedInputsCoreSource, /safeSpreadsheetCell\(value\)/);
  const userServiceSource = fs.readFileSync(
    new URL('../server/src/services/userService.ts', import.meta.url),
    'utf8',
  );
  assert.match(userServiceSource, /import \{ safeSpreadsheetCell \} from '\.\.\/utils\/spreadsheetSafety'/);
  assert.match(userServiceSource, /safeSpreadsheetCell\(redactDirectContactInfo\(String\(value \|\| ''\)\)\)/);
  assert.match(userServiceSource, /safeSpreadsheetCell\(String\(value \|\| ''\)\)/);
});

test('saved research-plan local storage hydration is bounded and normalized', () => {
  const source = fs.readFileSync(
    new URL('../client/src/components/accounts/SavedPathwaysSection.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /MAX_STORED_PLAN_COUNT = 100/);
  assert.match(source, /MAX_PLAN_NOTE_LENGTH = 2000/);
  assert.match(source, /MAX_PLAN_STORAGE_VALUE_LENGTH = 100_000/);
  assert.match(source, /PLAN_STORAGE_OWNER_RE = \/\^\[A-Za-z0-9\]\{2,12\}\$\/;/);
  assert.match(source, /export const normalizeSavedPlanStorageOwner = \(value: unknown\): string \| undefined =>/);
  assert.match(source, /export const savedPlanStorageKeyForOwner = \(owner: unknown\): string \| undefined =>/);
  assert.match(source, /STORAGE_PLAN_ID_RE = \/\^\[A-Za-z0-9_-\]\{1,80\}\$\//);
  assert.match(source, /raw\.length > MAX_PLAN_STORAGE_VALUE_LENGTH/);
  assert.match(source, /window\.localStorage\.removeItem\(PLAN_STORAGE_KEY\)/);
  assert.match(source, /catch \{\s*console\.error\('Error reading saved research plans\.'\);\s*const storageKey = savedPlanStorageKeyForOwner\(owner\);/);
  assert.match(source, /if \(storageKey\) window\.localStorage\.removeItem\(storageKey\);/);
  assert.match(source, /normalizePathwayPlanMap\(JSON\.parse\(raw\)\)/);
  assert.match(source, /const localStoragePlanMap = \(plans: PathwayPlanMap\): PathwayPlanMap =>/);
  assert.match(source, /note: '',\s*checklist: \{\},/);
  assert.match(source, /export const readStoredPlans = \(owner\?: unknown\): PathwayPlanMap => \{/);
  assert.match(source, /export const writeStoredPlans = \(plans: PathwayPlanMap, owner\?: unknown\): void => \{/);
  assert.match(source, /const serialized = JSON\.stringify\(localStoragePlanMap\(plans\)\)/);
  assert.match(source, /serialized\.length > MAX_PLAN_STORAGE_VALUE_LENGTH/);
  assert.match(source, /export const filterStoredPlansForSavedPathways = \(/);
  assert.match(source, /const planStorageOwner = normalizeSavedPlanStorageOwner\(user\?\.netId\)/);
  assert.match(source, /const \[hydratedPlanStorageOwner, setHydratedPlanStorageOwner\] = useState<string \| undefined>\(\)/);
  assert.match(source, /activePlanStorageOwnerRef\.current = ownerAtLoad/);
  assert.match(source, /if \(!planStorageOwner \|\| hydratedPlanStorageOwner !== planStorageOwner\) return/);
  assert.match(source, /const localPlansForSavedPathways = filterStoredPlansForSavedPathways\(/);
  assert.match(source, /mergeSavedPathwayPlansForHydration\(\s*localPlansForSavedPathways,\s*serverPlans,\s*\)/);
  assert.match(source, /getLocalOnlySavedPathwayPlanIds\(\s*localPlansForSavedPathways,\s*serverPlans,\s*savedPathwayIds,\s*\)/);
  assert.match(source, /writeStoredPlans\(plans, planStorageOwner\)/);
  assert.doesNotMatch(source, /window\.localStorage\.setItem\(PLAN_STORAGE_KEY, JSON\.stringify/);
  assert.doesNotMatch(source, /readStoredPlans\(\)/);
  assert.doesNotMatch(source, /writeStoredPlans\(plans\)/);
  assert.match(source, /note: normalizePlanNote\(event\.target\.value\)/);
});

test('user account routes set full private no-store response headers', () => {
  const routeSource = fs.readFileSync(new URL('../server/src/routes/users.ts', import.meta.url), 'utf8');
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

test('authenticated profile and research-area routes set full private no-store response headers', () => {
  const routeFiles = [
    '../server/src/routes/profiles.ts',
    '../server/src/routes/researchAreas.ts',
  ];

  for (const file of routeFiles) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /Cache-Control', 'no-store, private, max-age=0'/);
    assert.match(source, /Pragma', 'no-cache'/);
    assert.match(source, /Surrogate-Control', 'no-store'/);
    assert.match(source, /Expires', '0'/);
    assert.match(source, /X-Content-Type-Options', 'nosniff'/);
  }
});

test('account tracking local storage hydration is bounded and normalized', () => {
  const source = fs.readFileSync(
    new URL('../client/src/reducers/accountTrackingReducer.ts', import.meta.url),
    'utf8',
  );
  const favoritesManagerSource = fs.readFileSync(
    new URL('../client/src/components/accounts/FavoritesManager.tsx', import.meta.url),
    'utf8',
  );
  const debounceStorageSource = fs.readFileSync(
    new URL('../client/src/hooks/useDebouncedLocalStorage.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /MAX_TRACKING_ITEMS = 100/);
  assert.match(source, /MAX_TRACKING_NOTE_LENGTH = 2000/);
  assert.match(source, /MAX_TRACKING_STORAGE_VALUE_LENGTH = 100_000/);
  assert.match(source, /TRACKING_ID_RE = \/\^\[A-Za-z0-9_-\]\{1,80\}\$\//);
  assert.match(source, /TRACKING_OWNER_RE = \/\^\[A-Za-z0-9\]\{2,80\}\$\//);
  assert.match(source, /normalizeAccountTrackingStorageOwner/);
  assert.match(source, /`\$\{STORAGE_PREFIX\}-\$\{ownerKey\}-\$\{key\}`/);
  assert.match(source, /removeUnscopedTrackingStorage\(storage\)/);
  assert.match(source, /raw\.length > MAX_TRACKING_STORAGE_VALUE_LENGTH/);
  assert.match(source, /storage\.removeItem\(key\)/);
  assert.match(source, /catch \{\s*storage\.removeItem\(key\);\s*return null;\s*\}/);
  assert.doesNotMatch(source, /parseMigrated/);
  assert.match(source, /storage\.removeItem\(storageKey\('lab-notes', ownerKey\)\)/);
  assert.match(source, /storage\.removeItem\(storageKey\('fellowship-notes', ownerKey\)\)/);
  assert.doesNotMatch(source, /normalizeTrackingNotes\(parse\(storageKey\('lab-notes', ownerKey\)\)\)/);
  assert.doesNotMatch(source, /normalizeTrackingNotes\(parse\(storageKey\('fellowship-notes', ownerKey\)\)\)/);
  assert.match(source, /normalizeLabStageMap\(parse\(storageKey\('lab-stages', ownerKey\)\)\)/);
  assert.match(source, /normalizeFellowshipStageMap\(parse\(storageKey\('fellowship-stages', ownerKey\)\)\)/);
  assert.match(source, /normalizeAccountTrackingState\(\{ \.\.\.state, \.\.\.action\.payload \}\)/);
  assert.match(source, /normalizeTrackingNote\(action\.value\)/);
  assert.match(source, /persistAccountTrackingToStorage/);
  assert.match(source, /PRIVATE_TRACKING_STORAGE_KEYS\.has\(key\)/);
  assert.match(source, /serialized\.length > MAX_TRACKING_STORAGE_VALUE_LENGTH/);
  assert.match(source, /storage\.setItem\(fullKey, serialized\)/);
  assert.match(favoritesManagerSource, /normalizeAccountTrackingStorageOwner\(user\?\.netId\)/);
  assert.match(favoritesManagerSource, /hydratedTrackingOwner/);
  assert.match(favoritesManagerSource, /setHydratedTrackingOwner\(trackingStorageOwner\)/);
  assert.match(favoritesManagerSource, /hydratedTrackingOwner !== trackingStorageOwner/);
  assert.match(favoritesManagerSource, /loadAccountTrackingFromStorage\(localStorage, trackingStorageOwner\)/);
  assert.match(favoritesManagerSource, /persistAccountTrackingToStorage\([\s\S]*?'fellowship-stages'[\s\S]*?trackingStorageOwner[\s\S]*?\)/);
  assert.match(favoritesManagerSource, /persistAccountTrackingToStorage\([\s\S]*?'fellowship-notes'[\s\S]*?trackingStorageOwner[\s\S]*?\)/);
  assert.doesNotMatch(favoritesManagerSource, /localStorage\.setItem\('yale-research-fellowship/);
  assert.match(debounceStorageSource, /MAX_DEBOUNCED_STORAGE_KEY_LENGTH = 120/);
  assert.match(debounceStorageSource, /MAX_DEBOUNCED_STORAGE_VALUE_LENGTH = 100_000/);
  assert.match(debounceStorageSource, /safeKey\.length > MAX_DEBOUNCED_STORAGE_KEY_LENGTH/);
  assert.match(debounceStorageSource, /serialized\.length > MAX_DEBOUNCED_STORAGE_VALUE_LENGTH/);
});

test('posted-opportunity and application-route maintenance artifacts use safe JSON paths', () => {
  const applicationRouteBackfill = fs.readFileSync(
    new URL('../server/src/scripts/backfillApplicationRoutePathways.ts', import.meta.url),
    'utf8',
  );
  const postedOpportunityBackfill = fs.readFileSync(
    new URL('../server/src/scripts/backfillPostedOpportunitiesFromListings.ts', import.meta.url),
    'utf8',
  );
  const postedOpportunityReaper = fs.readFileSync(
    new URL('../server/src/scripts/reapPostedOpportunityStatuses.ts', import.meta.url),
    'utf8',
  );

  for (const [name, source] of [
    ['application route pathway backfill', applicationRouteBackfill],
    ['posted opportunity backfill', postedOpportunityBackfill],
    ['posted opportunity status reaper', postedOpportunityReaper],
  ]) {
    assert.match(
      source,
      /import \{ assertScriptApplyAllowed, resolveSafeJsonReportOutputPath \} from '\.\/scriptWriteGuards'/,
      `${name} must import the shared safe JSON report path resolver`,
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
      `${name} must not write raw --output paths`,
    );
    assert.doesNotMatch(
      source,
      /fs\.mkdirSync\(path\.dirname\(output\)/,
      `${name} must not create raw --output directories`,
    );
  }
});

test('program maintenance artifacts use safe JSON paths and safe review inputs', () => {
  const programResearchRelevance = fs.readFileSync(
    new URL('../server/src/scripts/auditProgramResearchRelevance.ts', import.meta.url),
    'utf8',
  );
  const programClassifications = fs.readFileSync(
    new URL('../server/src/scripts/backfillProgramClassifications.ts', import.meta.url),
    'utf8',
  );
  const programOfficialSources = fs.readFileSync(
    new URL('../server/src/scripts/backfillProgramOfficialSources.ts', import.meta.url),
    'utf8',
  );

  for (const [name, source] of [
    ['program research relevance audit', programResearchRelevance],
    ['program classification backfill', programClassifications],
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
  assert.match(programOfficialSources, /return resolveSafeJsonReportOutputPath\(input, '--input'\)/);
  assert.match(programOfficialSources, /const safeInput = resolveProgramOfficialSourceInputPath\(input\)/);
  assert.doesNotMatch(programOfficialSources, /fs\.readFileSync\(input,/);
  assert.match(programResearchRelevance, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(programResearchRelevance, /recordId: serializedDocumentId\(program\._id\) \|\| ''/);
  assert.doesNotMatch(programResearchRelevance, /recordId: String\(program\._id\)/);
  assert.doesNotMatch(programResearchRelevance, /String\(program\._id\)/);
  assert.match(programClassifications, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(programClassifications, /updates\.push\(\{ id: serializedDocumentId\(row\._id\) \|\| '', title: row\.title, classification \}\)/);
  assert.doesNotMatch(programClassifications, /id: String\(row\._id\)/);
  assert.doesNotMatch(programClassifications, /String\(row\._id\)/);
});

test('Meilisearch rebuild artifacts use safe JSON output paths', () => {
  const pathwayRebuild = fs.readFileSync(
    new URL('../server/src/scripts/rebuildPathwaySearchIndex.ts', import.meta.url),
    'utf8',
  );
  const researchEntityRebuild = fs.readFileSync(
    new URL('../server/src/scripts/rebuildResearchEntitySearchIndex.ts', import.meta.url),
    'utf8',
  );

  for (const [name, source] of [
    ['pathway search index rebuild', pathwayRebuild],
    ['research entity search index rebuild', researchEntityRebuild],
  ]) {
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
    ['professor bio coverage audit', '../server/src/scripts/profileBioCoverageAudit.ts'],
    ['research entity coverage audit', '../server/src/scripts/researchEntityCoverageAudit.ts'],
    ['profile image quality audit', '../server/src/scripts/profileImageQualityAudit.ts'],
    ['pathway quality audit', '../server/src/scripts/pathwayQualityAudit.ts'],
    ['research quality search review', '../server/src/scripts/researchQualitySearchReview.ts'],
    ['pathway relevance review', '../server/src/scripts/pathwayRelevanceReview.ts'],
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

test('publication and scholarly audit artifacts use safe JSON output paths', () => {
  const files = [
    ['scholarly link provenance audit', '../server/src/scripts/scholarlyLinkProvenanceAudit.ts'],
    ['scholarly link suppression audit', '../server/src/scripts/scholarlyLinkSuppressionAudit.ts'],
    ['paper quality audit', '../server/src/scripts/paperQualityAudit.ts'],
    ['paper authorship audit', '../server/src/scripts/paperAuthorshipAudit.ts'],
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
    ['research entity collection migration', '../server/src/scripts/migrateResearchEntityCollections.ts'],
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
    ['research home URL backfill', '../server/src/scripts/backfillResearchHomeOfficialUrls.ts'],
    ['research description backfill', '../server/src/scripts/backfillResearchDescriptions.ts'],
    ['profile bio backfill', '../server/src/scripts/backfillProfileBiosFromOfficialUrls.ts'],
    ['center directors backfill', '../server/src/scripts/backfillCenterDirectors.ts'],
    ['faculty ways-in backfill', '../server/src/scripts/backfillFacultyWaysIn.ts'],
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
    ['exploratory contact pathway dedupe', '../server/src/scripts/dedupeExploratoryContactPathways.ts'],
    ['duplicate access signal repair', '../server/src/scripts/repairDuplicateAccessSignals.ts'],
    ['profile description conflict repair', '../server/src/scripts/repairProfileDescriptionBackfillConflicts.ts'],
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

  const contactRouteSerializer = source.match(
    /const publicContactRouteForResearchDetail = \(route: any\) => \(\{[\s\S]*?\n\}\);/,
  );
  assert.ok(contactRouteSerializer, 'public contact-route serializer should exist');
  assert.doesNotMatch(contactRouteSerializer[0], /_id:/);
  assert.doesNotMatch(contactRouteSerializer[0], /email:/);
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
  assert.match(serviceSource, /publicMemberKeysByInternalId/);
  assert.match(serviceSource, /memberKey: pair\.memberDisplayId/);
  assert.doesNotMatch(serviceSource, /userId: pair\.memberDisplayId/);
  assert.doesNotMatch(serviceSource, /researchEntityId: String\(researchEntityId \|\| ''\)/);

  const accessSignalSerializer = serviceSource.match(
    /const publicAccessSignalForResearchDetail = \(signal: any\) => \(\{[\s\S]*?\n\}\);/,
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
  assert.match(clientTypeSource, /memberKey\?: string/);
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
  const publicFellowshipControllerSortFields = fellowshipControllerSource.match(
    /const PUBLIC_FELLOWSHIP_SORT_FIELDS = new Set\(\[[\s\S]*?\]\);/,
  );
  const publicFellowshipServiceSortFields = fellowshipServiceSource.match(
    /const PUBLIC_FELLOWSHIP_SORT_FIELDS = new Set\(\[[\s\S]*?\]\);/,
  );

  assert.ok(publicProgramSortFields, 'public program sort allowlist should exist');
  assert.ok(publicFellowshipControllerSortFields, 'public fellowship controller sort allowlist should exist');
  assert.ok(publicFellowshipServiceSortFields, 'public fellowship service sort allowlist should exist');
  for (const sortFields of [
    publicProgramSortFields[0],
    publicFellowshipControllerSortFields[0],
    publicFellowshipServiceSortFields[0],
  ]) {
    assert.doesNotMatch(sortFields, /'createdAt'/);
    assert.doesNotMatch(sortFields, /'updatedAt'/);
  }
  assert.doesNotMatch(programControllerSource, /sortBy = 'updatedAt'/);
  assert.doesNotMatch(fellowshipControllerSource, /sortBy = 'updatedAt'/);
  assert.match(programControllerSource, /const OPERATOR_PROGRAM_SORT_FIELDS = new Set/);
  assert.match(fellowshipServiceSource, /const OPERATOR_FELLOWSHIP_SORT_FIELDS = new Set/);
});

test('public scholarly link source labels are direct-contact redacted', () => {
  const source = fs.readFileSync(
    new URL('../server/src/services/profileService.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const cleanPublicSourceLabel = \(value: unknown\): string \| undefined => \{/);
  assert.match(source, /redactDirectContactInfo\(value\)/);
  assert.match(source, /displaySource:\s*cleanPublicSourceLabel\(link\.displaySource \|\| options\.sourceName \|\| link\.destinationKind\)/);
  assert.match(source, /discoveredVia: normalizeDiscoveredVia\(cleanPublicSourceLabel\(link\.discoveredVia \|\| options\.sourceName\)\)/);
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
  assert.match(searchIndexSource, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(searchIndexSource, /const id = serializedDocumentId\(rawId\)/);
  assert.doesNotMatch(searchIndexSource, /id: String\(rawId\)/);
  assert.match(searchIndexSource, /'contactEmail'/);
  assert.match(searchIndexSource, /'contactName'/);
  assert.match(searchIndexSource, /'contactRole'/);
  assert.match(searchIndexSource, /for \(const field of SEARCH_INDEX_DIRECT_CONTACT_FIELDS\) \{\s*delete out\[field\];\s*\}/);
  assert.match(syncSource, /import \{ serializedDocumentId \} from '\.\.\/utils\/idSerialization'/);
  assert.match(syncSource, /const id = serializedDocumentId\(doc\?\._id\) \|\| serializedDocumentId\(doc\?\.id\)/);
  assert.doesNotMatch(syncSource, /String\(doc\._id\)/);
  assert.match(syncSource, /import \{[^}]*buildResearchEntitySearchIndexDocumentsWithMemberNames[^}]*\} from '\.\/researchEntitySearchIndexService'/);
  assert.match(syncSource, /transform: async \(doc: any\) =>\s*\(await buildResearchEntitySearchIndexDocumentsWithMemberNames\(\[doc\]\)\)/);
  assert.match(syncSource, /if \(!meiliDoc\) return/);
});

test('listing permission failures do not interpolate user or listing identifiers', () => {
  const controllerSource = fs.readFileSync(
    new URL('../server/src/controllers/listingController.ts', import.meta.url),
    'utf8',
  );
  const serviceSource = fs.readFileSync(
    new URL('../server/src/services/listingService.ts', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(controllerSource, /User with id \$\{currentUser\.netId\}/);
  assert.doesNotMatch(controllerSource, /delete listing with id \$\{request\.params\.id\}/);
  assert.match(controllerSource, /return response\.status\(403\)\.json\(\{ error: 'Forbidden' \}\)/);
  assert.doesNotMatch(serviceSource, /User with id \$\{userId\}/);
  assert.doesNotMatch(serviceSource, /update listing with id \$\{safeId\}/);
  assert.match(serviceSource, /throw new IncorrectPermissionsError\('Forbidden'\)/);
});

test('user lookup not-found errors do not echo queried identifiers', () => {
  const source = fs.readFileSync(new URL('../server/src/services/userService.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /User not found with ObjectId/);
  assert.doesNotMatch(source, /User not found with NetId/);
  assert.doesNotMatch(source, /netidFilter\.netid\.\$regex\.slice/);
  assert.match(source, /throw new NotFoundError\('User not found'\)/);
});

test('listing and fellowship not-found errors do not echo queried identifiers', () => {
  const listingSource = fs.readFileSync(
    new URL('../server/src/services/listingService.ts', import.meta.url),
    'utf8',
  );
  const fellowshipSource = fs.readFileSync(
    new URL('../server/src/services/fellowshipService.ts', import.meta.url),
    'utf8',
  );
  const itemOpsSource = fs.readFileSync(
    new URL('../server/src/services/itemOperations.ts', import.meta.url),
    'utf8',
  );

  for (const source of [listingSource, fellowshipSource, itemOpsSource]) {
    assert.doesNotMatch(source, /not found with ObjectId/);
    assert.doesNotMatch(source, /ObjectId: \$\{safeId\}/);
  }
  assert.match(listingSource, /throw new NotFoundError\('Listing not found'\)/);
  assert.match(fellowshipSource, /throw new NotFoundError\('Fellowship not found'\)/);
  assert.match(itemOpsSource, /throw new NotFoundError\('Item not found'\)/);
});

test('public item view and favorite mutations require visibility filters', () => {
  const listingSource = fs.readFileSync(
    new URL('../server/src/services/listingService.ts', import.meta.url),
    'utf8',
  );
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
  assert.match(listingSource, /PUBLIC_LISTING_MUTATION_FILTER = \{[\s\S]*?archived: false,[\s\S]*?confirmed: true,[\s\S]*?\}/);
  assert.match(listingSource, /itemOps\.addView\(getListingModel\(\), id, PUBLIC_LISTING_MUTATION_FILTER\)/);
  assert.match(listingSource, /itemOps\.addFavorite\(getListingModel\(\), id, PUBLIC_LISTING_MUTATION_FILTER\)/);
  assert.match(listingSource, /itemOps\.removeFavorite\(getListingModel\(\), id, PUBLIC_LISTING_MUTATION_FILTER\)/);
  assert.match(fellowshipSource, /itemOps\.addView\(Fellowship, id, \{[\s\S]*?archived: false,[\s\S]*?\.\.\.publicFellowshipFilter\(\),[\s\S]*?\}\)/);
  assert.match(fellowshipSource, /itemOps\.addFavorite\(Fellowship, id, \{[\s\S]*?archived: false,[\s\S]*?\.\.\.publicFellowshipFilter\(\),[\s\S]*?\}\)/);
  assert.match(fellowshipSource, /itemOps\.removeFavorite\(Fellowship, id, \{[\s\S]*?archived: false,[\s\S]*?\.\.\.publicFellowshipFilter\(\),[\s\S]*?\}\)/);
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
    '../server/src/scripts/repairOfficialProfilePublicationPointers.ts',
    '../server/src/scrapers/sources/yaleDirectoryScraper.ts',
    '../server/src/scrapers/sources/nsfAwardScraper.ts',
    '../server/src/scrapers/renderedFetch.ts',
    '../server/src/scrapers/sources/studentDecisionLLMExtractor.ts',
    '../server/src/scrapers/sources/yaleCollegeFellowshipsOfficeScraper.ts',
    '../server/src/scrapers/sources/labMicrositeDescriptionLLMExtractor.ts',
    '../server/src/scripts/researchQualitySearchReview.ts',
    '../server/src/scripts/pathwayRelevanceReview.ts',
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
