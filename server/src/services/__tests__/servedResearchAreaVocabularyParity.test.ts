import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  resetControlledVocabularyHeadingsCache,
  resetServedWarmFailureReport,
  warmServedResearchAreaVocabulary,
  controlledVocabularyHeadingsAreWarm,
} from '../../utils/controlledVocabularyHeadings';
import { Observation } from '../../models/observation';
import mongoose from 'mongoose';

/**
 * The served warm skips entirely when mongoose is not connected, so every test here states the
 * connection state it wants rather than inheriting whatever the previous one left. Stubbed rather
 * than opened, because what is under test is the warm being called, not the read itself.
 *
 * Said explicitly in both directions because `vi.restoreAllMocks` did not restore this getter
 * between tests, so a test relying on the ambient value passed alone and failed in file order.
 */
const withReadyState = (readyState: number) =>
  vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(readyState as never);
const withConnection = () => withReadyState(1);
const withoutConnection = () => withReadyState(0);

const SERVER_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

afterEach(() => {
  vi.restoreAllMocks();
  resetControlledVocabularyHeadingsCache();
  resetServedWarmFailureReport();
});

/**
 * #3807 warmed the vocabulary at server start and at index rebuild, which left every script
 * that renders through the served DTO splitting a heading a student is not served. The served
 * scoreboard reported the pre-fix chips because of it.
 *
 * Pinned by reading the source rather than by calling the route, because the failure is an
 * ABSENT call: a behavioural test would need a live corpus to tell "warmed" from "the vocabulary
 * happened to be empty", and that is the ambiguity that hid the gap in the first place.
 */
describe('every served-DTO entry point warms the controlled vocabulary (#3817)', () => {
  const serviceSource = fs.readFileSync(
    path.join(SERVER_SRC, 'services/researchGroupService.ts'),
    'utf8',
  );

  const bodyOf = (declaration: string): string => {
    const start = serviceSource.indexOf(declaration);
    expect(start, `${declaration} should exist`).toBeGreaterThan(-1);
    return serviceSource.slice(start, start + 4000);
  };

  it.each([
    'export async function getResearchGroupDetail',
    'export async function searchResearchGroupsViaMeili',
  ])('%s warms before it builds anything', (declaration) => {
    expect(bodyOf(declaration)).toContain('await warmServedResearchAreaVocabulary()');
  });

  /**
   * The list of entry points is the whole contract, so a third one added later has to be
   * warmed too. Asserted as a count so adding a public async entry to this service fails here
   * and the author has to decide rather than inherit the gap silently.
   */
  it('has exactly the two entry points this contract covers', () => {
    const warmed = serviceSource.match(/await warmServedResearchAreaVocabulary\(\)/g) ?? [];

    expect(warmed).toHaveLength(2);
  });
});

describe('warmServedResearchAreaVocabulary', () => {
  it('loads the vocabulary so a script path sees what the server sees', async () => {
    withConnection();
    vi.spyOn(Observation, 'find').mockReturnValue({
      select: () => ({ lean: async () => [{ value: ['Lymphoma, T-Cell, Cutaneous'] }] }),
    } as never);

    await warmServedResearchAreaVocabulary();

    expect(controlledVocabularyHeadingsAreWarm()).toBe(true);
  });

  /**
   * A vocabulary read is an enrichment, so a failed one must degrade to a split heading rather
   * than to a failed page. Reported once, because a silent failure on every request is the
   * inert-fix shape this whole family of issues keeps producing.
   */
  it('never throws when the read fails, and says so once', async () => {
    withConnection();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Observation, 'find').mockReturnValue({
      select: () => ({
        lean: async () => {
          throw new Error('no database');
        },
      }),
    } as never);

    await expect(warmServedResearchAreaVocabulary()).resolves.toBeUndefined();
    await expect(warmServedResearchAreaVocabulary()).resolves.toBeUndefined();

    expect(controlledVocabularyHeadingsAreWarm()).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain('#3817');
  });

  /**
   * A serve path with no connection cannot serve, so warming would only buffer. Without this
   * guard every unit test of the two entry points waited out mongoose's ten-second buffering
   * timeout: one failed outright and the file around it took seventeen minutes.
   */
  it('reads nothing when mongoose is not connected', async () => {
    withoutConnection();
    const find = vi.spyOn(Observation, 'find');

    await warmServedResearchAreaVocabulary();

    expect(find).not.toHaveBeenCalled();
    expect(controlledVocabularyHeadingsAreWarm()).toBe(false);
  });
});
