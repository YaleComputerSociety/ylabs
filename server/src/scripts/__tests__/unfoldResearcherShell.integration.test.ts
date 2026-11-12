import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AdminAuditEvent } from '../../models/adminAuditEvent';
import {
  assertUnfoldResearcherShellWriteAllowed,
  parseUnfoldResearcherShellArgs,
  unfoldResearcherShell,
} from '../unfoldResearcherShell';
import { UNFOLD_SHELL_AUDIT_ACTION, auditActorFor } from '../unfoldResearcherShellCore';

const NOTE = 'the fold joined two different people sharing a surname';
const ACTOR = 'agent:ylabs-fixture';
const DEDUPED_AT = new Date('2026-10-05T04:21:51.000Z');

let server: MongoMemoryServer;
const db = () => mongoose.connection.db!;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri(), { autoIndex: false });
});

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

beforeEach(async () => {
  await Promise.all(
    ['role_assignments', 'researchers', 'admin_audit_events'].map((name) =>
      db().collection(name).deleteMany({}),
    ),
  );
});

const seedFold = async (
  { shell: shellOver = {}, survivor: survivorOver = {} } = {} as {
    shell?: Record<string, unknown>;
    survivor?: Record<string, unknown>;
  },
) => {
  const shell = new mongoose.Types.ObjectId();
  const survivor = new mongoose.Types.ObjectId();
  const row = new mongoose.Types.ObjectId();
  const foldArchivedEdge = new mongoose.Types.ObjectId();
  const reviewedEdge = new mongoose.Types.ObjectId();
  await db()
    .collection('researchers')
    .insertMany([
      {
        _id: survivor,
        displayName: 'Fixture Survivor',
        archived: false,
        identifiers: { netid: 'zz9991' },
        ...survivorOver,
      },
      {
        _id: shell,
        displayName: 'Fixture Shell',
        archived: true,
        identifiers: {},
        dedupedIntoResearcherId: survivor,
        dedupedAt: DEDUPED_AT,
        ...shellOver,
      },
    ]);
  await db()
    .collection('role_assignments')
    .insertMany([
      {
        _id: new mongoose.Types.ObjectId(),
        personId: survivor,
        target: { kind: 'RESEARCH_ENTITY', id: row },
        role: 'PI',
        reviewStatus: 'UNREVIEWED',
        archived: false,
      },
      {
        _id: foldArchivedEdge,
        personId: shell,
        target: { kind: 'RESEARCH_ENTITY', id: row },
        role: 'PI',
        reviewStatus: 'UNREVIEWED',
        archived: true,
      },
      {
        _id: reviewedEdge,
        personId: shell,
        target: { kind: 'RESEARCH_ENTITY', id: row },
        role: 'PI',
        reviewStatus: 'DISPUTED',
        reviewNotes: 'detached by a stage (#1)',
        archived: true,
      },
    ]);
  return {
    shell: String(shell),
    survivor: String(survivor),
    foldArchivedEdge: String(foldArchivedEdge),
    reviewedEdge: String(reviewedEdge),
  };
};

const applyArgs = (seeded: { shell: string; survivor: string }, over = {}) => ({
  shellId: seeded.shell,
  expectedSurvivorId: seeded.survivor,
  note: NOTE,
  actor: ACTOR,
  apply: true,
  ...over,
});

const researcher = async (id: string) =>
  (await db()
    .collection('researchers')
    .findOne({ _id: new mongoose.Types.ObjectId(id) })) as any;

const expectStillFolded = async (seeded: { shell: string; survivor: string }) => {
  const shell = await researcher(seeded.shell);
  expect(shell.archived).toBe(true);
  expect(String(shell.dedupedIntoResearcherId)).toBe(seeded.survivor);
  expect(await AdminAuditEvent.countDocuments()).toBe(0);
};

