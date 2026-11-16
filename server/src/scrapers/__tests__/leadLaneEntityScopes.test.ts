import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { LEAD_LANE_ENTITY_TYPE_SCOPES, laneReadsEntityType } from '../leadLaneEntityScopes';

const SOURCES_DIR = path.resolve(__dirname, '../sources');

describe('director lanes take their row-type scope from one registry (#6327)', () => {
  const directorLaneFiles = fs
    .readdirSync(SOURCES_DIR)
    .filter((file) => file.endsWith('.ts'))
    .filter((file) =>
      /field: 'inferredDirectorUserName'/.test(
        fs.readFileSync(path.join(SOURCES_DIR, file), 'utf8'),
      ),
    );

  it('finds the lanes that emit a director', () => {
    expect(directorLaneFiles.length).toBeGreaterThan(0);
  });

  it.each(directorLaneFiles)('%s reads its candidate rows through the registry scope', (file) => {
    const text = fs.readFileSync(path.join(SOURCES_DIR, file), 'utf8');
    expect(text).toMatch(/LEAD_LANE_ENTITY_TYPE_SCOPES\[/);
  });

  it('keeps every registered director lane off person rows', () => {
    for (const source of Object.keys(LEAD_LANE_ENTITY_TYPE_SCOPES)) {
      expect(laneReadsEntityType(source, 'FACULTY_RESEARCH_AREA')).toBe(false);
      expect(laneReadsEntityType(source, 'CENTER')).toBe(true);
    }
  });

  it('leaves a lane with no registered scope unrestricted', () => {
    expect(laneReadsEntityType('synthetic-unscoped-lane', 'FACULTY_RESEARCH_AREA')).toBe(true);
  });
});
