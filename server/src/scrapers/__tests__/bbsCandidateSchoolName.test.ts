import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { schoolForDirectoryProfileHost } from '../../utils/personProfileRanking';

const LANE_SOURCE = fs.readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../sources/bbsResearchTrackScraper.ts',
  ),
  'utf8',
);

/**
 * The lane's candidate query matches a school by the name the CORPUS stores, and it read
 * `'Yale School of Medicine'`, which matches zero rows: every live row stores
 * `'School of Medicine'`. Both school arms were dead, so the candidate set was only its
 * slug-prefix arm and the lane could not re-reach a row whose slug was not `ysm-` or `bbs-`
 * prefixed. Measured on Development: 1,843 candidates against 2,269 once the name is right (#3834).
 *
 * Pinned against `schoolForDirectoryProfileHost`, which maps this school's own hosts to the same
 * stored name. That is a real cross-check rather than a restatement: the two are independently
 * maintained and they have to agree on one spelling for either to work.
 */
describe('the BBS lane names the school the way the corpus stores it (#3834)', () => {
  const declared = /const SCHOOL_NAME = '([^']+)';/.exec(LANE_SOURCE)?.[1];

  it('declares a school name at all', () => {
    expect(declared).toBeTruthy();
  });

  it.each(['medicine.yale.edu', 'ysm.yale.edu'])(
    'agrees with the stored name %s maps to',
    (host) => {
      expect(declared).toBe(schoolForDirectoryProfileHost(`https://${host}/profile/someone/`));
    },
  );

  it('does not use the brand form, which matches no row', () => {
    expect(declared).not.toMatch(/^Yale /);
  });

  /**
   * A predicate arm that matches nothing is how the reach was lost silently, so the lane says so.
   * The check needs `school` and `schools` in its own projection to be able to see them, which the
   * first draft of it omitted, making it fire on every run instead of never.
   */
  it('selects the fields its dead-arm check reads', () => {
    const projection = LANE_SOURCE.slice(
      LANE_SOURCE.indexOf('async function defaultEntityFinder'),
      LANE_SOURCE.indexOf('return docs.map(candidateFromDoc)'),
    );

    expect(projection).toContain('school: 1,');
    expect(projection).toContain('schools: 1,');
    expect(projection).toContain('no candidate row carries school');
  });
});