describe('researchers:unfold-shell (#6018)', () => {
  it('plans without writing on a dry run and names the edges the fold archived', async () => {
    const seeded = await seedFold();
    const result = await unfoldResearcherShell({ ...applyArgs(seeded), apply: false });
    expect(result).toMatchObject({
      found: true,
      refusal: null,
      unfolded: false,
      survivorId: seeded.survivor,
      foldArchivedEdgeIds: [seeded.foldArchivedEdge],
    });
    await expectStillFolded(seeded);
  });

  it('unfolds one shell, records both as distinct people, and audits the pre-image', async () => {
    const seeded = await seedFold();
    const result = await unfoldResearcherShell(applyArgs(seeded));
    expect(result).toMatchObject({ refusal: null, unfolded: true });
    const shell = await researcher(seeded.shell);
    expect(shell.archived).toBe(false);
    expect(shell.dedupedIntoResearcherId).toBeUndefined();
    expect(shell.dedupedAt).toBeUndefined();
    expect(shell.distinctFromResearcherIds.map(String)).toEqual([seeded.survivor]);
    const survivor = await researcher(seeded.survivor);
    expect(survivor.distinctFromResearcherIds.map(String)).toEqual([seeded.shell]);

    const audit = (await AdminAuditEvent.findById(result.auditId).lean()) as any;
    expect(audit).toMatchObject({
      actorNetid: ACTOR,
      action: UNFOLD_SHELL_AUDIT_ACTION,
      targetType: 'researcher',
      targetId: seeded.shell,
      summary: { note: NOTE, status: 'applied' },
    });
    expect(audit.metadata.foldArchivedEdgeIds).toEqual([seeded.foldArchivedEdge]);
    expect(String(audit.metadata.before.shell.dedupedIntoResearcherId)).toBe(seeded.survivor);
    expect(audit.metadata.before.shell.archived).toBe(true);
    expect(audit.metadata.before.shellEdges).toHaveLength(2);
  });

  it('is a no-op on a second run', async () => {
    const seeded = await seedFold();
    const first = await unfoldResearcherShell(applyArgs(seeded));
    const before = await researcher(seeded.shell);
    const second = await unfoldResearcherShell(applyArgs(seeded));
    expect(second).toMatchObject({
      refusal: null,
      unfolded: false,
      alreadyUnfolded: true,
      auditId: first.auditId,
    });
    expect(await researcher(seeded.shell)).toEqual(before);
    expect(await AdminAuditEvent.countDocuments()).toBe(1);
  });

  it('refuses a shell folded again after an earlier unfold', async () => {
    const seeded = await seedFold();
    await unfoldResearcherShell(applyArgs(seeded));
    await db()
      .collection('researchers')
      .updateOne(
        { _id: new mongoose.Types.ObjectId(seeded.shell) },
        {
          $set: {
            archived: true,
            dedupedIntoResearcherId: new mongoose.Types.ObjectId(seeded.survivor),
            dedupedAt: new Date(),
          },
        },
      );
    const result = await unfoldResearcherShell(applyArgs(seeded));
    expect(result).toMatchObject({ refusal: 'shell-refolded-after-unfold', unfolded: false });
    expect((await researcher(seeded.shell)).archived).toBe(true);
    expect(await AdminAuditEvent.countDocuments()).toBe(1);
  });

  it('refuses when the survivor was itself folded', async () => {
    const seeded = await seedFold({
      survivor: { archived: true, dedupedIntoResearcherId: new mongoose.Types.ObjectId() },
    });
    expect(await unfoldResearcherShell(applyArgs(seeded))).toMatchObject({
      refusal: 'survivor-was-itself-folded',
    });
    await expectStillFolded(seeded);
  });

  it('refuses when the survivor is archived', async () => {
    const seeded = await seedFold({ survivor: { archived: true } });
    expect(await unfoldResearcherShell(applyArgs(seeded))).toMatchObject({
      refusal: 'survivor-is-archived',
    });
    await expectStillFolded(seeded);
  });

  it('refuses when the shell folded into a survivor other than the expected one', async () => {
    const seeded = await seedFold();
    const result = await unfoldResearcherShell(
      applyArgs(seeded, { expectedSurvivorId: String(new mongoose.Types.ObjectId()) }),
    );
    expect(result).toMatchObject({ refusal: 'survivor-does-not-match-expected' });
    await expectStillFolded(seeded);
  });

  it('refuses when the survivor record no longer exists', async () => {
    const seeded = await seedFold();
    await db()
      .collection('researchers')
      .deleteOne({ _id: new mongoose.Types.ObjectId(seeded.survivor) });
    expect(await unfoldResearcherShell(applyArgs(seeded))).toMatchObject({
      refusal: 'survivor-not-found',
    });
  });

  it('refuses a record that was never folded', async () => {
    const seeded = await seedFold();
    expect(
      await unfoldResearcherShell(applyArgs(seeded, { shellId: seeded.survivor })),
    ).toMatchObject({ refusal: 'shell-not-folded', unfolded: false });
    expect(await AdminAuditEvent.countDocuments()).toBe(0);
  });

  it('refuses a folded shell that is not archived, failing closed on an inconsistent fold', async () => {
    const seeded = await seedFold({ shell: { archived: false } });
    expect(await unfoldResearcherShell(applyArgs(seeded))).toMatchObject({
      refusal: 'shell-not-archived',
    });
    expect(await AdminAuditEvent.countDocuments()).toBe(0);
  });

  it('refuses a shell id that does not exist', async () => {
    const result = await unfoldResearcherShell({
      shellId: String(new mongoose.Types.ObjectId()),
      note: NOTE,
      apply: false,
    });
    expect(result).toMatchObject({ found: false, refusal: 'shell-not-found' });
  });
});

