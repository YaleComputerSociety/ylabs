import { describe, expect, it } from 'vitest';
import { OWNER_HELD_SOURCES } from '../opsSweepCore';
import {
  DEVELOPMENT_POST_RUN_STAGE_DEFINITIONS,
  FELLOWSHIP_POST_RUN_STAGE_DEFINITIONS,
  FELLOWSHIP_SWEEP_SOURCES,
  RESEARCH_SWEEP_SOURCES,
} from '../runScraperSweep';

const DESCRIPTION_LANE_PATTERN =
  /\bcards?\b|coverage-synthesis|rederive-cards|synthesis|description|writer|microsite|-llm\b/i;

const scheduledSourceNames = [...RESEARCH_SWEEP_SOURCES, ...FELLOWSHIP_SWEEP_SOURCES].map(
  (source) => source.name,
);

const scheduledStages = [
  ...DEVELOPMENT_POST_RUN_STAGE_DEFINITIONS,
  ...FELLOWSHIP_POST_RUN_STAGE_DEFINITIONS,
].map((stage) => ({ name: stage.name, command: stage.command }));

describe('the scheduled sweep never runs an owner-held description, writer or card lane', () => {
  it('has a non-empty population to check', () => {
    expect(Object.keys(OWNER_HELD_SOURCES).length).toBeGreaterThan(0);
    expect(scheduledSourceNames.length).toBeGreaterThan(0);
    expect(scheduledStages.length).toBeGreaterThan(0);
  });

  it('lists no owner-held source', () => {
    const held = scheduledSourceNames.filter((name) => name in OWNER_HELD_SOURCES);
    expect(held).toEqual([]);
  });

  it('lists no source whose name marks it as a description, writer or card lane', () => {
    const describing = scheduledSourceNames.filter((name) => DESCRIPTION_LANE_PATTERN.test(name));
    expect(describing).toEqual([]);
  });

  it('runs no post-run stage that synthesizes cards or descriptions', () => {
    const describing = scheduledStages.filter(
      (stage) =>
        DESCRIPTION_LANE_PATTERN.test(stage.name) || DESCRIPTION_LANE_PATTERN.test(stage.command),
    );
    expect(describing).toEqual([]);
  });

  it('recognizes every owner-held source as a description lane by name alone', () => {
    const unrecognized = Object.keys(OWNER_HELD_SOURCES).filter(
      (name) => !DESCRIPTION_LANE_PATTERN.test(name),
    );
    expect(unrecognized).toEqual([]);
  });
});
