import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { hasExpectedEntityName, normalizeText } from './research-detail-professor-audit-core.mjs';

const clientBase = process.env.CLIENT_BASE || 'http://localhost:3000';
const serverBase = process.env.SERVER_BASE || 'http://localhost:4000';
const outDir = process.env.OUT_DIR || 'tmp/research-detail-professor-audit';
const query = process.env.AUDIT_QUERY || '';
const limit = Number.parseInt(process.env.AUDIT_LIMIT || '25', 10);
const pageSize = Math.min(100, Math.max(1, Number.parseInt(process.env.AUDIT_PAGE_SIZE || '50', 10)));
const headless = process.env.HEADLESS !== 'false';
const screenshotFailures = process.env.SCREENSHOT_FAILURES === 'true';
const publicLeadRoles = new Set(['pi', 'co-pi', 'director', 'co-director']);

const findings = [];
const artifacts = [];

const nowIso = () => new Date().toISOString();

const memberName = (member) =>
  normalizeText(
    member?.user?.displayName ||
      [member?.user?.fname, member?.user?.lname].filter(Boolean).join(' '),
  );

const memberNetid = (member) => normalizeText(member?.user?.netid);

const absoluteApiUrl = (pathname) => `${serverBase.replace(/\/$/, '')}/api${pathname}`;
const absoluteClientUrl = (pathname) => `${clientBase.replace(/\/$/, '')}${pathname}`;

const addFinding = (finding) => {
  findings.push({
    severity: finding.severity || 'warning',
    kind: finding.kind,
    message: finding.message,
    rootCauseHypothesis: finding.rootCauseHypothesis,
    suggestedFixLayer: finding.suggestedFixLayer || 'investigate',
    dataPointers: finding.dataPointers || {},
    evidence: finding.evidence || {},
  });
};

const writeJson = async (filename, value) => {
  const file = path.join(outDir, filename);
  await fs.writeFile(file, JSON.stringify(value, null, 2));
  artifacts.push({ type: 'json', file });
  return file;
};

const pageText = async (page) =>
  normalizeText(await page.evaluate(() => document.body.innerText || ''));

const waitForSettled = async (page) => {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => undefined);
  await page.waitForTimeout(300);
};

const safeJsonFetch = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { ok: response.ok, status: response.status, body };
};

const collectResearchEntities = async () => {
  const rows = [];
  let page = 1;

  while (rows.length < limit) {
    const response = await safeJsonFetch(absoluteApiUrl('/research/search'), {
      method: 'POST',
      body: JSON.stringify({ q: query, page, pageSize, filters: {} }),
    });

    if (!response.ok) {
      addFinding({
        severity: 'error',
        kind: 'research_search_api_failed',
        message: `Research search API failed with HTTP ${response.status}.`,
        rootCauseHypothesis:
          'The crawl cannot start because /api/research/search is unavailable or rejecting the request.',
        suggestedFixLayer: 'server/controller',
        evidence: { status: response.status, body: response.body },
      });
      break;
    }

    const entities = response.body?.researchEntities || [];
    rows.push(...entities.filter((entity) => entity?.slug));
    if (entities.length < pageSize || rows.length >= response.body?.estimatedTotalHits) break;
    page += 1;
  }

  return rows.slice(0, limit);
};

const profileApiFromBrowser = async (page, netid) =>
  page.evaluate(async ({ base, id }) => {
    try {
      const response = await fetch(`${base.replace(/\/$/, '')}/api/profiles/${id}`, {
        credentials: 'include',
      });
      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = { raw: text };
      }
      return { ok: response.ok, status: response.status, body };
    } catch (error) {
      return { ok: false, status: 0, error: String(error?.message || error) };
    }
  }, { base: serverBase, id: netid });

const namesAreCompatible = (expected, actualText) => {
  const expectedParts = normalizeText(expected)
    .toLowerCase()
    .split(/\s+/)
    .filter((part) => part.length > 1);
  const actual = normalizeText(actualText).toLowerCase();
  return expectedParts.length > 0 && expectedParts.every((part) => actual.includes(part));
};

