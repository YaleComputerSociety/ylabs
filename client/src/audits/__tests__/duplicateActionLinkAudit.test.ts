import fs from 'fs';
import { describe, expect, it } from 'vitest';
import { auditDuplicateActionLinks } from '../duplicateActionLinkAudit';

const DUMP = process.env.ACTION_LINK_DUMP || '/tmp/research-detail-action-link-inputs.json';
// Written rather than logged: vitest suppresses console when its output is
// redirected, so a console-only audit cannot be read from a script or from CI.
const REPORT = process.env.ACTION_LINK_REPORT || '/tmp/duplicate-action-link-report.json';

const PROFILE = 'https://medicine.yale.edu/profile/fixture-scholar/';
const WEBSITE = 'https://medicine.yale.edu/lab/fixture/';

const payload = (group: Record<string, unknown>, role = 'pi') => ({
  slug: 'fixture',
  group: { _id: 'e1', leadIdentityStatus: 'verified', ...group },
  members: [{ role, user: { _id: 'u1', netid: 'ab123', displayName: 'Fixture Scholar' } }],
  accessSignals: [],
});

describe('auditDuplicateActionLinks (#3288)', () => {
  it('counts a row whose two slots resolve to one destination', () => {
    const report = auditDuplicateActionLinks([
      payload({ websiteUrl: `${PROFILE}?utm_source=x`, sourceUrls: [PROFILE] }),
    ]);
    expect(report.bothLinks).toBeGreaterThan(0);
    expect(report.oneDestination).toBe(report.bothLinks);
  });

  it('counts a row whose slots are genuinely distinct as both-links and not as a defect', () => {
    const report = auditDuplicateActionLinks([
      payload({ websiteUrl: WEBSITE, sourceUrls: [PROFILE] }),
    ]);
    expect(report.bothLinks).toBe(1);
    expect(report.oneDestination).toBe(0);
  });

  it('reads nothing from a row that offers only one slot', () => {
    const report = auditDuplicateActionLinks([payload({ sourceUrls: [PROFILE] })]);
    expect(report.bothLinks).toBe(0);
  });
});

describe('the Development corpus, when a dump is present', () => {
  it.skipIf(!fs.existsSync(DUMP))('reports the three lanes and proves it can read non-zero', () => {
    const payloads = JSON.parse(fs.readFileSync(DUMP, 'utf8'));
    const report = auditDuplicateActionLinks(payloads);
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    console.log('[audit] %s', JSON.stringify(report, null, 1));
    // The pre-trust check, asserted rather than eyeballed: a zero both-links
    // population means the instrument is broken, not that the corpus is clean.
    expect(report.rowsRead).toBeGreaterThan(0);
    expect(report.bothLinks).toBeGreaterThan(0);
    expect(report.oneDestination).toBeLessThanOrEqual(report.bothLinks);
  });
});
