import { describe, expect, it } from 'vitest';

import { buildOrchestrator } from '../registry';
import { ACTIVE_SOURCE_NAMES } from '../seedSources';
import {
  RETIRED_SOURCE_NAMES,
  SCRIPT_DRIVEN_SOURCE_NAMES,
  SCRIPT_DRIVEN_SOURCE_OWNERS,
  findRegisteredScrapersWithoutSourceRow,
  partitionSourcesByDispatch,
  resolveSourceDispatch,
} from '../sourceDispatch';

const registeredNames = buildOrchestrator()
  .list()
  .map((scraper) => scraper.name);

describe('resolveSourceDispatch', () => {
  it('reads sweep dispatch from the orchestrator rather than the row', () => {
    expect(resolveSourceDispatch('yale-directory', registeredNames)).toBe('sweep-registered');
  });

  it('names a script-driven lane instead of implying a crawl', () => {
    expect(resolveSourceDispatch('visibility-repair-queue', registeredNames)).toBe('script-driven');
  });

  it('reports a retired lane as retired', () => {
    expect(resolveSourceDispatch('course-based-research-pathways', registeredNames)).toBe(
      'retired',
    );
  });

  it('reports a row no dispatch path owns as unowned', () => {
    expect(resolveSourceDispatch('a-lane-nobody-owns', registeredNames)).toBe('unowned');
  });
});

describe('source dispatch declarations', () => {
  it('leaves no Source name both seeded active and retired', () => {
    const conflicting = ACTIVE_SOURCE_NAMES.filter((name) => RETIRED_SOURCE_NAMES.includes(name));
    expect(conflicting).toEqual([]);
  });

  it('keeps script-driven lanes out of the registry, so the CLI cannot claim to run them', () => {
    const alsoRegistered = SCRIPT_DRIVEN_SOURCE_NAMES.filter((name) =>
      registeredNames.includes(name),
    );
    expect(alsoRegistered).toEqual([]);
  });

  it('keeps retired lanes out of the registry', () => {
    const alsoRegistered = RETIRED_SOURCE_NAMES.filter((name) => registeredNames.includes(name));
    expect(alsoRegistered).toEqual([]);
  });

  it('gives every script-driven lane a command an operator can run', () => {
    const unnamed = SCRIPT_DRIVEN_SOURCE_NAMES.filter(
      (name) => !SCRIPT_DRIVEN_SOURCE_OWNERS[name]?.trim(),
    );
    expect(unnamed).toEqual([]);
  });

  it('seeds a Source row for every registered scraper, so the seed can clear the audit block', () => {
    expect(findRegisteredScrapersWithoutSourceRow(registeredNames, ACTIVE_SOURCE_NAMES)).toEqual([]);
  });

  it('declares a dispatch path for every active seeded source', () => {
    const undeclared = ACTIVE_SOURCE_NAMES.filter(
      (name) => resolveSourceDispatch(name, registeredNames) === 'unowned',
    );
    expect(undeclared).toEqual([]);
  });
});

describe('partitionSourcesByDispatch', () => {
  it('splits rows by how each one is dispatched', () => {
    const partition = partitionSourcesByDispatch(
      ['yale-directory', 'visibility-repair-queue', 'arxiv', 'a-lane-nobody-owns'],
      registeredNames,
    );
    expect(partition).toEqual({
      sweepRegistered: ['yale-directory'],
      scriptDriven: ['visibility-repair-queue'],
      retired: ['arxiv'],
      unowned: ['a-lane-nobody-owns'],
    });
  });
});

describe('findRegisteredScrapersWithoutSourceRow', () => {
  it('reports a registered scraper the Source collection is missing', () => {
    expect(
      findRegisteredScrapersWithoutSourceRow(['yale-directory', 'nih-reporter'], ['nih-reporter']),
    ).toEqual(['yale-directory']);
  });

  it('is empty when every registered scraper has a row', () => {
    expect(findRegisteredScrapersWithoutSourceRow(registeredNames, registeredNames)).toEqual([]);
  });
});
