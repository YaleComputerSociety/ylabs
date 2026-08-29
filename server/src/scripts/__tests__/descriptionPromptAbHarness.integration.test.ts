import fs from 'fs';
import os from 'os';
import path from 'path';
import axios from 'axios';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPORT_PATH = path.join(os.tmpdir(), `ylabs-description-ab-test-${process.pid}.json`);

const FILLER = [
  'Home. People. Publications. Positions. Events. Contact.',
  'Prospective students interested in joining should read the openings page first, and current members can find meeting notes in the shared calendar for the term.',
  'Recent news items, seminar recordings, and retreat photographs are archived on the news page along with department announcements.',
];

const pageHtml = (paragraphs: string[]): string =>
  `<html><body><main>${[...paragraphs, ...FILLER].map((text) => `<p>${text}</p>`).join('')}</main></body></html>`;

const MISSION_BLOCK =
  'Our Mission Create and communicate high-quality and creative science while training the next generation of leaders in a collaborative and inclusive environment.';
const MISSION_CONTACT = 'Write to fixture.lab@example.org or call 203-555-0148 for a tour.';
const PEDS_VISION =
  'The Department of Example Pediatrics is a world leader in transforming education, research, and clinical care for children everywhere.';
const CORE_BLURB =
  'The Example Center for Outcomes Research and Evaluation designs clinical trials and builds hospital quality measures for national reporting.';
const RETINA_PROSE =
  'The group studies photoreceptor degeneration in the mouse retina and the gene therapy vectors used to slow it.';
const RETINA_UNGROUNDED =
  'The group is internationally recognized for pioneering translational ophthalmology across three continents.';
const IMMUNOLOGY_PROSE =
  'We study immune dysregulation underlying early-life critical illness in the neonatal lung.';

interface Fixture {
  slug: string;
  name: string;
  entityType: string;
  kind: string;
  url: string;
  tier: string;
  archived: boolean;
  html: string;
  grants?: Array<{ title: string; abstract: string }>;
  armA: string;
  armB: { fullDescription: string; researchSubject?: string; subjectScope?: string };
}

/**
 * `dept-mcdb-valerie-horsley` is archived and `dept-seas-michael-hatridge` sits
 * outside student_ready on purpose: the harness must reach its named anchors by
 * slug alone, and filtering them like the random strata would drop exactly the
 * two regression cases the run exists to check.
 */
const FIXTURES: Fixture[] = [
  {
    slug: 'dept-mcdb-valerie-horsley',
    name: 'Example Barrier Tissue Lab',
    entityType: 'FACULTY_RESEARCH_AREA',
    kind: 'individual',
    url: 'https://barrier-tissue.example.org/about',
    tier: 'operator_review',
    archived: true,
    html: pageHtml([MISSION_BLOCK, MISSION_CONTACT]),
    armA: MISSION_BLOCK,
    armB: { fullDescription: '', researchSubject: '', subjectScope: 'unclear' },
  },
  {
    slug: 'ysm-faculty-jaspreet-loyal',
    name: 'Example Pediatrics Faculty Record',
    entityType: 'FACULTY_RESEARCH_AREA',
    kind: 'individual',
    url: 'https://peds.example.edu/about-us',
    tier: 'student_ready',
    archived: false,
    html: pageHtml([PEDS_VISION]),
    armA: PEDS_VISION,
    armB: {
      fullDescription: PEDS_VISION,
      researchSubject: 'pediatric education, research, and clinical care',
      subjectScope: 'parent_org',
    },
  },
  {
    slug: 'ysm-faculty-jennifer-mattera',
    name: 'Example Outcomes Faculty Record',
    entityType: 'FACULTY_RESEARCH_AREA',
    kind: 'individual',
    url: 'https://core.example.edu/overview',
    tier: 'student_ready',
    archived: false,
    html: pageHtml([CORE_BLURB]),
    armA: CORE_BLURB,
    // Both judgement fields omitted, the common json_object omission.
    armB: { fullDescription: CORE_BLURB },
  },
  {
    slug: 'example-retina-lab',
    name: 'Example Retina Lab',
    entityType: 'RESEARCH_LAB',
    kind: 'lab',
    url: 'https://retina.example.org/research',
    tier: 'student_ready',
    archived: false,
    html: pageHtml([RETINA_PROSE]),
    grants: [
      {
        title: 'Photoreceptor rescue in the mouse retina',
        abstract: 'Gene therapy vectors that slow photoreceptor degeneration in the mouse retina.',
      },
    ],
    armA: RETINA_UNGROUNDED,
    armB: {
      fullDescription: RETINA_PROSE,
      researchSubject: 'photoreceptor degeneration and gene therapy vectors',
      subjectScope: 'this_entity',
    },
  },
  {
    slug: 'example-yale-immunology-lab',
    name: 'Example Yale Immunology Lab',
    entityType: 'RESEARCH_LAB',
    kind: 'lab',
    url: 'https://immunology.yale.edu/labs/example-immunology',
    tier: 'student_ready',
    archived: false,
    html: pageHtml([IMMUNOLOGY_PROSE]),
    armA: IMMUNOLOGY_PROSE,
    armB: {
      fullDescription: IMMUNOLOGY_PROSE,
      researchSubject: 'immune dysregulation in early-life critical illness',
      subjectScope: 'this_entity',
    },
  },
];

