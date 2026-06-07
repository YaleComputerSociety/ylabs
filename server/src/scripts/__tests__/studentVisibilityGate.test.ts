import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  assertStudentVisibilityGateApplyConfirmed,
  buildStudentVisibilityGateOutput,
  parseStudentVisibilityGateArgs,
  writeStudentVisibilityGateOutput,
} from '../studentVisibilityGate';

describe('studentVisibilityGate CLI helpers', () => {
  it('parses collection mode filters and output flags', () => {
    expect(
      parseStudentVisibilityGateArgs([
        '--collection=research',
        '--mode=dry-run',
        '--source=ysm-atoz-index',
        '--record-id=entity-1',
        '--limit=25',
        '--output',
        '/tmp/ylabs-student-visibility-gate.json',
      ]),
    ).toEqual({
      collection: 'research',
      mode: 'dry-run',
      confirmStudentVisibilityApply: false,
      sourceName: 'ysm-atoz-index',
      recordIds: ['entity-1'],
      limit: 25,
      output: '/tmp/ylabs-student-visibility-gate.json',
    });
  });

  it('parses max apply for student visibility gate apply bounds', () => {
    expect(
      parseStudentVisibilityGateArgs([
        '--apply',
        '--confirm-student-visibility-apply',
        '--collection=all',
        '--max-apply=25',
      ]),
    ).toMatchObject({
      collection: 'all',
      mode: 'apply',
      confirmStudentVisibilityApply: true,
      maxApply: 25,
    });
  });

  it('requires explicit confirmation before student visibility gate apply', () => {
    expect(parseStudentVisibilityGateArgs(['--apply'])).toMatchObject({
      mode: 'apply',
      confirmStudentVisibilityApply: false,
    });

    expect(() =>
      buildStudentVisibilityGateOutput(
        {
          environment: 'beta',
          db: 'Beta',
          options: {
            collection: 'all',
            mode: 'apply',
            confirmStudentVisibilityApply: false,
          },
        },
        {
          collection: 'all',
          mode: 'apply',
          scanned: 2,
          changed: 1,
        },
      ),
    ).toThrow(/--confirm-student-visibility-apply is required/);

    expect(
      parseStudentVisibilityGateArgs([
        '--apply',
        '--confirm-student-visibility-apply',
        '--collection=all',
      ]),
    ).toMatchObject({
      collection: 'all',
      mode: 'apply',
      confirmStudentVisibilityApply: true,
    });
  });

  it('rejects malformed student visibility gate arguments', () => {
    expect(() => parseStudentVisibilityGateArgs(['--limit=bad'])).toThrow(
      /--limit must be a positive integer/,
    );
    expect(() => parseStudentVisibilityGateArgs(['--max-apply=bad'])).toThrow(
      /--max-apply must be a positive integer/,
    );
    expect(() => parseStudentVisibilityGateArgs(['--limit=1e3'])).toThrow(
      /--limit must be a positive integer/,
    );
    expect(() => parseStudentVisibilityGateArgs(['--max-apply=1e3'])).toThrow(
      /--max-apply must be a positive integer/,
    );
    expect(() => parseStudentVisibilityGateArgs(['--output', '--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseStudentVisibilityGateArgs(['--output=--apply'])).toThrow(
      /--output requires a path/,
    );
  });

  it('requires and enforces max apply before student visibility gate writes', () => {
    expect(() =>
      assertStudentVisibilityGateApplyConfirmed({
        collection: 'all',
        mode: 'apply',
        confirmStudentVisibilityApply: true,
      }),
    ).toThrow(/--max-apply is required/);

    expect(() =>
      assertStudentVisibilityGateApplyConfirmed(
        {
          collection: 'all',
          mode: 'apply',
          confirmStudentVisibilityApply: true,
          maxApply: 2,
        },
        3,
      ),
    ).toThrow(/Apply would update visibility for 3 records, above --max-apply/);
  });

  it('writes the student visibility gate artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-visibility-gate-'));
    const output = path.join(dir, 'visibility-gate.json');
    writeStudentVisibilityGateOutput(
      {
        environment: 'beta',
        db: 'Beta',
        collection: 'all',
        mode: 'dry-run',
        scanned: 2,
        changed: 0,
      },
      output,
    );

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      environment: 'beta',
      db: 'Beta',
      collection: 'all',
      mode: 'dry-run',
      scanned: 2,
      changed: 0,
    });
  });

  it('wraps gate artifacts with target metadata and parsed options', () => {
    const options = {
      collection: 'all' as const,
      mode: 'dry-run' as const,
      confirmStudentVisibilityApply: false,
      limit: 25,
      output: '/tmp/ylabs-student-visibility-gate.json',
    };

    expect(
      buildStudentVisibilityGateOutput(
        { environment: 'beta', db: 'Beta', options },
        {
          collection: 'all',
          mode: 'dry-run',
          scanned: 2,
          changed: 0,
        },
      ),
    ).toEqual({
      environment: 'beta',
      db: 'Beta',
      options,
      collection: 'all',
      mode: 'dry-run',
      scanned: 2,
      changed: 0,
    });
  });
});
