import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { researchEntityTypes } from '../../models/researchAccessTypes';
import { ResearchEntity } from '../../models/researchEntity';
import {
  LEAD_LANE_ENTITY_TYPE_SCOPES,
  laneLeadCountsOnEntityType,
  laneReadsEntityType,
} from '../leadLaneEntityScopes';
import {
  CENTER_DIRECTOR_LLM_SOURCE_NAME,
  defaultCenterFinder,
} from '../sources/centerDirectorLLMExtractor';
import {
  CENTER_DIRECTOR_SOURCE_NAME,
  findCenterDirectorTargets,
} from '../sources/centerDirectorScraper';

const ISSUE_6327_ORG_TYPES = ['CENTER', 'CORE_FACILITY', 'INITIATIVE', 'INSTITUTE'];
const ISSUE_6327_CODE_LANE_TYPES = [...ISSUE_6327_ORG_TYPES, 'LAB'].sort();

const slugFor = (entityType: string) => `synthetic-${entityType.toLowerCase().replace(/_/g, '-')}`;

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  await mongoose.connection.db!.collection('research_entities').deleteMany({});
  await mongoose.connection.db!.collection('role_assignments').deleteMany({});
  for (const entityType of researchEntityTypes) {
    await ResearchEntity.create({
      slug: slugFor(entityType),
      name: `Synthetic ${entityType}`,
      entityType,
      websiteUrl: `https://synthetic.yale.edu/${slugFor(entityType)}/`,
      archived: false,
    });
  }
});

const typesOfSlugs = (slugs: Array<string | undefined>) =>
  researchEntityTypes.filter((entityType) => slugs.includes(slugFor(entityType))).sort();

describe('director lanes read the row types their assertions count on (#6327)', () => {
  it('center-director-llm reads organisation rows only', async () => {
    const candidates = await defaultCenterFinder();
    const readTypes = typesOfSlugs(candidates.map((candidate) => candidate.slug));
    expect(readTypes).toEqual(ISSUE_6327_ORG_TYPES);
    expect(
      researchEntityTypes
        .filter((t) => laneReadsEntityType(CENTER_DIRECTOR_LLM_SOURCE_NAME, t))
        .sort(),
    ).toEqual(readTypes);
  });

  it('center-director reads organisation rows plus labs', async () => {
    const targets = await findCenterDirectorTargets([]);
    const readTypes = typesOfSlugs(targets.map((target) => target.slug));
    expect(readTypes).toEqual(ISSUE_6327_CODE_LANE_TYPES);
    expect(
      researchEntityTypes.filter((t) => laneReadsEntityType(CENTER_DIRECTOR_SOURCE_NAME, t)).sort(),
    ).toEqual(readTypes);
  });
});

describe('a director lane lead counts everywhere but a person row the lane does not read', () => {
  it('keeps every registered director lane off person rows', () => {
    for (const source of Object.keys(LEAD_LANE_ENTITY_TYPE_SCOPES)) {
      expect(laneLeadCountsOnEntityType(source, 'FACULTY_RESEARCH_AREA')).toBe(false);
      expect(laneLeadCountsOnEntityType(source, 'CENTER')).toBe(true);
    }
  });

  it('leaves a row whose type is not a person type alone', () => {
    expect(laneLeadCountsOnEntityType(CENTER_DIRECTOR_LLM_SOURCE_NAME, 'PROGRAM')).toBe(true);
  });

  it('refuses a lane with no registered scope on a person row and keeps it on an org row', () => {
    expect(laneLeadCountsOnEntityType('synthetic-unscoped-lane', 'FACULTY_RESEARCH_AREA')).toBe(
      false,
    );
    expect(laneLeadCountsOnEntityType('synthetic-unscoped-lane', 'CENTER')).toBe(true);
  });
});

describe('the lanes that emit a director are exactly the registered ones (#6327)', () => {
  const SOURCES_DIR = path.resolve(__dirname, '../sources');
  const EMITTING_LANE_FILES = ['centerDirectorLLMExtractor.ts', 'centerDirectorScraper.ts'];

  it('names every source file that emits a director field, so a new lane fails here', () => {
    const emitting = fs
      .readdirSync(SOURCES_DIR)
      .filter((file) => file.endsWith('.ts'))
      .filter((file) =>
        /field: 'inferredDirector(User)?Name'/.test(
          fs.readFileSync(path.join(SOURCES_DIR, file), 'utf8'),
        ),
      )
      .sort();
    expect(emitting).toEqual([...EMITTING_LANE_FILES].sort());
  });

  it('registers a scope for each emitting lane', () => {
    expect(Object.keys(LEAD_LANE_ENTITY_TYPE_SCOPES).sort()).toEqual(
      [CENTER_DIRECTOR_LLM_SOURCE_NAME, CENTER_DIRECTOR_SOURCE_NAME].sort(),
    );
  });
});