const auditProfileLink = async ({ page, entity, detail, member, netid, name }) => {
  const profilePath = `/profile/${encodeURIComponent(netid)}`;
  const profileUrl = absoluteClientUrl(profilePath);

  await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
  await waitForSettled(page);
  const text = await pageText(page);
  const profileApi = await profileApiFromBrowser(page, netid);

  if (/profile not found/i.test(text) || !profileApi.ok) {
    addFinding({
      severity: 'error',
      kind: 'profile_navigation_failed',
      message: `${entity.name} links to ${profilePath}, but the profile did not load cleanly.`,
      rootCauseHypothesis:
        'The research detail member points at a netid that does not resolve to a public profile in users/profile service.',
      suggestedFixLayer: 'data/users/research_entity_members',
      dataPointers: {
        researchEntityId: entity._id,
        researchEntitySlug: entity.slug,
        researchEntityName: entity.name,
        expectedMemberName: name,
        netid,
        collections: ['research_entity_members', 'users'],
      },
      evidence: { profileUrl, profileApiStatus: profileApi.status, textSample: text.slice(0, 600) },
    });
    return;
  }

  if (!namesAreCompatible(name, text)) {
    addFinding({
      severity: 'error',
      kind: 'profile_identity_mismatch',
      message: `${entity.name} member ${name} links to ${profilePath}, but the destination page does not display that name.`,
      rootCauseHypothesis:
        'The member row likely references the wrong user/faculty identity, or the user profile name is stale.',
      suggestedFixLayer: 'data/research_entity_members/users',
      dataPointers: {
        researchEntityId: entity._id,
        researchEntitySlug: entity.slug,
        researchEntityName: entity.name,
        expectedMemberName: name,
        netid,
        collections: ['research_entity_members', 'users', 'faculty_members'],
      },
      evidence: { profileUrl, textSample: text.slice(0, 600) },
    });
  }

  await page.goto(`${profileUrl}?tab=research`, { waitUntil: 'domcontentloaded' });
  await waitForSettled(page);
  const researchTabLinks = await page.evaluate(() =>
    [...document.querySelectorAll('a[href^="/research/"]')].map((anchor) => ({
      text: anchor.textContent?.replace(/\s+/g, ' ').trim() || '',
      href: anchor.getAttribute('href') || '',
    })),
  );
  const expectedHref = `/research/${detail.researchEntity?.slug || entity.slug}`;
  const hasBacklink = researchTabLinks.some((link) => link.href === expectedHref);

  if (!hasBacklink) {
    addFinding({
      severity: 'warning',
      kind: 'profile_research_backlink_missing',
      message: `${profilePath}?tab=research does not link back to ${expectedHref}.`,
      rootCauseHypothesis:
        'Profile research-home hydration may not be joining this user to the research entity, or the membership row lacks the expected user identity.',
      suggestedFixLayer: 'server/profileService-or-data/research_entity_members',
      dataPointers: {
        researchEntityId: entity._id,
        researchEntitySlug: entity.slug,
        researchEntityName: entity.name,
        netid,
        expectedMemberName: name,
        collections: ['research_entity_members', 'research_entities', 'users'],
      },
      evidence: { profileUrl: `${profileUrl}?tab=research`, researchTabLinks: researchTabLinks.slice(0, 10) },
    });
  }
};

