import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { isKnownDeadSourceUrl } from '../services/sourceLinkHealth';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
const t = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const norm = (u: string): string => u.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').toLowerCase();
const PERSONISH = /^(FACULTY_RESEARCH_AREA|FACULTY_PROJECT|INDIVIDUAL_RESEARCH)$/;

async function main(): Promise<void> {
  await initializeConnections();
  const all = (await ResearchEntity.find({ archived: { $ne: true } })
    .select('slug name displayName entityType kind websiteUrl website sourceLinkHealth sourceUrls studentVisibilityTier manuallyLockedFields')
    .lean()) as unknown as Array<Record<string, any>>;

  // Who else owns each url as their own website?
  const ownersByUrl = new Map<string, Array<Record<string, any>>>();
  for (const r of all) {
    for (const u of [t(r.websiteUrl), t(r.website)]) {
      if (!u) continue;
      const k = norm(u);
      if (!ownersByUrl.has(k)) ownersByUrl.set(k, []);
      if (!ownersByUrl.get(k)!.some((x) => String(x.slug) === String(r.slug))) ownersByUrl.get(k)!.push(r);
    }
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const r of all) {
    if (t(r.studentVisibilityTier) !== 'student_ready') continue;
    const health = Array.isArray(r.sourceLinkHealth) ? r.sourceLinkHealth : [];
    const site = t(r.websiteUrl) || t(r.website);
    if (!site) continue;
    if (!isKnownDeadSourceUrl(health, site)) continue;
    const others = (ownersByUrl.get(norm(site)) ?? []).filter((x) => String(x.slug) !== String(r.slug));
    const liveCitations = (Array.isArray(r.sourceUrls) ? r.sourceUrls : [])
      .map((u: any) => t(typeof u === 'string' ? u : u?.url))
      .filter((u: string) => u && !isKnownDeadSourceUrl(health, u));
    // Identity shape: does the row's own name disagree with its slug / type?
    const name = t(r.name) || t(r.displayName);
    const nameTokens = name.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/).filter((x) => x.length > 2);
    const slugTokens = new Set(String(r.slug).split('-').filter(Boolean));
    const nameSharesNothingWithSlug = nameTokens.length > 0 && !nameTokens.some((x) => slugTokens.has(x));
    const nameSaysLab = /\b(lab|laboratory|center|centre|institute|program)\b/i.test(name);
    const typeIsPersonish = PERSONISH.test(t(r.entityType));
    rows.push({
      slug: String(r.slug),
      entityType: t(r.entityType),
      field: t(r.websiteUrl) ? 'websiteUrl' : 'website',
      alsoOwnedByOtherRows: others.length,
      otherOwnerSlugCount: others.length,
      liveCitationsRemaining: liveCitations.length,
      locked: Array.isArray(r.manuallyLockedFields) ? r.manuallyLockedFields : [],
      identity_nameSharesNothingWithSlug: nameSharesNothingWithSlug,
      identity_nameSaysCollectiveButTypeIsPerson: nameSaysLab && typeIsPersonish,
    });
  }
  console.log(JSON.stringify({
    servedRowsWithADeadOwnWebsite: rows.length,
    byField: rows.reduce((a: Record<string, number>, r) => { a[String(r.field)] = (a[String(r.field)] || 0) + 1; return a; }, {}),
    withZeroLiveCitations: rows.filter((r) => r.liveCitationsRemaining === 0).length,
    deadUrlAlsoOwnedByAnotherRow: rows.filter((r) => (r.alsoOwnedByOtherRows as number) > 0).length,
    identity_nameSharesNothingWithSlug: rows.filter((r) => r.identity_nameSharesNothingWithSlug).length,
    identity_nameSaysCollectiveButTypeIsPerson: rows.filter((r) => r.identity_nameSaysCollectiveButTypeIsPerson).length,
    anyLocked: rows.filter((r) => (r.locked as unknown[]).length > 0).length,
    byEntityType: rows.reduce((a: Record<string, number>, r) => { a[String(r.entityType)] = (a[String(r.entityType)] || 0) + 1; return a; }, {}),
    rows,
  }, null, 2));
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
