import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ResearchEntity } from '../../models/researchEntity';
import { RoleAssignment } from '../../models/roleAssignment';
import { CenterDirectorScraper, findCenterDirectorTargets } from '../sources/centerDirectorScraper';

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

beforeEach(async () => {
  for (const name of ['research_entities', 'role_assignments']) {
    await mongoose.connection.db!.collection(name).deleteMany({});
  }
});

const seedRow = (slug: string, name: string, entityType: string, websiteUrl: string) =>
  ResearchEntity.create({ slug, name, entityType, websiteUrl, archived: false });

const seedLead = (
  rowId: mongoose.Types.ObjectId,
  over: { state?: string; archived?: boolean; sourceName?: string; operatorEnded?: boolean } = {},
) =>
  RoleAssignment.collection.insertOne({
    personId: new mongoose.Types.ObjectId(),
    target: { kind: 'RESEARCH_ENTITY', id: rowId },
    role: 'PI',
    state: over.state ?? 'UNKNOWN',
    confidence: 0.7,
    reviewStatus: 'UNREVIEWED',
    archived: over.archived ?? false,
    rosterProvenance: { sourceName: over.sourceName ?? 'dept-faculty-roster' },
    ...(over.operatorEnded
      ? {
          endedAt: new Date('2025-12-31T00:00:00.000Z'),
          operatorEnd: {
            endedAt: new Date('2025-12-31T00:00:00.000Z'),
            reason: 'synthetic operator end',
            citationUrl: 'https://synthetic.yale.edu/',
            decidedBy: 'agent',
            recordedAt: new Date('2026-11-12T00:00:00.000Z'),
            previousState: 'UNKNOWN',
          },
        }
      : {}),
  });

const LAB_URL = 'https://synthetic.yale.edu/lab/humanitarian/';
const PAGES: Record<string, string> = {
  [LAB_URL]: '<a href="/lab/humanitarian/people/">People</a><p>Welcome to the lab.</p>',
  'https://synthetic.yale.edu/lab/humanitarian/people/': `
    <div class="card"><h3>Bo Nimbus</h3><span>Faculty Director</span></div>
    <div class="card"><h3>Cy Tarn</h3><span>Executive Director</span></div>`,
  'https://synthetic.yale.edu/lab/tied/': `
    <div class="card"><h3>Bo Nimbus</h3><span>Director</span></div>
    <div class="card"><h3>Cy Tarn</h3><span>Director</span></div>`,
};

const frozenFetch = (url: string) => {
  const html = PAGES[url];
  return html === undefined ? Promise.reject(new Error('404')) : Promise.resolve({ url, html });
};

const targetSlugs = async () =>
  (await findCenterDirectorTargets([])).map((target) => target.slug).sort();

describe('the director lane reads leaderless labs (#6025)', () => {
  it('reads a lab whose only lead an operator ended and names its faculty director', async () => {
    const lab = await seedRow(
      'synthetic-humanitarian-lab',
      'Synthetic Humanitarian Lab',
      'LAB',
      LAB_URL,
    );
    await seedLead(lab._id, { state: 'HISTORICAL', operatorEnded: true });

    expect(await targetSlugs()).toEqual(['synthetic-humanitarian-lab']);
    const [target] = await findCenterDirectorTargets([]);
    const read = await new CenterDirectorScraper({ fetchPage: frozenFetch }).readCenter(target);
    expect(read?.decision).toMatchObject({
      outcome: 'named',
      director: { name: 'Bo Nimbus', tier: 'top' },
    });
  });

  it('reads a lab with no lead edge at all, or only an archived one', async () => {
    await seedRow(
      'synthetic-unled-lab',
      'Synthetic Unled Lab',
      'LAB',
      'https://synthetic.yale.edu/lab/unled/',
    );
    const archived = await seedRow(
      'synthetic-archived-lead-lab',
      'Synthetic Archived Lead Lab',
      'LAB',
      'https://synthetic.yale.edu/lab/archived/',
    );
    await seedLead(archived._id, { archived: true });

    expect(await targetSlugs()).toEqual(['synthetic-archived-lead-lab', 'synthetic-unled-lab']);
  });

  it('still skips a lab another lane currently leads', async () => {
    const lab = await seedRow('synthetic-led-lab', 'Synthetic Led Lab', 'LAB', LAB_URL);
    await seedLead(lab._id);

    expect(await targetSlugs()).toEqual([]);
  });

  it('still refuses a tie on a lab', async () => {
    const lab = await seedRow(
      'synthetic-tied-lab',
      'Synthetic Tied Lab',
      'LAB',
      'https://synthetic.yale.edu/lab/tied/',
    );
    const [target] = await findCenterDirectorTargets([String(lab._id)]);
    const read = await new CenterDirectorScraper({ fetchPage: frozenFetch }).readCenter(target);

    expect(read?.decision).toMatchObject({ outcome: 'ambiguous', reason: 'several-directors' });
  });

  it('keeps org rows as before and never reads a faculty research row', async () => {
    await seedRow(
      'center-synthetic-unled',
      'Synthetic Unled Center',
      'CENTER',
      'https://synthetic.yale.edu/center/a/',
    );
    const led = await seedRow(
      'center-synthetic-led',
      'Synthetic Led Center',
      'CENTER',
      'https://synthetic.yale.edu/center/b/',
    );
    await seedLead(led._id);
    const directorLed = await seedRow(
      'center-synthetic-director-led',
      'Synthetic Director Led Center',
      'CENTER',
      'https://synthetic.yale.edu/center/c/',
    );
    await seedLead(directorLed._id, { sourceName: 'center-director' });
    await seedRow(
      'ysm-faculty-synthetic-person',
      'Synthetic Person Faculty Research',
      'FACULTY_RESEARCH_AREA',
      'https://synthetic.yale.edu/person/',
    );

    expect(await targetSlugs()).toEqual([
      'center-synthetic-director-led',
      'center-synthetic-unled',
    ]);
  });
});