const auditEntity = async ({ page, entity }) => {
  const detailResponse = await safeJsonFetch(absoluteApiUrl(`/research/${encodeURIComponent(entity.slug)}`));
  if (!detailResponse.ok) {
    addFinding({
      severity: 'error',
      kind: 'detail_api_failed',
      message: `${entity.name || entity.slug} appears in search but /api/research/${entity.slug} returned HTTP ${detailResponse.status}.`,
      rootCauseHypothesis:
        'Search index/API results include a research entity that the canonical detail route cannot load as public.',
      suggestedFixLayer: 'search-index-or-data/research_entities',
      dataPointers: {
        researchEntityId: entity._id,
        researchEntitySlug: entity.slug,
        researchEntityName: entity.name,
        collections: ['research_entities', 'researchentities Meili index'],
      },
      evidence: { status: detailResponse.status, body: detailResponse.body },
    });
    return;
  }

  const detail = detailResponse.body || {};
  const detailEntity = detail.researchEntity || {};
  const expectedName = normalizeText(detailEntity.displayName || detailEntity.name || entity.name);
  const entityUrl = absoluteClientUrl(`/research/${entity.slug}`);

  page.removeAllListeners('console');
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto(entityUrl, { waitUntil: 'domcontentloaded' });
  await waitForSettled(page);
  const text = await pageText(page);
  const ui = await page.evaluate(() => ({
    title: document.title,
    h1: document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    profileLinks: [...document.querySelectorAll('a[href^="/profile/"]')].map((anchor) => ({
      text: anchor.textContent?.replace(/\s+/g, ' ').trim() || '',
      href: anchor.getAttribute('href') || '',
    })),
  }));

  if (/couldn'?t find that yale research page|research entity not found|profile not found/i.test(text)) {
    addFinding({
      severity: 'error',
      kind: 'detail_page_not_found',
      message: `${entityUrl} rendered a not-found state even though the search result exists.`,
      rootCauseHypothesis:
        'The client route, API detail route, or public visibility filter disagrees with search results.',
      suggestedFixLayer: 'client-route/server-detail/search-index-data',
      dataPointers: {
        researchEntityId: entity._id,
        researchEntitySlug: entity.slug,
        researchEntityName: entity.name,
        collections: ['research_entities'],
      },
      evidence: { entityUrl, textSample: text.slice(0, 600) },
    });
  }

  if (!hasExpectedEntityName(expectedName, text, ui)) {
    addFinding({
      severity: 'warning',
      kind: 'detail_name_mismatch',
      message: `${entityUrl} does not visibly include expected research entity name "${expectedName}".`,
      rootCauseHypothesis:
        'The UI may be rendering stale search-card text or the detail payload display name differs from the indexed row.',
      suggestedFixLayer: 'data/research_entities-or-client-display',
      dataPointers: {
        researchEntityId: entity._id,
        researchEntitySlug: entity.slug,
        researchEntityName: entity.name,
        detailResearchEntityName: detailEntity.name,
      },
      evidence: { h1: ui.h1, title: ui.title },
    });
  }

  if (consoleErrors.length > 0) {
    addFinding({
      severity: 'warning',
      kind: 'detail_console_errors',
      message: `${entityUrl} produced browser console errors.`,
      rootCauseHypothesis:
        'The detail page may have a client runtime, asset, or failed-request issue.',
      suggestedFixLayer: 'client/server',
      dataPointers: {
        researchEntityId: entity._id,
        researchEntitySlug: entity.slug,
        researchEntityName: entity.name,
      },
      evidence: { consoleErrors: consoleErrors.slice(0, 10) },
    });
  }

  const leadMembers = (detail.members || []).filter((member) => publicLeadRoles.has(member?.role));
  const expectedMembers = leadMembers.filter(memberNetid);
  const uiProfileNetids = new Set(
    ui.profileLinks
      .map((link) => (link.href.match(/^\/profile\/([^?/#]+)/) || [])[1])
      .filter(Boolean),
  );

  if (expectedMembers.length === 0) {
    const leadMembersWithNoNetid = leadMembers.filter((member) => !memberNetid(member));
    const hasLeadMembers = leadMembers.length > 0;

    if (hasLeadMembers) {
      addFinding({
        severity: 'warning',
        kind: 'detail_has_current_lead_without_netid',
        message: `${entity.name || entity.slug} has ${leadMembers.length} current lead member(s) but none with a netid, so there is no professor profile to click.`,
        rootCauseHypothesis:
          'Lead member rows exist for this entity, but scraped or materialized identities are not resolving to Yale netids.',
        suggestedFixLayer: 'data/research_entity_members/faculty_members/users',
        dataPointers: {
          researchEntityId: entity._id,
          researchEntitySlug: entity.slug,
          researchEntityName: entity.name,
          collections: ['research_entity_members', 'faculty_members', 'users'],
        },
        evidence: {
          memberCount: leadMembers.length,
          membersWithoutNetid: leadMembersWithNoNetid.map((member) => memberName(member)),
        },
      });
      return;
    }

    addFinding({
      severity: 'warning',
      kind: 'detail_has_no_current_lead_member',
      message: `${entity.name || entity.slug} has no current lead API member with a netid, so there is no professor profile to click.`,
      rootCauseHypothesis:
        'The research entity may lack a PI/member row, or the member identity was not resolved to a Yale profile.',
      suggestedFixLayer: 'data/research_entity_members/faculty_members/users',
      dataPointers: {
        researchEntityId: entity._id,
        researchEntitySlug: entity.slug,
        researchEntityName: entity.name,
        collections: ['research_entity_members', 'faculty_members', 'users'],
      },
      evidence: { memberCount: (detail.members || []).length },
    });
  }

  for (const member of expectedMembers) {
    const netid = memberNetid(member);
    const name = memberName(member);
    if (!uiProfileNetids.has(netid)) {
      addFinding({
        severity: 'error',
        kind: 'member_profile_link_missing',
        message: `${entity.name || entity.slug} API member ${name} (${netid}) is not exposed as a clickable profile link on the detail page.`,
        rootCauseHypothesis:
          'The detail payload has the member, but LabMembersList/lead-professor UI is not rendering the matching /profile link.',
        suggestedFixLayer: 'client/detail-page',
        dataPointers: {
          researchEntityId: entity._id,
          researchEntitySlug: entity.slug,
          researchEntityName: entity.name,
          expectedMemberName: name,
          netid,
        },
        evidence: { profileLinks: ui.profileLinks },
      });
      continue;
    }

    await auditProfileLink({ page, entity, detail, member, netid, name });
  }

  if (screenshotFailures && findings.some((finding) => finding.dataPointers?.researchEntitySlug === entity.slug)) {
    const file = path.join(outDir, `failure-${entity.slug}.png`);
    await page.screenshot({ path: file, fullPage: true });
    artifacts.push({ type: 'screenshot', file, slug: entity.slug });
  }
};

await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless });
const context = await browser.newContext({
  viewport: { width: 1440, height: 980 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

try {
  await page.goto(absoluteApiUrl('/dev-login'), { waitUntil: 'domcontentloaded' });
  await waitForSettled(page);

  const entities = await collectResearchEntities();

  for (const entity of entities) {
    await auditEntity({ page, entity });
  }

  const summary = {
    generatedAt: nowIso(),
    clientBase,
    serverBase,
    query,
    limit,
    auditedCount: entities.length,
    findingCount: findings.length,
    findingsBySeverity: findings.reduce((acc, finding) => {
      acc[finding.severity] = (acc[finding.severity] || 0) + 1;
      return acc;
    }, {}),
    findingsByKind: findings.reduce((acc, finding) => {
      acc[finding.kind] = (acc[finding.kind] || 0) + 1;
      return acc;
    }, {}),
    findings,
    artifacts,
  };

  await writeJson('research-detail-professor-audit.json', summary);
  console.log(JSON.stringify(summary, null, 2));

  if (findings.some((finding) => finding.severity === 'error')) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