const fixtureByUrl = new Map(FIXTURES.map((fixture) => [fixture.url, fixture]));

interface LlmCall {
  arm: 'A_baseline' | 'B_subject_gate';
  url: string;
  userContent: string;
}

const llmCalls: LlmCall[] = [];
const pageFetches: string[] = [];

function stubCompletion(systemPrompt: string, userContent: string): string {
  const url = (userContent.match(/Source URL: (\S+)/) ?? [])[1] ?? '';
  const fixture = fixtureByUrl.get(url);
  if (!fixture) throw new Error(`no fixture for source url ${url}`);
  const arm = systemPrompt.includes('researchSubject') ? 'B_subject_gate' : 'A_baseline';
  llmCalls.push({ arm, url, userContent });
  const body: Record<string, unknown> =
    arm === 'A_baseline'
      ? { fullDescription: fixture.armA, shortDescription: fixture.armA }
      : {
          fullDescription: fixture.armB.fullDescription,
          shortDescription: fixture.armB.fullDescription,
          ...(fixture.armB.researchSubject === undefined
            ? {}
            : {
                researchSubject: fixture.armB.researchSubject,
                subjectScope: fixture.armB.subjectScope,
              }),
        };
  return JSON.stringify({ ...body, topics: [], methods: [], name: '' });
}

function installStubTransport(): void {
  axios.defaults.adapter = async (config) => {
    const url = String(config.url ?? '');
    const response = (data: unknown) => ({
      data,
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
      request: {},
    });
    if (url.includes('api.openai.com')) {
      const body = JSON.parse(String(config.data ?? '{}'));
      return response({
        choices: [
          {
            message: {
              content: stubCompletion(
                String(body.messages?.[0]?.content ?? ''),
                String(body.messages?.[1]?.content ?? ''),
              ),
            },
          },
        ],
      });
    }
    const fixture = fixtureByUrl.get(url);
    if (!fixture) throw new Error(`unexpected page fetch ${url}`);
    pageFetches.push(url);
    return response(fixture.html);
  };
}

async function seed(mongoUrl: string): Promise<void> {
  await mongoose.connect(mongoUrl);
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db');
  await db.collection('research_entities').insertMany(
    FIXTURES.map((fixture) => ({
      slug: fixture.slug,
      name: fixture.name,
      displayName: fixture.name,
      entityType: fixture.entityType,
      kind: fixture.kind,
      websiteUrl: fixture.url,
      sourceUrls: [fixture.url],
      studentVisibilityTier: fixture.tier,
      archived: fixture.archived,
    })),
  );
  const grantRows = FIXTURES.flatMap((fixture) =>
    (fixture.grants ?? []).map((grant) => ({
      entityKey: fixture.slug,
      field: 'recentGrants',
      superseded: false,
      value: [grant],
    })),
  );
  if (grantRows.length) await db.collection('observations').insertMany(grantRows);
  await mongoose.disconnect();
}

async function waitForReport(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(REPORT_PATH)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('the harness did not write its report');
}

interface ArmMetrics {
  attempted: number;
  errors: number;
  nonEmpty: number;
  grounded: number;
  groundedChecked: number;
  servable: number;
  corroborationSum: number;
  corroborationCount: number;
  rejections: Record<string, number>;
}

interface Report {
  metrics: Record<string, ArmMetrics>;
  scoredPairs: number;
  blindReview: Array<{ caseId: number; slug: string; left: string; right: string }>;
  blindReviewKey: Array<{ caseId: number; leftArm: string; rightArm: string }>;
}