describe('researchers:unfold-shell arguments (#6018)', () => {
  const shell = String(new mongoose.Types.ObjectId());
  const survivor = String(new mongoose.Types.ObjectId());

  it('requires a note, one shell, and on apply the expected survivor and an actor', () => {
    expect(() => parseUnfoldResearcherShellArgs([`--shell=${shell}`], {})).toThrow(/--note/);
    expect(() => parseUnfoldResearcherShellArgs([`--note=${NOTE}`], {})).toThrow(/--shell/);
    expect(() =>
      parseUnfoldResearcherShellArgs([`--shell=${shell}`, `--shell=${shell}`, `--note=x`], {}),
    ).toThrow(/at most once/);
    expect(() =>
      parseUnfoldResearcherShellArgs(
        [`--shell=${shell}`, `--note=x`, '--apply', `--actor=${ACTOR}`],
        {},
      ),
    ).toThrow(/--expect-survivor/);
    expect(() =>
      parseUnfoldResearcherShellArgs(
        [`--shell=${shell}`, `--note=x`, '--apply', `--expect-survivor=${survivor}`],
        {},
      ),
    ).toThrow(/actor/);
    expect(() => parseUnfoldResearcherShellArgs(['--bulk'], {})).toThrow(/Unknown/);
  });

  it('says it is an operator tool for one-row judgements in its help', () => {
    expect(() => parseUnfoldResearcherShellArgs(['--help'], {})).toThrow(
      /operator tool for one-row judgements, not a bulk repair path/,
    );
  });

  it('needs the confirm flag and ALLOW_NON_PROD_SCRAPER_WRITES before an apply', () => {
    const args = parseUnfoldResearcherShellArgs(
      [`--shell=${shell}`, '--note=x', '--apply', `--expect-survivor=${survivor}`],
      { DEV_WRITE_OWNER: 'agent:ylabs-fixture' },
    );
    expect(args.actor).toBe('agent:ylabs-fixture');
    expect(() =>
      assertUnfoldResearcherShellWriteAllowed(args, { ALLOW_NON_PROD_SCRAPER_WRITES: 'true' }),
    ).toThrow(/--confirm-unfold-shell/);
    const confirmed = { ...args, confirmed: true };
    expect(() => assertUnfoldResearcherShellWriteAllowed(confirmed, {})).toThrow(
      /ALLOW_NON_PROD_SCRAPER_WRITES=true/,
    );
    expect(() =>
      assertUnfoldResearcherShellWriteAllowed(confirmed, { ALLOW_NON_PROD_SCRAPER_WRITES: 'true' }),
    ).not.toThrow();
  });

  it('keeps a netid actor and refuses an actor it cannot audit', () => {
    expect(auditActorFor('zz9991')).toBe('zz9991');
    expect(auditActorFor('agent:ylabs-fixture')).toBe('agent:ylabs-fixture');
    expect(() => auditActorFor('not a label!')).toThrow(/--actor/);
    expect(() => auditActorFor('ylabs-fixture-session')).toThrow(/--actor/);
  });
});