describe('descriptionPromptAbHarness A/B run (#2183)', () => {
  let mongod: MongoMemoryServer;
  let report: Report;

  beforeAll(async () => {
    fs.rmSync(REPORT_PATH, { force: true });
    mongod = await MongoMemoryServer.create();
    const mongoUrl = `${mongod.getUri()}ylabs_description_ab_test`;
    await seed(mongoUrl);

    process.env.MONGODBURL = mongoUrl;
    process.env.OPENAI_API_KEY = 'stub-key-not-a-real-credential';
    process.argv = [
      process.argv[0],
      'descriptionPromptAbHarness',
      '--random',
      '2',
      '--output',
      REPORT_PATH,
    ];
    installStubTransport();

    await import('../descriptionPromptAbHarness');
    await waitForReport(120_000);
    report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8')) as Report;
  }, 180_000);

  afterAll(async () => {
    fs.rmSync(REPORT_PATH, { force: true });
    axios.defaults.adapter = undefined;
    await mongod.stop();
  });

  it('reaches its named anchors even when they are archived or below student_ready', () => {
    expect(llmCalls.map((call) => call.url)).toContain('https://barrier-tissue.example.org/about');
  });

  it('fetches each page once and feeds both arms the identical text', () => {
    expect(pageFetches.length).toBe(new Set(pageFetches).size);
    for (const url of new Set(llmCalls.map((call) => call.url))) {
      const [baseline, candidate] = ['A_baseline', 'B_subject_gate'].map(
        (arm) => llmCalls.find((call) => call.url === url && call.arm === arm)!.userContent,
      );
      const pageTextOf = (content: string) => content.slice(content.indexOf(FILLER[0]));
      expect(pageTextOf(baseline)).toContain(FILLER[2]);
      expect(pageTextOf(candidate)).toBe(pageTextOf(baseline));
    }
  });

  it('redacts direct contact details before any page text leaves for the model', () => {
    const contact = /[\w.+-]+@[\w-]+\.[\w.]+|\b\d{3}-\d{3}-\d{4}\b/;
    for (const call of llmCalls) expect(call.userContent).not.toMatch(contact);
    const missionCalls = llmCalls.filter((call) => call.url.includes('barrier-tissue.example.org'));
    expect(missionCalls.length).toBe(2);
    for (const call of missionCalls) {
      expect(call.userContent).toContain('[email redacted]');
      expect(call.userContent).toContain('[phone redacted]');
    }
  });

  it('judges the gated arm on the arm, never on whether it returned the judgement fields', () => {
    // mattera returns prose with both judgement fields missing, loyal returns
    // parent_org, horsley returns no subject: a gated arm that omits the fields
    // must be rejected rather than waived back to the baseline rate.
    expect(report.metrics.B_subject_gate.rejections).toEqual({
      no_subject: 2,
      parent_org_subject: 1,
    });
  });

  it('leaves the baseline arm ungated so its servable rate is production behaviour', () => {
    const baseline = report.metrics.A_baseline;
    expect(baseline.rejections).toEqual({});
    expect(baseline.servable).toBe(baseline.grounded);
    expect(baseline.nonEmpty).toBe(baseline.attempted);
  });

  it('counts an ungrounded extraction against the grounding guardrail', () => {
    const baseline = report.metrics.A_baseline;
    expect(baseline.groundedChecked).toBe(baseline.nonEmpty);
    expect(baseline.grounded).toBe(baseline.groundedChecked - 1);
    expect(report.metrics.B_subject_gate.grounded).toBe(
      report.metrics.B_subject_gate.groundedChecked,
    );
  });

  it('scores grant corroboration only for entities that have grant text', () => {
    for (const arm of ['A_baseline', 'B_subject_gate']) {
      expect(report.metrics[arm].corroborationCount).toBe(1);
    }
    const grounded = report.metrics.B_subject_gate.corroborationSum;
    expect(grounded).toBeGreaterThan(report.metrics.A_baseline.corroborationSum);
  });

  it('keeps arm labels out of the blind review payload and in a joinable key', () => {
    expect(report.blindReview.length).toBeGreaterThan(0);
    for (const entry of report.blindReview) {
      expect(Object.keys(entry).some((key) => /arm/i.test(key))).toBe(false);
    }
    expect(report.blindReviewKey.map((entry) => entry.caseId)).toEqual(
      report.blindReview.map((entry) => entry.caseId),
    );
    for (const key of report.blindReviewKey) {
      expect([key.leftArm, key.rightArm].sort()).toEqual(['A_baseline', 'B_subject_gate']);
    }
  });

  it('assigns the blind sides from the slug, so case order never reveals the arm', () => {
    // Index parity would put the baseline on the left for every even caseId.
    const evenCases = report.blindReviewKey.filter((entry) => entry.caseId % 2 === 0);
    expect(evenCases.some((entry) => entry.leftArm === 'B_subject_gate')).toBe(true);
  });

  it('emits the blind pair as the two arms own descriptions for that entity', () => {
    for (const entry of report.blindReview) {
      const key = report.blindReviewKey.find((row) => row.caseId === entry.caseId)!;
      const fixture = FIXTURES.find((row) => row.slug === entry.slug)!;
      const baselineSide = key.leftArm === 'A_baseline' ? entry.left : entry.right;
      const candidateSide = key.leftArm === 'A_baseline' ? entry.right : entry.left;
      expect(baselineSide).toBe(fixture.armA);
      expect(candidateSide).toBe(fixture.armB.fullDescription);
    }
  });
});
